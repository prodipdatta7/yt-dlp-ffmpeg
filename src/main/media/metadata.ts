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
import { classifyStderr } from './classifyStderr'
import { buildAnalyzeArgs } from './argBuilders'
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

export interface RawInfo {
  _type?: string
  id?: string
  title?: string
  uploader?: string
  channel?: string
  duration?: number | null
  view_count?: number | null
  concurrent_view_count?: number | null
  upload_date?: string
  thumbnail?: string | null
  webpage_url?: string
  is_live?: boolean
  live_status?: string
  formats?: RawFormat[]
  entries?: Array<{ id?: string; title?: string; url?: string }>
}

function normalizeCodec(value: string | undefined): string | null {
  if (!value || value === 'none' || value === 'unknown') return null
  return value
}

function mapUploadDate(raw: string | undefined): string | null {
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
    const entries: PlaylistEntryPreview[] = (raw.entries ?? [])
      .slice(0, 1000)
      .map((e, i) => ({ index: i + 1, title: e.title ?? e.id ?? `Entry ${i + 1}` }))
    const metadata: MediaMetadata = {
      id: raw.id ?? null,
      title: raw.title ?? 'Playlist',
      uploader: raw.uploader ?? raw.channel ?? null,
      durationSec: null,
      viewCount: null,
      uploadDate: null,
      thumbnailUrl: null,
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
    uploadDate: mapUploadDate(raw.upload_date),
    thumbnailUrl: raw.thumbnail ?? null,
    isLive: raw.is_live === true || raw.live_status === 'is_live',
    webpageUrl: raw.webpage_url ?? sourceUrl,
  }

  return { kind: 'video', metadata, formats }
}

export interface AnalyzeServiceOptions {
  resolveYtDlp: () => Promise<LocatedBinary | null>
  logger?: Logger
}

const RETRYABLE_CODES = new Set(['MF_EXTRACTOR_STALE', 'MF_UNKNOWN'])

export class AnalyzeService {
  private activeHandle: SpawnHandle | null = null
  private cancelRequested = false

  constructor(private readonly opts: AnalyzeServiceOptions) {}

  cancel(): void {
    this.cancelRequested = true
    const handle = this.activeHandle
    this.activeHandle = null
    void handle?.killTree()
  }

  async analyze(rawUrl: string): Promise<AnalyzeResult> {
    const validation = validateUrl(rawUrl)
    if (!validation.ok) throw new MfError('MF_INVALID_URL')

    const binary = await this.opts.resolveYtDlp()
    if (!binary) throw new MfError('MF_UNKNOWN')

    this.cancelRequested = false

    try {
      return await this.runOnce(binary.path, validation.url.toString())
    } catch (error) {
      if (this.cancelRequested) throw new MfError('MF_CANCELLED')
      const firstError =
        error instanceof MfError ? error : new MfError(classifyStderr([String(error)]))
      const retryUrl = cleanUrlForRetry(validation.url.toString())
      if (!retryUrl || !RETRYABLE_CODES.has(firstError.code)) throw firstError
      try {
        return await this.runOnce(binary.path, retryUrl)
      } catch {
        if (this.cancelRequested) throw new MfError('MF_CANCELLED')
        throw firstError
      }
    }
  }

  private async runOnce(binaryPath: string, url: string): Promise<AnalyzeResult> {
    const args = buildAnalyzeArgs(url)
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    this.opts.logger?.debug('analyze spawn started', { url })
    const handle = spawnProcess(binaryPath, args, {
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
    })
    this.activeHandle = handle

    let result
    try {
      result = await handle.result
    } finally {
      this.activeHandle = null
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
    return mapRawInfo(raw, url)
  }
}
