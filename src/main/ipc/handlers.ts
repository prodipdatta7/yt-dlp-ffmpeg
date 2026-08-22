import { ipcMain } from 'electron'
import {
  MF_ANALYZE_CANCEL,
  MF_ANALYZE_START,
  MF_BINARIES_INFO,
  MF_PING,
  type AnalyzeResponse,
  type BinariesInfoResult,
  type MfErrorCode,
  type PingResult,
} from '../../shared/ipcContract'
import { ERROR_MESSAGES } from '../../shared/models'
import { MfError } from '../media/metadata'
import type { Logger } from '../store/logger'

export interface IpcDeps {
  getBinariesInfo: () => Promise<BinariesInfoResult>
  analyze: (url: string) => Promise<AnalyzeResponse>
  cancelAnalyze: () => { ok: boolean }
}

const MAX_URL_LENGTH = 2048

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
      const code: MfErrorCode = error instanceof MfError ? error.code : 'MF_UNKNOWN'
      logger?.warn('analyze failed', { code })
      return { kind: 'error', code, message: ERROR_MESSAGES[code] }
    }
  })

  ipcMain.handle(MF_ANALYZE_CANCEL, () => deps.cancelAnalyze())
}

function extractUrl(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  const url = payload.trim()
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return null
  if (!/^https?:\/\//i.test(url)) return null
  return url
}
