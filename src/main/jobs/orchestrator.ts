import { createHash, randomUUID } from 'node:crypto'
import * as fsp from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  JobConfig,
  JobDonePayload,
  JobEvent,
  JobPhase,
  MfErrorCode,
} from '../../shared/models'
import { ERROR_MESSAGES } from '../../shared/models'
import type { LocatedBinary } from '../binaries/locator'
import { spawnProcess, type RunResult, type SpawnHandle } from '../binaries/runner'
import { freeDiskSpaceBytes, isDiskSpaceInsufficient } from '../fsops/diskSpace'
import { findExistingDownload, recordDownload } from '../fsops/downloadManifest'
import { collisionFreeTarget, sanitizeFileName } from '../fsops/sanitizer'
import { classifyStderr } from '../media/classifyStderr'
import type { Logger } from '../store/logger'
import { buildDownloadArgs, outputTemplateFor } from './argBuilders'
import { JobEventCoalescer } from './eventCoalescer'
import {
  computeSegmentPercent,
  isFinalPathLine,
  isPostprocessorLine,
  parseDownloadLine,
  parsePostprocessLine,
} from './progressParser'

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [5000, 15000, 30000]

/** Cadence of the `finalizing` heartbeat emitted while a cross-volume copy is in flight. */
export const FINALIZE_HEARTBEAT_MS = 500

/**
 * The filesystem surface used by finalization, injectable so tests can drive the EXDEV,
 * permission-denied and zero-byte-destination branches without a second volume.
 */
export interface FinalizeFs {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>
  rename(source: string, target: string): Promise<void>
  copyFile(source: string, target: string): Promise<void>
  stat(path: string): Promise<{ size: number }>
  unlink(path: string): Promise<void>
  rm(path: string, options: { recursive: true; force: true }): Promise<void>
}

const NODE_FS: FinalizeFs = {
  mkdir: (path, options) => fsp.mkdir(path, options),
  rename: (source, target) => fsp.rename(source, target),
  copyFile: (source, target) => fsp.copyFile(source, target),
  stat: (path) => fsp.stat(path),
  unlink: (path) => fsp.unlink(path),
  rm: (path, options) => fsp.rm(path, options),
}

export interface OrchestratorDeps {
  resolveYtDlp(): Promise<LocatedBinary | null>
  resolveFfmpeg(): Promise<LocatedBinary | null>
  tempRoot: string
  logger?: Logger
  /** Test seam: argv elements prepended before the built download args. */
  spawnArgPrefix?: readonly string[]
  /** Retry ladder for MF_NETWORK failures; empty array disables retries. */
  retryDelaysMs?: readonly number[]
  /** cookies.txt path appended as --cookies when present. */
  getCookiesPath?: () => string | null
  /** Raw CLI line tap (stdout/stderr of yt-dlp) for the live console. */
  onProcessLine?: (line: string, stream: 'out' | 'err') => void
  /**
   * Max concurrent downloads (D2a). Defaults to 1. Settings clamps 2–5 for
   * playlist parallel mode; sequential UI still launches one at a time.
   */
  getMaxConcurrent?: () => number
  /** Test seam: override free-disk probe. */
  getFreeDiskBytes?: (destDir: string) => Promise<number | null>
  /** Test seam: flush cadence for coalesced progress events. */
  coalesceIntervalMs?: number
  /** Test seam: filesystem used by finalization. Defaults to node:fs/promises. */
  fs?: Partial<FinalizeFs>
  /** Test seam: `finalizing` heartbeat cadence during a cross-volume copy. */
  finalizeHeartbeatMs?: number
}

export type SendEvent = (event: JobEvent) => void
export type SendDone = (done: JobDonePayload) => void

interface ActiveJob {
  id: string
  config: JobConfig
  handle: SpawnHandle | null
  cancelRequested: boolean
  tempDir: string
  destDir: string
}

export class MfLaunchError extends Error {
  constructor(
    public readonly code: MfErrorCode | null,
    message: string,
  ) {
    super(message)
    this.name = 'MfLaunchError'
  }
}

async function findLargestCompletedFile(dir: string): Promise<string | null> {
  let best: string | null = null
  let bestSize = -1
  for (const name of await fsp.readdir(dir)) {
    if (name.endsWith('.part') || name.endsWith('.ytdl')) continue
    const full = join(dir, name)
    const stat = await fsp.stat(full)
    if (!stat.isFile()) continue
    if (stat.size > bestSize) {
      best = full
      bestSize = stat.size
    }
  }
  return best !== null && bestSize > 0 ? best : null
}

async function findLargestPartFile(dir: string): Promise<string | null> {
  let best: string | null = null
  let bestSize = -1
  for (const name of await fsp.readdir(dir)) {
    if (!name.endsWith('.part')) continue
    const full = join(dir, name)
    try {
      const size = (await fsp.stat(full)).size
      if (size > bestSize) {
        best = full
        bestSize = size
      }
    } catch {
      return null
    }
  }
  return best !== null && bestSize > 0 ? best : null
}

function tempDirForUrl(tempRoot: string, url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16)
  return join(tempRoot, `job-${hash}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DownloadOrchestrator {
  private readonly activeJobs = new Map<string, ActiveJob>()
  /** P-04: rate-limits routine progress events on their way across IPC. */
  private readonly events: JobEventCoalescer

  private readonly fs: FinalizeFs

  constructor(private readonly deps: OrchestratorDeps) {
    this.events = new JobEventCoalescer(deps.coalesceIntervalMs)
    this.fs = { ...NODE_FS, ...deps.fs }
  }

  isBusy(): boolean {
    return this.activeJobs.size > 0
  }

  activeCount(): number {
    return this.activeJobs.size
  }

  private maxConcurrent(): number {
    const n = this.deps.getMaxConcurrent?.() ?? 1
    return Number.isFinite(n) && n >= 1 ? Math.min(5, Math.floor(n)) : 1
  }

  /** Bytes already reserved by in-flight jobs (sum of positive estimates). */
  private reservedEstimateBytes(): number {
    let sum = 0
    for (const job of this.activeJobs.values()) {
      const est = job.config.estimatedBytes
      if (typeof est === 'number' && est > 0) sum += est
    }
    return sum
  }

  cancel(jobId?: string): boolean {
    if (jobId) {
      const job = this.activeJobs.get(jobId)
      if (!job) return false
      job.cancelRequested = true
      this.deps.logger?.info('download cancel requested', { jobId: job.id })
      void job.handle?.killTree()
      return true
    }
    if (this.activeJobs.size === 0) return false
    for (const job of this.activeJobs.values()) {
      job.cancelRequested = true
      this.deps.logger?.info('download cancel requested', { jobId: job.id })
      void job.handle?.killTree()
    }
    return true
  }

  async launch(config: JobConfig, sendEvent: SendEvent, sendDone: SendDone): Promise<string> {
    if (this.activeJobs.size >= this.maxConcurrent()) {
      throw new MfLaunchError(null, 'Download concurrency limit reached.')
    }

    const ytDlp = await this.deps.resolveYtDlp()
    const ffmpeg = await this.deps.resolveFfmpeg()
    if (!ytDlp || !ffmpeg) {
      throw new MfLaunchError(null, 'Media engines are not installed.')
    }

    const effectiveDestDir = config.playlistTitle
      ? join(config.destDir, sanitizeFileName(config.playlistTitle))
      : config.destDir

    if (!config.isLive) {
      const existingPath = findExistingDownload(effectiveDestDir, config)
      if (existingPath) {
        const jobId = randomUUID()
        this.deps.logger?.info('download skipped — already exists at this quality', {
          jobId,
          url: config.url,
        })
        // Deferred so the MF_JOB_DONE event reaches the renderer only after it has
        // received this jobId back from the downloadStart IPC call that's still in flight.
        setTimeout(() => {
          sendDone({ jobId, status: 'completed', outputPath: existingPath, skipped: true })
        }, 0)
        return jobId
      }
    }

    const freeBytes = this.deps.getFreeDiskBytes
      ? await this.deps.getFreeDiskBytes(effectiveDestDir)
      : await freeDiskSpaceBytes(effectiveDestDir)
    const batchEstimate =
      (typeof config.estimatedBytes === 'number' && config.estimatedBytes > 0
        ? config.estimatedBytes
        : 0) + this.reservedEstimateBytes()
    if (isDiskSpaceInsufficient(freeBytes, batchEstimate > 0 ? batchEstimate : undefined)) {
      this.deps.logger?.warn('preflight disk-space abort', {
        freeBytes,
        estimatedBytes: config.estimatedBytes,
        reservedBytes: this.reservedEstimateBytes(),
        batchEstimate,
      })
      throw new MfLaunchError('MF_DISK_FULL', ERROR_MESSAGES.MF_DISK_FULL)
    }

    const jobId = randomUUID()
    const tempDir = tempDirForUrl(this.deps.tempRoot, config.url)
    await fsp.mkdir(tempDir, { recursive: true })

    const job: ActiveJob = {
      id: jobId,
      config,
      handle: null,
      cancelRequested: false,
      tempDir,
      destDir: effectiveDestDir,
    }
    this.activeJobs.set(jobId, job)
    this.deps.logger?.info('job launched', {
      jobId,
      mode: config.mode,
      tier: config.tier,
      active: this.activeJobs.size,
    })
    this.events.emit(
      { jobId, phase: 'queued', percent: null, speedBps: null, etaSec: null },
      sendEvent,
    )

    void this.run(job, ytDlp.path, ffmpeg.path, sendEvent, sendDone)
    return jobId
  }

  private async run(
    job: ActiveJob,
    ytdlpPath: string,
    ffmpegPath: string,
    sendEvent: SendEvent,
    sendDone: SendDone,
  ): Promise<void> {
    const { id: jobId } = job
    let lastPercent: number | null = null
    let segmentsStarted = 0
    let segmentsFinished = 0

    const emit = (
      next: JobPhase,
      percent: number | null,
      speedBps: number | null,
      etaSec: number | null,
      downloadedBytes: number | null = null,
      totalBytes: number | null = null,
    ): void => {
      if (percent !== null) lastPercent = percent
      this.events.emit(
        { jobId, phase: next, percent, speedBps, etaSec, downloadedBytes, totalBytes },
        sendEvent,
      )
    }

    try {
      const delays = this.deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
      const cookiesPath = this.deps.getCookiesPath?.() ?? null
      // P-01: the `--print after_move:filepath` payload is the only stdout line we need to
      // outlive the process, so keep one string instead of retaining every decoded line.
      let finalPathFromPrint: string | null = null

      let attempt = 0
      let result: RunResult | null = null
      for (;;) {
        attempt += 1

        if (job.cancelRequested) break

        const args = [
          ...(this.deps.spawnArgPrefix ?? []),
          ...buildDownloadArgs(job.config, ffmpegPath, outputTemplateFor(job.tempDir), cookiesPath),
        ]

        this.deps.onProcessLine?.(`$ yt-dlp ${args.join(' ')}`, 'out')

        const handle = spawnProcess(ytdlpPath, args, {
          // stdout is parsed live; nothing needs retaining past the callback (P-01).
          capture: { stdout: 'none', stderr: 'tail', tailLines: 100 },
          onStdoutLine: (line) => {
            this.deps.onProcessLine?.(line, 'out')

            if (isFinalPathLine(line)) finalPathFromPrint = line.trim()

            const post = parsePostprocessLine(line)
            if (post !== null) {
              emit('merging', Math.min(100, post), null, null)
              return
            }
            if (isPostprocessorLine(line)) {
              emit('merging', lastPercent, null, null)
              return
            }

            const progress = parseDownloadLine(line)
            if (progress) {
              if (progress.status === 'downloading' && segmentsStarted === segmentsFinished) {
                segmentsStarted += 1
              }
              if (progress.status === 'finished') {
                segmentsFinished = Math.min(segmentsStarted, segmentsFinished + 1)
              }
              const nextPhase: JobPhase =
                segmentsStarted >= 2 || job.config.mode === 'audio-only'
                  ? 'downloading-audio'
                  : 'downloading-video'
              emit(
                nextPhase,
                computeSegmentPercent(progress),
                progress.speedBps,
                progress.etaSec,
                progress.downloadedBytes,
                progress.totalBytes,
              )
            }
          },
          onStderrLine: (line) => {
            this.deps.onProcessLine?.(line, 'err')
          },
        })

        job.handle = handle
        result = await handle.result
        job.handle = null
        this.deps.onProcessLine?.(
          `yt-dlp exited with code ${result.code ?? 'null'} (attempt ${attempt})`,
          'out',
        )

        if (job.cancelRequested) break

        if (result.code === 0) break

        const code: MfErrorCode = classifyStderr(result.stderrLines.slice(-40))
        if (code !== 'MF_NETWORK' || attempt > delays.length) {
          this.deps.logger?.warn('download failed', {
            jobId,
            code,
            exitCode: result.code,
            attempts: attempt,
          })
          await this.finish(job, sendDone, { status: 'failed', errorCode: code })
          return
        }

        const delayMs = delays[attempt - 1]
        this.deps.logger?.info('network failure — retry scheduled', { jobId, attempt, delayMs })
        this.events.emit(
          {
            jobId,
            phase: 'queued',
            percent: lastPercent,
            speedBps: null,
            etaSec: null,
            message: `Network issue — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt} of ${delays.length})…`,
          },
          sendEvent,
        )
        await sleep(delayMs)
      }

      if (result && job.cancelRequested) {
        if (job.config.isLive) {
          const saved = await this.finalizeLiveRecording(job)
          if (saved) {
            this.deps.logger?.info('live recording saved on stop', { jobId, target: saved })
            await this.finish(job, sendDone, { status: 'completed', outputPath: saved })
          } else {
            await this.finish(job, sendDone, { status: 'cancelled' })
          }
        } else {
          await this.finish(job, sendDone, { status: 'cancelled' })
        }
        return
      }

      emit('finalizing', 100, null, null)

      const finalSource = finalPathFromPrint ?? (await findLargestCompletedFile(job.tempDir))
      const sourceStat = finalSource ? await this.fs.stat(finalSource).catch(() => null) : null
      if (!finalSource || !sourceStat || sourceStat.size <= 0) {
        this.deps.logger?.error('final output missing after success', { jobId })
        await this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
        return
      }

      await this.fs.mkdir(job.destDir, { recursive: true })
      const target = collisionFreeTarget(job.destDir, basename(finalSource))
      const moved = await this.moveIntoPlace(finalSource, target, () =>
        emit('finalizing', 100, null, null),
      )
      if (!moved) {
        this.deps.logger?.error('moved output failed verification', { jobId, target })
        await this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
        return
      }

      await this.fs.rm(job.tempDir, { recursive: true, force: true })
      this.deps.logger?.info('download completed', { jobId, target })
      recordDownload(job.destDir, job.config, target)
      await this.finish(job, sendDone, { status: 'completed', outputPath: target })
    } catch (error) {
      this.deps.logger?.error('orchestrator error', { jobId, error: String(error) })
      await this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
    }
  }

  /**
   * Moves `source` onto `target`, preferring a same-volume rename. Only EXDEV falls through
   * to a copy — a permission or collision failure is a real error and rethrows rather than
   * being retried as a copy that would fail differently.
   *
   * AM-06 throughout: the source is unlinked, and the caller removes the temp tree, only
   * after the destination is confirmed to exist and be non-zero. Returns false when that
   * verification fails, leaving the source in place so the download is still recoverable.
   */
  private async moveIntoPlace(
    source: string,
    target: string,
    heartbeat?: () => void,
  ): Promise<boolean> {
    let copied = false
    try {
      await this.fs.rename(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      // A multi-gigabyte cross-volume copy can take minutes. The copy itself no longer
      // blocks the main loop; the heartbeat lets the UI show that it hasn't (P-02).
      const every = this.deps.finalizeHeartbeatMs ?? FINALIZE_HEARTBEAT_MS
      const timer = heartbeat ? setInterval(heartbeat, every) : null
      timer?.unref?.()
      try {
        await this.fs.copyFile(source, target)
      } finally {
        if (timer) clearInterval(timer)
      }
      copied = true
    }

    const stat = await this.fs.stat(target).catch(() => null)
    if (!stat || stat.size <= 0) return false
    if (copied) await this.fs.unlink(source)
    return true
  }

  private async finalizeLiveRecording(job: ActiveJob): Promise<string | null> {
    const partSource = await findLargestPartFile(job.tempDir)
    if (!partSource) return null
    const finalName = sanitizeFileName(basename(partSource).replace(/\.part$/i, ''))
    await this.fs.mkdir(job.destDir, { recursive: true })
    const target = collisionFreeTarget(job.destDir, finalName)
    if (!(await this.moveIntoPlace(partSource, target))) return null
    await this.fs.rm(job.tempDir, { recursive: true, force: true })
    return target
  }

  private async finish(
    job: ActiveJob,
    sendDone: SendDone,
    payload: Omit<JobDonePayload, 'jobId'> & { jobId?: string },
  ): Promise<void> {
    // Drain before the terminal event so no sample is stranded behind it (P-04).
    this.events.release(job.id)
    const keepPartials = payload.status === 'cancelled' || payload.status === 'failed'
    const tempExists =
      keepPartials &&
      (await fsp
        .stat(job.tempDir)
        .then(() => true)
        .catch(() => false))
    const partialDir = tempExists ? job.tempDir : (payload.partialDir ?? undefined)
    sendDone({
      ...payload,
      jobId: job.id,
      ...(partialDir ? { partialDir } : {}),
    } as JobDonePayload)
    this.activeJobs.delete(job.id)
  }
}
