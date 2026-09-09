import { ipcMain } from 'electron'
import {
  MF_ANALYZE_CANCEL,
  MF_ANALYZE_ENTRY,
  MF_ANALYZE_START,
  MF_BINARIES_INFO,
  MF_DOWNLOAD_CANCEL,
  MF_DOWNLOAD_START,
  MF_DEFAULT_DEST_DIR,
  MF_CLIPBOARD_URL,
  MF_DIALOG_CHOOSE_DIR,
  MF_JOB_DONE,
  MF_JOB_EVENT,
  MF_LOGS_OPEN,
  MF_LOG_CLEAR,
  MF_LOG_HISTORY,
  MF_PING,
  MF_SETTINGS_CLEAR_COOKIES,
  MF_SETTINGS_GET,
  MF_SETTINGS_IMPORT_COOKIES,
  MF_SETTINGS_MARK_FIRST_RUN,
  MF_SETTINGS_SET,
  MF_PARTIALS_LIST,
  MF_PARTIALS_OPEN,
  MF_PARTIALS_CLEAR,
  MF_REVEAL_PATH,
  MF_OPEN_FILE,
  MF_SEARCH_CANCEL,
  MF_SEARCH_START,
  MF_UPDATER_APPLY,
  MF_UPDATER_CHECK,
  MF_APP_VERSION,
  MF_APP_UPDATE_CHECK,
  MF_APP_UPDATE_OPEN_RELEASE,
  MF_APP_UPDATE_DOWNLOAD_INSTALL,
  type AnalyzeResponse,
  type AnalyzeStreamEvent,
  type AppUpdateCheckResult,
  type AppUpdateInstallResult,
  type BinariesInfoResult,
  type Container,
  type DownloadStartResponse,
  type JobConfig,
  type JobDonePayload,
  type JobEvent,
  type LogEntryPayload,
  type MfSettingsView,
  type PartialsClearResult,
  type PartialsListResult,
  type PingResult,
  type SearchResponse,
} from '../../shared/ipcContract'
import type { SearchSort, UpdaterDriverKind } from '../../shared/models'
import {
  BITRATE_TIERS,
  CONTAINERS,
  LOSSLESS_AUDIO_FORMATS,
  LOSSY_AUDIO_FORMATS,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  RESOLUTION_TIERS,
  SEARCH_PLATFORMS,
  ERROR_MESSAGES,
  type AudioFormat,
  type BitrateTier,
} from '../../shared/models'
import { MfError } from '../media/metadata'
import type { Logger } from '../store/logger'

const MAX_URL_LENGTH = 2048

export interface IpcDeps {
  getBinariesInfo: () => Promise<BinariesInfoResult>
  analyze: (
    url: string,
    sendEntry?: (event: AnalyzeStreamEvent) => void,
  ) => Promise<AnalyzeResponse>
  cancelAnalyze: () => { ok: boolean }
  startDownload: (
    config: JobConfig,
    sendEvent: (event: JobEvent) => void,
    sendDone: (done: JobDonePayload) => void,
  ) => Promise<DownloadStartResponse>
  cancelDownload: (jobId: string) => { ok: boolean }
  getDefaultDestDir: () => string
  getClipboardUrl: () => Promise<string | null>
  chooseDirectory: () => Promise<string | null>
  importCookies: () => Promise<boolean>
  clearCookies: () => boolean
  openLogsFolder: () => Promise<boolean>
  logHistory: () => Promise<{ lines: LogEntryPayload[] }> | { lines: LogEntryPayload[] }
  logClear: () => { ok: boolean }
  getSettings: () => MfSettingsView
  setSettings: (
    patch: Partial<
      Pick<
        MfSettingsView,
        'theme' | 'lastOutputDir' | 'playlistConcurrency' | 'notifyOnComplete' | 'queueSnapshot'
      >
    >,
  ) => MfSettingsView
  markFirstRunSeen: () => boolean
  listPartials: () => PartialsListResult
  openPartialDir: (path: string) => Promise<{ ok: boolean }>
  clearPartials: (path?: string) => PartialsClearResult
  revealPath: (path: string) => Promise<{ ok: boolean }>
  openFile: (path: string) => Promise<{ ok: boolean }>
  updaterCheck: (kind: UpdaterDriverKind) => Promise<{
    current: string | null
    latest: string | null
    updateAvailable: boolean
    error?: string
  }>
  updaterApply: (kind: UpdaterDriverKind) => Promise<{
    ok: boolean
    newVersion?: string
    rolledBack?: boolean
    error?: string
  }>
  search: (
    platform: string,
    query: string,
    limit: number,
    sort: SearchSort,
  ) => Promise<SearchResponse>
  cancelSearch: () => { ok: boolean }
  getAppVersion: () => string
  checkAppUpdate: () => Promise<AppUpdateCheckResult>
  openAppReleasePage: () => Promise<{ ok: boolean }>
  downloadAndInstallAppUpdate: () => Promise<AppUpdateInstallResult>
}

function invalidUrl(): AnalyzeResponse {
  return { kind: 'error', code: 'MF_INVALID_URL', message: ERROR_MESSAGES.MF_INVALID_URL }
}

export function registerIpcHandlers(deps: IpcDeps, logger?: Logger): void {
  ipcMain.handle(MF_PING, (): PingResult => ({ pong: 'mediaforge', ts: Date.now() }))

  ipcMain.handle(MF_BINARIES_INFO, async (): Promise<BinariesInfoResult> => deps.getBinariesInfo())

  ipcMain.handle(MF_ANALYZE_START, async (event, payload: unknown): Promise<AnalyzeResponse> => {
    const url = extractUrl(payload)
    if (!url) return invalidUrl()
    const sender = event.sender
    const sendEntry = (streamEvent: AnalyzeStreamEvent): void => {
      if (!sender.isDestroyed()) sender.send(MF_ANALYZE_ENTRY, streamEvent)
    }
    try {
      return await deps.analyze(url, sendEntry)
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

  ipcMain.handle(MF_CLIPBOARD_URL, () => deps.getClipboardUrl())

  ipcMain.handle(MF_DIALOG_CHOOSE_DIR, () => deps.chooseDirectory())

  ipcMain.handle(MF_SETTINGS_IMPORT_COOKIES, () => deps.importCookies())
  ipcMain.handle(MF_SETTINGS_CLEAR_COOKIES, () => deps.clearCookies())
  ipcMain.handle(MF_LOGS_OPEN, () => deps.openLogsFolder())

  ipcMain.handle(MF_LOG_HISTORY, () => deps.logHistory())

  ipcMain.handle(MF_LOG_CLEAR, () => deps.logClear())

  ipcMain.handle(MF_SETTINGS_GET, () => deps.getSettings())

  ipcMain.handle(MF_SETTINGS_SET, (_event, payload: unknown) => {
    const patch: Partial<
      Pick<
        MfSettingsView,
        'theme' | 'lastOutputDir' | 'playlistConcurrency' | 'notifyOnComplete' | 'queueSnapshot'
      >
    > = {}
    if (payload && typeof payload === 'object') {
      const raw = payload as Record<string, unknown>
      if (raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark') {
        patch.theme = raw.theme
      }
      if (typeof raw.lastOutputDir === 'string') patch.lastOutputDir = raw.lastOutputDir
      if (typeof raw.playlistConcurrency === 'number') {
        patch.playlistConcurrency = raw.playlistConcurrency
      }
      if (typeof raw.notifyOnComplete === 'boolean') {
        patch.notifyOnComplete = raw.notifyOnComplete
      }
      if (raw.queueSnapshot === null) {
        patch.queueSnapshot = null
      } else if (raw.queueSnapshot && typeof raw.queueSnapshot === 'object') {
        patch.queueSnapshot = raw.queueSnapshot as MfSettingsView['queueSnapshot']
      }
    }
    return deps.setSettings(patch)
  })
  ipcMain.handle(MF_SETTINGS_MARK_FIRST_RUN, () => deps.markFirstRunSeen())

  ipcMain.handle(MF_PARTIALS_LIST, () => deps.listPartials())
  ipcMain.handle(MF_PARTIALS_OPEN, async (_event, payload: unknown) => {
    const path = typeof payload === 'string' ? payload : null
    if (!path) return { ok: false }
    return deps.openPartialDir(path)
  })
  ipcMain.handle(MF_PARTIALS_CLEAR, (_event, payload: unknown) => {
    if (payload === undefined || payload === null || payload === '') {
      return deps.clearPartials()
    }
    if (typeof payload !== 'string') return { ok: false, cleared: 0, failed: 1 }
    return deps.clearPartials(payload)
  })
  ipcMain.handle(MF_REVEAL_PATH, async (_event, payload: unknown) => {
    const path = typeof payload === 'string' ? payload : null
    if (!path) return { ok: false }
    return deps.revealPath(path)
  })
  ipcMain.handle(MF_OPEN_FILE, async (_event, payload: unknown) => {
    const path = typeof payload === 'string' ? payload : null
    if (!path) return { ok: false }
    return deps.openFile(path)
  })

  ipcMain.handle(MF_UPDATER_CHECK, (_event, payload: unknown) =>
    deps.updaterCheck(readUpdaterKind(payload)),
  )
  ipcMain.handle(MF_UPDATER_APPLY, (_event, payload: unknown) =>
    deps.updaterApply(readUpdaterKind(payload)),
  )

  ipcMain.handle(MF_APP_VERSION, () => ({ version: deps.getAppVersion() }))
  ipcMain.handle(MF_APP_UPDATE_CHECK, () => deps.checkAppUpdate())
  ipcMain.handle(MF_APP_UPDATE_OPEN_RELEASE, () => deps.openAppReleasePage())
  ipcMain.handle(MF_APP_UPDATE_DOWNLOAD_INSTALL, () => deps.downloadAndInstallAppUpdate())

  ipcMain.handle(MF_SEARCH_START, async (_event, payload: unknown): Promise<SearchResponse> => {
    const req = parseSearchRequest(payload)
    if (!req) {
      return { kind: 'error', code: 'MF_INVALID_QUERY', message: ERROR_MESSAGES.MF_INVALID_QUERY }
    }
    try {
      return await deps.search(req.platform, req.query, req.limit, req.sort)
    } catch (error) {
      const code = error instanceof MfError ? error.code : 'MF_UNKNOWN'
      logger?.warn('search failed', { code })
      return { kind: 'error', code, message: ERROR_MESSAGES[code] }
    }
  })
  ipcMain.handle(MF_SEARCH_CANCEL, () => deps.cancelSearch())
}

function parseSearchRequest(
  payload: unknown,
): { platform: string; query: string; limit: number; sort: SearchSort } | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>

  if (typeof raw.platform !== 'string' || !SEARCH_PLATFORMS.some((p) => p.id === raw.platform)) {
    return null
  }
  if (typeof raw.query !== 'string') return null
  const query = raw.query.trim()
  if (query.length === 0 || query.length > MAX_SEARCH_QUERY_LENGTH) return null

  let limit = 20
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) return null
    limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(raw.limit)))
  }

  const sort: SearchSort = raw.sort === 'newest' ? 'newest' : 'relevance'

  return { platform: raw.platform, query, limit, sort }
}

function extractUrl(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  const url = payload.trim()
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return null
  if (!/^https?:\/\//i.test(url)) return null
  return url
}

function readUpdaterKind(payload: unknown): UpdaterDriverKind {
  return payload === 'ffmpeg' ? 'ffmpeg' : 'yt-dlp'
}

const FORMAT_ID_PATTERN = /^[\w.-]{1,64}$/

function parseJobConfig(payload: unknown): JobConfig | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>

  const url = extractUrl(raw.url)
  if (!url) return null

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

  let estimatedBytes: number | undefined
  if (raw.estimatedBytes !== undefined) {
    if (typeof raw.estimatedBytes !== 'number' || !Number.isFinite(raw.estimatedBytes)) return null
    if (raw.estimatedBytes < 0 || raw.estimatedBytes > 1e13) return null
    estimatedBytes = raw.estimatedBytes
  }

  let playlistTitle: string | undefined
  if (raw.playlistTitle !== undefined) {
    if (
      typeof raw.playlistTitle !== 'string' ||
      raw.playlistTitle.length === 0 ||
      raw.playlistTitle.length > 300
    ) {
      return null
    }
    playlistTitle = raw.playlistTitle
  }

  switch (raw.mode) {
    case 'video-audio':
      return {
        url,
        mode: 'video-audio',
        tier,
        container,
        destDir: raw.destDir,
        estimatedBytes,
        playlistTitle,
      }

    case 'audio-only': {
      const format = raw.audioFormat
      if (typeof format !== 'string') return null
      const isLossy = LOSSY_AUDIO_FORMATS.includes(format as never)
      const isLossless = LOSSLESS_AUDIO_FORMATS.includes(format as never)
      if (!isLossy && !isLossless) return null

      let bitrate: BitrateTier | undefined
      if (raw.bitrate !== undefined) {
        if (typeof raw.bitrate !== 'string' || !BITRATE_TIERS.includes(raw.bitrate as never))
          return null
        if (isLossless) return null
        bitrate = raw.bitrate as BitrateTier
      }
      return {
        url,
        mode: 'audio-only',
        audioFormat: format as AudioFormat,
        bitrate,
        destDir: raw.destDir,
        estimatedBytes,
        playlistTitle,
      }
    }

    case 'advanced': {
      const videoFormatId = raw.videoFormatId
      const audioFormatId = raw.audioFormatId
      if (
        typeof videoFormatId !== 'string' ||
        typeof audioFormatId !== 'string' ||
        !FORMAT_ID_PATTERN.test(videoFormatId) ||
        !FORMAT_ID_PATTERN.test(audioFormatId)
      ) {
        return null
      }
      return {
        url,
        mode: 'advanced',
        container,
        videoFormatId,
        audioFormatId,
        destDir: raw.destDir,
        estimatedBytes,
        playlistTitle,
      }
    }

    default:
      return null
  }
}
