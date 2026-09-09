import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
  MF_LOG_LINE,
  MF_PING,
  MF_PARTIALS_CLEAR,
  MF_PARTIALS_LIST,
  MF_PARTIALS_OPEN,
  MF_REVEAL_PATH,
  MF_OPEN_FILE,
  MF_SEARCH_CANCEL,
  MF_SEARCH_START,
  MF_SETTINGS_CLEAR_COOKIES,
  MF_SETTINGS_GET,
  MF_SETTINGS_IMPORT_COOKIES,
  MF_SETTINGS_MARK_FIRST_RUN,
  MF_SETTINGS_SET,
  MF_UPDATER_APPLY,
  MF_UPDATER_CHECK,
  MF_UPDATER_PHASE,
  type AnalyzeResponse,
  type AnalyzeStreamEvent,
  type BinariesInfoResult,
  type DownloadStartResponse,
  type JobConfig,
  type JobDonePayload,
  type JobEvent,
  type LogEntryPayload,
  type MfApi,
  type MfSettingsView,
  type PartialsClearResult,
  type PartialsListResult,
  type PingResult,
  type SearchRequest,
  type SearchResponse,
  type UpdaterApplyResult,
  type UpdaterCheckResult,
  type UpdaterPhaseEvent,
} from '../shared/ipcContract'
import type { UpdaterDriverKind } from '../shared/models'

const api: MfApi = {
  ping: (): Promise<PingResult> => ipcRenderer.invoke(MF_PING),
  getBinariesInfo: (): Promise<BinariesInfoResult> => ipcRenderer.invoke(MF_BINARIES_INFO),
  analyzeStart: (url: string): Promise<AnalyzeResponse> =>
    ipcRenderer.invoke(MF_ANALYZE_START, url),
  analyzeCancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(MF_ANALYZE_CANCEL),
  onAnalyzeEntry: (listener: (event: AnalyzeStreamEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AnalyzeStreamEvent): void =>
      listener(payload)
    ipcRenderer.on(MF_ANALYZE_ENTRY, wrapped)
    return () => ipcRenderer.removeListener(MF_ANALYZE_ENTRY, wrapped)
  },
  downloadStart: (config: JobConfig): Promise<DownloadStartResponse> =>
    ipcRenderer.invoke(MF_DOWNLOAD_START, config),
  downloadCancel: (jobId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(MF_DOWNLOAD_CANCEL, jobId),
  onJobEvent: (listener: (event: JobEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: JobEvent): void => listener(payload)
    ipcRenderer.on(MF_JOB_EVENT, wrapped)
    return () => ipcRenderer.removeListener(MF_JOB_EVENT, wrapped)
  },
  onJobDone: (listener: (done: JobDonePayload) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: JobDonePayload): void => listener(payload)
    ipcRenderer.on(MF_JOB_DONE, wrapped)
    return () => ipcRenderer.removeListener(MF_JOB_DONE, wrapped)
  },
  getDefaultDestDir: (): Promise<string> => ipcRenderer.invoke(MF_DEFAULT_DEST_DIR),
  getClipboardUrl: (): Promise<string | null> => ipcRenderer.invoke(MF_CLIPBOARD_URL),
  chooseDestDir: (): Promise<string | null> => ipcRenderer.invoke(MF_DIALOG_CHOOSE_DIR),
  importCookies: (): Promise<boolean> => ipcRenderer.invoke(MF_SETTINGS_IMPORT_COOKIES),
  clearCookies: (): Promise<boolean> => ipcRenderer.invoke(MF_SETTINGS_CLEAR_COOKIES),
  openLogsFolder: (): Promise<boolean> => ipcRenderer.invoke(MF_LOGS_OPEN),
  logHistory: (): Promise<{ lines: LogEntryPayload[] }> => ipcRenderer.invoke(MF_LOG_HISTORY),
  logClear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(MF_LOG_CLEAR),
  onLogLine: (listener: (entry: LogEntryPayload) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: LogEntryPayload): void => listener(payload)
    ipcRenderer.on(MF_LOG_LINE, wrapped)
    return () => ipcRenderer.removeListener(MF_LOG_LINE, wrapped)
  },
  getSettings: (): Promise<MfSettingsView> => ipcRenderer.invoke(MF_SETTINGS_GET),
  setSettings: (
    patch: Partial<
      Pick<
        MfSettingsView,
        'theme' | 'lastOutputDir' | 'playlistConcurrency' | 'notifyOnComplete' | 'queueSnapshot'
      >
    >,
  ): Promise<MfSettingsView> => ipcRenderer.invoke(MF_SETTINGS_SET, patch),
  markFirstRunSeen: (): Promise<boolean> => ipcRenderer.invoke(MF_SETTINGS_MARK_FIRST_RUN),
  listPartials: (): Promise<PartialsListResult> => ipcRenderer.invoke(MF_PARTIALS_LIST),
  openPartialDir: (path: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(MF_PARTIALS_OPEN, path),
  clearPartials: (path?: string): Promise<PartialsClearResult> =>
    ipcRenderer.invoke(MF_PARTIALS_CLEAR, path),
  revealPath: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(MF_REVEAL_PATH, path),
  openFile: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(MF_OPEN_FILE, path),
  updaterCheck: (kind: UpdaterDriverKind): Promise<UpdaterCheckResult> =>
    ipcRenderer.invoke(MF_UPDATER_CHECK, kind),
  updaterApply: (kind: UpdaterDriverKind): Promise<UpdaterApplyResult> =>
    ipcRenderer.invoke(MF_UPDATER_APPLY, kind),
  onUpdaterPhase: (listener: (event: UpdaterPhaseEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: UpdaterPhaseEvent): void =>
      listener(payload)
    ipcRenderer.on(MF_UPDATER_PHASE, wrapped)
    return () => ipcRenderer.removeListener(MF_UPDATER_PHASE, wrapped)
  },
  searchStart: (req: SearchRequest): Promise<SearchResponse> =>
    ipcRenderer.invoke(MF_SEARCH_START, req),
  searchCancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(MF_SEARCH_CANCEL),
}

contextBridge.exposeInMainWorld('mf', api)
