import type { AudioFormat, BitrateTier, Container, FormatRow } from '../../../shared/models'

const KBPS_TO_BYTES_PER_SEC = 125

function bestAudioRow(formats: FormatRow[]): FormatRow | null {
  const audioRows = formats.filter((f) => f.acodec !== null)
  if (audioRows.length === 0) return null
  return audioRows.reduce((best, f) => ((f.abrKbps ?? 0) > (best.abrKbps ?? 0) ? f : best))
}

function videoRowForTier(formats: FormatRow[], tier: number): FormatRow | null {
  const rows = formats
    .filter((f) => f.vcodec !== null && (f.height ?? 0) <= tier && f.filesizeBytes !== null)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
  return rows[0] ?? null
}

export interface EstimateInput {
  mode: 'video-audio' | 'audio-only' | 'advanced'
  durationSec: number | null
  tier: number
  container: Container
  audioFormat: AudioFormat
  bitrate: BitrateTier | null
  videoFormatId: string
  audioFormatId: string
}

export function estimateJobBytes(formats: FormatRow[], input: EstimateInput): number | null {
  if (input.mode === 'audio-only') {
    const lossyKbps: Record<string, number> = { mp3: 320, m4a: 320, ogg: 224, flac: 900, wav: 1411 }
    if (input.bitrate !== null) {
      const kbps = Number(input.bitrate.replace('K', ''))
      if (input.durationSec === null) return null
      return Math.round(kbps * KBPS_TO_BYTES_PER_SEC * input.durationSec * 1.02)
    }
    void lossyKbps
    const best = bestAudioRow(formats)
    return best?.filesizeBytes ?? null
  }

  if (input.mode === 'advanced') {
    const video = formats.find(
      (f) => f.formatId === input.videoFormatId && f.filesizeBytes !== null,
    )
    const audio = formats.find(
      (f) => f.formatId === input.audioFormatId && f.filesizeBytes !== null,
    )
    if (!video || !audio) return null
    return (video.filesizeBytes ?? 0) + (audio.filesizeBytes ?? 0)
  }

  const video = videoRowForTier(formats, input.tier)
  const audio = bestAudioRow(formats)
  if (!video) return null
  return (video.filesizeBytes ?? 0) + (audio?.filesizeBytes ?? 0)
}
