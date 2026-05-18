import type { InvocationContext } from '@azure/functions'

export interface StructuredFields {
  [key: string]: string | number | boolean | null | undefined
}

const REDACTED_FIELDS = new Set(['pat', 'token', 'authorization', 'privateKey', 'private_key'])

export function logInfo(ctx: InvocationContext, event: string, fields: StructuredFields = {}) {
  ctx.log(JSON.stringify({ event, level: 'info', ...scrub(fields) }))
}

export function logWarn(ctx: InvocationContext, event: string, fields: StructuredFields = {}) {
  ctx.warn(JSON.stringify({ event, level: 'warn', ...scrub(fields) }))
}

export function logError(ctx: InvocationContext, event: string, fields: StructuredFields = {}) {
  ctx.error(JSON.stringify({ event, level: 'error', ...scrub(fields) }))
}

function scrub(fields: StructuredFields): StructuredFields {
  const out: StructuredFields = {}
  for (const [k, v] of Object.entries(fields)) {
    out[k] = REDACTED_FIELDS.has(k) ? '[REDACTED]' : v
  }
  return out
}
