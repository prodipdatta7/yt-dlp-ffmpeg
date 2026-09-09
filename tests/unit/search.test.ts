import { describe, expect, it, vi } from 'vitest'
import { buildSearchQuery } from '../../src/main/media/argBuilders'
import { SearchService } from '../../src/main/media/search'

describe('buildSearchQuery (yt-dlp search pseudo-URL)', () => {
  it('combines prefix, limit and query verbatim', () => {
    expect(buildSearchQuery('ytsearch', 'lofi beats', 20)).toBe('ytsearch20:lofi beats')
  })

  it('clamps limit into [1, 50]', () => {
    expect(buildSearchQuery('ytsearch', 'q', 0)).toBe('ytsearch1:q')
    expect(buildSearchQuery('ytsearch', 'q', -5)).toBe('ytsearch1:q')
    expect(buildSearchQuery('ytsearch', 'q', 500)).toBe('ytsearch50:q')
  })

  it('falls back to a sane default for a non-finite limit', () => {
    expect(buildSearchQuery('scsearch', 'q', Number.NaN)).toBe('scsearch20:q')
  })
})

describe('SearchService input validation (rejects before spawning any process)', () => {
  it('rejects an unknown platform id', async () => {
    const spy = vi.fn(async () => null)
    const service = new SearchService({ resolveYtDlp: spy })
    await expect(
      service.search('not-a-real-platform', 'cats', 20, 'relevance'),
    ).rejects.toMatchObject({ code: 'MF_INVALID_QUERY' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an empty/whitespace-only query', async () => {
    const spy = vi.fn(async () => null)
    const service = new SearchService({ resolveYtDlp: spy })
    await expect(service.search('youtube', '   ', 20, 'relevance')).rejects.toMatchObject({
      code: 'MF_INVALID_QUERY',
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('maps a missing binary to MF_UNKNOWN', async () => {
    const service = new SearchService({ resolveYtDlp: async () => null })
    await expect(service.search('youtube', 'cats', 20, 'relevance')).rejects.toMatchObject({
      code: 'MF_UNKNOWN',
    })
  })

  it('cancel without an active search is a safe no-op', () => {
    const service = new SearchService({ resolveYtDlp: async () => null })
    expect(() => service.cancel()).not.toThrow()
  })
})
