import {
  SEARCH_PLATFORMS,
  type SearchFilterCriteria,
  type SearchResultItem,
  type SearchSort,
} from '../../shared/models'
import type { SearchHydratePayload } from '../../shared/ipcContract'
import type { LocatedBinary } from '../binaries/locator'
import { spawnProcess, type SpawnHandle } from '../binaries/runner'
import type { Logger } from '../store/logger'
import { classifyStderr } from './classifyStderr'
import { buildAnalyzeArgs, buildSearchTarget } from './argBuilders'
import { mapRawInfo, MfError, type RawInfo } from './metadata'

export interface SearchServiceOptions {
  resolveYtDlp: () => Promise<LocatedBinary | null>
  logger?: Logger
  getCookiesPath?: () => string | null
  /** Raw CLI line tap (stdout/stderr of yt-dlp) for the live console. */
  onProcessLine?: (line: string, stream: 'out' | 'err') => void
  onEntryHydrated?: (item: SearchHydratePayload) => void
}

/** Parses a formatted print line "%(webpage_url)s|%(upload_date)s|%(timestamp)s|%(like_count)s" */
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
  return { url, uploadDate, timestamp, likeCount }
}

const SEARCH_TIMEOUT_MS = 45_000

export class SearchService {
  private readonly activeHandles = new Set<SpawnHandle>()
  private cancelRequested = false

  constructor(private readonly opts: SearchServiceOptions) {}

  cancel(): void {
    this.cancelRequested = true
    const handles = [...this.activeHandles]
    this.activeHandles.clear()
    for (const handle of handles) void handle.killTree()
  }

  async search(
    platformId: string,
    query: string,
    limit: number,
    sort: SearchSort,
    filters?: SearchFilterCriteria,
  ): Promise<SearchResultItem[]> {
    const platform = SEARCH_PLATFORMS.find((p) => p.id === platformId)
    const trimmed = query.trim()
    if (!platform || trimmed.length === 0) throw new MfError('MF_INVALID_QUERY')

    const binary = await this.opts.resolveYtDlp()
    if (!binary) throw new MfError('MF_UNKNOWN')

    this.cancelRequested = false
    const { urlOrQuery, extraFlags } = buildSearchTarget(
      platformId,
      platform.prefix,
      trimmed,
      limit,
      sort,
      filters,
    )
    const args = buildAnalyzeArgs(urlOrQuery, this.opts.getCookiesPath?.() ?? null, extraFlags)

    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    this.opts.logger?.debug('search spawn started', { platform: platformId, limit, sort, filters })
    this.opts.onProcessLine?.(`$ yt-dlp ${args.join(' ')}`, 'out')
    const handle = spawnProcess(binary.path, args, {
      onStdoutLine: (line) => {
        stdoutLines.push(line)
        this.opts.onProcessLine?.(line, 'out')
      },
      onStderrLine: (line) => {
        stderrLines.push(line)
        this.opts.onProcessLine?.(line, 'err')
      },
      timeoutMs: SEARCH_TIMEOUT_MS,
    })
    this.activeHandles.add(handle)

    let result
    try {
      result = await handle.result
    } finally {
      this.activeHandles.delete(handle)
    }

    if (this.cancelRequested) throw new MfError('MF_CANCELLED')

    if (result.code !== 0) {
      this.opts.logger?.debug('search failed', { stderrTail: stderrLines.slice(-5).join(' / ') })
      throw new MfError(classifyStderr(stderrLines))
    }

    const jsonText = stdoutLines.join('\n').trim()
    let raw: RawInfo
    try {
      raw = JSON.parse(jsonText) as RawInfo
    } catch {
      throw new MfError('MF_EXTRACTOR_STALE')
    }

    const mapped = mapRawInfo(raw, urlOrQuery)
    let entries: SearchResultItem[] = (
      mapped.kind === 'playlist' ? (mapped.playlistEntries ?? []) : []
    ).map((entry) => ({ ...entry, platform: platformId }))

    // Server-side filtering for all popover criteria
    if (filters) {
      entries = entries.filter((r) => {
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
    if (sort === 'views') {
      entries.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    } else if (sort === 'newest') {
      entries.sort((a, b) => {
        const aT = a.timestamp ?? (a.uploadDate ? new Date(a.uploadDate).getTime() : 0)
        const bT = b.timestamp ?? (b.uploadDate ? new Date(b.uploadDate).getTime() : 0)
        return bT - aT
      })
    }

    // Slice to the requested user limit
    entries = entries.slice(0, limit)

    // Kick off progressive background hydration of real upload date and likes
    if (this.opts.onEntryHydrated && entries.length > 0) {
      void this.hydrateEntries(binary.path, entries)
    }

    return entries
  }

  private async hydrateEntries(binaryPath: string, entries: SearchResultItem[]): Promise<void> {
    if (!this.opts.onEntryHydrated || entries.length === 0 || this.cancelRequested) return

    const chunkSize = 10
    const chunks: SearchResultItem[][] = []
    for (let i = 0; i < entries.length; i += chunkSize) {
      chunks.push(entries.slice(i, i + chunkSize))
    }

    let nextChunk = 0
    const worker = async (): Promise<void> => {
      while (nextChunk < chunks.length && !this.cancelRequested) {
        const chunk = chunks[nextChunk++]
        const urls = chunk.map((e) => e.url).filter((u) => u.startsWith('http'))
        if (urls.length === 0) continue

        const args = [
          '--no-warnings',
          '--print',
          '%(webpage_url)s|%(upload_date)s|%(timestamp)s|%(like_count)s',
        ]
        const cookies = this.opts.getCookiesPath?.()
        if (cookies) args.push('--cookies', cookies)
        args.push(...urls)

        const handle = spawnProcess(binaryPath, args, {
          onStdoutLine: (line) => {
            const parsed = parseHydrateLine(line)
            if (parsed) {
              this.opts.onEntryHydrated?.(parsed)
            }
          },
          timeoutMs: 30_000,
        })
        this.activeHandles.add(handle)
        try {
          await handle.result
        } catch {
          /* best effort */
        } finally {
          this.activeHandles.delete(handle)
        }
      }
    }

    const concurrency = Math.min(2, chunks.length)
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  }
}
