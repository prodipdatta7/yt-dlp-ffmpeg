import { describe, expect, it } from 'vitest'
import {
  cleanUrlForRetry,
  hasTrackingParams,
  stripTrackingParams,
  validateUrl,
} from '../../src/main/media/urlCleaner'

describe('validateUrl (PRD §3.1)', () => {
  const cases: Array<{ input: string; ok: boolean; reason?: string }> = [
    { input: '', ok: false, reason: 'empty' },
    { input: '   ', ok: false, reason: 'empty' },
    { input: 'youtube.com/watch?v=abc', ok: false, reason: 'scheme' },
    { input: 'ftp://example.com/file', ok: false, reason: 'scheme' },
    { input: 'https://youtu.be/abc', ok: true },
    { input: '  https://www.youtube.com/watch?v=abc  ', ok: true },
    { input: 'http://example.com', ok: true },
    { input: 'https://exa mple.com/x', ok: false, reason: 'parse' },
  ]

  for (const c of cases) {
    it(`"${c.input}" → ${c.ok ? 'ok' : `rejected (${c.reason})`}`, () => {
      const res = validateUrl(c.input)
      expect(res.ok).toBe(c.ok)
      if (!res.ok && c.reason) expect(res.reason).toBe(c.reason)
    })
  }
})

function parse(s: string): URL {
  return new URL(s)
}

describe('tracking-param handling', () => {
  it('detects tracking params', () => {
    expect(hasTrackingParams(parse('https://x.test/v?a=1&si=abc'))).toBe(true)
    expect(hasTrackingParams(parse('https://x.test/v?utm_source=x'))).toBe(true)
    expect(hasTrackingParams(parse('https://x.test/v?v=abc&t=30s'))).toBe(false)
  })

  it('strips only known tracking params, keeps functional ones', () => {
    const out = stripTrackingParams(
      parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&index=2&si=xyz&utm_medium=ref'),
    )
    const u = new URL(out)
    expect(u.searchParams.get('v')).toBe('dQw4w9WgXcQ')
    expect(u.searchParams.get('list')).toBe('PL1')
    expect(u.searchParams.get('index')).toBe('2')
    expect(u.searchParams.has('si')).toBe(false)
    expect(u.searchParams.has('utm_medium')).toBe(false)
  })

  it('is a no-op when nothing to strip', () => {
    const url = 'https://www.youtube.com/watch?v=abc'
    expect(stripTrackingParams(parse(url))).toBe(url)
  })

  it('cleanUrlForRetry returns null when no tracking params present', () => {
    expect(cleanUrlForRetry('https://www.youtube.com/watch?v=abc')).toBeNull()
  })

  it('cleanUrlForRetry returns stripped url for retry strategy', () => {
    const cleaned = cleanUrlForRetry('https://youtu.be/abc?si=tok')
    expect(cleaned).toBe('https://youtu.be/abc')
  })

  it('rejects invalid urls defensively', () => {
    expect(cleanUrlForRetry('not-a-url')).toBeNull()
  })
})
