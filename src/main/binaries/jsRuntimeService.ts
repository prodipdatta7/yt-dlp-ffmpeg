import type { JsRuntimeInfo } from '../../shared/ipcContract'
import type { Logger } from '../store/logger'
import {
  JS_RUNTIME_PREFERENCE,
  jsRuntimeArgs,
  jsRuntimeDescriptor,
  jsRuntimeVersionArgs,
  locateJsRuntime,
  meetsMinimumVersion,
  parseJsRuntimeVersion,
  type JsRuntimeDescriptor,
  type LocatedJsRuntime,
} from './jsRuntime'
import { locateBinary, type BinaryCandidate } from './locator'
import { runCapture } from './runner'

/** Reported when the bundle carries no runtime, which is the pre-AM-21 behaviour. */
export const NO_JS_RUNTIME: JsRuntimeInfo = {
  name: null,
  version: null,
  source: null,
  usable: false,
  minVersion: null,
}

export type JsRuntimeProbe = (runtime: LocatedJsRuntime) => Promise<string | null>

export interface JsRuntimeServiceOptions {
  platform: string
  candidates: readonly BinaryCandidate[]
  /** Injected in unit tests so no real process is spawned. */
  probe?: JsRuntimeProbe
  /** Injected in unit tests; mirrors `locateBinary`'s existence seam. */
  exists?: (path: string) => boolean
  logger?: Logger
}

async function defaultProbe(runtime: LocatedJsRuntime): Promise<string | null> {
  const result = await runCapture(runtime.path, jsRuntimeVersionArgs(runtime.name), {
    capture: { stdout: 'tail', stderr: 'tail', tailLines: 20 },
    timeoutMs: 15_000,
  })
  // QuickJS prints its banner on stdout; keep stderr in the haystack so a runtime that
  // reports on the other stream still yields a version.
  return parseJsRuntimeVersion(runtime.name, [...result.stdoutLines, ...result.stderrLines])
}

/**
 * True when yt-dlp will accept this runtime.
 *
 * A `null` descriptor minimum means "yt-dlp supports every version of this runtime" (all
 * QuickJS-NG releases), which is **not** a missing requirement — treating it as one is what made
 * a working runtime report as unusable.
 */
export function isRuntimeUsable(
  version: string | null,
  descriptor: JsRuntimeDescriptor,
): boolean {
  if (version === null) return false
  if (descriptor.minVersion === null) return true
  return meetsMinimumVersion(version, descriptor.minVersion)
}

/** Supported but below the optimization floor: a challenge solve can take minutes. */
export function isBelowOptimizedFloor(
  version: string | null,
  descriptor: JsRuntimeDescriptor,
): boolean {
  if (version === null || !descriptor.optimizedMinVersion) return false
  return !meetsMinimumVersion(version, descriptor.optimizedMinVersion)
}

/**
 * Owns the single decision of which JavaScript runtime yt-dlp should use, and the argv pair
 * that expresses it (AM-21).
 *
 * `args()` is deliberately synchronous and memoised: every yt-dlp spawn site (`jobs/argBuilders`
 * and `media/argBuilders`) is a pure function, and threading an `await` through all of them to
 * answer a question that only depends on which files exist would be churn for no benefit.
 */
export class JsRuntimeService {
  private cachedRuntime: LocatedJsRuntime | null | undefined
  private cachedArgs: readonly string[] | null = null
  private cachedInfo: Promise<JsRuntimeInfo> | null = null

  constructor(private readonly opts: JsRuntimeServiceOptions) {}

  private locate(): LocatedJsRuntime | null {
    if (this.cachedRuntime === undefined) {
      this.cachedRuntime = locateJsRuntime(this.opts.platform, this.opts.candidates, this.opts.exists)
    }
    return this.cachedRuntime
  }

  /** The `--js-runtimes RUNTIME[:PATH]` pair, or `[]` when no runtime is available. */
  args(): readonly string[] {
    if (this.cachedArgs === null) {
      const runtime = this.locate()
      const ytdlp = locateBinary(
        'yt-dlp',
        this.opts.platform,
        this.opts.candidates,
        this.opts.exists,
      )
      this.cachedArgs = jsRuntimeArgs(runtime, ytdlp?.path ?? null, this.opts.platform)
      if (runtime) {
        this.opts.logger?.info(`JavaScript runtime ready: ${runtime.name}`, {
          source: runtime.source,
        })
      } else {
        // Without this, YouTube extraction silently degrades to a format list that is missing
        // entries, and the only trace is a yt-dlp warning inside the per-job log.
        this.opts.logger?.warn(
          `no JavaScript runtime found; YouTube extraction will be degraded (expected one of: ${JS_RUNTIME_PREFERENCE.map((r) => r.name).join(', ')})`,
        )
      }
    }
    return this.cachedArgs
  }

  info(): Promise<JsRuntimeInfo> {
    if (!this.cachedInfo) this.cachedInfo = this.probeInfo()
    return this.cachedInfo
  }

  /** Called after an updater apply swaps a binary on disk (AM-03). */
  invalidate(): void {
    this.cachedRuntime = undefined
    this.cachedArgs = null
    this.cachedInfo = null
  }

  private async probeInfo(): Promise<JsRuntimeInfo> {
    const runtime = this.locate()
    if (!runtime) return NO_JS_RUNTIME

    const descriptor = jsRuntimeDescriptor(runtime.name)
    const probe = this.opts.probe ?? defaultProbe
    const version = await probe(runtime).catch(() => null)
    const usable = isRuntimeUsable(version, descriptor)

    if (!usable) {
      // Only reachable when the probe yielded nothing, or the version is genuinely below the
      // floor yt-dlp documents. A runtime that is merely unoptimized is handled below instead.
      this.opts.logger?.warn(
        version === null
          ? `JavaScript runtime ${runtime.name} did not report a version; treating it as unusable`
          : `JavaScript runtime ${runtime.name} ${version} is below the minimum yt-dlp supports (${descriptor.minVersion})`,
        { path: runtime.path },
      )
    } else if (isBelowOptimizedFloor(version, descriptor)) {
      // Supported, just slow — must NOT be surfaced as unusable.
      this.opts.logger?.warn(
        `JavaScript runtime ${runtime.name} ${version} is supported but below ${descriptor.optimizedMinVersion}; YouTube challenge solving will be slower than usual`,
        { path: runtime.path },
      )
    }

    return {
      name: runtime.name,
      version,
      source: runtime.source,
      usable,
      minVersion: descriptor.minVersion,
    }
  }
}
