import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  getSearchPlatform,
  type ChapterMarker,
  type SearchFilterCriteria,
  type SearchPlatformId,
  type SearchResultItem,
  type SearchSort,
  type TranscriptCue,
  type VideoTranscriptResult,
} from '../../shared/models'
import type { SearchHydratePayload, VideoChaptersResult } from '../../shared/ipcContract'
import type { LocatedBinary } from '../binaries/locator'
import { spawnProcess, type SpawnHandle } from '../binaries/runner'
import type { Logger } from '../store/logger'
import { classifyStderr } from './classifyStderr'
import {
  buildAnalyzeArgs,
  buildEntryInfoArgs,
  buildFederatedDiscoveryQuery,
  buildSearchTarget,
} from './argBuilders'
import { mapRawInfo, MfError, type RawInfo } from './metadata'
import {
  buildBravePublicWebSearchUrl,
  buildPublicWebSearchUrl,
  extractBravePublicWebResultUrls,
  extractPublicWebResultUrls,
  fetchPublicWebSearch,
  isPublicWebChallenge,
  PublicWebSearchError,
} from './publicWebSearch'

export interface SearchServiceOptions {
  resolveYtDlp: () => Promise<LocatedBinary | null>
  logger?: Logger
  getCookiesPath?: () => string | null
  /** Raw CLI line tap (stdout/stderr of yt-dlp) for the live console. */
  onProcessLine?: (line: string, stream: 'out' | 'err') => void
  onEntryHydrated?: (item: SearchHydratePayload) => void
  /** Injectable only for deterministic tests; production uses the cookie-free public-web fetcher. */
  fetchPublicWebSearch?: (url: string, signal: AbortSignal) => Promise<string>
  /** Test seam: process spawner, so handle bookkeeping and cancel are assertable. */
  spawn?: typeof spawnProcess
}

/** Parses a formatted print line "%(original_url)s|%(upload_date)s|%(timestamp)s|%(like_count)s". */
export function parseHydrateLine(line: string): SearchHydratePayload | null {
  const parts = line.trim().split('|')
  if (parts.length < 4) return null
  const [url, rawDate, rawTs, rawLikes] = parts
  if (!url || !url.startsWith('http')) return null
  const uploadDate = /^\d{8}$/.test(rawDate)
    ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
    : null
  const tsNum = Number(rawTs)
  const timestamp =
    Number.isFinite(tsNum) && tsNum > 0 ? (tsNum < 100_000_000_000 ? tsNum * 1000 : tsNum) : null
  const likesNum = Number(rawLikes)
  const likeCount = Number.isFinite(likesNum) && likesNum > 0 ? likesNum : null
  return {
    sourceUrl: url,
    metadataState: 'ready',
    patch: { uploadDate, timestamp, likeCount },
  }
}

const FEDERATED_PLATFORM_IDS = new Set<SearchPlatformId>([
  'facebook',
  'instagram',
  'twitter',
  'tiktok',
  'reddit',
])

function hostMatches(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`)
}

function isFederatedMediaPath(platformId: SearchPlatformId, url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const path = url.pathname

  switch (platformId) {
    case 'facebook':
      if (host === 'fb.watch') return path.length > 1
      if (!hostMatches(host, 'facebook.com')) return false
      return (
        /\/(?:reel|reels|videos|share\/(?:r|v))\//i.test(path) ||
        /\/(?:watch\/?|video\.php|story\.php)$/i.test(path)
      )
    case 'instagram':
      return hostMatches(host, 'instagram.com') && /^\/(?:p|reel|reels|tv)\/[\w.-]+/i.test(path)
    case 'twitter':
      if (host === 't.co') return path.length > 1
      return (
        (hostMatches(host, 'x.com') || hostMatches(host, 'twitter.com')) &&
        /^\/[^/]+\/status\/\d+/i.test(path)
      )
    case 'tiktok':
      if (!hostMatches(host, 'tiktok.com')) return false
      if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return path.length > 1
      return /^\/(?:@[^/]+\/video\/\d+|t\/[\w-]+)/i.test(path)
    case 'reddit':
      if (host === 'redd.it' || host === 'v.redd.it') return path.length > 1
      return hostMatches(host, 'reddit.com') && /\/(?:comments|gallery)\/[a-z0-9]+/i.test(path)
    default:
      return false
  }
}

/** Validates and normalizes a Google-discovered URL before it can reach the renderer. */
export function normalizeFederatedCandidateUrl(platformId: string, rawUrl: string): string | null {
  if (!FEDERATED_PLATFORM_IDS.has(platformId as SearchPlatformId)) return null

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!isFederatedMediaPath(platformId as SearchPlatformId, url)) return null

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'igshid', 'si', 'ref'].includes(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  return url.toString()
}

function normalizeUploadDate(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

function normalizeTimestamp(raw: number | null | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return raw < 100_000_000_000 ? raw * 1000 : raw
}

function isReelUrl(platformId: string, url: string): boolean {
  return (
    platformId === 'tiktok' ||
    /instagram\.com\/(?:reel|reels)\//i.test(url) ||
    /facebook\.com\/(?:reel|reels)\//i.test(url)
  )
}

/** Maps a full yt-dlp metadata document into an exact federated result update. */
export function parseFederatedHydration(
  sourceUrl: string,
  platformId: string,
  jsonText: string,
): SearchHydratePayload {
  try {
    const raw = JSON.parse(jsonText) as RawInfo
    const mapped = mapRawInfo(raw, sourceUrl)
    const metadata = mapped.metadata
    const reel = isReelUrl(platformId, sourceUrl)
    const music =
      /\b(official (music )?video|music video|lyric video|official audio|visualizer)\b/i.test(
        `${metadata.title} ${raw.description ?? ''}`,
      )
    return {
      sourceUrl,
      metadataState: 'ready',
      patch: {
        title: metadata.title,
        id: metadata.id,
        durationSec: metadata.durationSec,
        uploader: metadata.uploader,
        viewCount: metadata.viewCount,
        likeCount: metadata.likeCount ?? null,
        commentCount: raw.comment_count ?? null,
        thumbnailUrl: metadata.thumbnailUrl,
        uploadDate: metadata.uploadDate ?? normalizeUploadDate(raw.upload_date),
        timestamp: normalizeTimestamp(raw.timestamp ?? raw.release_timestamp),
        isVerified: raw.channel_is_verified === true || raw.uploader_is_verified === true,
        description: raw.description ?? null,
        isPlaylist: mapped.kind === 'playlist',
        isReel: reel,
        isMusicVideo: !reel && music,
      },
    }
  } catch {
    return {
      sourceUrl,
      metadataState: 'unavailable',
      errorCode: 'MF_EXTRACTOR_STALE',
      patch: {},
    }
  }
}

export function formatChapterTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(minutes)}:${pad(seconds)}`
}

export function parseChaptersFromDescription(description: string): ChapterMarker[] {
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
  const unique = parsed
    .filter((ch, idx, self) => idx === self.findIndex((o) => o.seconds === ch.seconds))
    .sort((a, b) => a.seconds - b.seconds)

  for (let i = 0; i < unique.length; i++) {
    if (i < unique.length - 1) {
      const diff = unique[i + 1].seconds - unique[i].seconds
      if (diff > 0) {
        const m = Math.floor(diff / 60)
        const s = diff % 60
        unique[i].duration = `${m}:${s < 10 ? '0' : ''}${s}`
      }
    }
  }
  return unique
}

export function parseChaptersOutput(stdout: string): VideoChaptersResult {
  const parts = stdout.split('===MF_DESC_SPLIT===')
  const jsonPart = parts[0]?.trim()
  const description =
    parts.length > 1 ? parts.slice(1).join('===MF_DESC_SPLIT===').trim() || null : null

  if (jsonPart && jsonPart !== 'NA' && jsonPart !== 'null') {
    try {
      const rawChapters = JSON.parse(jsonPart)
      if (Array.isArray(rawChapters) && rawChapters.length > 0) {
        const chapters: ChapterMarker[] = []
        for (let i = 0; i < rawChapters.length; i++) {
          const rc = rawChapters[i]
          if (!rc || typeof rc !== 'object') continue
          const startSec =
            typeof rc.start_time === 'number' && Number.isFinite(rc.start_time)
              ? Math.max(0, Math.floor(rc.start_time))
              : 0
          const title =
            typeof rc.title === 'string' && rc.title.trim().length > 0
              ? rc.title.trim()
              : `Chapter ${i + 1}`
          let duration: string | undefined
          if (
            typeof rc.end_time === 'number' &&
            Number.isFinite(rc.end_time) &&
            rc.end_time > startSec
          ) {
            const diff = Math.round(rc.end_time - startSec)
            const dm = Math.floor(diff / 60)
            const ds = diff % 60
            duration = `${dm}:${ds < 10 ? '0' : ''}${ds}`
          }
          chapters.push({
            time: formatChapterTime(startSec),
            title,
            seconds: startSec,
            duration,
          })
        }
        if (chapters.length > 0) {
          return { chapters, description }
        }
      }
    } catch {
      /* fallback to description parsing below */
    }
  }

  if (description) {
    const descChapters = parseChaptersFromDescription(description)
    if (descChapters.length > 0) {
      return { chapters: descChapters, description }
    }
  }

  return { chapters: [], description }
}

export function parseJson3Transcript(rawJson: string): TranscriptCue[] {
  try {
    const data = JSON.parse(rawJson)
    const cues: TranscriptCue[] = []
    let curCue: { startSec: number; endSec: number; text: string } | null = null

    for (const ev of data.events || []) {
      if (!ev.segs) continue
      const segText = ev.segs
        .map((s: { utf8?: string }) => s.utf8 || '')
        .join('')
        .replace(/\n/g, ' ')
        .trim()
      if (!segText) continue

      const startSec = (ev.tStartMs || 0) / 1000
      const durSec = (ev.dDurationMs || 0) / 1000
      const endSec = startSec + durSec

      if (!curCue) {
        curCue = { startSec, endSec, text: segText }
      } else if (startSec - curCue.startSec < 4.5 && curCue.text.length < 85) {
        curCue.text += ' ' + segText
        curCue.endSec = Math.max(curCue.endSec, endSec)
      } else {
        cues.push({
          id: cues.length,
          startSec: Math.round(curCue.startSec * 10) / 10,
          endSec: Math.round(curCue.endSec * 10) / 10,
          time: formatChapterTime(curCue.startSec),
          text: curCue.text.trim(),
        })
        curCue = { startSec, endSec, text: segText }
      }
    }
    if (curCue && curCue.text.trim()) {
      cues.push({
        id: cues.length,
        startSec: Math.round(curCue.startSec * 10) / 10,
        endSec: Math.round(curCue.endSec * 10) / 10,
        time: formatChapterTime(curCue.startSec),
        text: curCue.text.trim(),
      })
    }
    return cues
  } catch {
    return []
  }
}

export function parseVttTranscript(rawVtt: string): TranscriptCue[] {
  const lines = rawVtt.split(/\r?\n/)
  const cues: TranscriptCue[] = []
  const timeRegex =
    /(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/
  let curTime: { start: number; end: number; timeStr: string } | null = null
  let textLines: string[] = []

  function toSec(h?: string, m?: string, s?: string, ms?: string): number {
    return Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0) + Number(ms || 0) / 1000
  }

  for (const line of lines) {
    const match = line.match(timeRegex)
    if (match) {
      if (curTime && textLines.length > 0) {
        const text = textLines
          .join(' ')
          .replace(/<[^>]+>/g, '')
          .trim()
        if (text) {
          cues.push({
            id: cues.length,
            startSec: Math.round(curTime.start * 10) / 10,
            endSec: Math.round(curTime.end * 10) / 10,
            time: curTime.timeStr,
            text,
          })
        }
        textLines = []
      }
      const start = toSec(match[1], match[2], match[3], match[4])
      const end = toSec(match[5], match[6], match[7], match[8])
      curTime = {
        start,
        end,
        timeStr: formatChapterTime(start),
      }
    } else if (
      curTime &&
      line.trim() &&
      !line.startsWith('NOTE') &&
      !line.startsWith('WEBVTT') &&
      !/^\d+$/.test(line.trim())
    ) {
      textLines.push(line.trim())
    }
  }

  if (curTime && textLines.length > 0) {
    const text = textLines
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text) {
      cues.push({
        id: cues.length,
        startSec: Math.round(curTime.start * 10) / 10,
        endSec: Math.round(curTime.end * 10) / 10,
        time: curTime.timeStr,
        text,
      })
    }
  }
  return cues
}

const SEARCH_TIMEOUT_MS = 45_000

/** Upper bound on how long `cancel()` waits for process trees to die before giving up. */
const CANCEL_TIMEOUT_MS = 2000

export class SearchService {
  private readonly activeHandles = new Set<SpawnHandle>()
  /**
   * Preview (chapter/transcript) handles keyed by the renderer's request id, so closing a
   * preview can kill exactly that request's children instead of letting them run to
   * completion (P-06).
   */
  private readonly previewRequests = new Map<string, Set<SpawnHandle>>()
  /** Request ids cancelled while still in flight; consulted before spawning a follow-up. */
  private readonly cancelledRequests = new Set<string>()
  private readonly searchHandles = new Set<SpawnHandle>()
  private searchGeneration = 0
  private searchAbortController: AbortController | null = null

  constructor(private readonly opts: SearchServiceOptions) {}

  /**
   * Supersedes the current search and kills every child it owns (AM-09). `activeHandles` —
   * the set chapter and transcript requests register in — used to be left running, so those
   * processes survived a cancel entirely (P-08).
   *
   * The generation bump comes first so late writes from in-flight work are dropped, and the
   * wait for termination is bounded: a stuck `taskkill` must not hang the UI.
   */
  async cancel(): Promise<void> {
    this.searchGeneration++
    this.searchAbortController?.abort()
    this.searchAbortController = null

    const handles = [...this.searchHandles, ...this.activeHandles]
    this.searchHandles.clear()
    this.activeHandles.clear()
    if (handles.length === 0) return

    const kills = Promise.allSettled(handles.map((handle) => handle.killTree()))
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CANCEL_TIMEOUT_MS)
      timer.unref?.()
    })
    await Promise.race([kills, timeout])
  }

  /** Supersedes without waiting — for the internal "a new search replaces the old" path. */
  private supersede(): void {
    void this.cancel()
  }

  /** Kills the children of one preview request and blocks any follow-up spawn it would make. */
  async cancelPreviewRequest(requestId: string): Promise<void> {
    if (!requestId) return
    this.cancelledRequests.add(requestId)
    // Bounded: ids are removed when their request settles, this only guards a leak if one
    // never does.
    if (this.cancelledRequests.size > 64) {
      const oldest = this.cancelledRequests.values().next()
      if (!oldest.done) this.cancelledRequests.delete(oldest.value)
    }

    const handles = this.previewRequests.get(requestId)
    this.previewRequests.delete(requestId)
    if (!handles || handles.size === 0) return

    const kills = Promise.allSettled([...handles].map((handle) => handle.killTree()))
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CANCEL_TIMEOUT_MS)
      timer.unref?.()
    })
    await Promise.race([kills, timeout])
  }

  private trackPreview(requestId: string | undefined, handle: SpawnHandle): void {
    if (!requestId) return
    let set = this.previewRequests.get(requestId)
    if (!set) {
      set = new Set<SpawnHandle>()
      this.previewRequests.set(requestId, set)
    }
    set.add(handle)
  }

  private untrackPreview(requestId: string | undefined, handle: SpawnHandle): void {
    if (!requestId) return
    const set = this.previewRequests.get(requestId)
    if (!set) return
    set.delete(handle)
    if (set.size === 0) this.previewRequests.delete(requestId)
  }

  private previewCancelled(requestId: string | undefined): boolean {
    return requestId !== undefined && this.cancelledRequests.has(requestId)
  }

  /** Forgets a settled request id so `cancelledRequests` cannot grow with the session. */
  private finishPreview(requestId: string | undefined): void {
    if (!requestId) return
    this.previewRequests.delete(requestId)
    this.cancelledRequests.delete(requestId)
  }

  async search(
    platformId: string,
    query: string,
    limit: number,
    sort: SearchSort,
    filters?: SearchFilterCriteria,
  ): Promise<SearchResultItem[]> {
    const platform = getSearchPlatform(platformId)
    const trimmed = query.trim()
    if (!platform || trimmed.length === 0) throw new MfError('MF_INVALID_QUERY')

    // A new search supersedes both discovery and background hydration from the previous one.
    this.supersede()
    const generation = this.searchGeneration
    const binary = await this.opts.resolveYtDlp()
    if (!binary) throw new MfError('MF_UNKNOWN')

    if (platform.discovery.kind === 'public-web') {
      return this.searchPublicWeb(
        platform.id,
        platform.label,
        platform.discovery.queryScope,
        trimmed,
        limit,
        binary.path,
        generation,
      )
    }

    const isFederated = false
    const effectiveSort: SearchSort = sort
    const effectiveFilters = filters

    const { urlOrQuery, extraFlags } = buildSearchTarget(
      platform,
      trimmed,
      limit,
      effectiveSort,
      effectiveFilters,
    )
    // Never send imported cookies to Google discovery. Target hydration may still use them.
    const args = buildAnalyzeArgs(urlOrQuery, this.opts.getCookiesPath?.() ?? null, extraFlags)

    this.opts.logger?.debug('search spawn started', {
      platform: platformId,
      limit,
      sort: effectiveSort,
      federated: false,
    })
    this.opts.onProcessLine?.(`$ yt-dlp ${args.join(' ')}`, 'out')
    const handle = (this.opts.spawn ?? spawnProcess)(binary.path, args, {
      // stdout is the -J JSON payload and must be complete; stderr only needs a tail (P-01).
      capture: { stdout: 'full', stderr: 'tail', tailLines: 100 },
      onStdoutLine: (line) => {
        this.opts.onProcessLine?.(line, 'out')
      },
      onStderrLine: (line) => {
        this.opts.onProcessLine?.(line, 'err')
      },
      timeoutMs: SEARCH_TIMEOUT_MS,
    })
    this.searchHandles.add(handle)

    let result
    try {
      result = await handle.result
    } finally {
      this.searchHandles.delete(handle)
    }

    if (generation !== this.searchGeneration) throw new MfError('MF_CANCELLED')

    if (result.code !== 0) {
      this.opts.logger?.debug('search failed', {
        stderrTail: result.stderrLines.slice(-5).join(' / '),
      })
      throw new MfError(classifyStderr(result.stderrLines))
    }

    // A partial payload would JSON.parse into nonsense; fail explicitly instead.
    if (result.stdoutTruncated) throw new MfError('MF_EXTRACTOR_STALE')

    const jsonText = result.stdoutLines.join('\n').trim()
    let raw: RawInfo
    try {
      raw = JSON.parse(jsonText) as RawInfo
    } catch {
      throw new MfError('MF_EXTRACTOR_STALE')
    }

    const mapped = mapRawInfo(raw, urlOrQuery)
    const discoveredEntries = mapped.kind === 'playlist' ? (mapped.playlistEntries ?? []) : []
    let entries: SearchResultItem[]

    {
      entries = discoveredEntries.map((entry) => {
        const isPl = entry.url.includes('/playlist?list=')
        const isRl =
          !isPl &&
          (filters?.contentType === 'reel' ||
            entry.url.includes('/shorts/') ||
            Boolean(
              entry.durationSec != null &&
              entry.durationSec <= 180 &&
              /#shorts\b/i.test(`${entry.title} ${entry.description ?? ''}`),
            ))
        const isMv =
          !isPl &&
          !isRl &&
          (filters?.contentType === 'music' ||
            /\b(official (music )?video|official mv|official m\/v|music video|official lyric video|official visualizer)\b/i.test(
              entry.title,
            ) ||
            /(?:\(|\[)(?:official video|official music video|music video|mv|m\/v|official visualizer)(?:\)|\])/i.test(
              entry.title,
            ) ||
            (entry.uploader != null &&
              (/\bvevo\b/i.test(entry.uploader) || entry.uploader.endsWith(' - Topic'))))
        return {
          ...entry,
          platform: platformId,
          isPlaylist: isPl,
          isReel: isRl,
          isMusicVideo: isMv,
        }
      })
    }

    // Server-side filtering for all popover criteria
    if (!isFederated && effectiveFilters) {
      const filters = effectiveFilters
      entries = entries.filter((r) => {
        if (filters.contentType === 'playlist') {
          return Boolean(r.isPlaylist || r.url.includes('/playlist?list='))
        }
        if (filters.contentType === 'reel') {
          if (r.isPlaylist || r.url.includes('/playlist?list=')) return false
          if (r.durationSec != null && r.durationSec > 180) return false
          return true
        } else if (filters.contentType === 'music') {
          if (r.isPlaylist || r.url.includes('/playlist?list=')) return false
          if (r.isReel) return false
          return Boolean(r.isMusicVideo)
        } else if (filters.contentType === 'video') {
          if (r.isPlaylist || r.url.includes('/playlist?list=')) return false
        }

        if (
          filters.minDurationSec != null &&
          (r.durationSec == null || r.durationSec < filters.minDurationSec)
        )
          return false
        if (
          filters.maxDurationSec != null &&
          (r.durationSec == null || r.durationSec > filters.maxDurationSec)
        )
          return false
        if (filters.minViews != null && (r.viewCount == null || r.viewCount < filters.minViews))
          return false
        if (filters.verifiedOnly && !r.isVerified) return false
        if (filters.has4K && !/\b(4k|2160p|uhd)\b/i.test(r.title)) return false
        if (
          filters.hasSubtitles &&
          !/\b(sub|subtitle|subtitles|cc|caption|captions|bn|en|hi|es|ja|ko)\b/i.test(
            `${r.title} ${r.uploader ?? ''}`,
          )
        )
          return false
        if (filters.minFps && filters.minFps >= 60 && !/\b(60fps|60p|120fps)\b/i.test(r.title))
          return false
        if (filters.uploadRecency && filters.uploadRecency !== 'all') {
          const t = r.timestamp ?? (r.uploadDate ? new Date(r.uploadDate).getTime() : null)
          if (t != null) {
            const now = Date.now()
            const msMap: Record<string, number> = {
              '24h': 24 * 60 * 60 * 1000,
              week: 7 * 24 * 60 * 60 * 1000,
              month: 31 * 24 * 60 * 60 * 1000,
              year: 366 * 24 * 60 * 60 * 1000,
            }
            const maxAge = msMap[filters.uploadRecency]
            if (maxAge && now - t > maxAge) return false
          }
        }
        return true
      })
    }

    // Server-side sort application
    if (!isFederated && effectiveSort === 'views') {
      entries.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    } else if (!isFederated && effectiveSort === 'newest') {
      entries.sort((a, b) => {
        const aT = a.timestamp ?? (a.uploadDate ? new Date(a.uploadDate).getTime() : 0)
        const bT = b.timestamp ?? (b.uploadDate ? new Date(b.uploadDate).getTime() : 0)
        return bT - aT
      })
    }

    // Slice to the requested user limit
    const userLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 20))
    entries = entries.slice(0, userLimit)

    // Defer hydration one turn so the initial IPC response reaches the renderer first.
    if (this.opts.onEntryHydrated && entries.length > 0) {
      setTimeout(() => {
        void this.hydrateEntries(binary.path, entries, generation, isFederated)
      }, 0)
    }

    return entries
  }

  private async searchPublicWeb(
    platformId: SearchPlatformId,
    platformLabel: string,
    queryScope: string,
    query: string,
    limit: number,
    binaryPath: string,
    generation: number,
  ): Promise<SearchResultItem[]> {
    const platform = getSearchPlatform(platformId)
    if (!platform) throw new MfError('MF_INVALID_QUERY')
    const target = buildFederatedDiscoveryQuery(platform, query, limit)
    const controller = new AbortController()
    this.searchAbortController = controller
    const requestUrl = buildPublicWebSearchUrl(queryScope, query)

    this.opts.logger?.debug('public-web search started', {
      platform: platformId,
      limit,
      candidateLimit: target.candidateLimit,
    })

    let discoveredUrls: string[]
    try {
      const fetcher = this.opts.fetchPublicWebSearch ?? fetchPublicWebSearch
      const duckDuckGoHtml = await fetcher(requestUrl, controller.signal)
      discoveredUrls = extractPublicWebResultUrls(duckDuckGoHtml)

      // DuckDuckGo can return a 200 challenge page after repeated searches. The backup stays
      // cookie-free and only runs when there are no usable primary-result links.
      if (discoveredUrls.length === 0) {
        const braveHtml = await fetcher(
          buildBravePublicWebSearchUrl(queryScope, query),
          controller.signal,
        )
        discoveredUrls = extractBravePublicWebResultUrls(braveHtml)
        this.opts.logger?.debug('public-web backup search used', {
          platform: platformId,
          duckDuckGoChallenge: isPublicWebChallenge(duckDuckGoHtml),
          braveCandidates: discoveredUrls.length,
        })
      }
    } catch (error) {
      if (generation !== this.searchGeneration || controller.signal.aborted) {
        throw new MfError('MF_CANCELLED')
      }
      if (error instanceof PublicWebSearchError) {
        throw new MfError(
          error.kind === 'rate-limited'
            ? 'MF_RATE_LIMITED'
            : error.kind === 'cancelled'
              ? 'MF_CANCELLED'
              : 'MF_NETWORK',
        )
      }
      throw new MfError('MF_NETWORK')
    } finally {
      if (this.searchAbortController === controller) this.searchAbortController = null
    }

    if (generation !== this.searchGeneration) throw new MfError('MF_CANCELLED')

    const seen = new Set<string>()
    const userLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 20))
    const entries: SearchResultItem[] = []
    for (const rawUrl of discoveredUrls) {
      const normalizedUrl = normalizeFederatedCandidateUrl(platformId, rawUrl)
      if (!normalizedUrl || seen.has(normalizedUrl)) continue
      seen.add(normalizedUrl)
      entries.push({
        index: entries.length + 1,
        id: null,
        title: `${platformLabel} video`,
        url: normalizedUrl,
        platform: platformId,
        isPlaylist: false,
        isReel: isReelUrl(platformId, normalizedUrl),
        metadataState: 'loading',
      })
      if (entries.length >= userLimit) break
    }

    // Defer metadata extraction so lightweight cards render before full yt-dlp analysis begins.
    if (this.opts.onEntryHydrated && entries.length > 0) {
      setTimeout(() => {
        void this.hydrateFederatedEntries(binaryPath, entries, generation)
      }, 0)
    }
    return entries
  }

  private async hydrateEntries(
    binaryPath: string,
    entries: SearchResultItem[],
    generation: number,
    federated: boolean,
  ): Promise<void> {
    if (
      !this.opts.onEntryHydrated ||
      entries.length === 0 ||
      generation !== this.searchGeneration
    ) {
      return
    }

    if (federated) {
      await this.hydrateFederatedEntries(binaryPath, entries, generation)
      return
    }

    const chunkSize = 10
    const chunks: SearchResultItem[][] = []
    for (let i = 0; i < entries.length; i += chunkSize) {
      chunks.push(entries.slice(i, i + chunkSize))
    }

    let nextChunk = 0
    const worker = async (): Promise<void> => {
      while (nextChunk < chunks.length && generation === this.searchGeneration) {
        const chunk = chunks[nextChunk++]
        const urls = chunk
          .map((e) => e.url)
          .filter((u) => u.startsWith('http') && !u.includes('/playlist?list='))
        if (urls.length === 0) continue

        const args = [
          '--no-warnings',
          '--print',
          '%(original_url)s|%(upload_date)s|%(timestamp)s|%(like_count)s',
        ]
        const cookies = this.opts.getCookiesPath?.()
        if (cookies) args.push('--cookies', cookies)
        args.push(...urls)

        const handle = (this.opts.spawn ?? spawnProcess)(binaryPath, args, {
          // Lines are parsed live; nothing needs retaining (P-01).
          capture: { stdout: 'none', stderr: 'tail', tailLines: 20 },
          onStdoutLine: (line) => {
            const parsed = parseHydrateLine(line)
            if (parsed && generation === this.searchGeneration) {
              this.opts.onEntryHydrated?.(parsed)
            }
          },
          timeoutMs: 30_000,
        })
        this.searchHandles.add(handle)
        try {
          await handle.result
        } catch {
          /* best effort */
        } finally {
          this.searchHandles.delete(handle)
        }
      }
    }

    const concurrency = Math.min(2, chunks.length)
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  }

  private async hydrateFederatedEntries(
    binaryPath: string,
    entries: SearchResultItem[],
    generation: number,
  ): Promise<void> {
    let nextEntry = 0
    const worker = async (): Promise<void> => {
      while (nextEntry < entries.length && generation === this.searchGeneration) {
        const entry = entries[nextEntry++]
        const args = buildEntryInfoArgs(entry.url, this.opts.getCookiesPath?.() ?? null)
        const handle = (this.opts.spawn ?? spawnProcess)(binaryPath, args, {
          // stdout is the -J JSON payload and must be complete (P-01).
          capture: { stdout: 'full', stderr: 'tail', tailLines: 100 },
          timeoutMs: 30_000,
        })
        this.searchHandles.add(handle)

        let update: SearchHydratePayload = {
          sourceUrl: entry.url,
          metadataState: 'unavailable',
          patch: {},
        }
        try {
          const result = await handle.result
          if (result.code === 0 && !result.stdoutTruncated && result.stdoutLines.length > 0) {
            update = parseFederatedHydration(
              entry.url,
              entry.platform,
              result.stdoutLines.join('\n').trim(),
            )
          } else if (result.code !== 0) {
            const errorCode = classifyStderr(result.stderrLines)
            update = { ...update, errorCode }
            this.opts.logger?.debug('federated result hydration failed', {
              platform: entry.platform,
              errorCode,
            })
          }
        } catch {
          // Individual metadata failures leave an analyzable URL card in place.
        } finally {
          this.searchHandles.delete(handle)
        }

        if (generation === this.searchGeneration) {
          this.opts.onEntryHydrated?.(update)
        }
      }
    }

    const concurrency = Math.min(2, entries.length)
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  }

  async fetchChapters(
    binaryPath: string,
    url: string,
    requestId?: string,
  ): Promise<VideoChaptersResult> {
    const generation = this.searchGeneration
    if (this.previewCancelled(requestId)) return { chapters: [] }
    const args = [
      '--no-warnings',
      '--print',
      '%(chapters)j',
      '--print',
      '===MF_DESC_SPLIT===',
      '--print',
      '%(description)s',
    ]
    const cookies = this.opts.getCookiesPath?.()
    if (cookies) args.push('--cookies', cookies)
    args.push(url)

    const handle = (this.opts.spawn ?? spawnProcess)(binaryPath, args, {
      // --print payload (chapters JSON + description) must be complete (P-01).
      capture: { stdout: 'full', stderr: 'tail', tailLines: 20 },
      timeoutMs: 15_000,
    })
    this.activeHandles.add(handle)
    this.trackPreview(requestId, handle)
    try {
      const res = await handle.result
      // A cancel landing mid-request supersedes it (AM-09).
      if (generation !== this.searchGeneration || this.previewCancelled(requestId)) {
        return { chapters: [] }
      }
      if (res.code === 0) {
        return parseChaptersOutput(res.stdoutLines.join('\n'))
      }
      return { chapters: [] }
    } catch {
      return { chapters: [] }
    } finally {
      this.activeHandles.delete(handle)
      this.untrackPreview(requestId, handle)
      this.finishPreview(requestId)
    }
  }

  async fetchTranscript(
    binaryPath: string,
    url: string,
    requestId?: string,
  ): Promise<VideoTranscriptResult> {
    const generation = this.searchGeneration
    if (this.previewCancelled(requestId)) return { cues: [] }
    const tmpDir = path.join(
      os.tmpdir(),
      `mf-transcripts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    try {
      await fs.promises.mkdir(tmpDir, { recursive: true })
      const primaryArgs = [
        '--skip-download',
        '--ignore-errors',
        '--no-warnings',
        '--write-auto-subs',
        '--write-subs',
        '--sub-langs',
        'en,en-US,en-GB,en-orig,es,es-419,de,fr,ja,ko,zh-Hans,zh-Hant,hi,bn,pt,pt-BR,ru,it,ar,id,tr,vi,nl,pl,sv,uk,ro,el,th,cs,da,fi,he,hu,no',
        '--sub-format',
        'json3/vtt/srt',
        '-o',
        path.join(tmpDir, '%(id)s.%(ext)s'),
      ]
      const cookies = this.opts.getCookiesPath?.()
      if (cookies) primaryArgs.push('--cookies', cookies)
      primaryArgs.push(url)

      // Subtitles land on disk; stdout is never read (P-01).
      const handle = (this.opts.spawn ?? spawnProcess)(binaryPath, primaryArgs, {
        capture: { stdout: 'none', stderr: 'tail', tailLines: 20 },
        timeoutMs: 25_000,
      })
      this.activeHandles.add(handle)
      this.trackPreview(requestId, handle)
      try {
        await handle.result
      } finally {
        this.activeHandles.delete(handle)
        this.untrackPreview(requestId, handle)
      }

      const superseded = (): boolean =>
        generation !== this.searchGeneration || this.previewCancelled(requestId)
      if (superseded()) return { cues: [] }
      let files = await fs.promises.readdir(tmpDir)

      // Fallback: if none of the explicit primary language tags matched, try all available
      // subtitles — but not if a cancel has since superseded this request (AM-09).
      if (files.length === 0 && !superseded()) {
        const fallbackArgs = [
          '--skip-download',
          '--ignore-errors',
          '--no-warnings',
          '--write-auto-subs',
          '--write-subs',
          '--sub-langs',
          'all,-live_chat',
          '--sub-format',
          'json3/vtt/srt',
          '-o',
          path.join(tmpDir, '%(id)s.%(ext)s'),
        ]
        if (cookies) fallbackArgs.push('--cookies', cookies)
        fallbackArgs.push(url)

        const fbHandle = (this.opts.spawn ?? spawnProcess)(binaryPath, fallbackArgs, {
          capture: { stdout: 'none', stderr: 'tail', tailLines: 20 },
          timeoutMs: 20_000,
        })
        this.activeHandles.add(fbHandle)
        this.trackPreview(requestId, fbHandle)
        try {
          await fbHandle.result
        } finally {
          this.activeHandles.delete(fbHandle)
          this.untrackPreview(requestId, fbHandle)
        }
        files = await fs.promises.readdir(tmpDir)
      }

      if (files.length === 0 || superseded()) {
        return { cues: [] }
      }

      const json3Files = files.filter((f) => f.endsWith('.json3'))
      const textSubFiles = files.filter((f) => f.endsWith('.vtt') || f.endsWith('.srt'))

      const targetJson3 =
        json3Files.find(
          (f) =>
            f.includes('.en.') ||
            f.includes('.en-') ||
            f.includes('.en_') ||
            f.endsWith('.en.json3'),
        ) ?? json3Files[0]
      if (targetJson3) {
        const raw = await fs.promises.readFile(path.join(tmpDir, targetJson3), 'utf8')
        const cues = parseJson3Transcript(raw)
        if (cues.length > 0) {
          return { cues }
        }
      }

      const targetText =
        textSubFiles.find(
          (f) =>
            f.includes('.en.') ||
            f.includes('.en-') ||
            f.includes('.en_') ||
            f.endsWith('.en.vtt') ||
            f.endsWith('.en.srt'),
        ) ?? textSubFiles[0]
      if (targetText) {
        const raw = await fs.promises.readFile(path.join(tmpDir, targetText), 'utf8')
        const cues = parseVttTranscript(raw)
        if (cues.length > 0) {
          return { cues }
        }
      }

      return { cues: [] }
    } catch {
      return { cues: [] }
    } finally {
      this.finishPreview(requestId)
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true })
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
