import type {
  AnalyzeResult,
  FormatRow,
  MediaMetadata,
  MfErrorCode,
  PlaylistEntryPreview,
} from '../../shared/models'
import type { LocatedBinary } from '../binaries/locator'
import { spawnProcess, type SpawnHandle } from '../binaries/runner'
import type { Logger } from '../store/logger'
import type { AnalyzeStreamEvent } from '../../shared/ipcContract'
import { classifyStderr } from './classifyStderr'
import { buildAnalyzeArgs, buildEntryInfoArgs } from './argBuilders'
import { cleanUrlForRetry, validateUrl } from './urlCleaner'

export class MfError extends Error {
  constructor(public readonly code: MfErrorCode) {
    super(code)
    this.name = 'MfError'
  }
}

export interface RawFormat {
  format_id?: string | number
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  fps?: number
  abr?: number
  tbr?: number
  filesize?: number | null
  filesize_approx?: number | null
  format_note?: string
}

export interface RawThumbnail {
  url?: string | null
}

export interface RawInfo {
  _type?: string
  id?: string
  title?: string
  uploader?: string
  channel?: string
  duration?: number | null
  view_count?: number | null
  concurrent_view_count?: number | null
  like_count?: number | null
  comment_count?: number | null
  upload_date?: string
  thumbnail?: string | null
  thumbnails?: RawThumbnail[] | null
  webpage_url?: string
  is_live?: boolean
  live_status?: string
  formats?: RawFormat[]
  entries?: Array<{
    id?: string
    title?: string
    url?: string
    ie_key?: string | null
    webpage_url?: string | null
    duration?: number | null
    view_count?: number | null
    like_count?: number | null
    comment_count?: number | null
    uploader?: string | null
    channel?: string | null
    thumbnail?: string | null
    thumbnails?: RawThumbnail[] | null
    upload_date?: string | null
    timestamp?: number | null
    release_timestamp?: number | null
    channel_is_verified?: boolean
    uploader_is_verified?: boolean
    description?: string | null
  }>
}

/** yt-dlp exposes thumbnails as a `thumbnail` string or a `thumbnails[]` array — use either. */
function firstThumbnailUrl(
  raw: { thumbnail?: string | null; thumbnails?: RawThumbnail[] | null } | null | undefined,
): string | null {
  if (!raw) return null
  if (typeof raw.thumbnail === 'string' && raw.thumbnail.length > 0) return raw.thumbnail
  for (const t of raw.thumbnails ?? []) {
    if (t && typeof t.url === 'string' && t.url.length > 0) return t.url
  }
  return null
}

function normalizeCodec(value: string | undefined): string | null {
  if (!value || value === 'none' || value === 'unknown') return null
  return value
}

function mapUploadDate(raw: string | undefined | null): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

function isStoryboard(f: RawFormat): boolean {
  if (f.format_note && /storyboard/i.test(f.format_note)) return true
  const v = f.vcodec ?? ''
  return v.startsWith('sb')
}

export function mapRawInfo(raw: RawInfo, sourceUrl: string): AnalyzeResult {
  if (raw._type === 'playlist') {
    const isPlaylistSearch = sourceUrl.includes('sp=EgIQAw')
    const entries: PlaylistEntryPreview[] = (raw.entries ?? [])
      .slice(0, 1000)
      .filter((e) => {
        if (!e) return false
        const u = e.webpage_url ?? e.url ?? ''
        if (isPlaylistSearch) {
          if (u.includes('/channel/') || u.includes('/@')) return false
          return u.includes('/playlist?list=')
        }
        if (e.ie_key === 'YoutubeTab') return false
        if (u.includes('/playlist?list=')) return false
        return true
      })
      .map((e, i) => {
        const rawTs =
          typeof e.timestamp === 'number'
            ? e.timestamp
            : typeof e.release_timestamp === 'number'
              ? e.release_timestamp
              : null
        return {
          index: i + 1,
          title: e.title ?? e.id ?? `Entry ${i + 1}`,
          url: e.webpage_url ?? e.url ?? e.id ?? '',
          id: e.id ?? null,
          durationSec: typeof e.duration === 'number' ? e.duration : null,
          uploader: e.uploader ?? e.channel ?? null,
          viewCount: typeof e.view_count === 'number' ? e.view_count : null,
          likeCount: typeof e.like_count === 'number' ? e.like_count : null,
          commentCount: typeof e.comment_count === 'number' ? e.comment_count : null,
          thumbnailUrl: firstThumbnailUrl(e),
          uploadDate: mapUploadDate(e.upload_date),
          timestamp:
            rawTs !== null && rawTs > 0 ? (rawTs < 100_000_000_000 ? rawTs * 1000 : rawTs) : null,
          isVerified: e.channel_is_verified === true || e.uploader_is_verified === true,
          description: e.description ?? null,
        }
      })
      .filter((e) => e.url.length > 0)
    const metadata: MediaMetadata = {
      id: raw.id ?? null,
      title: raw.title ?? 'Playlist',
      uploader: raw.uploader ?? raw.channel ?? null,
      durationSec: null,
      viewCount: null,
      likeCount: null,
      uploadDate: null,
      thumbnailUrl: firstThumbnailUrl(raw),
      isLive: false,
      webpageUrl: raw.webpage_url ?? sourceUrl,
    }
    return {
      kind: 'playlist',
      metadata,
      formats: [],
      playlistCount: entries.length,
      playlistEntries: entries,
    }
  }

  const formats: FormatRow[] = (raw.formats ?? [])
    .filter((f) => !isStoryboard(f))
    .map((f) => ({
      formatId: String(f.format_id ?? ''),
      ext: f.ext ?? '',
      vcodec: normalizeCodec(f.vcodec),
      acodec: normalizeCodec(f.acodec),
      height: typeof f.height === 'number' ? f.height : null,
      fps: typeof f.fps === 'number' ? f.fps : null,
      abrKbps: typeof f.abr === 'number' ? f.abr : null,
      tbrKbps: typeof f.tbr === 'number' ? f.tbr : null,
      filesizeBytes: f.filesize ?? f.filesize_approx ?? null,
    }))

  const metadata: MediaMetadata = {
    id: raw.id ?? null,
    title: raw.title ?? 'Untitled',
    uploader: raw.uploader ?? raw.channel ?? null,
    durationSec: typeof raw.duration === 'number' ? raw.duration : null,
    viewCount: raw.view_count ?? raw.concurrent_view_count ?? null,
    likeCount: typeof raw.like_count === 'number' ? raw.like_count : null,
    uploadDate: mapUploadDate(raw.upload_date),
    thumbnailUrl: firstThumbnailUrl(raw),
    isLive: raw.is_live === true || raw.live_status === 'is_live',
    webpageUrl: raw.webpage_url ?? sourceUrl,
  }

  return { kind: 'video', metadata, formats }
}

export interface AnalyzeServiceOptions {
  resolveYtDlp: () => Promise<LocatedBinary | null>
  logger?: Logger
  getCookiesPath?: () => string | null
  onEntryHydrated?: (event: Extract<AnalyzeStreamEvent, { kind: 'entry' }>) => void
  /** Raw CLI line tap (stdout/stderr of yt-dlp) for the live console. */
  onProcessLine?: (line: string, stream: 'out' | 'err') => void
}

const RETRYABLE_CODES = new Set(['MF_EXTRACTOR_STALE', 'MF_UNKNOWN'])

/** Systemic per-entry failures abort the whole hydration pass instead of skipping. */
const HYDRATION_ABORT_CODES = new Set(['MF_RATE_LIMITED', 'MF_BOT_CHECK', 'MF_AGE_RESTRICTED'])

const ENTRY_INFO_TIMEOUT_MS = 30_000
const HYDRATION_CONCURRENCY = 4

export class AnalyzeService {
  private readonly activeHandles = new Set<SpawnHandle>()
  private cancelRequested = false
  private entrySink: ((event: AnalyzeStreamEvent) => void) | null = null

  constructor(private readonly opts: AnalyzeServiceOptions) {}

  cancel(): void {
    this.cancelRequested = true
    const handles = [...this.activeHandles]
    this.activeHandles.clear()
    for (const handle of handles) void handle.killTree()
  }

  async analyze(
    rawUrl: string,
    onEntry?: (event: AnalyzeStreamEvent) => void,
  ): Promise<AnalyzeResult> {
    const validation = validateUrl(rawUrl)
    if (!validation.ok) throw new MfError('MF_INVALID_URL')

    const binary = await this.opts.resolveYtDlp()
    if (!binary) throw new MfError('MF_UNKNOWN')

    this.cancelRequested = false
    const legacySink = this.opts.onEntryHydrated
    this.entrySink =
      onEntry ??
      (legacySink
        ? (event) => {
            if (event.kind === 'entry') legacySink(event)
          }
        : null)

    const attempt = async (url: string): Promise<AnalyzeResult> => {
      const result = await this.runOnce(binary.path, url, true)
      if (result.kind === 'playlist' && (result.playlistEntries?.length ?? 0) > 0) {
        this.entrySink?.({ kind: 'outline', result })
        await this.hydrateEntries(binary.path, result.playlistEntries!)
      }
      return result
    }

    try {
      return await attempt(validation.url.toString())
    } catch (error) {
      if (this.cancelRequested) throw new MfError('MF_CANCELLED')
      const firstError =
        error instanceof MfError ? error : new MfError(classifyStderr([String(error)]))
      const retryUrl = cleanUrlForRetry(validation.url.toString())
      if (!retryUrl || !RETRYABLE_CODES.has(firstError.code)) throw firstError
      try {
        return await attempt(retryUrl)
      } catch {
        if (this.cancelRequested) throw new MfError('MF_CANCELLED')
        throw firstError
      }
    } finally {
      this.entrySink = null
    }
  }

  private async runOnce(
    binaryPath: string,
    url: string,
    flatPlaylist: boolean,
  ): Promise<AnalyzeResult> {
    const args = flatPlaylist
      ? buildAnalyzeArgs(url, this.opts.getCookiesPath?.() ?? null)
      : buildEntryInfoArgs(url, this.opts.getCookiesPath?.() ?? null)
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    this.opts.logger?.debug('analyze spawn started', { url, flatPlaylist })
    this.opts.onProcessLine?.(`$ yt-dlp ${args.join(' ')}`, 'out')
    const handle = spawnProcess(binaryPath, args, {
      onStdoutLine: (line) => {
        stdoutLines.push(line)
        this.opts.onProcessLine?.(line, 'out')
      },
      onStderrLine: (line) => {
        stderrLines.push(line)
        this.opts.onProcessLine?.(line, 'err')
      },
      timeoutMs: flatPlaylist ? undefined : ENTRY_INFO_TIMEOUT_MS,
    })
    this.activeHandles.add(handle)

    let result
    try {
      result = await handle.result
    } finally {
      this.activeHandles.delete(handle)
    }

    if (result.code !== 0) {
      this.opts.logger?.debug('analyze failed', { stderrTail: stderrLines.slice(-5).join(' / ') })
      throw new MfError(classifyStderr(stderrLines))
    }

    const jsonText = stdoutLines.join('\n').trim()
    let raw: RawInfo
    try {
      raw = JSON.parse(jsonText) as RawInfo
    } catch {
      throw new MfError('MF_EXTRACTOR_STALE')
    }

    const mapped = mapRawInfo(raw, url)
    return mapped
  }

  /**
   * Fills in per-video details (thumbnail, duration, uploader, views) for every playlist
   * entry so the UI can present each one like a single-video analysis. Failures on
   * individual entries keep the bare preview row; systemic failures abort the pass.
   */
  private async hydrateEntries(binaryPath: string, entries: PlaylistEntryPreview[]): Promise<void> {
    const total = entries.length
    let completed = 0
    let nextIndex = 0

    const worker = async (): Promise<void> => {
      while (true) {
        if (this.cancelRequested) throw new MfError('MF_CANCELLED')
        const i = nextIndex
        if (i >= total) return
        nextIndex += 1
        const entry = entries[i]
        try {
          const info = await this.runOnce(binaryPath, entry.url, false)
          entry.title = info.metadata.title !== 'Untitled' ? info.metadata.title : entry.title
          entry.durationSec = info.metadata.durationSec
          entry.uploader = info.metadata.uploader
          entry.viewCount = info.metadata.viewCount
          if (info.metadata.thumbnailUrl) entry.thumbnailUrl = info.metadata.thumbnailUrl
        } catch (error) {
          if (this.cancelRequested) throw new MfError('MF_CANCELLED')
          const code = error instanceof MfError ? error.code : 'MF_UNKNOWN'
          if (HYDRATION_ABORT_CODES.has(code)) throw error
          this.opts.logger?.debug('playlist entry hydration skipped', { index: entry.index, code })
        }
        completed += 1
        const entryEvent: Extract<AnalyzeStreamEvent, { kind: 'entry' }> = {
          kind: 'entry',
          index: entry.index,
          entry: { ...entry },
          done: completed,
          total,
        }
        this.entrySink?.(entryEvent)
        this.opts.onEntryHydrated?.(entryEvent)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(HYDRATION_CONCURRENCY, total) }, () => worker()),
    )
  }
}
