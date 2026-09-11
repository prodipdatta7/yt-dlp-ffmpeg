import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
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

function findLargestCompletedFile(dir: string): string | null {
  let best: string | null = null
  let bestSize = -1
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.part') || name.endsWith('.ytdl')) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (!stat.isFile()) continue
    if (stat.size > bestSize) {
      best = full
      bestSize = stat.size
    }
  }
  return best !== null && bestSize > 0 ? best : null
}

function findLargestPartFile(dir: string): string | null {
  let best: string | null = null
  let bestSize = -1
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.part')) continue
    const full = join(dir, name)
    try {
      const size = statSync(full).size
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

  constructor(private readonly deps: OrchestratorDeps) {
    this.events = new JobEventCoalescer(deps.coalesceIntervalMs)
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
    mkdirSync(tempDir, { recursive: true })

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
          this.finish(job, sendDone, { status: 'failed', errorCode: code })
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
          const saved = this.finalizeLiveRecording(job)
          if (saved) {
            this.deps.logger?.info('live recording saved on stop', { jobId, target: saved })
            this.finish(job, sendDone, { status: 'completed', outputPath: saved })
          } else {
            this.finish(job, sendDone, { status: 'cancelled' })
          }
        } else {
          this.finish(job, sendDone, { status: 'cancelled' })
        }
        return
      }

      emit('finalizing', 100, null, null)

      const finalSource = finalPathFromPrint ?? findLargestCompletedFile(job.tempDir)
      if (!finalSource || !existsSync(finalSource) || statSync(finalSource).size <= 0) {
        this.deps.logger?.error('final output missing after success', { jobId })
        this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
        return
      }

      mkdirSync(job.destDir, { recursive: true })
      const target = collisionFreeTarget(job.destDir, basename(finalSource))
      try {
        renameSync(finalSource, target)
      } catch {
        copyFileSync(finalSource, target)
        unlinkSync(finalSource)
      }

      if (!existsSync(target) || statSync(target).size <= 0) {
        this.deps.logger?.error('moved output failed verification', { jobId, target })
        this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
        return
      }

      rmSync(job.tempDir, { recursive: true, force: true })
      this.deps.logger?.info('download completed', { jobId, target })
      recordDownload(job.destDir, job.config, target)
      this.finish(job, sendDone, { status: 'completed', outputPath: target })
    } catch (error) {
      this.deps.logger?.error('orchestrator error', { jobId, error: String(error) })
      this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
    }
  }

  private finalizeLiveRecording(job: ActiveJob): string | null {
    const partSource = findLargestPartFile(job.tempDir)
    if (!partSource) return null
    const finalName = sanitizeFileName(basename(partSource).replace(/\.part$/i, ''))
    mkdirSync(job.destDir, { recursive: true })
    const target = collisionFreeTarget(job.destDir, finalName)
    try {
      renameSync(partSource, target)
    } catch {
      copyFileSync(partSource, target)
      unlinkSync(partSource)
    }
    if (!existsSync(target) || statSync(target).size <= 0) return null
    rmSync(job.tempDir, { recursive: true, force: true })
    return target
  }

  private finish(
    job: ActiveJob,
    sendDone: SendDone,
    payload: Omit<JobDonePayload, 'jobId'> & { jobId?: string },
  ): void {
    // Drain before the terminal event so no sample is stranded behind it (P-04).
    this.events.release(job.id)
    const keepPartials = payload.status === 'cancelled' || payload.status === 'failed'
    const partialDir =
      keepPartials && existsSync(job.tempDir) ? job.tempDir : (payload.partialDir ?? undefined)
    sendDone({
      ...payload,
      jobId: job.id,
      ...(partialDir ? { partialDir } : {}),
    } as JobDonePayload)
    this.activeJobs.delete(job.id)
  }
}
