import { ipcMain } from 'electron'
import {
  MF_ANALYZE_CANCEL,
  MF_ANALYZE_START,
  MF_BINARIES_INFO,
  MF_DOWNLOAD_CANCEL,
  MF_DOWNLOAD_START,
  MF_DEFAULT_DEST_DIR,
  MF_JOB_DONE,
  MF_JOB_EVENT,
  MF_PING,
  type AnalyzeResponse,
  type BinariesInfoResult,
  type Container,
  type DownloadStartResponse,
  type JobConfig,
  type JobDonePayload,
  type JobEvent,
  type PingResult,
} from '../../shared/ipcContract'
import { CONTAINERS, RESOLUTION_TIERS, ERROR_MESSAGES } from '../../shared/models'
import { MfError } from '../media/metadata'
import type { Logger } from '../store/logger'

const MAX_URL_LENGTH = 2048

export interface IpcDeps {
  getBinariesInfo: () => Promise<BinariesInfoResult>
  analyze: (url: string) => Promise<AnalyzeResponse>
  cancelAnalyze: () => { ok: boolean }
  startDownload: (
    config: JobConfig,
    sendEvent: (event: JobEvent) => void,
    sendDone: (done: JobDonePayload) => void,
  ) => Promise<DownloadStartResponse>
  cancelDownload: (jobId: string) => { ok: boolean }
  getDefaultDestDir: () => string
}

function invalidUrl(): AnalyzeResponse {
  return { kind: 'error', code: 'MF_INVALID_URL', message: ERROR_MESSAGES.MF_INVALID_URL }
}

export function registerIpcHandlers(deps: IpcDeps, logger?: Logger): void {
  ipcMain.handle(MF_PING, (): PingResult => ({ pong: 'mediaforge', ts: Date.now() }))

  ipcMain.handle(MF_BINARIES_INFO, async (): Promise<BinariesInfoResult> => deps.getBinariesInfo())

  ipcMain.handle(MF_ANALYZE_START, async (_event, payload: unknown): Promise<AnalyzeResponse> => {
    const url = extractUrl(payload)
    if (!url) return invalidUrl()
    try {
      return await deps.analyze(url)
    } catch (error) {
      const code = error instanceof MfError ? error.code : 'MF_UNKNOWN'
      logger?.warn('analyze failed', { code })
      return { kind: 'error', code, message: ERROR_MESSAGES[code] }
    }
  })

  ipcMain.handle(MF_ANALYZE_CANCEL, () => deps.cancelAnalyze())

  ipcMain.handle(
    MF_DOWNLOAD_START,
    async (event, payload: unknown): Promise<DownloadStartResponse> => {
      const config = parseJobConfig(payload)
      if (!config) {
        return { kind: 'error', code: 'MF_INVALID_URL', message: ERROR_MESSAGES.MF_INVALID_URL }
      }
      const sender = event.sender
      const sendEvent = (jobEvent: JobEvent): void => {
        if (!sender.isDestroyed()) sender.send(MF_JOB_EVENT, jobEvent)
      }
      const sendDone = (done: JobDonePayload): void => {
        if (!sender.isDestroyed()) sender.send(MF_JOB_DONE, done)
      }
      try {
        return await deps.startDownload(config, sendEvent, sendDone)
      } catch (error) {
        const message = error instanceof Error ? error.message : ERROR_MESSAGES.MF_UNKNOWN
        return { kind: 'error', code: 'MF_UNKNOWN', message }
      }
    },
  )

  ipcMain.handle(MF_DOWNLOAD_CANCEL, (_event, payload: unknown) => {
    const jobId = typeof payload === 'string' && payload.length > 0 ? payload : undefined
    return deps.cancelDownload(jobId ?? '')
  })

  ipcMain.handle(MF_DEFAULT_DEST_DIR, () => deps.getDefaultDestDir())
}

function extractUrl(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  const url = payload.trim()
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return null
  if (!/^https?:\/\//i.test(url)) return null
  return url
}

function parseJobConfig(payload: unknown): JobConfig | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>

  const url = extractUrl(raw.url)
  if (!url) return null

  if (raw.mode !== 'video-audio') return null

  let tier: number | undefined
  if (raw.tier !== undefined) {
    if (typeof raw.tier !== 'number' || !RESOLUTION_TIERS.includes(raw.tier as never)) return null
    tier = raw.tier
  }

  let container: Container | undefined
  if (raw.container !== undefined) {
    if (typeof raw.container !== 'string' || !CONTAINERS.includes(raw.container as never))
      return null
    container = raw.container as Container
  }

  if (typeof raw.destDir !== 'string' || raw.destDir.length === 0 || raw.destDir.length > 500) {
    return null
  }

  return { url, mode: 'video-audio', tier, container, destDir: raw.destDir }
}
