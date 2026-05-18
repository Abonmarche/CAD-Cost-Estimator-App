import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { validateFeedback, ValidationError } from '../lib/validate.js'
import { extractCaller, UnauthorizedError } from '../lib/client-principal.js'
import { RateLimiter } from '../lib/rate-limit.js'
import { buildIssuePayload } from '../lib/issue-body.js'
import { getInstallationToken } from '../lib/github-app.js'
import { createIssue } from '../lib/github-issues.js'
import { logInfo, logWarn, logError } from '../lib/logger.js'

const limiter = new RateLimiter()

interface EnvConfig {
  appId: string
  installationId: string
  owner: string
  repo: string
  vaultUrl: string
  secretName: string
}

function readConfig(): EnvConfig {
  const required = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_INSTALLATION_ID: process.env.GITHUB_INSTALLATION_ID,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    GITHUB_REPO: process.env.GITHUB_REPO,
    KEY_VAULT_URL: process.env.KEY_VAULT_URL,
    KEY_VAULT_SECRET_NAME: process.env.KEY_VAULT_SECRET_NAME,
  }
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`)
  }
  return {
    appId: required.GITHUB_APP_ID!,
    installationId: required.GITHUB_INSTALLATION_ID!,
    owner: required.GITHUB_OWNER!,
    repo: required.GITHUB_REPO!,
    vaultUrl: required.KEY_VAULT_URL!,
    secretName: required.KEY_VAULT_SECRET_NAME!,
  }
}

function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: { 'Content-Type': 'application/json' },
  }
}

export async function submitFeedback(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  const started = Date.now()

  let config: EnvConfig
  try {
    config = readConfig()
  } catch (err) {
    logError(ctx, 'config_missing', { message: (err as Error).message })
    return json(500, { ok: false, error: { code: 'server_misconfigured' } })
  }

  let caller
  try {
    caller = extractCaller(req.headers)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      logWarn(ctx, 'unauthorized', { reason: err.message })
      return json(401, { ok: false, error: { code: 'unauthorized' } })
    }
    throw err
  }

  const rate = limiter.check(caller.oid)
  if (!rate.allowed) {
    logWarn(ctx, 'rate_limited', { oid: caller.oid, resetAt: rate.resetAt })
    return json(429, {
      ok: false,
      error: { code: 'rate_limited', resetAt: new Date(rate.resetAt).toISOString() },
    })
  }

  let input
  try {
    const raw = await req.json()
    input = validateFeedback(raw)
  } catch (err) {
    if (err instanceof ValidationError) {
      logInfo(ctx, 'validation_error', { field: err.field, oid: caller.oid })
      return json(400, {
        ok: false,
        error: { code: 'validation_error', field: err.field, message: err.message },
      })
    }
    logInfo(ctx, 'bad_json', { oid: caller.oid })
    return json(400, { ok: false, error: { code: 'invalid_json' } })
  }

  const payload = buildIssuePayload(input, caller)

  let issue
  try {
    const token = await getInstallationToken({
      appId: config.appId,
      installationId: config.installationId,
      vaultUrl: config.vaultUrl,
      secretName: config.secretName,
    })
    issue = await createIssue(token, config.owner, config.repo, payload)
  } catch (err) {
    logError(ctx, 'github_upstream_error', {
      oid: caller.oid,
      message: (err as Error).message,
    })
    return json(502, { ok: false, error: { code: 'upstream_error' } })
  }

  const ms = Date.now() - started
  logInfo(ctx, 'issue_created', {
    oid: caller.oid,
    email: caller.email,
    type: input.type,
    issueNumber: issue.number,
    ms,
  })

  return json(200, {
    ok: true,
    issue: { number: issue.number, url: issue.htmlUrl },
  })
}

app.http('submit-feedback', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'submit-feedback',
  handler: submitFeedback,
})
