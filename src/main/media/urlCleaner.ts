const TRACKING_PARAM_NAMES = new Set([
  'si',
  'feature',
  'app',
  'persist_app',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
])

function isTrackingParam(name: string): boolean {
  if (TRACKING_PARAM_NAMES.has(name.toLowerCase())) return true
  return /^utm_/i.test(name)
}

export type UrlValidation =
  { ok: true; url: URL } | { ok: false; reason: 'empty' | 'scheme' | 'parse' }

export function validateUrl(raw: string): UrlValidation {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, reason: 'scheme' }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return { ok: false, reason: 'scheme' }
    return { ok: true, url }
  } catch {
    return { ok: false, reason: 'parse' }
  }
}

export function hasTrackingParams(url: URL): boolean {
  for (const key of new Set(url.searchParams.keys())) {
    if (isTrackingParam(key)) return true
  }
  return false
}

export function stripTrackingParams(url: URL): string {
  const cleaned = new URL(url.toString())
  for (const key of Array.from(cleaned.searchParams.keys())) {
    if (isTrackingParam(key)) cleaned.searchParams.delete(key)
  }
  return cleaned.toString()
}

export function cleanUrlForRetry(url: string): string | null {
  const parsed = validateUrl(url)
  if (!parsed.ok) return null
  if (!hasTrackingParams(parsed.url)) return null
  return stripTrackingParams(parsed.url)
}
