import { describe, expect, it } from 'vitest'
import {
  EMBED_REQUEST_FILTER,
  FALLBACK_EMBED_REFERER,
  patchEmbedHeaders,
} from '../../src/main/embedHeaders'

describe('embedHeaders (patchEmbedHeaders)', () => {
  it('injects fallback referer when Referer is undefined', () => {
    const headers = { 'User-Agent': 'TestAgent' }
    const patched = patchEmbedHeaders(headers)
    expect(patched.Referer).toBe(FALLBACK_EMBED_REFERER)
    expect(patched['User-Agent']).toBe('TestAgent')
  })

  it('injects fallback referer when Referer is empty string', () => {
    const headers = { Referer: '' }
    const patched = patchEmbedHeaders(headers)
    expect(patched.Referer).toBe(FALLBACK_EMBED_REFERER)
  })

  it('replaces file:// referer with fallback referer', () => {
    const headers = {
      Referer: 'file:///C:/Program%20Files/MediaForge/resources/app.asar/renderer/index.html',
    }
    const patched = patchEmbedHeaders(headers)
    expect(patched.Referer).toBe(FALLBACK_EMBED_REFERER)
  })

  it('handles array format referer from file://', () => {
    const headers = {
      Referer: ['file:///opt/mediaforge/renderer/index.html'],
    }
    const patched = patchEmbedHeaders(headers)
    expect(patched.Referer).toBe(FALLBACK_EMBED_REFERER)
  })

  it('preserves legitimate http and https web referrers', () => {
    const headers = { Referer: 'https://example.com/watch' }
    const patched = patchEmbedHeaders(headers)
    expect(patched.Referer).toBe('https://example.com/watch')

    const devHeaders = { Referer: 'http://localhost:5173/' }
    const devPatched = patchEmbedHeaders(devHeaders)
    expect(devPatched.Referer).toBe('http://localhost:5173/')
  })

  it('preserves all other headers without alteration', () => {
    const headers = {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'iframe',
    }
    const patched = patchEmbedHeaders(headers)
    expect(patched.Referer).toBe(FALLBACK_EMBED_REFERER)
    expect(patched.Accept).toBe('text/html,application/xhtml+xml')
    expect(patched['Accept-Language']).toBe('en-US,en;q=0.9')
    expect(patched['Sec-Fetch-Dest']).toBe('iframe')
  })

  it('includes key media embed domains in filter', () => {
    expect(EMBED_REQUEST_FILTER.urls).toContain('*://*.youtube.com/*')
    expect(EMBED_REQUEST_FILTER.urls).toContain('*://*.youtube-nocookie.com/*')
    expect(EMBED_REQUEST_FILTER.urls).toContain('*://*.googlevideo.com/*')
    expect(EMBED_REQUEST_FILTER.urls).toContain('*://*.soundcloud.com/*')
    expect(EMBED_REQUEST_FILTER.urls).toContain('*://*.vimeo.com/*')
    expect(EMBED_REQUEST_FILTER.urls).toContain('*://*.bilibili.com/*')
  })
})
