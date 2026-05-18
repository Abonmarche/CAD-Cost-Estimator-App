/**
 * Structured logging with secret scrubbing.
 *
 * Functions runtime captures stdout JSON lines into App Insights as
 * `traces`. Emitting one JSON object per line keeps queries clean.
 *
 * Scrubbing: any string field that LOOKS like an Anthropic key, a bearer
 * token, or a JWT gets redacted before logging. This is belt-and-braces —
 * we should never be logging those — but the cost of being wrong is high
 * enough to justify the defensive scrub.
 */

const REDACT_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic API keys
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, // JWTs
  /Bearer\s+[A-Za-z0-9_.\-+/=]{20,}/gi, // Bearer headers
];

function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    let v = value;
    for (const p of REDACT_PATTERNS) v = v.replace(p, '[REDACTED]');
    return v;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ...(scrub(fields) as object) }));
}

export function logWarn(event: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ level: 'warn', event, ...(scrub(fields) as object) }));
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', event, ...(scrub(fields) as object) }));
}
