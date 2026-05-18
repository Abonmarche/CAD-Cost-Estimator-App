/**
 * Lazily-constructed MSAL PublicClientApplication for the Cost Estimator
 * desktop client.
 *
 * Public client because the desktop app can't safely hold a client secret —
 * the Auth-Code-with-PKCE flow on a public client is the canonical pattern
 * for native apps.
 *
 * Config values come from baked env (MSAL_CLIENT_ID, MSAL_TENANT_ID),
 * which `injectBakedEnv()` republishes onto process.env at startup.
 */

import {
  PublicClientApplication,
  LogLevel,
  type Configuration,
} from '@azure/msal-node';

import { cachePlugin } from './cache-plugin';

let pca: PublicClientApplication | null = null;

function buildConfig(): Configuration {
  const clientId = process.env.MSAL_CLIENT_ID;
  const tenantId = process.env.MSAL_TENANT_ID;
  if (!clientId || !tenantId) {
    throw new Error(
      'MSAL_CLIENT_ID and MSAL_TENANT_ID must be baked into the build.',
    );
  }
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    cache: {
      cachePlugin,
    },
    system: {
      loggerOptions: {
        loggerCallback: (_level, message, containsPii) => {
          if (containsPii) return;
          // eslint-disable-next-line no-console
          console.log('[msal]', message);
        },
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  };
}

export function getMsal(): PublicClientApplication {
  if (!pca) {
    pca = new PublicClientApplication(buildConfig());
  }
  return pca;
}
