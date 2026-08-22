import type { Container } from '../../shared/models'
import { join } from 'node:path'

export const DOWNLOAD_PROGRESS_TEMPLATE =
  'download:MF|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'

export const POSTPROCESS_PROGRESS_TEMPLATE = 'postprocess:MFPOST|%(progress._percent_str)s'

export function outputTemplateFor(tempJobDir: string): string {
  return join(tempJobDir, '%(title).200B [%(id)s].%(ext)s')
}

export function buildBaseDownloadArgs(ffmpegPath: string, outputTemplate: string): string[] {
  return [
    '--newline',
    '--progress',
    '--no-colors',
    '--windows-filenames',
    '--trim-filenames',
    '200',
    '--ffmpeg-location',
    ffmpegPath,
    '-o',
    outputTemplate,
    '--progress-template',
    DOWNLOAD_PROGRESS_TEMPLATE,
    '--progress-template',
    POSTPROCESS_PROGRESS_TEMPLATE,
    '--print',
    'after_move:filepath',
  ]
}

export function buildVideoAudioArgs(tier: number, container: Container): string[] {
  return ['-f', `bv*[height<=${tier}]+ba/b`, '-S', 'res,fps', '--merge-output-format', container]
}
