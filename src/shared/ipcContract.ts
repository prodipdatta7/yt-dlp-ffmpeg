import type { MfErrorCode } from './models'

export type { MfErrorCode }

export const MF_PING = 'mf:ping' as const
export const MF_BINARIES_INFO = 'mf:binaries:info' as const
export const MF_ANALYZE_START = 'mf:analyze:start' as const
export const MF_ANALYZE_CANCEL = 'mf:analyze:cancel' as const

export interface PingResult {
  pong: string
  ts: number
}

export type BinaryKind = 'yt-dlp' | 'ffmpeg'
export type BinarySource = 'override' | 'userData' | 'bundled'

export interface BinaryInfo {
  version: string | null
  source: BinarySource | null
}

export interface BinariesInfoResult {
  ytdlp: BinaryInfo
  ffmpeg: BinaryInfo
}

export type AnalyzeResponse =
  | { kind: 'ok'; result: import('./models').AnalyzeResult }
  | { kind: 'error'; code: MfErrorCode; message: string }

export interface MfApi {
  ping(): Promise<PingResult>
  getBinariesInfo(): Promise<BinariesInfoResult>
  analyzeStart(url: string): Promise<AnalyzeResponse>
  analyzeCancel(): Promise<{ ok: boolean }>
}
