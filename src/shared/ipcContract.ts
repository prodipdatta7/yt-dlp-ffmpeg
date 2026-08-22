export const MF_PING = 'mf:ping' as const
export const MF_BINARIES_INFO = 'mf:binaries:info' as const

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

export interface MfApi {
  ping(): Promise<PingResult>
  getBinariesInfo(): Promise<BinariesInfoResult>
}
