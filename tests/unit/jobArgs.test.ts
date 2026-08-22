import { describe, expect, it } from 'vitest'
import {
  buildBaseDownloadArgs,
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
