/**
 * Tee the upstream response stream to capture Anthropic's `message_stop`
 * event, which carries the final usage counts (input_tokens,
 * output_tokens, cache tokens). We don't need to parse every SSE event —
 * just keep a rolling buffer of the last ~8KB so we can find the
 * terminal usage payload after the stream completes.
 *
 * Why a tee instead of parsing inline: the proxy's primary job is to pass
 * bytes through with minimum latency. We accumulate a tail buffer and
 * scan it once at the end, rather than touching every byte.
 *
 * For non-streaming JSON responses, parse the whole body and emit usage
 * from `response.usage`.
 */

import { logInfo, logWarn } from './logger.js';

interface UsagePayload {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const TAIL_BUFFER_MAX = 16 * 1024;

export function logUsageFromBuffer(
  oid: string,
  model: string | null,
  durationMs: number,
  tail: Uint8Array,
): void {
  const text = new TextDecoder('utf-8').decode(tail);
  // Try SSE final message_delta event format. The shape we look for is:
  //   event: message_delta
  //   data: { ..., "usage": { "input_tokens": N, "output_tokens": M } }
  //
  // OR the message_start which has the initial input_tokens.
  const usage = scanForUsage(text);
  if (usage) {
    logInfo('llm_usage', {
      oid,
      model,
      duration_ms: durationMs,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
    });
  } else {
    logWarn('llm_usage_missing', { oid, model, duration_ms: durationMs });
  }
}

function scanForUsage(text: string): UsagePayload | null {
  // Look for the final SSE event containing a `usage` field. We scan from
  // the end backward; the message_delta with output_tokens is the
  // terminal one we want.
  const dataMatches = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)];
  for (let i = dataMatches.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(dataMatches[i][1]) as { usage?: UsagePayload };
      if (obj.usage && typeof obj.usage.output_tokens === 'number') {
        return obj.usage;
      }
    } catch {
      // Malformed JSON in the buffer (probably truncated) — skip.
    }
  }
  return null;
}

export function appendToTail(tail: Uint8Array, chunk: Uint8Array): Uint8Array {
  const combined = new Uint8Array(tail.length + chunk.length);
  combined.set(tail, 0);
  combined.set(chunk, tail.length);
  if (combined.length <= TAIL_BUFFER_MAX) return combined;
  return combined.subarray(combined.length - TAIL_BUFFER_MAX);
}

export function logUsageFromJson(
  oid: string,
  model: string | null,
  durationMs: number,
  body: string,
): void {
  try {
    const obj = JSON.parse(body) as { usage?: UsagePayload; model?: string };
    if (obj.usage) {
      logInfo('llm_usage', {
        oid,
        model: model ?? obj.model ?? null,
        duration_ms: durationMs,
        input_tokens: obj.usage.input_tokens,
        output_tokens: obj.usage.output_tokens,
        cache_creation_input_tokens: obj.usage.cache_creation_input_tokens,
        cache_read_input_tokens: obj.usage.cache_read_input_tokens,
      });
    }
  } catch {
    logWarn('llm_usage_parse_failed', { oid, model, duration_ms: durationMs });
  }
}
