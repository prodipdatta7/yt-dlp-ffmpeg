import { join } from 'node:path'
import {
  LOSSY_AUDIO_FORMATS,
  type AudioFormat,
  type BitrateTier,
  type Container,
  type JobConfig,
} from '../../shared/models'

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
    // yt-dlp's default progress delta is zero, so every hook call emits a line. Capping
    // routine progress at ~4 lines/sec/job (P-04). Phase changes, completion, warnings and
    // errors are separate stdout lines and are unaffected; AM-01's machine templates stay.
    '--progress-delta',
    '0.25',
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

const AUDIO_FORMAT_FLAG: Record<AudioFormat, string> = {
  mp3: 'mp3',
  m4a: 'm4a',
  ogg: 'vorbis',
  flac: 'flac',
  wav: 'wav',
}

export function buildAudioOnlyArgs(
  audioFormat: AudioFormat,
  bitrate: BitrateTier | null,
): string[] {
  const args = ['-f', 'ba/b', '-x', '--audio-format', AUDIO_FORMAT_FLAG[audioFormat]]
  if (bitrate && LOSSY_AUDIO_FORMATS.includes(audioFormat)) {
    args.push('--audio-quality', bitrate)
  }
  return args
}

export function buildAdvancedArgs(
  videoFormatId: string,
  audioFormatId: string,
  container: Container | null,
): string[] {
  const args = ['-f', `${videoFormatId}+${audioFormatId}/b`]
  if (container) args.push('--merge-output-format', container)
  return args
}

export function buildAudioBoostArgs(config: JobConfig): string[] {
  if (!config.audioBoost || config.audioBoost === 'none') {
    return []
  }

  let filter: string
  switch (config.audioBoost) {
    case 'normalize':
      filter = 'loudnorm=I=-16:TP=-1.5:LRA=11'
      break
    case 'dynamic':
      filter = 'dynaudnorm'
      break
    case 'boost-6db':
      filter = 'volume=6dB'
      break
  }

  if (config.mode === 'audio-only') {
    return ['--postprocessor-args', `ExtractAudio+ffmpeg:-af ${filter}`]
  }

  if (config.container === 'webm') {
    return ['--postprocessor-args', `Merger+ffmpeg:-c:a libopus -b:a 160k -af ${filter}`]
  }

  return ['--postprocessor-args', `Merger+ffmpeg:-c:a aac -b:a 192k -af ${filter}`]
}

export function buildDownloadArgs(
  config: JobConfig,
  ffmpegPath: string,
  outputTemplate: string,
  cookiesPath?: string | null,
): string[] {
  let modeArgs: string[]
  switch (config.mode) {
    case 'video-audio':
      modeArgs = buildVideoAudioArgs(config.tier ?? 1080, config.container ?? 'mp4')
      break
    case 'audio-only':
      modeArgs = buildAudioOnlyArgs(config.audioFormat ?? 'mp3', config.bitrate ?? null)
      break
    case 'advanced':
      modeArgs = buildAdvancedArgs(
        config.videoFormatId ?? '',
        config.audioFormatId ?? '',
        config.container ?? null,
      )
      break
  }
  const base = buildBaseDownloadArgs(ffmpegPath, outputTemplate)
  if (cookiesPath) base.push('--cookies', cookiesPath)
  const boost = buildAudioBoostArgs(config)
  return [...modeArgs, ...base, ...boost, config.url]
}
