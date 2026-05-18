/**
 * MSAL JWT validation against the tenant's JWKS.
 *
 * Why this exists: Easy Auth is disabled on this Function App because the
 * @anthropic-ai/sdk authenticates with `x-api-key: <key>` rather than
 * `Authorization: Bearer`, and Easy Auth only validates tokens in the
 * Authorization header. So we substitute the user's MSAL access token for
 * the "key" and validate it manually here.
 *
 * Token shape we accept:
 *   - aud = api://<LLM_API_APP_ID>  (the LLM API app registration)
 *   - iss = https://login.microsoftonline.com/<TENANT_ID>/v2.0
 *   - signature verified against the tenant's published JWKS
 *
 * Both `x-api-key` (Agent-SDK path) and `Authorization: Bearer` (direct
 * HTTP clients, like our smoke-test curl) are accepted. Returns the
 * decoded claims (we use `oid` and `name` for usage logging downstream).
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) throw new Error('TENANT_ID app setting is not configured');
  // The v2.0 issuer's JWKS endpoint. jose caches keys and refreshes on
  // unknown kid.
  jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );
  return jwks;
}

export interface ValidatedClaims {
  oid: string;
  name?: string;
  preferredUsername?: string;
}

export class JwtValidationError extends Error {
  constructor(
    public code:
      | 'missing_token'
      | 'invalid_token'
      | 'wrong_audience'
      | 'wrong_issuer'
      | 'expired'
      | 'malformed_claims',
    message: string,
  ) {
    super(message);
    this.name = 'JwtValidationError';
  }
}

function extractToken(headers: Headers): string {
  // Prefer x-api-key (Agent SDK path), fall back to Authorization.
  const apiKey = headers.get('x-api-key');
  if (apiKey) return apiKey.trim();

  const auth = headers.get('authorization');
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  throw new JwtValidationError('missing_token', 'No token in x-api-key or Authorization header');
}

export async function validateToken(headers: Headers): Promise<ValidatedClaims> {
  const token = extractToken(headers);
  const tenantId = process.env.TENANT_ID;
  const apiAppId = process.env.LLM_API_APP_ID;
  if (!tenantId || !apiAppId) {
    throw new Error('TENANT_ID or LLM_API_APP_ID app setting is missing');
  }
  const expectedAudience = `api://${apiAppId}`;
  const expectedIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJwks(), {
      audience: expectedAudience,
      issuer: expectedIssuer,
    });
    payload = result.payload;
  } catch (err) {
    const code = mapJoseError(err);
    throw new JwtValidationError(code, (err as Error).message);
  }

  const oid = typeof payload.oid === 'string' ? payload.oid : null;
  if (!oid) {
    throw new JwtValidationError('malformed_claims', 'Token has no oid claim');
  }
  return {
    oid,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    preferredUsername:
      typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
  };
}

function mapJoseError(err: unknown): JwtValidationError['code'] {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ERR_JWT_EXPIRED') return 'expired';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    const claim = (err as { claim?: string }).claim;
    if (claim === 'aud') return 'wrong_audience';
    if (claim === 'iss') return 'wrong_issuer';
  }
  return 'invalid_token';
}
