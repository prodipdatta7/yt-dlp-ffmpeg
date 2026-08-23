import type {
  AnalyzeResult,
  JobConfig,
  JobDonePayload,
  JobEvent,
  MfErrorCode,
  PlaylistEntryPreview,
} from './models'

export type { MfErrorCode }

export const MF_PING = 'mf:ping' as const
export const MF_BINARIES_INFO = 'mf:binaries:info' as const
export const MF_ANALYZE_START = 'mf:analyze:start' as const
export const MF_ANALYZE_CANCEL = 'mf:analyze:cancel' as const
export const MF_ANALYZE_ENTRY = 'mf:analyze:entry' as const
export const MF_DOWNLOAD_START = 'mf:download:start' as const
export const MF_DOWNLOAD_CANCEL = 'mf:download:cancel' as const
export const MF_JOB_EVENT = 'mf:job:event' as const
export const MF_JOB_DONE = 'mf:job:done' as const
export const MF_DEFAULT_DEST_DIR = 'mf:default-dest-dir' as const
export const MF_DIALOG_CHOOSE_DIR = 'mf:dialog:choose-dir' as const
export const MF_SETTINGS_IMPORT_COOKIES = 'mf:settings:import-cookies' as const
export const MF_SETTINGS_CLEAR_COOKIES = 'mf:settings:clear-cookies' as const
export const MF_LOGS_OPEN = 'mf:logs:open' as const
export const MF_LOG_HISTORY = 'mf:log:history' as const
export const MF_LOG_CLEAR = 'mf:log:clear' as const
export const MF_LOG_LINE = 'mf:log:line' as const
export const MF_UPDATER_CHECK = 'mf:updater:check' as const
export const MF_UPDATER_APPLY = 'mf:updater:apply' as const
export const MF_SETTINGS_GET = 'mf:settings:get' as const
export const MF_SETTINGS_MARK_FIRST_RUN = 'mf:settings:mark-first-run' as const

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
  { kind: 'ok'; result: AnalyzeResult } | { kind: 'error'; code: MfErrorCode; message: string }

export type DownloadStartResponse =
  { kind: 'ok'; jobId: string } | { kind: 'error'; code: MfErrorCode; message: string }

export interface AnalyzeEntryEvent {
  index: number
  entry: PlaylistEntryPreview
  done: number
  total: number
}

export type AnalyzeStreamEvent =
  | { kind: 'outline'; result: AnalyzeResult }
  | { kind: 'entry'; index: number; entry: PlaylistEntryPreview; done: number; total: number }

export interface MfSettingsView {
  lastOutputDir: string
  cookieFileSet: boolean
  firstRunNoticeSeen: boolean
}

export interface LogEntryPayload {
  ts: number
  source: 'yt-dlp' | 'app'
  stream: 'out' | 'err'
  text: string
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

export interface MfApi {
  ping(): Promise<PingResult>
  getBinariesInfo(): Promise<BinariesInfoResult>
  analyzeStart(url: string): Promise<AnalyzeResponse>
  analyzeCancel(): Promise<{ ok: boolean }>
  onAnalyzeEntry(listener: (event: AnalyzeStreamEvent) => void): () => void
  downloadStart(config: JobConfig): Promise<DownloadStartResponse>
  downloadCancel(jobId: string): Promise<{ ok: boolean }>
  onJobEvent(listener: (event: JobEvent) => void): () => void
  onJobDone(listener: (done: JobDonePayload) => void): () => void
  getDefaultDestDir(): Promise<string>
  chooseDestDir(): Promise<string | null>
  importCookies(): Promise<boolean>
  clearCookies(): Promise<boolean>
  openLogsFolder(): Promise<boolean>
  logHistory(): Promise<{ lines: LogEntryPayload[] }>
  logClear(): Promise<{ ok: boolean }>
  onLogLine(listener: (entry: LogEntryPayload) => void): () => void
  getSettings(): Promise<MfSettingsView>
  markFirstRunSeen(): Promise<boolean>
  updaterCheck(): Promise<UpdaterCheckResult>
  updaterApply(): Promise<UpdaterApplyResult>
}

export type { Container, JobConfig, JobDonePayload, JobEvent, PlaylistEntryPreview } from './models'
