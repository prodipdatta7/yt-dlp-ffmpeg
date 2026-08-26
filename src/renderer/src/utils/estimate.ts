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

/** Rough per-tier video bitrates (kbps) used when no format table is available (playlists). */
const TIER_KBPS: Record<number, number> = {
  4320: 40000,
  2160: 16000,
  1440: 9000,
  1080: 4500,
  720: 2500,
  480: 1200,
  360: 700,
}

const LOSSLESS_KBPS: Record<string, number> = { flac: 900, wav: 1411 }

/**
 * Duration-based size estimate for a single entry when its format table is
 * unknown (flat-playlist hydration). Returns null when it cannot guess.
 */
export function estimateEntryBytes(
  durationSec: number | null,
  input: EstimateInput,
): number | null {
  if (durationSec === null || durationSec <= 0) return null

  if (input.mode === 'audio-only') {
    const kbps =
      input.bitrate !== null
        ? Number(input.bitrate.replace('K', ''))
        : (LOSSLESS_KBPS[input.audioFormat] ?? 256)
    return Math.round(kbps * KBPS_TO_BYTES_PER_SEC * durationSec * 1.02)
  }

  if (input.mode === 'advanced') return null

  const videoKbps = TIER_KBPS[input.tier] ?? 4500
  return Math.round((videoKbps + 160) * KBPS_TO_BYTES_PER_SEC * durationSec * 1.02)
}
