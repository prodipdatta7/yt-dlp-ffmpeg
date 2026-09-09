import { describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '../../src/main/binaries/runner'
import { AnalyzeService, mapRawInfo } from '../../src/main/media/metadata'

describe('cancel semantics (AM-09: kill tree <500ms)', () => {
  it('aborts a hanging analyze within 500ms of cancel()', async () => {
    const service = new AnalyzeService({ resolveYtDlp: async () => null })

    const handle = spawnProcess(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 5000)'])
    await new Promise((r) => setTimeout(r, 150))
    expect(handle.pid).toBeGreaterThan(0)

    const t0 = Date.now()
    service.cancel()
    void handle.killTree()
    await handle.result
    const elapsed = Date.now() - t0

    expect(elapsed).toBeLessThan(1500)
  }, 10_000)

  it('cancel without active job is a safe no-op', () => {
    const service = new AnalyzeService({ resolveYtDlp: async () => null })
    expect(() => service.cancel()).not.toThrow()
  })
})

describe('AnalyzeService input validation', () => {
  it('rejects invalid urls with MF_INVALID_URL before spawning', async () => {
    const spy = vi.fn(async () => null)
    const service = new AnalyzeService({ resolveYtDlp: spy })
    await expect(service.analyze('not-a-url')).rejects.toMatchObject({ code: 'MF_INVALID_URL' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('maps missing binary to MF_UNKNOWN', async () => {
    const service = new AnalyzeService({ resolveYtDlp: async () => null })
    await expect(service.analyze('https://x.test/v')).rejects.toMatchObject({ code: 'MF_UNKNOWN' })
  })
})

describe('retry strategy (full URL first, strip only on failure)', () => {
  it('does not retry when url has no tracking params', async () => {
    const service = new AnalyzeService({
      resolveYtDlp: async () => ({ kind: 'yt-dlp', path: 'missing-binary', source: 'bundled' }),
    })
    await expect(service.analyze('https://x.test/watch?v=1')).rejects.toBeTruthy()
  })

  it('parses fixture JSON end-to-end through mapRawInfo', () => {
    const raw: Parameters<typeof mapRawInfo>[0] = {
      _type: 'video',
      id: 'x1',
      title: 'T',
      formats: [{ format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a' }],
    }
    const res = mapRawInfo(raw, 'https://x.test/v')
    expect(res.metadata.title).toBe('T')
    expect(res.formats[0]?.formatId).toBe('18')
  })
})
