import { describe, expect, it } from 'vitest'
import {
  buildAdvancedArgs,
  buildAudioBoostArgs,
  buildAudioOnlyArgs,
  buildBaseDownloadArgs,
  buildDownloadArgs,
  buildVideoAudioArgs,
  outputTemplateFor,
} from '../../src/main/jobs/argBuilders'

describe('buildBaseDownloadArgs (AGENTS.md §7.2 contract)', () => {
  it('matches the mandated machine-parseable base argv', () => {
    const args = buildBaseDownloadArgs('C:/bin/ffmpeg.exe', 'C:/tmp/%(title)s.%(ext)s')
    expect(args).toEqual([
      '--newline',
      '--progress',
      '--no-colors',
      '--windows-filenames',
      '--trim-filenames',
      '200',
      '--ffmpeg-location',
      'C:/bin/ffmpeg.exe',
      '-o',
      'C:/tmp/%(title)s.%(ext)s',
      '--progress-template',
      'download:MF|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
      '--progress-template',
      'postprocess:MFPOST|%(progress._percent_str)s',
      '--print',
      'after_move:filepath',
    ])
  })

  it('never uses a shell string (AM-02): args are separate argv elements', () => {
    const joined = buildBaseDownloadArgs('ff', 'tpl').join(' ')
    expect(joined).not.toContain('&&')
    expect(joined).not.toContain('| ') // pipe chars only inside the template value
  })
})

describe('buildVideoAudioArgs (PRD §3.3A)', () => {
  it('caps resolution at tier with fallback chain', () => {
    expect(buildVideoAudioArgs(1080, 'mp4')).toEqual([
      '-f',
      'bv*[height<=1080]+ba/b',
      '-S',
      'res,fps',
      '--merge-output-format',
      'mp4',
    ])
  })

  it('supports mkv and webm containers', () => {
    expect(buildVideoAudioArgs(2160, 'mkv').at(-1)).toBe('mkv')
    expect(buildVideoAudioArgs(720, 'webm').at(-1)).toBe('webm')
  })
})

describe('outputTemplateFor', () => {
  it('trims titles to 200 bytes and pins the id', () => {
    const tpl = outputTemplateFor('C:/tmp')
    expect(tpl.endsWith('%(title).200B [%(id)s].%(ext)s')).toBe(true)
  })
})

describe('buildAudioOnlyArgs (PRD §3.3B / AM-04)', () => {
  it('lossy mp3 with bitrate', () => {
    expect(buildAudioOnlyArgs('mp3', '320K')).toEqual([
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '320K',
    ])
  })

  it('m4a medium quality', () => {
    expect(buildAudioOnlyArgs('m4a', '192K')).toEqual([
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'm4a',
      '--audio-quality',
      '192K',
    ])
  })

  it('ogg maps to vorbis codec', () => {
    expect(buildAudioOnlyArgs('ogg', '128K').includes('vorbis')).toBe(true)
  })

  it('AM-04: lossless flac gets NO bitrate flag', () => {
    const args = buildAudioOnlyArgs('flac', null)
    expect(args).toEqual(['-f', 'ba/b', '-x', '--audio-format', 'flac'])
    expect(args.includes('--audio-quality')).toBe(false)
  })

  it('AM-04 defense-in-depth: bitrate ignored even if passed for wav', () => {
    const args = buildAudioOnlyArgs('wav', '320K')
    expect(args.includes('--audio-quality')).toBe(false)
  })
})

describe('buildAdvancedArgs (PRD §3.3C)', () => {
  it('pairs explicit format ids with /b fallback and merge container', () => {
    expect(buildAdvancedArgs('137', '140', 'mkv')).toEqual([
      '-f',
      '137+140/b',
      '--merge-output-format',
      'mkv',
    ])
  })

  it('omits container when not requested', () => {
    expect(buildAdvancedArgs('299', '251', null)).toEqual(['-f', '299+251/b'])
  })
})

describe('buildDownloadArgs unified choke point', () => {
  const ff = 'C:/bin/ffmpeg.exe'
  const tpl = outputTemplateFor('C:/tmp')

  it('ALWAYS terminates with the target URL (regression: missing URL broke every download)', () => {
    const url = 'https://www.youtube.com/watch?v=abc123'
    for (const config of [
      { url, mode: 'video-audio', tier: 720, container: 'mp4', destDir: 'd' },
      { url, mode: 'audio-only', audioFormat: 'mp3', bitrate: '320K', destDir: 'd' },
      { url, mode: 'advanced', videoFormatId: '137', audioFormatId: '140', destDir: 'd' },
    ] as const) {
      const args = buildDownloadArgs(config, ff, tpl)
      expect(args.at(-1)).toBe(url)
    }
  })

  it('routes audio-only config to the right argv prefix', () => {
    const args = buildDownloadArgs(
      { url: 'u', mode: 'audio-only', audioFormat: 'flac', destDir: 'd' },
      ff,
      tpl,
    )
    expect(args.slice(0, 4)).toEqual(['-f', 'ba/b', '-x', '--audio-format'])
    expect(args).toContain('flac')
    expect(args.at(-1)).toBe('u')
  })

  it('routes advanced config with ids', () => {
    const args = buildDownloadArgs(
      { url: 'u', mode: 'advanced', videoFormatId: '137', audioFormatId: '140', destDir: 'd' },
      ff,
      tpl,
    )
    expect(args[0]).toBe('-f')
    expect(args[1]).toBe('137+140/b')
    expect(args.at(-1)).toBe('u')
  })
})

describe('buildAudioBoostArgs and download integration', () => {
  const ff = 'C:/bin/ffmpeg.exe'
  const tpl = outputTemplateFor('C:/tmp')

  it('returns empty array when audioBoost is none or omitted', () => {
    expect(buildAudioBoostArgs({ url: 'u', mode: 'video-audio', destDir: 'd' })).toEqual([])
    expect(
      buildAudioBoostArgs({ url: 'u', mode: 'video-audio', audioBoost: 'none', destDir: 'd' }),
    ).toEqual([])
  })

  it('builds ExtractAudio postprocessor args for audio-only mode', () => {
    const norm = buildAudioBoostArgs({
      url: 'u',
      mode: 'audio-only',
      audioFormat: 'mp3',
      audioBoost: 'normalize',
      destDir: 'd',
    })
    expect(norm).toEqual([
      '--postprocessor-args',
      'ExtractAudio+ffmpeg:-af loudnorm=I=-16:TP=-1.5:LRA=11',
    ])

    const dyn = buildAudioBoostArgs({
      url: 'u',
      mode: 'audio-only',
      audioFormat: 'flac',
      audioBoost: 'dynamic',
      destDir: 'd',
    })
    expect(dyn).toEqual(['--postprocessor-args', 'ExtractAudio+ffmpeg:-af dynaudnorm'])

    const boost6 = buildAudioBoostArgs({
      url: 'u',
      mode: 'audio-only',
      audioFormat: 'wav',
      audioBoost: 'boost-6db',
      destDir: 'd',
    })
    expect(boost6).toEqual(['--postprocessor-args', 'ExtractAudio+ffmpeg:-af volume=6dB'])
  })

  it('builds Merger postprocessor args with aac for mp4/mkv video-audio', () => {
    const mp4 = buildAudioBoostArgs({
      url: 'u',
      mode: 'video-audio',
      container: 'mp4',
      audioBoost: 'normalize',
      destDir: 'd',
    })
    expect(mp4).toEqual([
      '--postprocessor-args',
      'Merger+ffmpeg:-c:a aac -b:a 192k -af loudnorm=I=-16:TP=-1.5:LRA=11',
    ])

    const mkv = buildAudioBoostArgs({
      url: 'u',
      mode: 'video-audio',
      container: 'mkv',
      audioBoost: 'boost-6db',
      destDir: 'd',
    })
    expect(mkv).toEqual(['--postprocessor-args', 'Merger+ffmpeg:-c:a aac -b:a 192k -af volume=6dB'])
  })

  it('builds Merger postprocessor args with libopus for webm container', () => {
    const webm = buildAudioBoostArgs({
      url: 'u',
      mode: 'video-audio',
      container: 'webm',
      audioBoost: 'normalize',
      destDir: 'd',
    })
    expect(webm).toEqual([
      '--postprocessor-args',
      'Merger+ffmpeg:-c:a libopus -b:a 160k -af loudnorm=I=-16:TP=-1.5:LRA=11',
    ])
  })

  it('integrates cleanly into buildDownloadArgs with URL remaining terminal', () => {
    const args = buildDownloadArgs(
      {
        url: 'https://example.com/video',
        mode: 'video-audio',
        tier: 1080,
        container: 'mp4',
        audioBoost: 'normalize',
        destDir: 'd',
      },
      ff,
      tpl,
    )
    expect(args).toContain('--postprocessor-args')
    expect(args).toContain('Merger+ffmpeg:-c:a aac -b:a 192k -af loudnorm=I=-16:TP=-1.5:LRA=11')
    expect(args.at(-1)).toBe('https://example.com/video')
  })
})
