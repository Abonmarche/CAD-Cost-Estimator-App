/**
 * Auth state machine for the main process.
 *
 * Owns the "who is currently signed in" question. Broadcasts changes to
 * all renderer windows over IPC so the renderer's AuthContext stays in
 * sync without each component asking individually.
 *
 * Imports are split so flow.ts can call `onSignedIn()` without a circular
 * dep on tokens.ts.
 */

import { BrowserWindow } from 'electron';
import type { AccountInfo } from '@azure/msal-node';

import type { Account, AuthState } from '@shared/types';
import { IPC_CHANNELS } from '@shared/constants';

import { getMsal } from './msal';

let state: AuthState = { status: 'loading', account: null };
let currentMsalAccount: AccountInfo | null = null;

function toAccount(a: AccountInfo): Account {
  return {
    // localAccountId == Entra `oid` for v2 endpoint accounts. We use it
    // as the stable identifier across the app.
    id: a.localAccountId,
    name: a.name ?? '',
    username: a.username,
  };
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AuthStateChanged, state);
    }
  }
}

export function getAuthState(): AuthState {
  return state;
}

export function getCurrentMsalAccount(): AccountInfo | null {
  return currentMsalAccount;
}

export function setLoading(): void {
  state = { status: 'loading', account: null };
  broadcast();
}

export function setSignedOut(lastError?: string): void {
  currentMsalAccount = null;
  state = { status: 'signedOut', account: null, lastError };
  broadcast();
}

export function setSignedIn(account: AccountInfo): void {
  currentMsalAccount = account;
  state = { status: 'signedIn', account: toAccount(account) };
  broadcast();
}

/**
 * Inspect the persistent cache at app start. If there's a usable account
 * we mark ourselves signed in; otherwise signedOut. Actual per-API token
 * acquisition happens lazily on first use.
 */
export async function bootAuthState(): Promise<void> {
  setLoading();
  try {
    const pca = getMsal();
    const accounts = await pca.getTokenCache().getAllAccounts();
    if (accounts.length === 0) {
      setSignedOut();
      return;
    }
    // Try silent refresh against the user.read scope just to verify the
    // refresh token is still valid. We don't surface this access token —
    // per-API tokens are fetched on demand by tokens.ts.
    const account = accounts[0];
    try {
      await pca.acquireTokenSilent({
        account,
        scopes: ['openid', 'profile', 'offline_access'],
      });
      setSignedIn(account);
    } catch {
      // Refresh token expired or revoked — drop back to signedOut
      setSignedOut();
    }
  } catch (err) {
    setSignedOut((err as Error).message);
  }
}

export async function signOut(): Promise<void> {
  if (currentMsalAccount) {
    try {
      await getMsal().getTokenCache().removeAccount(currentMsalAccount);
    } catch (err) {
      console.warn('[auth] cache.removeAccount failed:', (err as Error).message);
    }
  }
  setSignedOut();
}
