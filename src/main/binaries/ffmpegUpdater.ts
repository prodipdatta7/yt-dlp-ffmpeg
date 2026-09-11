import { mkdtempSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpdaterPhase } from '../../shared/models'
import { runCapture, spawnProcess } from './runner'
import { parseFfmpegVersion } from './versions'
import { downloadBuffer, downloadToFile, releaseDownloadUrl, resolveLatestTag } from './updater'
import type { Logger } from '../store/logger'

const FFMPEG_OWNER = 'BtbN'
const FFMPEG_REPO = 'FFmpeg-Builds'
const FFMPEG_ZIP_NAME = 'ffmpeg-master-latest-win64-lgpl.zip'
const FFMPEG_SHA_NAME = 'ffmpeg-master-latest-win64-lgpl.zip.sha256'
const STATE_FILE = '.ffmpeg-update.json'

export interface FfmpegUpdaterDeps {
  overrideDir: string
  getCurrentVersion: () => Promise<string | null>
  fetchFn?: typeof fetch
  logger?: Logger
  onPhase?: (phase: UpdaterPhase, detail?: string) => void
  /** Test seam: extract an archive into a dest dir. Default = system `tar -xf`. */
  extract?: (archivePath: string, destDir: string) => Promise<void>
  /** Test seam: probe a binary and return its version, or null if it won't run. */
  verifyInstalled?: (exePath: string) => Promise<string | null>
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

const NO_UPDATE = 'No update available — you are already up to date.'
const MIN_ZIP_BYTES = 1_000_000
/** Ceiling for the BtbN LGPL build — currently ~100 MB. */
export const MAX_FFMPEG_ZIP_BYTES = 512 * 1024 * 1024

async function exists(path: string): Promise<boolean> {
  return fsp
    .stat(path)
    .then(() => true)
    .catch(() => false)
}

/** Atomic-ish swap: back up the current file, move `source` into place, restore on failure. */
async function swapIntoPlace(source: string, target: string): Promise<void> {
  const tmp = `${target}.${Date.now()}.tmp`
  await fsp.copyFile(source, tmp)
  try {
    await fsp.rm(target, { force: true })
    await fsp.rename(tmp, target)
  } catch (swapError) {
    await fsp.rm(tmp, { force: true })
    throw swapError
  }
}

/** Grab the first 64-hex token from a `.sha256` sidecar (tolerates filename suffixes). */
export function extractFirstSha256(text: string): string | null {
  const m = /([a-fA-F0-9]{64})/.exec(text)
  return m ? m[1].toLowerCase() : null
}

async function findFile(rootDir: string, fileName: string): Promise<string | null> {
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === fileName) return full
    }
  }
  return null
}

interface FfmpegState {
  checksum: string
  tag: string
  version: string
}

async function readState(dir: string): Promise<FfmpegState | null> {
  try {
    return JSON.parse(await fsp.readFile(join(dir, STATE_FILE), 'utf8')) as FfmpegState
  } catch {
    return null
  }
}

async function writeState(dir: string, state: FfmpegState): Promise<void> {
  await fsp.writeFile(join(dir, STATE_FILE), JSON.stringify(state))
}

async function defaultExtract(archivePath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true })
  const handle = spawnProcess('tar', ['-xf', archivePath, '-C', destDir], {
    capture: { stdout: 'none', stderr: 'tail', tailLines: 20 },
    timeoutMs: 120_000,
  })
  const res = await handle.result
  if (res.code !== 0) throw new Error(`failed to extract FFmpeg archive (exit ${res.code})`)
}

async function defaultVerify(exePath: string): Promise<string | null> {
  try {
    const result = await runCapture(exePath, ['-version'], {
      capture: { stdout: 'tail', stderr: 'tail', tailLines: 20 },
      timeoutMs: 20000,
    })
    if (result.code !== 0) return null
    return parseFfmpegVersion(result.stdoutLines)
  } catch {
    return null
  }
}

export class FfmpegUpdater {
  private cachedTag: string | null = null

  constructor(private readonly deps: FfmpegUpdaterDeps) {}

  async check(): Promise<UpdaterCheckResult> {
    this.deps.onPhase?.('checking')
    try {
      const fetchFn = this.deps.fetchFn ?? fetch
      const tag = await resolveLatestTag(FFMPEG_OWNER, FFMPEG_REPO, fetchFn).catch(() => null)
      this.cachedTag = tag
      const current = await this.deps.getCurrentVersion()

      // The BtbN rolling build has no comparable version tag, so we detect "newer" by
      // checking whether the shipped binary's checksum differs from the one we installed.
      let latestHash: string | null = null
      try {
        const shaUrl = releaseDownloadUrl(FFMPEG_OWNER, FFMPEG_REPO, FFMPEG_SHA_NAME)
        const shaBytes = await downloadBuffer(shaUrl, fetchFn)
        latestHash = extractFirstSha256(shaBytes.toString('utf8'))
      } catch {
        latestHash = null
      }
      if (latestHash === null) {
        return {
          current,
          latest: tag,
          updateAvailable: false,
          error: 'could not read the checksum for the latest FFmpeg build',
        }
      }

      const stored = await readState(this.deps.overrideDir)
      const updateAvailable = current !== null && stored?.checksum !== latestHash
      return { current, latest: tag, updateAvailable }
    } catch (error) {
      return { current: null, latest: null, updateAvailable: false, error: String(error) }
    }
  }

  async apply(): Promise<UpdaterApplyResult> {
    try {
      const checkResult = await this.check()
      if (!checkResult.updateAvailable) {
        return { ok: false, error: checkResult.error ?? NO_UPDATE }
      }
      const fetchFn = this.deps.fetchFn ?? fetch
      const tag = this.cachedTag
      const zipUrl = releaseDownloadUrl(FFMPEG_OWNER, FFMPEG_REPO, FFMPEG_ZIP_NAME)
      const shaUrl = releaseDownloadUrl(FFMPEG_OWNER, FFMPEG_REPO, FFMPEG_SHA_NAME)

      // The zip streams straight into the work dir and is hashed on the way past, so it is
      // never held in memory and the ~100 MB hash never blocks the event loop (P-03).
      const work = mkdtempSync(join(tmpdir(), 'mf-ffmpeg-update-'))
      try {
        const zipPath = join(work, 'ffmpeg.zip')

        this.deps.onPhase?.('downloading', tag ?? undefined)
        const [zip, shaBytes] = await Promise.all([
          downloadToFile(zipUrl, zipPath, fetchFn, MAX_FFMPEG_ZIP_BYTES),
          downloadBuffer(shaUrl, fetchFn),
        ])
        if (zip.bytes < MIN_ZIP_BYTES) {
          return { ok: false, error: 'downloaded FFmpeg archive looks truncated' }
        }

        this.deps.onPhase?.('verifying', tag ?? undefined)
        const expected = extractFirstSha256(shaBytes.toString('utf8'))
        if (!expected) return { ok: false, error: 'checksum entry not found in .sha256' }
        if (zip.sha256 !== expected) {
          this.deps.logger?.warn('ffmpeg updater rejected download: checksum mismatch')
          return { ok: false, error: 'checksum mismatch — download rejected' }
        }

        this.deps.onPhase?.('swapping', tag ?? undefined)
        await (this.deps.extract ?? defaultExtract)(zipPath, work)

        const exe = await findFile(work, 'ffmpeg.exe')
        if (!exe) return { ok: false, error: 'ffmpeg.exe not found inside archive' }
        const ffprobe = await findFile(work, 'ffprobe.exe')

        this.deps.onPhase?.('verifying-install', tag ?? undefined)
        const extractedVersion = await (this.deps.verifyInstalled ?? defaultVerify)(exe)
        if (!extractedVersion) {
          return { ok: false, error: 'new FFmpeg build failed to run — previous version kept' }
        }

        await fsp.mkdir(this.deps.overrideDir, { recursive: true })
        const target = join(this.deps.overrideDir, 'ffmpeg.exe')
        const backup = join(this.deps.overrideDir, 'ffmpeg.exe.bak')
        const hadPrevious = await exists(target)
        if (hadPrevious) await fsp.copyFile(target, backup)
        await swapIntoPlace(exe, target)

        if (ffprobe) {
          const probeTarget = join(this.deps.overrideDir, 'ffprobe.exe')
          if (await exists(probeTarget)) await fsp.copyFile(probeTarget, `${probeTarget}.bak`)
          await swapIntoPlace(ffprobe, probeTarget)
        }

        const finalVersion = await (this.deps.verifyInstalled ?? defaultVerify)(target)
        if (!finalVersion) {
          await fsp.rm(target, { force: true })
          if (hadPrevious && (await exists(backup))) await fsp.copyFile(backup, target)
          this.deps.logger?.warn('swapped ffmpeg failed verification — rolled back')
          return {
            ok: false,
            rolledBack: true,
            error: 'new FFmpeg failed to run — previous version restored',
          }
        }

        await writeState(this.deps.overrideDir, {
          checksum: expected,
          tag: tag ?? 'unknown',
          version: finalVersion,
        })
        this.deps.logger?.info('ffmpeg updated successfully', { version: finalVersion })
        return { ok: true, newVersion: finalVersion }
      } finally {
        await fsp.rm(work, { recursive: true, force: true })
      }
    } catch (error) {
      this.deps.logger?.warn('ffmpeg updater apply failed', { error: String(error) })
      return { ok: false, error: String(error) }
    }
  }
}
