/**
 * Per-API token acquisition.
 *
 * Both APIs share the same desktop client app registration; each is its own
 * Entra "API" app registration exposing `access_as_user`. We request the
 * scope `api://<api-app-id>/access_as_user` to get an access token whose
 * `aud` matches the corresponding Function App's audience validation.
 *
 * Resolution order:
 *   1. acquireTokenSilent (uses refresh token from cache)
 *   2. On silent failure, kick off interactive sign-in, then retry silent.
 *
 * Concurrent requests for the same scope deduplicate via the inflight map.
 */

import type { AccountInfo } from '@azure/msal-node';

import { getMsal } from './msal';
import { getCurrentMsalAccount } from './state';
import { startInteractiveSignIn } from './flow';

export type ApiScope = 'llm' | 'feedback';

const inflight = new Map<ApiScope, Promise<string>>();

function scopeUri(scope: ApiScope): string {
  const id =
    scope === 'llm' ? process.env.LLM_API_APP_ID : process.env.FEEDBACK_API_APP_ID;
  if (!id) {
    throw new Error(
      `Missing ${scope === 'llm' ? 'LLM' : 'FEEDBACK'}_API_APP_ID in baked env`,
    );
  }
  return `api://${id}/access_as_user`;
}

async function silentAcquire(
  account: AccountInfo,
  scope: ApiScope,
): Promise<string> {
  const res = await getMsal().acquireTokenSilent({
    account,
    scopes: [scopeUri(scope)],
  });
  return res.accessToken;
}

export async function getApiToken(scope: ApiScope): Promise<string> {
  const existing = inflight.get(scope);
  if (existing) return existing;

  const promise = (async (): Promise<string> => {
    let account = getCurrentMsalAccount();
    if (!account) {
      await startInteractiveSignIn();
      account = getCurrentMsalAccount();
      if (!account) {
        throw new Error('Sign-in did not produce an account');
      }
    }
    try {
      return await silentAcquire(account, scope);
    } catch {
      // Silent failed — refresh token expired, consent revoked, MFA challenge.
      // Drop back to interactive and retry once.
      await startInteractiveSignIn();
      const next = getCurrentMsalAccount();
      if (!next) {
        throw new Error('Re-authentication did not produce an account');
      }
      return await silentAcquire(next, scope);
    }
  })();

  inflight.set(scope, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(scope);
  }
}
