import type {
  AnalyzeResult,
  FormatRow,
  MediaMetadata,
  MfErrorCode,
  PlaylistEntryPreview,
} from '../../shared/models'
import { PLAYLIST_HYDRATION_WINDOW } from '../../shared/models'
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
  timestamp?: number | null
  release_timestamp?: number | null
  channel_is_verified?: boolean
  uploader_is_verified?: boolean
  description?: string | null
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
  /** Test seam: process spawner, so hydration can be counted and driven deterministically. */
  spawn?: typeof spawnProcess
}

const RETRYABLE_CODES = new Set(['MF_EXTRACTOR_STALE', 'MF_UNKNOWN'])

/** Systemic per-entry failures abort the whole hydration pass instead of skipping. */
const HYDRATION_ABORT_CODES = new Set(['MF_RATE_LIMITED', 'MF_BOT_CHECK', 'MF_AGE_RESTRICTED'])

const ENTRY_INFO_TIMEOUT_MS = 30_000
const HYDRATION_CONCURRENCY = 4

/**
 * Entries hydrated eagerly when a playlist is analyzed (R-02). Each hydration spawns its own
 * yt-dlp — a 17 MB PyInstaller binary that unpacks itself to temp on every launch — so
 * hydrating a 1,000-entry playlist up front cost on the order of 1,000 processes and several
 * minutes before `analyze()` would resolve. The rest keep their flat-playlist preview rows
 * (title + URL, which already render) and gain detail on demand via `hydrateRange`.
 */
export const HYDRATION_WINDOW = PLAYLIST_HYDRATION_WINDOW

/** Upper bound on how long `cancel()` waits for process trees to die before giving up. */
const CANCEL_TIMEOUT_MS = 2000

interface CurrentPlaylist {
  binaryPath: string
  entries: PlaylistEntryPreview[]
  /** Array positions already hydrated or in flight, so a range is never hydrated twice. */
  attempted: Set<number>
  /** Entries attempted so far, for the `done` figure in stream events. */
  done: number
}

export class AnalyzeService {
  private readonly activeHandles = new Set<SpawnHandle>()
  private cancelRequested = false
  private entrySink: ((event: AnalyzeStreamEvent) => void) | null = null
  /** Bumped by every new analysis, so late results from a superseded one are dropped. */
  private generation = 0
  private current: CurrentPlaylist | null = null

  constructor(private readonly opts: AnalyzeServiceOptions) {}

  /**
   * Kills every in-flight yt-dlp tree and waits for them (AM-09), so a caller awaiting this
   * can rely on the old processes actually being gone. A stuck `taskkill` must not hang the
   * UI, so the wait is bounded — on timeout the handles are dropped and we move on.
   */
  async cancel(): Promise<void> {
    this.cancelRequested = true
    this.generation += 1
    this.current = null
    const handles = [...this.activeHandles]
    this.activeHandles.clear()
    if (handles.length === 0) return
    const kills = Promise.allSettled(handles.map((handle) => handle.killTree()))
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CANCEL_TIMEOUT_MS)
      timer.unref?.()
    })
    await Promise.race([kills, timeout])
  }

  /**
   * Hydrates a further slice of the current playlist, emitting the same `entry` events as the
   * initial window. No-ops when there is no current playlist, when the range is already
   * hydrated, or when a newer analysis has started.
   */
  async hydrateRange(
    fromIndex: number,
    count: number,
    onEntry?: (event: AnalyzeStreamEvent) => void,
  ): Promise<void> {
    const current = this.current
    if (!current || count <= 0) return
    const generation = this.generation
    this.cancelRequested = false
    try {
      await this.hydrateEntries(current, fromIndex, count, generation, onEntry)
    } catch (error) {
      if (error instanceof MfError && error.code === 'MF_CANCELLED') return
      throw error
    }
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
    this.generation += 1
    const generation = this.generation
    this.current = null
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
      // A cancel or a newer analysis landing during the outline call supersedes this one;
      // emitting now would overwrite the newer analysis in the renderer (P-08).
      if (this.cancelRequested || generation !== this.generation) {
        throw new MfError('MF_CANCELLED')
      }
      if (result.kind === 'playlist' && (result.playlistEntries?.length ?? 0) > 0) {
        this.entrySink?.({ kind: 'outline', result })
        const current: CurrentPlaylist = {
          binaryPath: binary.path,
          entries: result.playlistEntries!,
          attempted: new Set<number>(),
          done: 0,
        }
        this.current = current
        // Only the first window is hydrated eagerly; the rest arrive via hydrateRange
        // as the renderer scrolls (R-02).
        await this.hydrateEntries(current, 0, HYDRATION_WINDOW, generation, this.entrySink)
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
    this.opts.logger?.debug('analyze spawn started', { url, flatPlaylist })
    this.opts.onProcessLine?.(`$ yt-dlp ${args.join(' ')}`, 'out')
    const handle = (this.opts.spawn ?? spawnProcess)(binaryPath, args, {
      // stdout is the -J JSON payload and must be complete; stderr only needs a tail (P-01).
      capture: { stdout: 'full', stderr: 'tail', tailLines: 100 },
      onStdoutLine: (line) => {
        this.opts.onProcessLine?.(line, 'out')
      },
      onStderrLine: (line) => {
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
      this.opts.logger?.debug('analyze failed', {
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

    const mapped = mapRawInfo(raw, url)
    return mapped
  }

  /**
   * Fills in per-video details (thumbnail, duration, uploader, views) for the array positions
   * `[from, from + count)` so the UI can present each entry like a single-video analysis.
   * Positions already attempted are skipped, so a range is never hydrated twice. Failures on
   * individual entries keep the bare preview row; systemic failures abort the pass.
   */
  private async hydrateEntries(
    playlist: CurrentPlaylist,
    from: number,
    count: number,
    generation: number,
    sink?: ((event: AnalyzeStreamEvent) => void) | null,
  ): Promise<void> {
    const { binaryPath, entries, attempted } = playlist
    const total = entries.length
    const end = Math.min(total, Math.max(0, from) + count)

    const queue: number[] = []
    for (let i = Math.max(0, from); i < end; i += 1) {
      if (attempted.has(i)) continue
      attempted.add(i)
      queue.push(i)
    }
    if (queue.length === 0) return

    const superseded = (): boolean => this.cancelRequested || generation !== this.generation
    let nextQueued = 0

    const worker = async (): Promise<void> => {
      while (true) {
        if (superseded()) throw new MfError('MF_CANCELLED')
        const q = nextQueued
        if (q >= queue.length) return
        nextQueued += 1
        const entry = entries[queue[q]]
        try {
          const info = await this.runOnce(binaryPath, entry.url, false)
          // Re-check after the await: a cancel landing mid-entry must not emit a stale event.
          if (superseded()) throw new MfError('MF_CANCELLED')
          entry.title = info.metadata.title !== 'Untitled' ? info.metadata.title : entry.title
          entry.durationSec = info.metadata.durationSec
          entry.uploader = info.metadata.uploader
          entry.viewCount = info.metadata.viewCount
          if (info.metadata.thumbnailUrl) entry.thumbnailUrl = info.metadata.thumbnailUrl
        } catch (error) {
          if (superseded()) throw new MfError('MF_CANCELLED')
          const code = error instanceof MfError ? error.code : 'MF_UNKNOWN'
          if (HYDRATION_ABORT_CODES.has(code)) throw error
          this.opts.logger?.debug('playlist entry hydration skipped', { index: entry.index, code })
        }
        playlist.done += 1
        const entryEvent: Extract<AnalyzeStreamEvent, { kind: 'entry' }> = {
          kind: 'entry',
          index: entry.index,
          entry: { ...entry },
          done: playlist.done,
          total,
        }
        sink?.(entryEvent)
        this.opts.onEntryHydrated?.(entryEvent)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(HYDRATION_CONCURRENCY, queue.length) }, () => worker()),
    )
  }
}
