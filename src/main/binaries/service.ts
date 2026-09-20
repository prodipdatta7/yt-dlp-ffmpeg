import type { BinariesInfoResult, JsRuntimeInfo } from '../../shared/ipcContract'
import { NO_JS_RUNTIME } from './jsRuntimeService'
import type { BinaryCandidate, LocatedBinary } from './locator'
import { locateBinary } from './locator'
import { VersionProber } from './versions'
import type { Logger } from '../store/logger'

export interface BinariesServiceOptions {
  platform: string
  arch?: string
  candidates: readonly BinaryCandidate[]
  prober?: VersionProber
  logger?: Logger
  /** Reports which JavaScript runtime yt-dlp will use (AM-21); defaults to "none". */
  jsRuntime?: () => Promise<JsRuntimeInfo>
}

export class BinariesService {
  private readonly prober: VersionProber
  private cached: Promise<BinariesInfoResult> | null = null

  constructor(private readonly opts: BinariesServiceOptions) {
    this.prober = opts.prober ?? new VersionProber()
  }

  async locate(kind: 'yt-dlp' | 'ffmpeg'): Promise<LocatedBinary | null> {
    return locateBinary(kind, this.opts.platform, this.opts.candidates)
  }

  getInfo(): Promise<BinariesInfoResult> {
    if (!this.cached) this.cached = this.probeAll()
    return this.cached
  }

  invalidate(): void {
    this.cached = null
  }

  private async probeAll(): Promise<BinariesInfoResult> {
    const kinds = ['yt-dlp', 'ffmpeg'] as const
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const found = await this.locate(kind)
        const version = found ? await this.prober.probe(kind, found.path) : null
        if (this.opts.logger) {
          if (found && version) {
            this.opts.logger.info(`binary ready: ${kind} ${version}`, { source: found.source })
          } else if (found) {
            this.opts.logger.warn(`binary located but version probe failed: ${kind}`, { path: found.path })
          } else {
            this.opts.logger.warn(`binary missing: ${kind}`)
          }
        }
        return [kind, { version, source: found?.source ?? null }] as const
      })
    )
    const byKind = Object.fromEntries(entries)
    const jsRuntime = this.opts.jsRuntime ? await this.opts.jsRuntime() : NO_JS_RUNTIME
    return { ytdlp: byKind['yt-dlp'], ffmpeg: byKind.ffmpeg, jsRuntime }
  }
}
