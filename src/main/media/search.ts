import { SEARCH_PLATFORMS, type SearchResultItem, type SearchSort } from '../../shared/models'
import type { LocatedBinary } from '../binaries/locator'
import { spawnProcess, type SpawnHandle } from '../binaries/runner'
import type { Logger } from '../store/logger'
import { classifyStderr } from './classifyStderr'
import { buildAnalyzeArgs, buildSearchQuery } from './argBuilders'
import { mapRawInfo, MfError, type RawInfo } from './metadata'

export interface SearchServiceOptions {
  resolveYtDlp: () => Promise<LocatedBinary | null>
  logger?: Logger
  getCookiesPath?: () => string | null
  /** Raw CLI line tap (stdout/stderr of yt-dlp) for the live console. */
  onProcessLine?: (line: string, stream: 'out' | 'err') => void
}

/** Search results are one flat `-J` call — no per-entry hydration (that would spawn one
 * yt-dlp process per result, which is exactly the "heavy" cost this feature avoids). A
 * single result card only gets full details once the user opens it in the Downloader tab. */
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
  ): Promise<SearchResultItem[]> {
    const platform = SEARCH_PLATFORMS.find((p) => p.id === platformId)
    const trimmed = query.trim()
    if (!platform || trimmed.length === 0) throw new MfError('MF_INVALID_QUERY')

    const binary = await this.opts.resolveYtDlp()
    if (!binary) throw new MfError('MF_UNKNOWN')

    this.cancelRequested = false
    const prefix =
      sort === 'newest' && platform.dateSortPrefix ? platform.dateSortPrefix : platform.prefix
    const pseudoUrl = buildSearchQuery(prefix, trimmed, limit)
    const args = buildAnalyzeArgs(pseudoUrl, this.opts.getCookiesPath?.() ?? null)

    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    this.opts.logger?.debug('search spawn started', { platform: platformId, limit, sort })
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

    const mapped = mapRawInfo(raw, pseudoUrl)
    const entries = mapped.kind === 'playlist' ? (mapped.playlistEntries ?? []) : []
    return entries.map((entry) => ({ ...entry, platform: platformId }))
  }
}
