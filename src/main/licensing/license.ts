import { createPublicKey, verify } from 'node:crypto'

/**
 * SPKI DER public key (base64) matching the private key held by whoever runs
 * scripts/generate-license.mjs. Regenerate both together if you want your own
 * signing key — see that script.
 */
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAAU+STd+3Yz20PMS+ICPgUgFw/fQYvfDqYCNjX3H9oI4='

export interface LicensePayload {
  email: string
  tier: 'pro'
  iat: number
}

function isLicensePayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.email === 'string' &&
    raw.email.length > 0 &&
    raw.tier === 'pro' &&
    typeof raw.iat === 'number'
  )
}

/**
 * Verifies a `MFPRO.<payload>.<signature>` key entirely offline against the
 * embedded public key. Returns the decoded payload if — and only if — the
 * signature checks out, otherwise null. No network access, no side effects.
 */
export function verifyLicenseKey(key: string): LicensePayload | null {
  const trimmed = key.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts[0] !== 'MFPRO') return null
  const [, payloadB64, sigB64] = parts

  try {
    const payloadBuf = Buffer.from(payloadB64, 'base64url')
    const sigBuf = Buffer.from(sigB64, 'base64url')
    const publicKey = createPublicKey({
      key: Buffer.from(PUBLIC_KEY_B64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    if (!verify(null, payloadBuf, publicKey, sigBuf)) return null

    const payload: unknown = JSON.parse(payloadBuf.toString('utf8'))
    return isLicensePayload(payload) ? payload : null
  } catch {
    return null
  }
}
