import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  SEARCH_PLATFORMS,
  type ChapterMarker,
  type SearchFilterCriteria,
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
    ).map((entry) => {
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

    // Server-side filtering for all popover criteria
    if (filters) {
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
        const urls = chunk
          .map((e) => e.url)
          .filter((u) => u.startsWith('http') && !u.includes('/playlist?list='))
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

  async fetchChapters(binaryPath: string, url: string): Promise<VideoChaptersResult> {
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

    const handle = spawnProcess(binaryPath, args, { timeoutMs: 15_000 })
    this.activeHandles.add(handle)
    try {
      const res = await handle.result
      if (res.code === 0) {
        return parseChaptersOutput(res.stdoutLines.join('\n'))
      }
      return { chapters: [] }
    } catch {
      return { chapters: [] }
    } finally {
      this.activeHandles.delete(handle)
    }
  }

  async fetchTranscript(binaryPath: string, url: string): Promise<VideoTranscriptResult> {
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

      const handle = spawnProcess(binaryPath, primaryArgs, { timeoutMs: 25_000 })
      this.activeHandles.add(handle)
      try {
        await handle.result
      } finally {
        this.activeHandles.delete(handle)
      }

      let files = await fs.promises.readdir(tmpDir)

      // Fallback: if none of the explicit primary language tags matched, try all available subtitles
      if (files.length === 0) {
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

        const fbHandle = spawnProcess(binaryPath, fallbackArgs, { timeoutMs: 20_000 })
        this.activeHandles.add(fbHandle)
        try {
          await fbHandle.result
        } finally {
          this.activeHandles.delete(fbHandle)
        }
        files = await fs.promises.readdir(tmpDir)
      }

      if (files.length === 0) {
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
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true })
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
