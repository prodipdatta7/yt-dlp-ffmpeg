import { createHash } from 'node:crypto'
import { createWriteStream, statSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdaterPhase } from '../../shared/models'
import { parseYtDlpVersion } from './versions'
import { runCapture } from './runner'
import type { Logger } from '../store/logger'

const YTDLP_OWNER = 'yt-dlp'
const YTDLP_REPO = 'yt-dlp'

/**
 * Direct-download URL for a release asset. Unlike `api.github.com`, the `releases/latest/download`
 * path is not subject to the unauthenticated REST-API rate limit (which returns HTTP 403), so we
 * resolve the release and all assets through `github.com` instead of the GitHub REST API.
 */
export function releaseDownloadUrl(owner: string, repo: string, asset: string): string {
  return `https://github.com/${owner}/${repo}/releases/latest/download/${asset}`
}

function releaseLatestUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}/releases/latest`
}

/** Resolve the latest release tag by following the `releases/latest` redirect (no REST API). */
export async function resolveLatestTag(
  owner: string,
  repo: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const res = await fetchFn(releaseLatestUrl(owner, repo), {
    redirect: 'manual',
    headers: { 'User-Agent': 'MediaForge-Updater' },
  })
  const location = res.headers?.get?.('location') ?? ''
  const extract = (value: string): string | null => {
    const m = /\/releases\/tag\/([^/?#]+)/.exec(value)
    return m ? decodeURIComponent(m[1]) : null
  }
  return extract(location) ?? extract(String(res.url ?? ''))
}

function versionSegments(version: string): number[] {
  return version.split('.').map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) ? n : 0
  })
}

export function compareVersions(a: string, b: string): number {
  const sa = versionSegments(a)
  const sb = versionSegments(b)
  const len = Math.max(sa.length, sb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (sa[i] ?? 0) - (sb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function isNewerVersion(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) > 0
}

export function extractExpectedChecksum(sumsText: string, fileName: string): string | null {
  for (const rawLine of sumsText.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/i.exec(rawLine.trim())
    if (match && match[2] === fileName) return match[1].toLowerCase()
  }
  return null
}

/**
 * One-shot hash for small in-memory payloads only. Release assets are hashed incrementally
 * by {@link downloadToFile} — never buffer one to hash it (P-03).
 */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface UpdaterCheckResult {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  error?: string
}

export interface UpdaterApplyResult {
  ok: boolean
  newVersion?: string
  rolledBack?: boolean
  error?: string
}

export interface UpdaterDeps {
  overrideDir: string
  getCurrentVersion: () => Promise<string | null>
  fetchFn?: typeof fetch
  logger?: Logger
  onPhase?: (phase: UpdaterPhase, detail?: string) => void
  /** Test seam: verify a freshly swapped binary; returns its version or null. */
  verifyInstalled?: (exePath: string) => Promise<string | null>
}

/** Ceiling for the small text sidecars `downloadBuffer` is for (`.sha256`, `SHA256SUMS`). */
export const MAX_SIDECAR_BYTES = 64 * 1024

/**
 * Reads a small sidecar fully into memory. Large assets must use {@link downloadToFile} —
 * this one is capped so it can never become the 150 MB buffer it used to be (P-03).
 */
export async function downloadBuffer(
  url: string,
  fetchFn: typeof fetch,
  maxBytes: number = MAX_SIDECAR_BYTES,
): Promise<Buffer> {
  const response = await fetchFn(url, {
    headers: { 'User-Agent': 'MediaForge-Updater', Accept: 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) {
    throw new Error(`download exceeded ${maxBytes} bytes — expected a small sidecar`)
  }
  return buffer
}

export interface DownloadToFileResult {
  bytes: number
  sha256: string
}

/**
 * Streams a release asset to `destPath`, hashing incrementally. Never holds the asset in
 * memory (P-03). Rejects — and removes the partial file — if the stream exceeds `maxBytes`
 * or if a declared Content-Length disagrees with the bytes actually received.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  fetchFn: typeof fetch,
  maxBytes: number,
): Promise<DownloadToFileResult> {
  const response = await fetchFn(url, {
    headers: { 'User-Agent': 'MediaForge-Updater', Accept: 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  if (!response.body) throw new Error('download failed: response had no body')

  const declared = Number(response.headers?.get?.('content-length') ?? '')
  const hash = createHash('sha256')
  let bytes = 0

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          bytes += chunk.length
          if (bytes > maxBytes) {
            throw new Error(`download exceeded ${maxBytes} bytes — rejected`)
          }
          hash.update(chunk)
          yield chunk
        }
      },
      // Bound the writable's own buffer so a fast producer cannot queue the asset in
      // memory ahead of the disk (P-03).
      createWriteStream(destPath, { highWaterMark: 1024 * 1024 }),
    )

    if (Number.isFinite(declared) && declared > 0 && declared !== bytes) {
      throw new Error(`download truncated: expected ${declared} bytes, received ${bytes}`)
    }
  } catch (error) {
    await fsp.rm(destPath, { force: true })
    throw error
  }

  return { bytes, sha256: hash.digest('hex') }
}

const NO_UPDATE = 'No update available — you are already up to date.'

/** Ceiling for the yt-dlp PyInstaller executable — currently ~17 MB. */
export const MAX_YTDLP_EXE_BYTES = 128 * 1024 * 1024

async function exists(path: string): Promise<boolean> {
  return fsp
    .stat(path)
    .then(() => true)
    .catch(() => false)
}

export class YtDlpUpdater {
  private cachedTag: string | null = null

  constructor(private readonly deps: UpdaterDeps) {}

  async check(): Promise<UpdaterCheckResult> {
    this.deps.onPhase?.('checking')
    try {
      const fetchFn = this.deps.fetchFn ?? fetch
      const tag = await resolveLatestTag(YTDLP_OWNER, YTDLP_REPO, fetchFn)
      if (!tag) {
        return {
          current: null,
          latest: null,
          updateAvailable: false,
          error: 'could not determine the latest yt-dlp release',
        }
      }
      this.cachedTag = tag

      const current = await this.deps.getCurrentVersion()
      const updateAvailable = current === null ? false : isNewerVersion(current, tag)
      return { current, latest: tag, updateAvailable }
    } catch (error) {
      return { current: null, latest: null, updateAvailable: false, error: String(error) }
    }
  }

  async apply(): Promise<UpdaterApplyResult> {
    try {
      if (!this.cachedTag) {
        const checkResult = await this.check()
        if (!this.cachedTag) {
          return { ok: false, error: checkResult.error ?? NO_UPDATE }
        }
      }
      const tag = this.cachedTag

      // Re-validate against the current binary so apply() can never claim success
      // without a genuinely newer release (and the UI can keep the button gated).
      const current = await this.deps.getCurrentVersion()
      if (current === null || !isNewerVersion(current, tag)) {
        return { ok: false, error: NO_UPDATE }
      }

      const fetchFn = this.deps.fetchFn ?? fetch
      const exeUrl = releaseDownloadUrl(YTDLP_OWNER, YTDLP_REPO, 'yt-dlp.exe')
      const sumsUrl = releaseDownloadUrl(YTDLP_OWNER, YTDLP_REPO, 'SHA2-256SUMS')

      await fsp.mkdir(this.deps.overrideDir, { recursive: true })
      const target = join(this.deps.overrideDir, 'yt-dlp.exe')
      const backup = join(this.deps.overrideDir, 'yt-dlp.exe.bak')
      // Streamed straight to the file it will be renamed from — the executable is never
      // held in main-process memory (P-03).
      const tmpFile = `${target}.${Date.now()}.tmp`

      this.deps.onPhase?.('downloading', tag)
      let downloaded: DownloadToFileResult
      try {
        const [asset, sumsBytes] = await Promise.all([
          downloadToFile(exeUrl, tmpFile, fetchFn, MAX_YTDLP_EXE_BYTES),
          downloadBuffer(sumsUrl, fetchFn),
        ])
        downloaded = asset

        this.deps.onPhase?.('verifying', tag)
        const expected = extractExpectedChecksum(sumsBytes.toString('utf8'), 'yt-dlp.exe')
        if (!expected) {
          await fsp.rm(tmpFile, { force: true })
          return { ok: false, error: 'checksum entry not found in SHA2-256SUMS' }
        }
        if (downloaded.sha256 !== expected) {
          await fsp.rm(tmpFile, { force: true })
          this.deps.logger?.warn('updater rejected download: checksum mismatch')
          return { ok: false, error: 'checksum mismatch — download rejected' }
        }
      } catch (downloadError) {
        await fsp.rm(tmpFile, { force: true })
        throw downloadError
      }

      this.deps.onPhase?.('swapping', tag)
      const hadPrevious = await exists(target)
      if (hadPrevious) await fsp.copyFile(target, backup)
      try {
        await fsp.rm(target, { force: true })
        await fsp.rename(tmpFile, target)
      } catch (swapError) {
        await fsp.rm(tmpFile, { force: true })
        throw swapError
      }

      this.deps.onPhase?.('verifying-install', tag)
      const installedVersion = await (this.deps.verifyInstalled ?? defaultVerify)(target)
      if (!installedVersion || compareVersions(installedVersion, tag) !== 0) {
        await fsp.rm(target, { force: true })
        if (hadPrevious && (await exists(backup))) await fsp.copyFile(backup, target)
        this.deps.logger?.warn('swapped binary failed verification — rolled back')
        return {
          ok: false,
          rolledBack: true,
          error: 'new binary failed to run — previous version restored',
        }
      }

      this.deps.logger?.info('yt-dlp updated successfully', { version: tag })
      return { ok: true, newVersion: tag }
    } catch (error) {
      this.deps.logger?.warn('updater apply failed', { error: String(error) })
      return { ok: false, error: String(error) }
    }
  }
}

async function defaultVerify(exePath: string): Promise<string | null> {
  try {
    const result = await runCapture(exePath, ['--version'], {
      capture: { stdout: 'tail', stderr: 'tail', tailLines: 20 },
      timeoutMs: 20000,
    })
    if (result.code !== 0) return null
    return parseYtDlpVersion(result.stdoutLines)
  } catch {
    return null
  }
}

export function overrideBinarySize(exePath: string): number | null {
  try {
    return statSync(exePath).size
  } catch {
    return null
  }
}
