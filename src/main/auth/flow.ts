/**
 * Interactive Auth-Code-with-PKCE sign-in via the system browser.
 *
 * Flow:
 *   1. Generate PKCE verifier + challenge.
 *   2. Build the Entra auth-code URL with redirect_uri = the app's custom
 *      protocol (msal-cost-estimator://auth).
 *   3. Open the URL in the system browser.
 *   4. Wait for handleAuthCallback() to be called with the redirect URL —
 *      Electron's main process catches the protocol via either
 *      `second-instance` (Windows/Linux, single-instance lock route) or
 *      `open-url` (macOS).
 *   5. Exchange the code for tokens via acquireTokenByCode.
 *   6. Notify state.ts via setSignedIn() so the renderer flips to the app.
 *
 * Only one interactive flow can be in-flight at a time. A second call
 * cancels the first.
 */

import { shell } from 'electron';
import { randomBytes, createHash } from 'node:crypto';

import { getMsal } from './msal';
import { setSignedIn, setSignedOut } from './state';

const REDIRECT_URI = 'msal-cost-estimator://auth';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingFlow {
  resolve: () => void;
  reject: (err: Error) => void;
  verifier: string;
  state: string;
  timeoutId: NodeJS.Timeout;
}

let pending: PendingFlow | null = null;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function cancelPending(reason: string): void {
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pending.reject(new Error(reason));
  pending = null;
}

/**
 * Kicks off interactive sign-in. Resolves when the user completes the
 * flow and the token cache contains an account; rejects on user cancel,
 * timeout, or upstream error.
 */
export async function startInteractiveSignIn(): Promise<void> {
  cancelPending('Superseded by another sign-in attempt');

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const pca = getMsal();
  const authCodeUrl = await pca.getAuthCodeUrl({
    scopes: ['openid', 'profile', 'offline_access'],
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state,
    prompt: 'select_account',
  });

  await shell.openExternal(authCodeUrl);

  return new Promise<void>((resolve, reject) => {
    pending = {
      resolve,
      reject,
      verifier,
      state,
      timeoutId: setTimeout(() => {
        if (pending) {
          pending.reject(new Error('Sign-in timed out after 5 minutes'));
          pending = null;
        }
      }, SIGN_IN_TIMEOUT_MS),
    };
  });
}

/**
 * Called by main/index.ts when a `msal-cost-estimator://...` URL arrives
 * via the OS (single-instance event on Windows, open-url on macOS).
 */
export async function handleAuthCallback(callbackUrl: string): Promise<void> {
  if (!pending) {
    console.warn('[auth] callback received but no flow in progress:', callbackUrl);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    cancelPending('Malformed auth callback URL');
    setSignedOut('Malformed auth callback URL');
    return;
  }

  const errorCode = parsed.searchParams.get('error');
  if (errorCode) {
    const desc = parsed.searchParams.get('error_description') ?? 'unknown';
    cancelPending(`${errorCode}: ${desc}`);
    setSignedOut(`${errorCode}: ${desc}`);
    return;
  }

  const code = parsed.searchParams.get('code');
  const returnedState = parsed.searchParams.get('state');
  if (!code || returnedState !== pending.state) {
    cancelPending('Auth callback missing code or state mismatch');
    setSignedOut('Auth callback failed validation');
    return;
  }

  const verifier = pending.verifier;
  const flow = pending;
  pending = null;
  clearTimeout(flow.timeoutId);

  try {
    const pca = getMsal();
    const result = await pca.acquireTokenByCode({
      code,
      scopes: ['openid', 'profile', 'offline_access'],
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    if (!result.account) {
      throw new Error('acquireTokenByCode returned no account');
    }
    setSignedIn(result.account);
    flow.resolve();
  } catch (err) {
    const message = (err as Error).message;
    setSignedOut(message);
    flow.reject(new Error(message));
  }
}
