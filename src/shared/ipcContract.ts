import type {
  AnalyzeResult,
  AppUpdatePhase,
  JobConfig,
  JobDonePayload,
  JobEvent,
  MfErrorCode,
  PlaylistEntryPreview,
  SearchFilterCriteria,
  SearchResultItem,
  SearchSort,
  UpdaterDriverKind,
  UpdaterPhase,
  VideoTranscriptResult,
} from './models'

export type { MfErrorCode }

export const MF_PING = 'mf:ping' as const
export const MF_BINARIES_INFO = 'mf:binaries:info' as const
export const MF_ANALYZE_START = 'mf:analyze:start' as const
export const MF_ANALYZE_CANCEL = 'mf:analyze:cancel' as const
export const MF_ANALYZE_ENTRY = 'mf:analyze:entry' as const
export const MF_ANALYZE_HYDRATE_RANGE = 'mf:analyze:hydrate-range' as const
export const MF_DOWNLOAD_START = 'mf:download:start' as const
export const MF_DOWNLOAD_CANCEL = 'mf:download:cancel' as const
export const MF_JOB_EVENT = 'mf:job:event' as const
export const MF_JOB_DONE = 'mf:job:done' as const
export const MF_DEFAULT_DEST_DIR = 'mf:default-dest-dir' as const
export const MF_CLIPBOARD_URL = 'mf:clipboard:url' as const
export const MF_DIALOG_CHOOSE_DIR = 'mf:dialog:choose-dir' as const
export const MF_SETTINGS_IMPORT_COOKIES = 'mf:settings:import-cookies' as const
export const MF_SETTINGS_CLEAR_COOKIES = 'mf:settings:clear-cookies' as const
export const MF_LOGS_OPEN = 'mf:logs:open' as const
export const MF_LOG_HISTORY = 'mf:log:history' as const
export const MF_LOG_CLEAR = 'mf:log:clear' as const
export const MF_LOG_LINE = 'mf:log:line' as const
export const MF_LOG_CONSOLE_OPEN = 'mf:log:console-open' as const
export const MF_UPDATER_CHECK = 'mf:updater:check' as const
export const MF_UPDATER_APPLY = 'mf:updater:apply' as const
export const MF_UPDATER_PHASE = 'mf:updater:phase' as const
export const MF_APP_VERSION = 'mf:app:version' as const
export const MF_APP_UPDATE_CHECK = 'mf:app:update-check' as const
export const MF_APP_UPDATE_OPEN_RELEASE = 'mf:app:update-open-release' as const
export const MF_APP_UPDATE_DOWNLOAD_INSTALL = 'mf:app:update-download-install' as const
export const MF_APP_UPDATE_PHASE = 'mf:app:update-phase' as const
export const MF_SETTINGS_GET = 'mf:settings:get' as const
export const MF_SETTINGS_SET = 'mf:settings:set' as const
export const MF_SETTINGS_MARK_FIRST_RUN = 'mf:settings:mark-first-run' as const
export const MF_PARTIALS_LIST = 'mf:partials:list' as const
export const MF_PARTIALS_OPEN = 'mf:partials:open' as const
export const MF_PARTIALS_CLEAR = 'mf:partials:clear' as const
export const MF_REVEAL_PATH = 'mf:reveal-path' as const
export const MF_OPEN_FILE = 'mf:open-file' as const
export const MF_SEARCH_START = 'mf:search:start' as const
export const MF_SEARCH_CANCEL = 'mf:search:cancel' as const
export const MF_SEARCH_ENTRY = 'mf:search:entry' as const
export const MF_FETCH_CHAPTERS = 'mf:media:fetch-chapters' as const
export const MF_FETCH_TRANSCRIPT = 'mf:media:fetch-transcript' as const
export const MF_PREVIEW_CANCEL = 'mf:media:preview-cancel' as const
export const MF_PROBE_SCENARIO = 'mf:probe:scenario' as const
export const MF_SAVE_TEXT_FILE = 'mf:dialog:save-text-file' as const
export const MF_PREVIEW_SET_VOLUME_BOOST = 'mf:preview:set-volume-boost' as const

export interface SaveTextFileResult {
  ok: boolean
  filePath?: string
  canceled?: boolean
}

export interface VideoChaptersResult {
  chapters: import('./models').ChapterMarker[]
  description?: string | null
}

export interface SearchHydratePayload {
  /** Exact URL originally returned to the renderer; used as a stable update key. */
  sourceUrl: string
  metadataState: 'ready' | 'unavailable'
  /** A classified yt-dlp error for an unavailable federated result, if one was emitted. */
  errorCode?: import('./models').MfErrorCode
  patch: Partial<
    Pick<
      SearchResultItem,
      | 'title'
      | 'id'
      | 'durationSec'
      | 'uploader'
      | 'viewCount'
      | 'likeCount'
      | 'commentCount'
      | 'thumbnailUrl'
      | 'uploadDate'
      | 'timestamp'
      | 'isVerified'
      | 'description'
      | 'isPlaylist'
      | 'isReel'
      | 'isMusicVideo'
    >
  >
}

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
  theme: 'system' | 'light' | 'dark'
  playlistConcurrency: number
  notifyOnComplete: boolean
  queueSnapshot: {
    rows: Array<{
      url: string
      title: string
      status: 'pending' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled'
    }>
    runMode: 'sequential' | 'parallel'
    selectionJson?: string
    playlistTitle?: string
  } | null
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

/** Streams the updater's fine-grained progress (checking → installing → verified) to the UI. */
export interface UpdaterPhaseEvent {
  kind: UpdaterDriverKind
  phase: UpdaterPhase
  detail?: string
}

export interface AppUpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  error?: string
}

export interface AppUpdateInstallResult {
  ok: boolean
  error?: string
}

/** Streams the app-installer download's fine-grained progress to the UI. */
export interface AppUpdatePhaseEvent {
  phase: AppUpdatePhase
}

export interface PartialDirInfo {
  path: string
  bytes: number
  fileCount: number
  mtimeMs: number
}

export interface PartialsListResult {
  tempRoot: string
  items: PartialDirInfo[]
}

export interface PartialsClearResult {
  ok: boolean
  cleared: number
  failed?: number
}

export interface SearchRequest {
  platform: string
  query: string
  limit: number
  sort: SearchSort
  filters?: SearchFilterCriteria
}

export type SearchResponse =
  | { kind: 'ok'; results: SearchResultItem[] }
  | { kind: 'error'; code: MfErrorCode; message: string }

export interface MfApi {
  ping(): Promise<PingResult>
  getBinariesInfo(): Promise<BinariesInfoResult>
  analyzeStart(url: string): Promise<AnalyzeResponse>
  analyzeCancel(): Promise<{ ok: boolean }>
  /**
   * Hydrates a further slice of the current playlist, streaming the same `analyze:entry`
   * events as the initial window. No-ops when there is no current playlist, when the range
   * is already hydrated, or when a newer analysis has started (R-02).
   */
  analyzeHydrateRange(fromIndex: number, count: number): Promise<{ ok: boolean }>
  onAnalyzeEntry(listener: (event: AnalyzeStreamEvent) => void): () => void
  downloadStart(config: JobConfig): Promise<DownloadStartResponse>
  downloadCancel(jobId: string): Promise<{ ok: boolean }>
  onJobEvent(listener: (event: JobEvent) => void): () => void
  onJobDone(listener: (done: JobDonePayload) => void): () => void
  getDefaultDestDir(): Promise<string>
  getClipboardUrl(): Promise<string | null>
  chooseDestDir(): Promise<string | null>
  importCookies(): Promise<boolean>
  clearCookies(): Promise<boolean>
  openLogsFolder(): Promise<boolean>
  logHistory(): Promise<{ lines: LogEntryPayload[] }>
  logClear(): Promise<{ ok: boolean }>
  /**
   * Tells main whether the live console is mounted, and whether it wants the raw
   * `--progress-template` protocol lines. While closed, no CLI line crosses IPC (P-04).
   */
  logConsoleOpen(open: boolean, includeProtocol?: boolean): Promise<{ ok: boolean }>
  onLogLine(listener: (entry: LogEntryPayload) => void): () => void
  getSettings(): Promise<MfSettingsView>
  setSettings(
    patch: Partial<
      Pick<
        MfSettingsView,
        'theme' | 'lastOutputDir' | 'playlistConcurrency' | 'notifyOnComplete' | 'queueSnapshot'
      >
    >,
  ): Promise<MfSettingsView>
  markFirstRunSeen(): Promise<boolean>
  listPartials(): Promise<PartialsListResult>
  openPartialDir(path: string): Promise<{ ok: boolean }>
  clearPartials(path?: string): Promise<PartialsClearResult>
  /** Reveal a file or folder in the OS file manager (Explorer). */
  revealPath(path: string): Promise<{ ok: boolean }>
  /** Open a file with the OS-registered default application (e.g. play a video). */
  openFile(path: string): Promise<{ ok: boolean }>
  updaterCheck(kind: UpdaterDriverKind): Promise<UpdaterCheckResult>
  updaterApply(kind: UpdaterDriverKind): Promise<UpdaterApplyResult>
  onUpdaterPhase(listener: (event: UpdaterPhaseEvent) => void): () => void
  searchStart(req: SearchRequest): Promise<SearchResponse>
  searchCancel(): Promise<{ ok: boolean }>
  onSearchEntry(listener: (event: SearchHydratePayload) => void): () => void
  getAppVersion(): Promise<{ version: string }>
  checkAppUpdate(): Promise<AppUpdateCheckResult>
  openAppReleasePage(): Promise<{ ok: boolean }>
  downloadAndInstallAppUpdate(): Promise<AppUpdateInstallResult>
  onAppUpdatePhase(listener: (event: AppUpdatePhaseEvent) => void): () => void
  /** `requestId` lets the renderer cancel this exact request via {@link previewCancel}. */
  fetchChapters(url: string, requestId?: string): Promise<VideoChaptersResult>
  fetchTranscript(url: string, requestId?: string): Promise<VideoTranscriptResult>
  /**
   * Kills the yt-dlp children of one preview request and blocks any follow-up it would
   * spawn. Closing a preview or unmounting its card used to leave them running (P-06).
   */
  previewCancel(requestId: string): Promise<{ ok: boolean }>
  saveTextFile(defaultFilename: string, content: string): Promise<SaveTextFileResult>
  setPreviewVolumeBoost(boost: number): Promise<boolean>
  /**
   * Labels subsequent memory-probe samples so a benchmark run can mark phases. No-op
   * unless MF_MEMORY_PROBE=1 (P-10).
   */
  setProbeScenario(scenario: string): Promise<{ ok: boolean }>
}

export type {
  ChapterMarker,
  Container,
  JobConfig,
  JobDonePayload,
  JobEvent,
  PlaylistEntryPreview,
  SearchFilterCriteria,
  SearchPlatform,
  SearchResultItem,
  SearchSort,
  TranscriptCue,
  UploadRecency,
  VideoTranscriptResult,
} from './models'
