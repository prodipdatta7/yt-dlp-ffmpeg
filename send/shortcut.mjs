const { URL, URLSearchParams } = globalThis
const STORAGE_KEY = 'mediaforge.receiver.v1'

/** Only the exact private IPv4 receiver URLs emitted by MediaForge can be paired. */
export function receiverUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null
  try {
    const url = new URL(raw)
    const octets = url.hostname.split('.').map(Number)
    const [a, b] = octets
    const privateHost =
      octets.length === 4 &&
      octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
    if (
      !privateHost ||
      url.protocol !== 'http:' ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/receive\/[a-f0-9]{48}$/.test(url.pathname)
    )
      return null
    return url.href
  } catch {
    return null
  }
}

export function mediaUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) return null
  try {
    const url = new URL(raw)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export function pairing(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null
  const url = receiverUrl(value.url)
  if (
    !url ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= now ||
    value.expiresAt > now + 15 * 60 * 1000
  )
    return null
  return { url, expiresAt: value.expiresAt }
}

export function readPairing(storage, now = Date.now()) {
  try {
    return pairing(JSON.parse(storage.getItem(STORAGE_KEY)), now)
  } catch {
    return null
  }
}

export function savePairing(storage, value) {
  const valid = pairing(value)
  if (!valid)
    throw new Error(
      'This receiver session has expired or is invalid. Start a new session in MediaForge.',
    )
  storage.setItem(STORAGE_KEY, JSON.stringify(valid))
  return valid
}

export function forgetPairing(storage) {
  storage.removeItem(STORAGE_KEY)
}

export function readFragment(hash, now = Date.now()) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return { kind: 'empty' }
  if (raw.startsWith('pair=')) {
    const params = new URLSearchParams(raw)
    const value = pairing(
      { url: params.get('pair'), expiresAt: Number(params.get('expires')) },
      now,
    )
    return value ? { kind: 'pair', value } : { kind: 'error' }
  }
  const url = mediaUrl(raw)
  return url ? { kind: 'send', url } : { kind: 'error' }
}

export function destination(value, raw, now = Date.now()) {
  const valid = pairing(value, now)
  const url = mediaUrl(raw)
  return valid && url ? valid.url + '#' + url : null
}
