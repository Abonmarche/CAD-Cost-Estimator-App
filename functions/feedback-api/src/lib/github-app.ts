import { createSign } from 'node:crypto'
import { getSecret } from './keyvault.js'

interface InstallationToken {
  token: string
  expiresAt: number
}

let cachedInstallationToken: InstallationToken | null = null
const INSTALLATION_TOKEN_SAFETY_MS = 5 * 60 * 1000

export interface GitHubAppConfig {
  appId: string
  installationId: string
  vaultUrl: string
  secretName: string
}

// CUSTOMIZE: replace cost-estimator in the User-Agent with your project slug.
const USER_AGENT = 'cost-estimator-Feedback/1.0'

export async function getInstallationToken(cfg: GitHubAppConfig): Promise<string> {
  const now = Date.now()
  if (cachedInstallationToken && cachedInstallationToken.expiresAt - INSTALLATION_TOKEN_SAFETY_MS > now) {
    return cachedInstallationToken.token
  }

  const privateKey = await getSecret(cfg.vaultUrl, cfg.secretName)
  const appJwt = signAppJwt(cfg.appId, privateKey)

  const res = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(cfg.installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
      },
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub installation-token exchange failed: ${res.status} ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as { token: string; expires_at: string }
  const expiresAt = new Date(data.expires_at).getTime()

  cachedInstallationToken = { token: data.token, expiresAt }
  return data.token
}

function signAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  }

  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const sig = signer.sign(privateKeyPem)
  return `${signingInput}.${b64urlBuf(sig)}`
}

function b64url(input: string): string {
  return b64urlBuf(Buffer.from(input, 'utf8'))
}

function b64urlBuf(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function _resetTokenCacheForTests() {
  cachedInstallationToken = null
}
