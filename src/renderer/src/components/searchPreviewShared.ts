import type { VideoChaptersResult, VideoTranscriptResult } from '../../../shared/ipcContract'
import type { ChapterMarker } from '../../../shared/models'
import type { FormatPresetOption } from '../utils/estimate'
import { LruCache } from '../utils/lruCache'

/**
 * Preview plumbing shared by SearchResultCard (the collapsed card) and TheaterPreview (the
 * expanded modal). Split out when the modal was extracted (P-06) so both sides reference one
 * cache rather than each keeping its own.
 */
export type PresetOption = FormatPresetOption

/**
 * Preview content caches. These were unbounded module-level Maps, so everything a session
 * ever previewed stayed reachable after its card unmounted (P-06). Transcripts get a smaller
 * entry count because a single one can be thousands of cues.
 */
export const chaptersCache = new LruCache<VideoChaptersResult>(50, 10 * 1024 * 1024)
export const transcriptCache = new LruCache<VideoTranscriptResult>(10, 10 * 1024 * 1024)

/**
 * In-flight preview fetches keyed by URL, so reopening the same result while its first
 * request is still running reuses that promise instead of spawning a second yt-dlp (P-06).
 */
export const chaptersInFlight = new Map<string, Promise<VideoChaptersResult>>()
export const transcriptInFlight = new Map<string, Promise<VideoTranscriptResult>>()

/** Drops all cached preview content — called when the search results are replaced. */
export function clearPreviewCaches(): void {
  chaptersCache.clear()
  transcriptCache.clear()
}

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random()}`
}

/** Fetches chapters for `url`, deduplicating concurrent requests for the same URL. */
export function fetchChaptersDeduped(url: string, requestId: string): Promise<VideoChaptersResult> {
  const pending = chaptersInFlight.get(url)
  if (pending) return pending

  const request = (window.mf?.fetchChapters(url, requestId) ?? Promise.resolve({ chapters: [] }))
    .catch((): VideoChaptersResult => ({ chapters: [] }))
    .finally(() => chaptersInFlight.delete(url))
  chaptersInFlight.set(url, request)
  return request
}

/** Fetches a transcript for `url`, deduplicating concurrent requests for the same URL. */
export function fetchTranscriptDeduped(
  url: string,
  requestId: string,
): Promise<VideoTranscriptResult> {
  const pending = transcriptInFlight.get(url)
  if (pending) return pending

  const request = (window.mf?.fetchTranscript(url, requestId) ?? Promise.resolve({ cues: [] }))
    .catch((): VideoTranscriptResult => ({ cues: [] }))
    .finally(() => transcriptInFlight.delete(url))
  transcriptInFlight.set(url, request)
  return request
}

export function extractRealChapters(
  description?: string | null,
  totalDurationSec?: number | null,
): ChapterMarker[] {
  if (!description) return []
  const lines = description.split('\n')
  const parsed: ChapterMarker[] = []
  const timeRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/
  for (const line of lines) {
    const match = line.match(timeRegex)
    if (match) {
      const timeStr = match[0]
      const parts = timeStr.split(':').map(Number)
      let sec = 0
      if (parts.length === 3) {
        sec = parts[0] * 3600 + parts[1] * 60 + parts[2]
      } else if (parts.length === 2) {
        sec = parts[0] * 60 + parts[1]
      }
      const cleanTitle = line
        .replace(timeRegex, '')
        .replace(/^[\s\-–—:•|()[\]]+/, '')
        .replace(/[\s\-–—:•|()[\]]+$/, '')
        .trim()
      if (cleanTitle.length > 0) {
        parsed.push({
          time: timeStr,
          title: cleanTitle,
          seconds: sec,
        })
      }
    }
  }
  // Deduplicate identical timestamps and sort chronologically
  const unique = parsed
    .filter((ch, idx, self) => idx === self.findIndex((o) => o.seconds === ch.seconds))
    .sort((a, b) => a.seconds - b.seconds)

  // Calculate chapter durations
  for (let i = 0; i < unique.length; i++) {
    const nextSec = i < unique.length - 1 ? unique[i + 1].seconds : totalDurationSec
    if (nextSec && nextSec > unique[i].seconds) {
      const diff = nextSec - unique[i].seconds
      const m = Math.floor(diff / 60)
      const s = diff % 60
      unique[i].duration = `${m}:${s < 10 ? '0' : ''}${s}`
    }
  }
  return unique
}

export function formatChapterTime(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remSec = s % 60
  const ss = String(remSec).padStart(2, '0') + 's'
  if (h > 0) {
    const mm = String(m).padStart(2, '0') + 'm'
    return `${h}h ${mm} ${ss}`
  }
  return `${m}m ${ss}`
}

export function fmtClockTime(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remSec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(remSec).padStart(2, '0')
  if (h > 0) {
    const hh = String(h).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}
