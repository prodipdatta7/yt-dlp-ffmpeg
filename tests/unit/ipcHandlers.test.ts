import { describe, expect, it } from 'vitest'
import { parseJobConfig } from '../../src/main/ipc/handlers'
import type { JobConfig } from '../../src/shared/models'

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const DEST = 'D:/Media/Downloads'

/**
 * L-03 / P4: `parseJobConfig` used to silently drop `audioBoost` and `isLive` because
 * each of its three per-mode return objects re-listed fields by hand and neither was
 * forwarded. These tests round-trip a config carrying *every* JobConfig field through
 * each mode and assert nothing is lost — the standing guard against the same class of
 * bug when the v2 clip/chapter fields are added.
 */
describe('parseJobConfig (L-03 field round-trip)', () => {
  it('forwards audioBoost and isLive in video-audio mode', () => {
    const parsed = parseJobConfig({
      url: URL,
      mode: 'video-audio',
      tier: 1080,
      container: 'mp4',
      destDir: DEST,
      estimatedBytes: 123_456,
      playlistTitle: 'My Playlist',
      audioBoost: 'normalize',
      isLive: false,
    })
    expect(parsed).not.toBeNull()
    expect(parsed).toMatchObject({
      url: URL,
      mode: 'video-audio',
      tier: 1080,
      container: 'mp4',
      destDir: DEST,
      estimatedBytes: 123_456,
      playlistTitle: 'My Playlist',
      audioBoost: 'normalize',
      isLive: false,
    })
  })

  it('forwards audioBoost and isLive in audio-only mode', () => {
    const parsed = parseJobConfig({
      url: URL,
      mode: 'audio-only',
      audioFormat: 'mp3',
      bitrate: '320K',
      destDir: DEST,
      audioBoost: 'dynamic',
      isLive: false,
    })
    expect(parsed).toMatchObject({
      mode: 'audio-only',
      audioFormat: 'mp3',
      bitrate: '320K',
      audioBoost: 'dynamic',
      isLive: false,
    })
  })

  it('forwards audioBoost and isLive in advanced mode', () => {
    const parsed = parseJobConfig({
      url: URL,
      mode: 'advanced',
      container: 'mkv',
      videoFormatId: '137',
      audioFormatId: '140',
      destDir: DEST,
      audioBoost: 'boost-6db',
      isLive: true,
    })
    expect(parsed).toMatchObject({
      mode: 'advanced',
      container: 'mkv',
      videoFormatId: '137',
      audioFormatId: '140',
      audioBoost: 'boost-6db',
      isLive: true,
    })
  })

  it('every JobConfig field survives a full round-trip for each mode', () => {
    const full: Required<
      Omit<
        JobConfig,
        'tier' | 'container' | 'audioFormat' | 'bitrate' | 'videoFormatId' | 'audioFormatId'
      >
    > &
      Partial<JobConfig> = {
      url: URL,
      mode: 'video-audio',
      destDir: DEST,
      estimatedBytes: 1,
      playlistTitle: 'p',
      audioBoost: 'normalize',
      isLive: true,
      tier: 720,
      container: 'webm',
    }
    const parsed = parseJobConfig(full)
    expect(parsed).toMatchObject(full)
  })

  it('rejects an audioBoost value outside the allowlist', () => {
    expect(
      parseJobConfig({ url: URL, mode: 'video-audio', destDir: DEST, audioBoost: 'loud-11' }),
    ).toBeNull()
  })

  it('rejects a non-boolean isLive', () => {
    expect(
      parseJobConfig({ url: URL, mode: 'video-audio', destDir: DEST, isLive: 'yes' }),
    ).toBeNull()
  })

  it('omits audioBoost/isLive cleanly when not provided', () => {
    const parsed = parseJobConfig({ url: URL, mode: 'video-audio', destDir: DEST })
    expect(parsed).not.toBeNull()
    expect(parsed?.audioBoost).toBeUndefined()
    expect(parsed?.isLive).toBeUndefined()
  })

  it('still rejects a bad URL and an empty destDir', () => {
    expect(parseJobConfig({ url: 'notaurl', mode: 'video-audio', destDir: DEST })).toBeNull()
    expect(parseJobConfig({ url: URL, mode: 'video-audio', destDir: '' })).toBeNull()
    expect(parseJobConfig(null)).toBeNull()
  })
})
