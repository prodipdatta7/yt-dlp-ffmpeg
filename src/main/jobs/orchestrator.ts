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
import { collisionFreeTarget, sanitizeFileName } from '../fsops/sanitizer'
import { classifyStderr } from '../media/classifyStderr'
import type { Logger } from '../store/logger'
import { buildDownloadArgs, outputTemplateFor } from './argBuilders'
import {
  computeSegmentPercent,
  extractFinalPathLine,
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
  private activeJob: ActiveJob | null = null

  constructor(private readonly deps: OrchestratorDeps) {}

  isBusy(): boolean {
    return this.activeJob !== null
  }

  cancel(jobId?: string): boolean {
    const job = this.activeJob
    if (!job) return false
    if (jobId && job.id !== jobId) return false
    job.cancelRequested = true
    this.deps.logger?.info('download cancel requested', { jobId: job.id })
    void job.handle?.killTree()
    return true
  }

  async launch(config: JobConfig, sendEvent: SendEvent, sendDone: SendDone): Promise<string> {
    if (this.activeJob) {
      throw new MfLaunchError(null, 'A download is already running.')
    }

    const ytDlp = await this.deps.resolveYtDlp()
    const ffmpeg = await this.deps.resolveFfmpeg()
    if (!ytDlp || !ffmpeg) {
      throw new MfLaunchError(null, 'Media engines are not installed.')
    }

    const effectiveDestDir = config.playlistTitle
      ? join(config.destDir, sanitizeFileName(config.playlistTitle))
      : config.destDir

    const freeBytes = await freeDiskSpaceBytes(effectiveDestDir)
    if (isDiskSpaceInsufficient(freeBytes, config.estimatedBytes)) {
      this.deps.logger?.warn('preflight disk-space abort', {
        freeBytes,
        estimatedBytes: config.estimatedBytes,
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
    this.activeJob = job
    this.deps.logger?.info('job launched', { jobId, mode: config.mode, tier: config.tier })
    sendEvent({ jobId, phase: 'queued', percent: null, speedBps: null, etaSec: null })

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
      sendEvent({ jobId, phase: next, percent, speedBps, etaSec, downloadedBytes, totalBytes })
    }

    try {
      const delays = this.deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
      const cookiesPath = this.deps.getCookiesPath?.() ?? null
      const allStdoutLines: string[] = []

      let attempt = 0
      let result: RunResult | null = null
      for (;;) {
        attempt += 1
        const stdoutLines: string[] = []
        const stderrLines: string[] = []

        if (job.cancelRequested) break

        const args = [
          ...(this.deps.spawnArgPrefix ?? []),
          ...buildDownloadArgs(job.config, ffmpegPath, outputTemplateFor(job.tempDir), cookiesPath),
        ]

        this.deps.onProcessLine?.(`$ yt-dlp ${args.join(' ')}`, 'out')

        const handle = spawnProcess(ytdlpPath, args, {
          onStdoutLine: (line) => {
            stdoutLines.push(line)
            allStdoutLines.push(line)
            this.deps.onProcessLine?.(line, 'out')

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
            stderrLines.push(line)
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

        const code: MfErrorCode = classifyStderr(stderrLines.slice(-40))
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
        sendEvent({
          jobId,
          phase: 'queued',
          percent: lastPercent,
          speedBps: null,
          etaSec: null,
          message: `Network issue — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt} of ${delays.length})…`,
        })
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

      const finalSource =
        extractFinalPathLine(allStdoutLines) ?? findLargestCompletedFile(job.tempDir)
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
    sendDone({ ...payload, jobId: job.id } as JobDonePayload)
    if (this.activeJob?.id === job.id) this.activeJob = null
  }
}
