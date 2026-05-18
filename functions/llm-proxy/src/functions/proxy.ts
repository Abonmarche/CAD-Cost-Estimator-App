/**
 * Anthropic API reverse proxy.
 *
 * Catch-all handler under /v1/* that:
 *   1. Validates the caller's MSAL token (manual JWT — see lib/jwt-validate.ts
 *      for why Easy Auth isn't used).
 *   2. Reads the Anthropic API key from Key Vault via the Function App's
 *      Managed Identity (cached 5 minutes in-process).
 *   3. Forwards the request to https://api.anthropic.com<path> with the real
 *      x-api-key, preserving body and most headers.
 *   4. Streams the response back. For SSE responses, also tees a rolling
 *      tail buffer to extract usage counts after the stream completes.
 *
 * Why a generic /v1/* catch-all: the desktop client uses
 * @anthropic-ai/claude-agent-sdk → @anthropic-ai/sdk, which hits multiple
 * paths (/v1/messages, /v1/files, /v1/models, ...). Forwarding the full
 * path keeps the proxy upstream-agnostic — if Anthropic adds a new endpoint
 * tomorrow, we don't need a redeploy.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

import { validateToken, JwtValidationError } from '../lib/jwt-validate.js';
import { getSecret } from '../lib/keyvault.js';
import { logError, logInfo } from '../lib/logger.js';
import {
  appendToTail,
  logUsageFromBuffer,
  logUsageFromJson,
} from '../lib/usage-log.js';

// Headers we strip before forwarding to Anthropic. `host` is set by fetch
// automatically; `authorization` and `x-api-key` carried our MSAL token,
// not the Anthropic key. The rest are infrastructure headers that the
// upstream doesn't care about.
const STRIP_REQ_HEADERS = new Set([
  'host',
  'authorization',
  'x-api-key',
  'connection',
  'content-length', // fetch recomputes
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-arr-log-id',
  'disguised-host',
  'x-original-url',
  'x-waws-unencoded-url',
  'x-site-deployment-id',
  'was-default-hostname',
  'x-forwarded-host',
]);

// Headers we strip from the upstream response before returning. Most
// hop-by-hop headers; let fetch handle transfer-encoding.
const STRIP_RESP_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'content-length',
  'content-encoding', // upstream may compress; we passed through
]);

function buildUpstreamUrl(reqUrl: string): URL {
  const upstreamBase = process.env.ANTHROPIC_UPSTREAM ?? 'https://api.anthropic.com';
  const incoming = new URL(reqUrl);
  // Strip the Function App's route prefix. Azure Functions surfaces the
  // path the route matched; `/v1/messages` is what /v1/{*path} captures.
  const upstream = new URL(upstreamBase);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  return upstream;
}

function copyRequestHeaders(req: HttpRequest, apiKey: string): Headers {
  const out = new Headers();
  for (const [name, value] of req.headers.entries()) {
    if (STRIP_REQ_HEADERS.has(name.toLowerCase())) continue;
    out.set(name, value);
  }
  out.set('x-api-key', apiKey);
  return out;
}

function copyResponseHeaders(upstream: Response): Headers {
  const out = new Headers();
  for (const [name, value] of upstream.headers.entries()) {
    if (STRIP_RESP_HEADERS.has(name.toLowerCase())) continue;
    out.set(name, value);
  }
  return out;
}

export async function proxy(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  const started = Date.now();
  let oid: string;
  let username: string | undefined;
  try {
    const claims = await validateToken(req.headers);
    oid = claims.oid;
    username = claims.preferredUsername ?? claims.name;
  } catch (err) {
    if (err instanceof JwtValidationError) {
      logError('auth_failed', { code: err.code });
      return {
        status: 401,
        headers: { 'content-type': 'application/json' },
        jsonBody: {
          type: 'error',
          error: { type: 'authentication_error', message: `Auth failed: ${err.code}` },
        },
      };
    }
    logError('auth_unexpected', { err: (err as Error).message });
    return {
      status: 500,
      headers: { 'content-type': 'application/json' },
      jsonBody: {
        type: 'error',
        error: { type: 'api_error', message: 'Internal auth error' },
      },
    };
  }

  let anthropicKey: string;
  try {
    anthropicKey = await getSecret('anthropic-api-key');
  } catch (err) {
    logError('keyvault_failed', { oid, err: (err as Error).message });
    return {
      status: 500,
      headers: { 'content-type': 'application/json' },
      jsonBody: {
        type: 'error',
        error: { type: 'api_error', message: 'Could not read upstream credentials' },
      },
    };
  }

  const upstreamUrl = buildUpstreamUrl(req.url);
  const upstreamHeaders = copyRequestHeaders(req, anthropicKey);

  // Read body as buffer for non-GET. We don't pass through a stream because
  // the @anthropic-ai/sdk doesn't currently stream uploads, and treating
  // it as a buffer simplifies retry logic on transient upstream errors.
  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  logInfo('proxy_request', {
    oid,
    method: req.method,
    path: upstreamUrl.pathname,
    contentType: req.headers.get('content-type'),
  });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
      // Don't follow redirects — surface them to the client like Anthropic
      // would.
      redirect: 'manual',
    });
  } catch (err) {
    logError('upstream_fetch_failed', { oid, err: (err as Error).message });
    return {
      status: 502,
      headers: { 'content-type': 'application/json' },
      jsonBody: {
        type: 'error',
        error: { type: 'api_error', message: 'Upstream unreachable' },
      },
    };
  }

  const respHeaders = copyResponseHeaders(upstream);
  const isStreaming = respHeaders.get('content-type')?.includes('text/event-stream') ?? false;
  // Pull the requested model out of the request body for logging context
  // — best-effort, no fatal failure on parse error.
  const model = bestEffortModel(body);

  if (!upstream.body) {
    return {
      status: upstream.status,
      headers: Object.fromEntries(respHeaders.entries()),
    };
  }

  if (isStreaming) {
    // Tee the body so we can return it AND scan a trailing buffer for
    // usage telemetry.
    //
    // Type note: explicitly annotated as `Uint8Array<ArrayBufferLike>` so
    // it accepts the return of appendToTail() (which uses the loose Buffer
    // backing). @types/node 22 narrowed `new Uint8Array(n)` to
    // `Uint8Array<ArrayBuffer>` (strict), which is invariant in the buffer
    // generic, so without this widening the reassignment doesn't compile.
    let tail: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    const [forClient, forSampling] = upstream.body.tee();
    void (async () => {
      const reader = forSampling.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          tail = appendToTail(tail, value);
        }
      } catch {
        // Sampling failure should never affect the client.
      } finally {
        reader.releaseLock();
        logUsageFromBuffer(oid, model, Date.now() - started, tail);
      }
    })();
    ctx.log(`proxy: streaming response to ${oid} (${username ?? 'unknown'})`);
    return {
      status: upstream.status,
      headers: Object.fromEntries(respHeaders.entries()),
      body: forClient,
    };
  }

  // Non-streaming JSON: buffer it so we can log usage AND return.
  const buf = new Uint8Array(await upstream.arrayBuffer());
  if (upstream.status === 200) {
    logUsageFromJson(oid, model, Date.now() - started, new TextDecoder('utf-8').decode(buf));
  }
  return {
    status: upstream.status,
    headers: Object.fromEntries(respHeaders.entries()),
    body: buf,
  };
}

function bestEffortModel(body: ArrayBuffer | undefined): string | null {
  if (!body) return null;
  try {
    const text = new TextDecoder('utf-8').decode(body);
    const obj = JSON.parse(text) as { model?: string };
    return obj.model ?? null;
  } catch {
    return null;
  }
}

app.http('proxy', {
  // Catch-all under /v1/*. Anthropic API paths all live under /v1/ today.
  route: 'v1/{*restOfPath}',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
  authLevel: 'anonymous', // Auth is handled in the handler via JWT validation
  handler: proxy,
});
