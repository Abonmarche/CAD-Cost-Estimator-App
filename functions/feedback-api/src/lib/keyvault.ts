import { DefaultAzureCredential } from '@azure/identity'
import { SecretClient } from '@azure/keyvault-secrets'

interface CachedSecret {
  value: string
  fetchedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CachedSecret>()

export async function getSecret(vaultUrl: string, name: string): Promise<string> {
  const cacheKey = `${vaultUrl}::${name}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value
  }

  const client = new SecretClient(vaultUrl, new DefaultAzureCredential())
  const secret = await client.getSecret(name)
  if (!secret.value) {
    throw new Error(`Key Vault secret ${name} has no value`)
  }
  cache.set(cacheKey, { value: secret.value, fetchedAt: Date.now() })
  return secret.value
}

export function _clearCacheForTests() {
  cache.clear()
}
