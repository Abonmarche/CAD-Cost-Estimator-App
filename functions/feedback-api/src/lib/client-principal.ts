export interface Caller {
  oid: string
  email: string | undefined
  name: string | undefined
}

interface EasyAuthPrincipal {
  auth_typ?: string
  name_typ?: string
  role_typ?: string
  claims?: Array<{ typ: string; val: string }>
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export function extractCaller(headers: Headers | Record<string, string | undefined>): Caller {
  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('x-ms-client-principal')
      : (headers as Record<string, string | undefined>)['x-ms-client-principal']

  if (!raw) {
    throw new UnauthorizedError('Missing X-MS-CLIENT-PRINCIPAL header - Easy Auth not enforcing?')
  }

  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8')
  } catch {
    throw new UnauthorizedError('X-MS-CLIENT-PRINCIPAL is not valid base64')
  }

  let parsed: EasyAuthPrincipal
  try {
    parsed = JSON.parse(decoded) as EasyAuthPrincipal
  } catch {
    throw new UnauthorizedError('X-MS-CLIENT-PRINCIPAL is not valid JSON')
  }

  const claims = parsed.claims ?? []
  const byType = (types: string[]): string | undefined =>
    claims.find((c) => types.includes(c.typ))?.val

  const oid = byType([
    'http://schemas.microsoft.com/identity/claims/objectidentifier',
    'oid',
  ])
  if (!oid) {
    throw new UnauthorizedError('Token is missing the oid claim')
  }

  const email = byType([
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'emails',
    'preferred_username',
    'upn',
    'email',
  ])
  const name = byType(['name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'])

  return { oid, email, name }
}
