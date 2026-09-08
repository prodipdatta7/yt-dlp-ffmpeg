import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdaterPhase } from '../../shared/models'
import { parseYtDlpVersion } from './versions'
import { runCapture } from './runner'
import { restoreBackup, swapBinary } from './swap'
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

export async function downloadBuffer(url: string, fetchFn: typeof fetch): Promise<Buffer> {
  const response = await fetchFn(url, {
    headers: { 'User-Agent': 'MediaForge-Updater', Accept: 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const NO_UPDATE = 'No update available — you are already up to date.'

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

      this.deps.onPhase?.('downloading', tag)
      const [exeBytes, sumsBytes] = await Promise.all([
        downloadBuffer(exeUrl, fetchFn),
        downloadBuffer(sumsUrl, fetchFn),
      ])

      this.deps.onPhase?.('verifying', tag)
      const expected = extractExpectedChecksum(sumsBytes.toString('utf8'), 'yt-dlp.exe')
      if (!expected) return { ok: false, error: 'checksum entry not found in SHA2-256SUMS' }
      if (sha256Hex(exeBytes) !== expected) {
        this.deps.logger?.warn('updater rejected download: checksum mismatch')
        return { ok: false, error: 'checksum mismatch — download rejected' }
      }

      this.deps.onPhase?.('swapping', tag)
      mkdirSync(this.deps.overrideDir, { recursive: true })
      const target = join(this.deps.overrideDir, 'yt-dlp.exe')
      const { backupPath } = swapBinary(target, exeBytes)

      this.deps.onPhase?.('verifying-install', tag)
      const installedVersion = await (this.deps.verifyInstalled ?? defaultVerify)(target)
      if (!installedVersion || compareVersions(installedVersion, tag) !== 0) {
        rmSync(target, { force: true })
        restoreBackup(target, backupPath)
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
    const result = await runCapture(exePath, ['--version'], { timeoutMs: 20000 })
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
