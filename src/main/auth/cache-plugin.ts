/**
 * MSAL token cache backed by Electron's `safeStorage` (DPAPI on Windows,
 * Keychain on macOS, kwallet/libsecret on Linux).
 *
 * Why not @azure/msal-node-extensions: the extensions package brings in
 * native bindings that need a separate electron-rebuild pass. safeStorage
 * is built into Electron, gives us the same OS-level encryption, and Just
 * Works after a vanilla npm install.
 *
 * Cache file lives at <userData>/msal-cache.bin, encrypted-to-user. Soft
 * fallback to plaintext if safeStorage isn't available on the platform
 * (shouldn't happen on Win/Mac/Linux-with-keyring) so dev iteration on a
 * minimal container doesn't break.
 */

import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';

function cachePath(): string {
  return join(app.getPath('userData'), 'msal-cache.bin');
}

export const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
    try {
      const data = await fs.readFile(cachePath());
      if (data.length === 0) return;
      let plaintext: string;
      if (safeStorage.isEncryptionAvailable()) {
        plaintext = safeStorage.decryptString(data);
      } else {
        plaintext = data.toString('utf8');
      }
      ctx.tokenCache.deserialize(plaintext);
    } catch (err) {
      // ENOENT (no cache yet) or corrupt cache — start fresh.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[msal] cache read failed, starting fresh:', (err as Error).message);
      }
    }
  },
  async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
    if (!ctx.cacheHasChanged) return;
    const plaintext = ctx.tokenCache.serialize();
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plaintext);
        await fs.writeFile(cachePath(), encrypted);
      } else {
        await fs.writeFile(cachePath(), plaintext, 'utf8');
      }
    } catch (err) {
      console.error('[msal] cache write failed:', (err as Error).message);
    }
  },
};
