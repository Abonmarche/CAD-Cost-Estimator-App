/**
 * Key Vault secret reader with in-process cache.
 *
 * DefaultAzureCredential picks up the Function App's system Managed
 * Identity automatically when running on Flex Consumption. Locally it
 * falls back to Azure CLI auth.
 *
 * Cache TTL is 5 minutes — short enough that key rotations propagate
 * without a restart, long enough that we don't hammer KV on every
 * request. Per-instance cache; instances scale independently.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

let client: SecretClient | null = null;

function getClient(): SecretClient {
  if (client) return client;
  const vaultName = process.env.KEY_VAULT_NAME;
  if (!vaultName) {
    throw new Error('KEY_VAULT_NAME app setting is not configured');
  }
  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  client = new SecretClient(vaultUrl, new DefaultAzureCredential());
  return client;
}

export async function getSecret(name: string): Promise<string> {
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const secret = await getClient().getSecret(name);
  if (!secret.value) {
    throw new Error(`Secret '${name}' has no value`);
  }
  cache.set(name, { value: secret.value, expiresAt: now + CACHE_TTL_MS });
  return secret.value;
}
