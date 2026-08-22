import { describe, expect, it } from 'vitest'
import { binaryFileName, locateBinary, platformDir } from '../../src/main/binaries/locator'

const exists = (p: string) => p.includes('present')

describe('platformDir', () => {
  it('maps platform/arch to the §15 layout', () => {
    expect(platformDir('win32')).toBe('win32')
    expect(platformDir('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformDir('darwin', 'x64')).toBe('darwin-x64')
    expect(platformDir('linux', 'x64')).toBe('linux-x64')
    expect(platformDir('linux', 'arm64')).toBe('linux-aarch64')
  })
})

describe('binaryFileName', () => {
  it('appends .exe only on win32', () => {
    expect(binaryFileName('yt-dlp', 'win32')).toBe('yt-dlp.exe')
    expect(binaryFileName('ffmpeg', 'win32')).toBe('ffmpeg.exe')
    expect(binaryFileName('yt-dlp', 'linux')).toBe('yt-dlp')
  })
})

describe('locateBinary precedence (AM-03: userData override wins over bundled)', () => {
  const kind = 'yt-dlp'
  const platform = 'win32'

  it('prefers the first candidate when present', () => {
    const found = locateBinary(
      kind,
      platform,
      [
        { dir: 'C:/first-present', source: 'override' },
        { dir: 'C:/second-present', source: 'userData' },
        { dir: 'C:/third-present', source: 'bundled' },
      ],
      exists,
    )
    expect(found?.source).toBe('override')
  })

  it('falls through to userData when env override dir is empty', () => {
    const found = locateBinary(
      kind,
      platform,
      [
        { dir: 'C:/empty', source: 'override' },
        { dir: 'C:/present-user', source: 'userData' },
        { dir: 'C:/present-bundled', source: 'bundled' },
      ],
      exists,
    )
    expect(found?.source).toBe('userData')
  })

  it('falls through to bundled as last resort', () => {
    const found = locateBinary(
      kind,
      platform,
      [
        { dir: 'C:/empty1', source: 'override' },
        { dir: 'C:/empty2', source: 'userData' },
        { dir: 'C:/bundled-present', source: 'bundled' },
      ],
      exists,
    )
    expect(found?.source).toBe('bundled')
    expect(found?.path.endsWith('yt-dlp.exe')).toBe(true)
  })

  it('returns null when no candidate holds the binary', () => {
    const found = locateBinary(
      kind,
      platform,
      [
        { dir: 'C:/a', source: 'userData' },
        { dir: 'C:/b', source: 'bundled' },
      ],
      () => false,
    )
    expect(found).toBeNull()
  })
})
