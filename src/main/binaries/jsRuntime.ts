import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { BinarySource } from '../../shared/ipcContract'
import type { BinaryCandidate } from './locator'

/**
 * yt-dlp solves YouTube's JavaScript challenges through an external runtime (yt-dlp wiki/EJS).
 * The official `yt-dlp.exe` already bundles the `yt-dlp-ejs` solver scripts, so the runtime
 * executable is the only piece MediaForge was not shipping — which is why every YouTube call
 * emitted "No supported JavaScript runtime could be found" (plan v2, V-10) and why some
 * formats could not be resolved.
 *
 * Preference order follows yt-dlp's own (`deno, node, quickjs, bun`), narrowed to the runtimes
 * MediaForge ships or accepts as an AM-03 override. Deno solves fastest; QuickJS-NG is ~2 MB
 * against Deno's ~42 MB, which is why QuickJS is the bundled default and Deno is opt-in.
 */
export type JsRuntimeName = 'deno' | 'quickjs'

export interface JsRuntimeDescriptor {
  name: JsRuntimeName
  /** Canonical file base name yt-dlp looks for when the runtime is not given a path. */
  canonicalFileName: string
  /** Accepted alternate base names, e.g. a user-supplied `quickjs.exe` override. */
  alternateFileNames: readonly string[]
  /**
   * Lowest version yt-dlp accepts **at all**, or `null` when yt-dlp accepts every version of this
   * runtime. Source: the "Install a supported JavaScript Runtime" table in yt-dlp's EJS wiki.
   *
   * This is deliberately distinct from `optimizedMinVersion`. Conflating the two made MediaForge
   * report a perfectly good QuickJS-NG as "below the minimum yt-dlp supports", which is untrue:
   * the wiki states "All versions of QuickJS-NG are supported".
   */
  minVersion: string | null
  /**
   * Lowest version carrying the optimizations that keep a challenge solve from taking seconds
   * rather than minutes. **Advisory only** — below this floor the runtime still works, so it must
   * never be reported as unusable.
   */
  optimizedMinVersion?: string
  /**
   * True when yt-dlp enables this runtime without being asked (`--js-runtimes` defaults to
   * `['deno']`). Only affects how the diagnostic is phrased, not whether we pass the flag: we
   * always pass it so a bundled runtime is used even when the host has none on PATH.
   */
  enabledByDefault: boolean
}

/**
 * Minimums are taken from the EJS wiki's runtime table, not guessed: deno `2.0.0`, and
 * "All versions of QuickJS-NG are supported". QuickJS-NG below `0.12.0` (and QuickJS below
 * `2025-04-26`) is supported but slow, which is what `optimizedMinVersion` records.
 */
export const JS_RUNTIME_PREFERENCE: readonly JsRuntimeDescriptor[] = [
  {
    name: 'deno',
    canonicalFileName: 'deno',
    alternateFileNames: [],
    minVersion: '2.0.0',
    enabledByDefault: true,
  },
  {
    name: 'quickjs',
    canonicalFileName: 'qjs',
    alternateFileNames: ['quickjs'],
    // Every QuickJS-NG release is supported; only the *speed* of a solve depends on the version.
    minVersion: null,
    optimizedMinVersion: '0.12.0',
    enabledByDefault: false,
  },
]

export interface LocatedJsRuntime {
  name: JsRuntimeName
  path: string
  source: BinarySource
}

export function jsRuntimeDescriptor(name: JsRuntimeName): JsRuntimeDescriptor {
  const found = JS_RUNTIME_PREFERENCE.find((runtime) => runtime.name === name)
  if (!found) throw new Error(`Unknown JS runtime: ${name}`)
  return found
}

function withPlatformExtension(baseName: string, platform: string): string {
  return platform === 'win32' ? `${baseName}.exe` : baseName
}

/** Every file name a user-supplied override may legitimately use for this runtime. */
export function jsRuntimeFileNames(
  descriptor: JsRuntimeDescriptor,
  platform: string,
): readonly string[] {
  return [descriptor.canonicalFileName, ...descriptor.alternateFileNames].map((baseName) =>
    withPlatformExtension(baseName, platform),
  )
}

/**
 * Resolves the JS runtime to use.
 *
 * Runtime preference dominates directory preference, so a Deno override wins over the bundled
 * QuickJS build (the whole point of shipping a small default). Within one runtime the usual
 * AM-03 order still holds: env override -> userData -> bundled.
 */
export function locateJsRuntime(
  platform: string,
  candidates: readonly BinaryCandidate[],
  exists: (path: string) => boolean = existsSync,
): LocatedJsRuntime | null {
  for (const descriptor of JS_RUNTIME_PREFERENCE) {
    for (const candidate of candidates) {
      for (const fileName of jsRuntimeFileNames(descriptor, platform)) {
        const path = join(candidate.dir, fileName)
        if (exists(path)) return { name: descriptor.name, path, source: candidate.source }
      }
    }
  }
  return null
}

/**
 * Builds the `--js-runtimes` argv pair, or `[]` when no runtime is available.
 *
 * yt-dlp discovers a runtime that sits either on `PATH` or in the same folder as `yt-dlp.exe`.
 * When the runtime is already beside the binary we emit the bare form (`--js-runtimes qjs`),
 * which keeps a Windows path out of the `RUNTIME[:PATH]` grammar entirely. The explicit
 * `name:path` form is used only when the two live in different directories (for example a
 * Deno override while the bundled runtime stays next to the bundled yt-dlp).
 */
export function jsRuntimeArgs(
  runtime: LocatedJsRuntime | null,
  ytdlpPath: string | null,
  platform: string,
): string[] {
  if (!runtime) return []

  const descriptor = jsRuntimeDescriptor(runtime.name)
  const canonical = withPlatformExtension(descriptor.canonicalFileName, platform)
  const sameDir = ytdlpPath !== null && dirname(runtime.path) === dirname(ytdlpPath)
  // The bare form only works when yt-dlp can find the file by its canonical name beside itself;
  // an alternate name (e.g. a user's `quickjs.exe`) must therefore carry an explicit path.
  const bareFormIsDiscoverable =
    sameDir && basename(runtime.path).toLowerCase() === canonical.toLowerCase()

  return ['--js-runtimes', bareFormIsDiscoverable ? runtime.name : `${runtime.name}:${runtime.path}`]
}

/**
 * A line that is nothing but a version, e.g. `0.17.0`.
 *
 * This is the shape QuickJS-NG actually emits (see `parseQuickJsVersion`), and it is
 * unambiguous enough to be a safe last-resort parse for any runtime.
 */
function bareVersionLine(stdoutLines: readonly string[]): string | null {
  for (const line of stdoutLines) {
    const trimmed = line.trim()
    if (/^\d+\.\d+\.\d+(?:[-+]\S+)?$/.test(trimmed)) return trimmed
  }
  return null
}

/** `deno 2.9.7 (stable, release, x86_64-pc-windows-msvc)` -> `2.9.7` */
export function parseDenoVersion(stdoutLines: readonly string[]): string | null {
  for (const line of stdoutLines) {
    const m = /^deno\s+(\d+\.\d+\.\d+\S*)/i.exec(line.trim())
    if (m) return m[1]
  }
  return bareVersionLine(stdoutLines)
}

/**
 * QuickJS-NG's `qjs --version` prints the bare version and **nothing else**.
 *
 * Verified against the binary MediaForge bundles: stdout is a single line, `0.17.0`, with no
 * product name and no prefix. Forks and other builds print a banner instead
 * (`QuickJS-ng version 0.17.0`, `qjs 0.12.1`), so both shapes are accepted.
 *
 * Regression note (this function had exactly one bug, and it was invisible in tests): the first
 * version only accepted the banner form, because the unit tests asserted invented banner strings
 * rather than the real tool's output. A real `qjs.exe` therefore parsed to `null`, which the
 * caller reported as "version unknown — below the minimum yt-dlp supports" and as an unhealthy
 * JS runtime in Settings → Diagnostics, while yt-dlp itself was using the runtime perfectly.
 * `parseQuickJsVersion(['0.17.0'])` is the test that would have caught it.
 */
export function parseQuickJsVersion(stdoutLines: readonly string[]): string | null {
  for (const line of stdoutLines) {
    const trimmed = line.trim()
    if (!/quickjs|^qjs\b/i.test(trimmed)) continue
    const m = /(\d+\.\d+\.\d+(?:[-+]\S+)?)/.exec(trimmed)
    if (m) return m[1]
  }
  return bareVersionLine(stdoutLines)
}

export function parseJsRuntimeVersion(
  name: JsRuntimeName,
  stdoutLines: readonly string[],
): string | null {
  return name === 'deno' ? parseDenoVersion(stdoutLines) : parseQuickJsVersion(stdoutLines)
}

/**
 * Both supported runtimes report their version with `--version` on stdout. Kept as a function so
 * a future runtime needing a different probe flag does not force a change at every call site.
 */
export function jsRuntimeVersionArgs(_name: JsRuntimeName): string[] {
  return ['--version']
}

/** True when the probed version is at or above the minimum yt-dlp supports. */
export function meetsMinimumVersion(version: string | null, minVersion: string): boolean {
  if (!version) return false
  const parse = (value: string): number[] =>
    value
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))
  const actual = parse(version)
  const required = parse(minVersion)
  const length = Math.max(actual.length, required.length)
  for (let i = 0; i < length; i += 1) {
    const left = actual[i] ?? 0
    const right = required[i] ?? 0
    if (left !== right) return left > right
  }
  return true
}
