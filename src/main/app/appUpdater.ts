import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  downloadBuffer,
  extractExpectedChecksum,
  isNewerVersion,
  releaseDownloadUrl,
  resolveLatestTag,
  sha256Hex,
} from '../binaries/updater'
import type { Logger } from '../store/logger'
import type { AppUpdatePhase } from '../../shared/models'

const APP_OWNER = 'prodipdatta7'
const APP_REPO = 'yt-dlp-ffmpeg'
const PRODUCT_NAME = 'MediaForge Desktop'

/** The GitHub releases page users land on to download the newest installer. */
export function appReleasesUrl(): string {
  return `https://github.com/${APP_OWNER}/${APP_REPO}/releases/latest`
}

export interface AppUpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  error?: string
}

/**
 * Like the core-driver updaters (§7.6), this resolves the latest release tag via the
 * `releases/latest` redirect rather than the rate-limited REST API. This only reports
 * availability — see `downloadAndInstallAppUpdate` for the fetch-and-launch flow.
 */
export async function checkAppUpdate(
  currentVersion: string,
  fetchFn: typeof fetch = fetch,
): Promise<AppUpdateCheckResult> {
  try {
    const tag = await resolveLatestTag(APP_OWNER, APP_REPO, fetchFn)
    if (!tag) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        error: 'could not determine the latest release',
      }
    }
    const latestVersion = tag.replace(/^v/, '')
    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(currentVersion, latestVersion),
    }
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      error: String(error),
    }
  }
}

export interface AppUpdateInstallResult {
  ok: boolean
  error?: string
}

/** Matches `nsis.artifactName` in `electron-builder.yml` — the exact asset name each release publishes. */
export function installerAssetName(version: string): string {
  return `${PRODUCT_NAME}-Setup-${version}.exe`
}

const NO_UPDATE = 'No update available — you are already up to date.'

export interface AppInstallDeps {
  currentVersion: string
  /** Directory the downloaded installer is written into, e.g. `<userData>/updates`. */
  updatesDir: string
  fetchFn?: typeof fetch
  logger?: Logger
  onPhase?: (phase: AppUpdatePhase) => void
  /** Test seam: replaces the real detached spawn of the downloaded installer. */
  launchInstaller?: (installerPath: string) => void
}

function defaultLaunchInstaller(installerPath: string): void {
  spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
  }).unref()
}

/**
 * Downloads the current release's NSIS installer, checksum-verifies it against the `SHA256SUMS`
 * sidecar `release.yml` publishes alongside it (same shape as the yt-dlp SHA2-256SUMS check in
 * §7.6 — reuses `extractExpectedChecksum`/`sha256Hex`), writes it to `updatesDir`, then launches
 * it detached. The app never swaps its own installed files (AM-03's rationale for core drivers
 * applies even harder to `Program Files`) — the installer wizard does that itself, which is why
 * the caller should quit the app right after this resolves `ok: true` so the installer isn't
 * fighting file locks held by the running instance.
 */
export async function downloadAndInstallAppUpdate(
  deps: AppInstallDeps,
): Promise<AppUpdateInstallResult> {
  try {
    deps.onPhase?.('checking')
    const fetchFn = deps.fetchFn ?? fetch
    const tag = await resolveLatestTag(APP_OWNER, APP_REPO, fetchFn)
    if (!tag) return { ok: false, error: 'could not determine the latest release' }
    const latestVersion = tag.replace(/^v/, '')
    if (!isNewerVersion(deps.currentVersion, latestVersion)) {
      return { ok: false, error: NO_UPDATE }
    }

    const fileName = installerAssetName(latestVersion)
    const exeUrl = releaseDownloadUrl(APP_OWNER, APP_REPO, encodeURIComponent(fileName))
    const sumsUrl = releaseDownloadUrl(APP_OWNER, APP_REPO, 'SHA256SUMS')

    deps.onPhase?.('downloading')
    const [exeBytes, sumsBytes] = await Promise.all([
      downloadBuffer(exeUrl, fetchFn),
      downloadBuffer(sumsUrl, fetchFn),
    ])

    deps.onPhase?.('verifying')
    const expected = extractExpectedChecksum(sumsBytes.toString('utf8'), fileName)
    if (!expected) return { ok: false, error: 'checksum entry not found in SHA256SUMS' }
    if (sha256Hex(exeBytes) !== expected) {
      deps.logger?.warn('app update rejected: checksum mismatch')
      return { ok: false, error: 'checksum mismatch — download rejected' }
    }

    deps.onPhase?.('launching-installer')
    mkdirSync(deps.updatesDir, { recursive: true })
    const installerPath = join(deps.updatesDir, fileName)
    writeFileSync(installerPath, exeBytes)
    ;(deps.launchInstaller ?? defaultLaunchInstaller)(installerPath)

    deps.logger?.info('app installer launched', { version: latestVersion })
    return { ok: true }
  } catch (error) {
    deps.logger?.warn('app update failed', { error: String(error) })
    return { ok: false, error: String(error) }
  }
}
