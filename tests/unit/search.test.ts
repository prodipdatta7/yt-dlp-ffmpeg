import { describe, expect, it, vi } from 'vitest'
import { buildSearchQuery } from '../../src/main/media/argBuilders'
import { parseHydrateLine, SearchService } from '../../src/main/media/search'

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

  it('parseHydrateLine extracts real upload date, timestamp and likes from batch print line', () => {
    const parsed = parseHydrateLine(
      'https://www.youtube.com/watch?v=YykjpeuMNEk|20160129|1454079638|16236614',
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.url).toBe('https://www.youtube.com/watch?v=YykjpeuMNEk')
    expect(parsed?.uploadDate).toBe('2016-01-29')
    expect(parsed?.timestamp).toBe(1454079638000)
    expect(parsed?.likeCount).toBe(16236614)

    // Handles NA or invalid values safely
    const parsedNa = parseHydrateLine('https://example.com/watch?v=abc|NA|NA|NA')
    expect(parsedNa).not.toBeNull()
    expect(parsedNa?.uploadDate).toBeNull()
    expect(parsedNa?.timestamp).toBeNull()
    expect(parsedNa?.likeCount).toBeNull()

    // Ignores junk lines (warnings / headers)
    expect(parseHydrateLine('WARNING: [youtube] Something')).toBeNull()
    expect(parseHydrateLine('')).toBeNull()
  })
})

describe('Search Card helpers and intelligence (Rich Video Search Cards)', () => {
  it('detects best format preset by default (1080p FHD, or 4K when detected)', async () => {
    const { detectBestFormatPreset } = await import('../../src/renderer/src/utils/estimate')
    expect(detectBestFormatPreset('Coldplay - Yellow (Official Video)')).toBe('1080p-fhd')
    expect(detectBestFormatPreset('Nature in 4K 60FPS Ultra HD')).toBe('4k-uhd')
  })

  it('estimates download sizes accurately per format preset and duration', async () => {
    const { SEARCH_FORMAT_PRESETS, estimatePresetBytes } =
      await import('../../src/renderer/src/utils/estimate')
    const p1080 = SEARCH_FORMAT_PRESETS.find((p) => p.id === '1080p-fhd')!
    const p720 = SEARCH_FORMAT_PRESETS.find((p) => p.id === '720p-hd')!
    const p4k = SEARCH_FORMAT_PRESETS.find((p) => p.id === '4k-uhd')!
    const pAudio = SEARCH_FORMAT_PRESETS.find((p) => p.id === 'audio-mp3-320')!

    // 49m10s (2950s) duration from user screenshot
    const dur = 2950
    const bytes1080 = estimatePresetBytes(p1080, dur)
    const bytes720 = estimatePresetBytes(p720, dur)
    const bytes4k = estimatePresetBytes(p4k, dur)
    const bytesAudio = estimatePresetBytes(pAudio, dur)

    expect(bytes1080).toBeGreaterThan(700 * 1024 * 1024)
    expect(bytes1080).toBeLessThan(900 * 1024 * 1024)

    expect(bytes720).toBeGreaterThan(300 * 1024 * 1024)
    expect(bytes720).toBeLessThan(450 * 1024 * 1024)

    expect(bytes4k).toBeGreaterThan(2 * 1024 * 1024 * 1024)

    expect(bytesAudio).toBeGreaterThan(100 * 1024 * 1024)
    expect(bytesAudio).toBeLessThan(150 * 1024 * 1024)
  })

  it('detects video technical specifications (badges, fps, color profile)', async () => {
    const { detectVideoTechSpecs } = await import('../../src/renderer/src/utils/estimate')
    const specs1 = detectVideoTechSpecs('Natok 2024')
    expect(specs1.resolutionBadge).toBe('1080P FHD')
    expect(specs1.codecBadge).toBe('H.264 / AAC')
    expect(specs1.colorProfile).toBe('16:9')

    const specs2 = detectVideoTechSpecs('Cyberpunk 4K HDR 60fps')
    expect(specs2.resolutionBadge).toBe('4K 2160P')
    expect(specs2.colorProfile).toBe('HDR10')
  })

  it('detects audio and subtitle intelligence', async () => {
    const { detectAudioSubtitleSpecs } = await import('../../src/renderer/src/utils/estimate')
    const sub1 = detectAudioSubtitleSpecs('Tomake Bou Banabo | Bangla Natok', 'SKY DRAMA')
    expect(sub1.subtitleBadge).toBe('BN, EN (Auto)')
    expect(sub1.audioBadge).toBe('128 kbps AAC Stereo')

    const sub2 = detectAudioSubtitleSpecs('Movie with 5.1 surround sound', 'Studio')
    expect(sub2.audioBadge).toContain('5.1')
  })

  it('formats relative upload age and likes percentage using real data', async () => {
    const { fmtUploadedAgo, fmtLikes } = await import('../../src/renderer/src/utils/format')
    const twoWeeksAgo = Date.now() - 14 * 24 * 3600 * 1000
    expect(fmtUploadedAgo(twoWeeksAgo)).toBe('Uploaded 2 weeks ago')
    expect(fmtUploadedAgo(null, null)).toBeNull()

    // Real like counts and ratios
    expect(fmtLikes(100_000, 50_000)).toBe('50.0% (50K)')
    expect(fmtLikes(2_285_120_000, 16_236_000)).toContain('16.2M')
    expect(fmtLikes(100_000, null)).toBeNull()
    expect(fmtLikes(null, null)).toBeNull()
  })

  it('resolves embed player metadata for supported streaming platforms and video files', async () => {
    const { getEmbedInfo } = await import('../../src/renderer/src/utils/source')

    // YouTube standard watch URL
    const yt1 = getEmbedInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(yt1).not.toBeNull()
    expect(yt1?.type).toBe('iframe')
    expect(yt1?.platform).toBe('YouTube')
    expect(yt1?.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')

    // YouTube shorts URL
    const yt2 = getEmbedInfo('https://www.youtube.com/shorts/dQw4w9WgXcQ')
    expect(yt2?.platform).toBe('YouTube')
    expect(yt2?.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')

    // YouTube short youtu.be URL
    const yt3 = getEmbedInfo('https://youtu.be/dQw4w9WgXcQ')
    expect(yt3?.platform).toBe('YouTube')
    expect(yt3?.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')

    // Bare 11-char video ID
    const yt4 = getEmbedInfo('dQw4w9WgXcQ')
    expect(yt4?.platform).toBe('YouTube')
    expect(yt4?.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')

    // SoundCloud (webpage, api endpoint with redundant prefixes, mobile, and slugs)
    const sc = getEmbedInfo('https://soundcloud.com/nocopyrightsounds/cartoon-on-on')
    expect(sc?.platform).toBe('SoundCloud')
    expect(sc?.src).toContain('w.soundcloud.com/player')

    const scApi = getEmbedInfo('https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A1449975562')
    expect(scApi?.platform).toBe('SoundCloud')
    expect(scApi?.src).toContain('api.soundcloud.com%2Ftracks%2F1449975562')

    const scMobile = getEmbedInfo('https://m.soundcloud.com/artist/track')
    expect(scMobile?.platform).toBe('SoundCloud')

    const scSlug = getEmbedInfo('sc:aura-soundworks/synthwave-dreams')
    expect(scSlug?.platform).toBe('SoundCloud')
    expect(scSlug?.src).toContain('soundcloud.com%2Faura-soundworks%2Fsynthwave-dreams')

    const scTrackId = getEmbedInfo('soundcloud:tracks:1449975562')
    expect(scTrackId?.platform).toBe('SoundCloud')
    expect(scTrackId?.src).toContain('api.soundcloud.com%2Ftracks%2F1449975562')

    // Bilibili
    const bili = getEmbedInfo('https://www.bilibili.com/video/BV1xx411c7mD')
    expect(bili?.platform).toBe('Bilibili')
    expect(bili?.src).toContain('player.bilibili.com/player.html?bvid=BV1xx411c7mD')

    // Vimeo
    const vimeo = getEmbedInfo('https://vimeo.com/123456789')
    expect(vimeo?.platform).toBe('Vimeo')
    expect(vimeo?.src).toContain('player.vimeo.com/video/123456789')

    // Direct MP4
    const mp4 = getEmbedInfo('https://commondatastorage.googleapis.com/sample/video.mp4')
    expect(mp4?.type).toBe('video')
    expect(mp4?.platform).toBe('Direct Video')
    expect(mp4?.src).toBe('https://commondatastorage.googleapis.com/sample/video.mp4')

    // Empty or unsupported
    expect(getEmbedInfo(null)).toBeNull()
    expect(getEmbedInfo('')).toBeNull()
    expect(getEmbedInfo('https://random-unsupported-site.example/page')).toBeNull()
  })

  it('detects SoundCloud track vs DJ set specifications and estimates audio sizes', async () => {
    const {
      detectSoundcloudSpecs,
      estimatePresetBytes,
      SOUNDCLOUD_FORMAT_PRESETS,
      SOUNDCLOUD_DJ_SET_PRESETS,
    } = await import('../../src/renderer/src/utils/estimate')

    // Track test
    const trackSpecs = detectSoundcloudSpecs(
      'Synthwave Dreams (Original Mix) - Celestial Beats [Cyberpunk Theme]',
      'Aura Soundworks',
      'https://soundcloud.com/aura-soundworks/synthwave-dreams',
    )
    expect(trackSpecs.isDjSet).toBe(false)
    expect(trackSpecs.categoryTag).toBe('TRACK / ORIGINAL MIX')
    expect(trackSpecs.permalinkSlug).toBe('sc:aura-soundworks/synthwave-dreams')
    expect(trackSpecs.artworkBadge1).toBe('SOUNDCLOUD')
    expect(trackSpecs.artworkBadge2).toBe('HQ AUDIO')
    expect(trackSpecs.bottomLeftOverlay).toBe('waveform')
    expect(trackSpecs.isPro).toBe(true)
    expect(trackSpecs.streamBadge).toContain('24-bit 48kHz FLAC')
    expect(trackSpecs.id3Badge).toContain('BPM:')

    // Track size estimates (252 seconds = 4:12)
    const flacBytes = estimatePresetBytes(SOUNDCLOUD_FORMAT_PRESETS[0], 252)
    const mp3Bytes = estimatePresetBytes(SOUNDCLOUD_FORMAT_PRESETS[1], 252)
    expect(flacBytes).toBeGreaterThan(40 * 1024 * 1024)
    expect(flacBytes).toBeLessThan(55 * 1024 * 1024)
    expect(mp3Bytes).toBeGreaterThan(9 * 1024 * 1024)
    expect(mp3Bytes).toBeLessThan(12 * 1024 * 1024)

    // DJ Set / continuous mix test
    const djSpecs = detectSoundcloudSpecs(
      'Cyberpunk 2077 Night City Club Live Mix (Continuous DJ Set + Cue Sheet & Tracklist)',
      'NEO TOKYO FM',
      'https://soundcloud.com/neo-tokyo-fm/night-city-club-mix',
    )
    expect(djSpecs.isDjSet).toBe(true)
    expect(djSpecs.categoryTag).toBe('CONTINUOUS DJ MIX + CUE')
    expect(djSpecs.permalinkSlug).toBe('sc:neo-tokyo-fm/night-city-club-mix')
    expect(djSpecs.artworkBadge1).toBe('DJ SET / SET')
    expect(djSpecs.artworkBadge2).toBe('18 TRACKS')
    expect(djSpecs.bottomLeftOverlay).toBe('cue')
    expect(djSpecs.streamBadge).toContain('CUE sheet')
    expect(djSpecs.id3Badge).toContain('Auto-tagging ID3v2')

    // DJ Set size estimate (4460 seconds = 1:14:20)
    const djMp3Bytes = estimatePresetBytes(SOUNDCLOUD_DJ_SET_PRESETS[0], 4460)
    expect(djMp3Bytes).toBeGreaterThan(160 * 1024 * 1024)
    expect(djMp3Bytes).toBeLessThan(200 * 1024 * 1024)
  })

  it('detects Bilibili single 4K video and multi-part series specifications and estimates sizes', async () => {
    const {
      detectBilibiliSpecs,
      fmtBiliCount,
      estimatePresetBytes,
      BILIBILI_FORMAT_PRESETS,
      BILIBILI_MULTI_P_PRESETS,
    } = await import('../../src/renderer/src/utils/estimate')

    // Test fmtBiliCount
    expect(fmtBiliCount(19000)).toBe('1.9万')
    expect(fmtBiliCount(42000)).toBe('4.2万')
    expect(fmtBiliCount(2800000)).toBe('280万')
    expect(fmtBiliCount(850)).toBe('850')

    // Single 4K Video (Cyber Horizon anime OP with real dynamic numbers)
    const singleSpecs = detectBilibiliSpecs(
      '【4K 120帧/画质天花板】Cyber Horizon - Full Anime Special OP & OST (Official bilibili Stream / Dolby Atmos)',
      'bilibili Official',
      'https://www.bilibili.com/video/BV1VG4Y1E7QM',
      'BV1VG4Y1E7QM',
      1455, // 24m 15s
      2800000, // 2.8M views
      276000, // likes
      42000, // danmaku/comments
      false,
    )
    expect(singleSpecs.isMultiPart).toBe(false)
    expect(singleSpecs.bvid).toBe('BV1VG4Y1E7QM')
    expect(singleSpecs.partBadge).toBe('4K 120FPS')
    expect(singleSpecs.badge3).toBe('Dolby Vision')
    expect(singleSpecs.categoryTag).toBe('BANGUMI / ANIME OST')
    expect(singleSpecs.upBadge).toBe('LV6 UP')
    expect(singleSpecs.danmakuCount).toBe('4.2万')
    expect(singleSpecs.durationText).toBe('24:15')
    expect(singleSpecs.coinsOrFav).toContain('硬币')
    expect(singleSpecs.ctaText).toBe('Quick Download')

    // Single video 4K size estimate (1455 seconds = 24:15)
    const single4kBytes = estimatePresetBytes(BILIBILI_FORMAT_PRESETS[0], 1455)
    const single1080pBytes = estimatePresetBytes(BILIBILI_FORMAT_PRESETS[1], 1455)
    expect(single4kBytes).toBeGreaterThan(1.5 * 1024 * 1024 * 1024)
    expect(single4kBytes).toBeLessThan(2.0 * 1024 * 1024 * 1024)
    expect(single1080pBytes).toBeGreaterThan(500 * 1024 * 1024)
    expect(single1080pBytes).toBeLessThan(750 * 1024 * 1024)

    // Multi-Part Series (Tech Course Masterclass with real dynamic numbers)
    const multiSpecs = detectBilibiliSpecs(
      '【全12集全套】Advanced Modern Web & Shader Architecture Masterclass (Bilibili Tech Pro Course)',
      'CodeArchitect Studio',
      'https://www.bilibili.com/video/BV1XK411J7QR',
      'BV1XK411J7QR',
      15480, // 4h 18m
      850000, // 850k views
      64000, // 64k favorites/likes
      19000, // 19k danmaku
      true, // verified
    )
    expect(multiSpecs.isMultiPart).toBe(true)
    expect(multiSpecs.bvid).toBe('BV1XK411J7QR')
    expect(multiSpecs.partCount).toBe(12)
    expect(multiSpecs.partBadge).toBe('12 PARTS (MULTI-P)')
    expect(multiSpecs.badge3).toBe('VIP UNLOCKED')
    expect(multiSpecs.categoryTag).toBe('FULL SERIES (P1-P12)')
    expect(multiSpecs.upBadge).toBe('VERIFIED')
    expect(multiSpecs.danmakuCount).toBe('1.9万')
    expect(multiSpecs.durationText).toBe('P1~P12 (4h 18m)')
    expect(multiSpecs.coinsOrFav).toBe('⭐ 收藏 6.4万')
    expect(multiSpecs.ctaText).toBe('Download All Parts')

    // Multi-part batch size estimate (15480 seconds = 4h 18m)
    const multiBatchBytes = estimatePresetBytes(BILIBILI_MULTI_P_PRESETS[0], 15480)
    expect(multiBatchBytes).toBeGreaterThan(3.5 * 1024 * 1024 * 1024)
    expect(multiBatchBytes).toBeLessThan(4.5 * 1024 * 1024 * 1024)
  })
})
