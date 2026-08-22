import { randomUUID } from 'node:crypto'
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
import { basename, extname, join } from 'node:path'
import type {
  JobConfig,
  JobDonePayload,
  JobEvent,
  JobPhase,
  MfErrorCode,
} from '../../shared/models'
import type { LocatedBinary } from '../binaries/locator'
import { spawnProcess, type SpawnHandle } from '../binaries/runner'
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

export interface OrchestratorDeps {
  resolveYtDlp(): Promise<LocatedBinary | null>
  resolveFfmpeg(): Promise<LocatedBinary | null>
  tempRoot: string
  logger?: Logger
  /** Test seam: argv elements prepended before the built download args. */
  spawnArgPrefix?: readonly string[]
}

export type SendEvent = (event: JobEvent) => void
export type SendDone = (done: JobDonePayload) => void

interface ActiveJob {
  id: string
  config: JobConfig
  handle: SpawnHandle | null
  cancelRequested: boolean
  tempDir: string
}

function collisionFreeTarget(destDir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(destDir, fileName)
  let n = 1
  while (existsSync(candidate)) {
    candidate = join(destDir, `${stem}_${n}${ext}`)
    n += 1
  }
  return candidate
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
    if (this.activeJob) throw new MfLaunchError('A download is already running.')

    const ytDlp = await this.deps.resolveYtDlp()
    const ffmpeg = await this.deps.resolveFfmpeg()
    if (!ytDlp || !ffmpeg) throw new MfLaunchError('Media engines are not installed.')

    const jobId = randomUUID()
    const tempDir = join(this.deps.tempRoot, `job-${jobId}`)
    mkdirSync(tempDir, { recursive: true })

    const job: ActiveJob = { id: jobId, config, handle: null, cancelRequested: false, tempDir }
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
    ): void => {
      if (percent !== null) lastPercent = percent
      sendEvent({ jobId, phase: next, percent, speedBps, etaSec })
    }

    try {
      const args = [
        ...(this.deps.spawnArgPrefix ?? []),
        ...buildDownloadArgs(job.config, ffmpegPath, outputTemplateFor(job.tempDir)),
      ]

      const stdoutLines: string[] = []
      const stderrLines: string[] = []

      const handle = spawnProcess(ytdlpPath, args, {
        onStdoutLine: (line) => {
          stdoutLines.push(line)

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
            emit(nextPhase, computeSegmentPercent(progress), progress.speedBps, progress.etaSec)
          }
        },
        onStderrLine: (line) => stderrLines.push(line),
      })

      job.handle = handle
      const result = await handle.result
      job.handle = null

      if (job.cancelRequested) {
        this.finish(job, sendDone, { status: 'cancelled' })
        return
      }

      if (result.code !== 0) {
        const code: MfErrorCode = classifyStderr(stderrLines.slice(-40))
        this.deps.logger?.warn('download failed', { jobId, code, exitCode: result.code })
        this.finish(job, sendDone, { status: 'failed', errorCode: code })
        return
      }

      emit('finalizing', 100, null, null)

      const finalSource = extractFinalPathLine(stdoutLines) ?? findLargestCompletedFile(job.tempDir)
      if (!finalSource || !existsSync(finalSource) || statSync(finalSource).size <= 0) {
        this.deps.logger?.error('final output missing after success', { jobId })
        this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
        return
      }

      mkdirSync(job.config.destDir, { recursive: true })
      const target = collisionFreeTarget(job.config.destDir, basename(finalSource))
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

  private finish(
    job: ActiveJob,
    sendDone: SendDone,
    payload: Omit<JobDonePayload, 'jobId'> & { jobId?: string },
  ): void {
    sendDone({ ...payload, jobId: job.id } as JobDonePayload)
    if (this.activeJob?.id === job.id) this.activeJob = null
  }
}

export class MfLaunchError extends Error {}
