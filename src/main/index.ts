import { existsSync, copyFileSync, rmSync, appendFileSync, writeFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  Tray,
  nativeTheme,
  shell,
  nativeImage,
  Notification,
  session,
} from 'electron'
import { BinariesService } from './binaries/service'
import { platformDir, type BinaryCandidate } from './binaries/locator'
import { registerIpcHandlers } from './ipc/handlers'
import { AnalyzeService, MfError } from './media/metadata'
import { SearchService } from './media/search'
import { DownloadOrchestrator } from './jobs/orchestrator'
import type {
  AnalyzeResponse,
  DownloadStartResponse,
  JobConfig,
  JobDonePayload,
  JobEvent,
  MfSettingsView,
  SearchResponse,
} from '../shared/ipcContract'
import type { SearchFilterCriteria, SearchSort } from '../shared/models'
import {
  MF_LOG_LINE,
  MF_UPDATER_PHASE,
  MF_APP_UPDATE_PHASE,
  MF_SEARCH_ENTRY,
  type SearchHydratePayload,
} from '../shared/ipcContract'
import { LogBus } from './logs/logBus'
import { ERROR_MESSAGES } from '../shared/models'
import { createLogger, type Logger } from './store/logger'
import { SettingsStore, clampPlaylistConcurrency } from './store/settingsStore'
import { MfLaunchError } from './jobs/orchestrator'
import { sweepOrphanedTempDirs } from './fsops/tempSweep'
import { platformDir as platformDirName } from './binaries/locator'
import { YtDlpUpdater } from './binaries/updater'
import { FfmpegUpdater } from './binaries/ffmpegUpdater'
import { appReleasesUrl, checkAppUpdate, downloadAndInstallAppUpdate } from './app/appUpdater'
import type { AppUpdatePhase, UpdaterDriverKind, UpdaterPhase } from '../shared/models'
import {
  clearAllPartialDirs,
  clearPartialDir,
  isUnderAnyRoot,
  listPartialDirs,
  STAGING_DIR_NAME,
} from './fsops/partials'
import { sanitizeFileName } from './fsops/sanitizer'
import { dirname } from 'node:path'
import { chromeThemeColors, createWindowOptions, getWindowSecurityFlags } from './windowOptions'
import { EMBED_REQUEST_FILTER, patchEmbedHeaders } from './embedHeaders'

function toSettingsView(s: ReturnType<SettingsStore['load']>): MfSettingsView {
  return {
    lastOutputDir: s.lastOutputDir,
    cookieFileSet: s.cookieFileSet === true,
    firstRunNoticeSeen: s.firstRunNoticeSeen === true,
    theme: s.theme ?? 'system',
    playlistConcurrency: clampPlaylistConcurrency(s.playlistConcurrency),
    notifyOnComplete: s.notifyOnComplete !== false,
    queueSnapshot: s.queueSnapshot ?? null,
  }
}

function binaryCandidates(logger: Logger): BinaryCandidate[] {
  const dirName = platformDir(process.platform, process.arch)
  const candidates: BinaryCandidate[] = []

  const envDir = process.env.MEDIAFORGE_BIN_DIR
  if (envDir) candidates.push({ dir: join(envDir, dirName), source: 'override' })

  candidates.push({ dir: join(app.getPath('userData'), 'binaries', dirName), source: 'userData' })

  if (app.isPackaged) {
    candidates.push({ dir: join(process.resourcesPath, 'binaries', dirName), source: 'bundled' })
  } else {
    candidates.push({ dir: join(__dirname, '..', '..', 'binaries', dirName), source: 'bundled' })
  }

  logger.debug('binary candidate dirs resolved', { count: candidates.length })
  return candidates
}

function createMainWindow(theme: 'light' | 'dark'): BrowserWindow {
  const win = new BrowserWindow({
    ...createWindowOptions(theme),
    webPreferences: {
      ...getWindowSecurityFlags(),
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let forceClose = false

async function ensureTray(win: BrowserWindow): Promise<void> {
  if (tray) return
  const icon = await app
    .getFileIcon(app.getPath('exe'), { size: 'small' })
    .catch(() => nativeImage.createEmpty())
  tray = new Tray(icon)
  tray.setToolTip('MediaForge Desktop — download running in background')
  const show = (): void => {
    win.show()
    disposeTray()
  }
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show MediaForge', click: show }]))
  tray.on('click', show)
}

function disposeTray(): void {
  tray?.destroy()
  tray = null
}

function resolvedTheme(pref: string | undefined): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function applyChromeTheme(theme: 'light' | 'dark'): void {
  const { color, symbolColor } = chromeThemeColors(theme)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.setTitleBarOverlay({ color, symbolColor })
    } catch {
      /* overlay unsupported off-Windows */
    }
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    EMBED_REQUEST_FILTER,
    (details, callback) => {
      callback({ cancel: false, requestHeaders: patchEmbedHeaders(details.requestHeaders) })
    },
  )

  const userDataDir = app.getPath('userData')
  const logsDir = join(userDataDir, 'logs')
  const tempRoot = join(userDataDir, 'tmp')
  const cookiesFile = join(userDataDir, 'cookies.txt')

  const logger = createLogger({ dir: logsDir })
  logger.info(`app starting v${app.getVersion()}`, { packaged: app.isPackaged })

  const settings = new SettingsStore(join(userDataDir, 'settings.json'))

  /**
   * Every root a partial job dir can live under: the userData staging area, plus the
   * in-destination staging dir used when the output folder is on another volume (R-03).
   * Resolved at call time — the output folder can change while the app runs.
   */
  const stagingRoots = (): string[] => {
    const outputDir = settings.load().lastOutputDir || app.getPath('downloads')
    return [...new Set([tempRoot, join(outputDir, STAGING_DIR_NAME)])]
  }

  const binariesService = new BinariesService({
    platform: process.platform,
    arch: process.arch,
    candidates: binaryCandidates(logger),
    logger,
  })

  const resolveCookiesPath = (): string | null => (existsSync(cookiesFile) ? cookiesFile : null)

  const logBus = new LogBus()
  logBus.subscribe((entry) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(MF_LOG_LINE, entry)
    }
  })
  const tapProcessLines = logBus.tap('yt-dlp')

  const analyzeService = new AnalyzeService({
    resolveYtDlp: () => binariesService.locate('yt-dlp'),
    logger,
    getCookiesPath: resolveCookiesPath,
    onProcessLine: tapProcessLines,
  })

  const sendSearchEntry = (payload: SearchHydratePayload): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(MF_SEARCH_ENTRY, payload)
    }
  }

  const searchService = new SearchService({
    resolveYtDlp: () => binariesService.locate('yt-dlp'),
    logger,
    getCookiesPath: resolveCookiesPath,
    onProcessLine: tapProcessLines,
    onEntryHydrated: sendSearchEntry,
  })

  const orchestrator = new DownloadOrchestrator({
    resolveYtDlp: () => binariesService.locate('yt-dlp'),
    resolveFfmpeg: () => binariesService.locate('ffmpeg'),
    tempRoot,
    logger,
    getCookiesPath: resolveCookiesPath,
    onProcessLine: tapProcessLines,
    getMaxConcurrent: () => clampPlaylistConcurrency(settings.load().playlistConcurrency),
  })

  const overrideDir = join(userDataDir, 'binaries', platformDirName(process.platform, process.arch))
  const sendUpdaterPhase = (
    kind: UpdaterDriverKind,
    phase: UpdaterPhase,
    detail?: string,
  ): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(MF_UPDATER_PHASE, { kind, phase, detail })
    }
  }
  const updater = new YtDlpUpdater({
    overrideDir,
    getCurrentVersion: async () => (await binariesService.getInfo()).ytdlp.version,
    logger,
    onPhase: (phase, detail) => sendUpdaterPhase('yt-dlp', phase, detail),
  })
  const ffmpegUpdater = new FfmpegUpdater({
    overrideDir,
    getCurrentVersion: async () => (await binariesService.getInfo()).ffmpeg.version,
    logger,
    onPhase: (phase, detail) => sendUpdaterPhase('ffmpeg', phase, detail),
  })
  const sendAppUpdatePhase = (phase: AppUpdatePhase): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(MF_APP_UPDATE_PHASE, { phase })
    }
  }

  if (process.env.MF_MEMORY_PROBE === '1') {
    const probePath = join(logsDir, 'mem.jsonl')
    if (!existsSync(probePath)) {
      try {
        writeFileSync(probePath, `${JSON.stringify({ note: 'AM-10 probe', unit: 'MB' })}\n`)
      } catch {
        /* best-effort */
      }
    }
    setInterval(() => {
      try {
        const byType: Record<string, number> = {}
        let electronSum = 0
        for (const metric of app.getAppMetrics()) {
          const mb = (metric.memory?.workingSetSize ?? 0) / 1024
          electronSum += mb
          const type = String(metric.type ?? 'unknown')
          byType[type] = Math.round(((byType[type] ?? 0) + mb) * 10) / 10
        }
        appendFileSync(
          probePath,
          `${JSON.stringify({
            t: new Date().toISOString(),
            mainRssMB: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
            electronSumMB: Math.round(electronSum * 10) / 10,
            byType,
            busy: orchestrator.isBusy(),
          })}\n`,
        )
      } catch {
        /* best-effort */
      }
    }, 2000).unref()
    logger.info('memory probe enabled', { file: 'logs/mem.jsonl' })
  }

  registerIpcHandlers(
    {
      getBinariesInfo: () => binariesService.getInfo(),
      analyze: async (url, sendEntry): Promise<AnalyzeResponse> => {
        try {
          return { kind: 'ok', result: await analyzeService.analyze(url, sendEntry) }
        } catch (error) {
          const code = error instanceof MfError ? error.code : 'MF_UNKNOWN'
          return { kind: 'error', code, message: ERROR_MESSAGES[code] }
        }
      },
      cancelAnalyze: async () => {
        await analyzeService.cancel()
        return { ok: true }
      },
      hydrateAnalyzeRange: async (fromIndex, count, sendEntry) => {
        await analyzeService.hydrateRange(fromIndex, count, sendEntry)
        return { ok: true }
      },
      startDownload: async (
        config: JobConfig,
        sendEvent: (event: JobEvent) => void,
        sendDone: (done: JobDonePayload) => void,
      ): Promise<DownloadStartResponse> => {
        try {
          const notifyDone = (done: JobDonePayload): void => {
            sendDone(done)
            const s = settings.load()
            if (s.notifyOnComplete === false) return
            const focused = BrowserWindow.getAllWindows().some(
              (w) => !w.isDestroyed() && w.isFocused(),
            )
            if (focused) return
            if (!Notification.isSupported()) return
            const title =
              done.status === 'completed'
                ? 'Download complete'
                : done.status === 'failed'
                  ? 'Download failed'
                  : 'Download cancelled'
            const body =
              done.status === 'completed' && done.outputPath
                ? done.outputPath
                : done.status === 'failed'
                  ? done.errorCode
                    ? ERROR_MESSAGES[done.errorCode]
                    : 'Something went wrong.'
                  : 'Partial files were kept.'
            try {
              new Notification({ title, body }).show()
            } catch {
              /* best-effort */
            }
          }
          const jobId = await orchestrator.launch(config, sendEvent, notifyDone)
          return { kind: 'ok', jobId }
        } catch (error) {
          if (error instanceof MfLaunchError && error.code) {
            return { kind: 'error', code: error.code, message: ERROR_MESSAGES[error.code] }
          }
          return {
            kind: 'error',
            code: 'MF_UNKNOWN',
            message: error instanceof Error ? error.message : ERROR_MESSAGES.MF_UNKNOWN,
          }
        }
      },
      cancelDownload: (jobId: string) => ({ ok: orchestrator.cancel(jobId || undefined) }),
      getDefaultDestDir: () => settings.load().lastOutputDir || app.getPath('downloads'),
      getClipboardUrl: async () => {
        const text = (clipboard.readText() ?? '').trim()
        return /^https?:\/\/\S+$/i.test(text) ? text : null
      },
      chooseDirectory: async () => {
        const current = settings.load()
        const result = await dialog.showOpenDialog({
          title: 'Choose download destination',
          defaultPath: current.lastOutputDir || app.getPath('downloads'),
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) return null
        const chosen = result.filePaths[0]
        settings.save({ ...settings.load(), lastOutputDir: chosen })
        logger.info('destination folder chosen', { dirSet: true })
        return chosen
      },
      importCookies: async () => {
        const result = await dialog.showOpenDialog({
          title: 'Import cookies.txt (Netscape format)',
          filters: [{ name: 'cookies.txt', extensions: ['txt'] }],
          properties: ['openFile'],
        })
        if (result.canceled || result.filePaths.length === 0) return false
        try {
          copyFileSync(result.filePaths[0], cookiesFile)
          settings.save({ ...settings.load(), cookieFileSet: true })
          logger.info('cookies file imported')
          return true
        } catch {
          return false
        }
      },
      clearCookies: () => {
        try {
          rmSync(cookiesFile, { force: true })
          settings.save({ ...settings.load(), cookieFileSet: false })
          logger.info('cookies cleared')
          return true
        } catch {
          return false
        }
      },
      openLogsFolder: async () => {
        const result = await shell.openPath(logsDir)
        return result.length === 0
      },
      logHistory: () => ({ lines: logBus.tail(1000) }),
      logConsoleOpen: (open, includeProtocol) => {
        logBus.setBroadcast(open, includeProtocol)
        return { ok: true }
      },
      logClear: () => {
        logBus.clear()
        logger.info('live console cleared by user')
        return { ok: true }
      },
      getSettings: () => toSettingsView(settings.load()),
      setSettings: (patch) => {
        const current = settings.load()
        const next = { ...current }
        if (patch.theme) next.theme = patch.theme
        if (typeof patch.lastOutputDir === 'string') next.lastOutputDir = patch.lastOutputDir
        if (typeof patch.playlistConcurrency === 'number') {
          next.playlistConcurrency = clampPlaylistConcurrency(patch.playlistConcurrency)
        }
        if (typeof patch.notifyOnComplete === 'boolean') {
          next.notifyOnComplete = patch.notifyOnComplete
        }
        if (patch.queueSnapshot !== undefined) {
          next.queueSnapshot = patch.queueSnapshot
        }
        settings.save(next)
        applyChromeTheme(resolvedTheme(next.theme))
        logger.info('settings updated', { keys: Object.keys(patch) })
        return toSettingsView(next)
      },
      markFirstRunSeen: () => {
        settings.save({ ...settings.load(), firstRunNoticeSeen: true })
        return true
      },
      listPartials: async () => ({
        tempRoot,
        items: await listPartialDirs(stagingRoots()),
      }),
      openPartialDir: async (dirPath: string) => {
        if (!isUnderAnyRoot(stagingRoots(), dirPath)) return { ok: false }
        if (
          !(await fsp
            .stat(dirPath)
            .then(() => true)
            .catch(() => false))
        )
          return { ok: false }
        const result = await shell.openPath(dirPath)
        return { ok: result.length === 0 }
      },
      clearPartials: async (dirPath?: string) => {
        const roots = stagingRoots()
        if (dirPath) {
          const ok = await clearPartialDir(roots, dirPath)
          if (ok) logger.info('partial dir cleared', { pathSet: true })
          return { ok, cleared: ok ? 1 : 0, failed: ok ? 0 : 1 }
        }
        const result = await clearAllPartialDirs(roots)
        logger.info('all partial dirs cleared', result)
        return { ok: result.failed === 0, ...result }
      },
      revealPath: async (targetPath: string) => {
        if (!existsSync(targetPath)) return { ok: false }
        try {
          shell.showItemInFolder(targetPath)
          return { ok: true }
        } catch {
          const folder = dirname(targetPath)
          const result = await shell.openPath(folder)
          return { ok: result.length === 0 }
        }
      },
      openFile: async (targetPath: string) => {
        if (!existsSync(targetPath)) return { ok: false }
        const result = await shell.openPath(targetPath)
        return { ok: result.length === 0 }
      },
      updaterCheck: (kind: UpdaterDriverKind) =>
        kind === 'ffmpeg' ? ffmpegUpdater.check() : updater.check(),
      updaterApply: async (kind: UpdaterDriverKind) => {
        const result = kind === 'ffmpeg' ? await ffmpegUpdater.apply() : await updater.apply()
        if (result.ok) binariesService.invalidate()
        return result
      },
      getAppVersion: () => app.getVersion(),
      checkAppUpdate: () => checkAppUpdate(app.getVersion()),
      openAppReleasePage: async () => {
        try {
          await shell.openExternal(appReleasesUrl())
          return { ok: true }
        } catch {
          return { ok: false }
        }
      },
      downloadAndInstallAppUpdate: async () => {
        if (orchestrator.isBusy()) {
          return {
            ok: false,
            error: 'A download is in progress — cancel or wait for it to finish, then try again.',
          }
        }
        const result = await downloadAndInstallAppUpdate({
          currentVersion: app.getVersion(),
          updatesDir: join(app.getPath('userData'), 'updates'),
          logger,
          onPhase: (phase: AppUpdatePhase) => sendAppUpdatePhase(phase),
        })
        if (result.ok) {
          forceClose = true
          setTimeout(() => app.quit(), 800)
        }
        return result
      },
      search: async (
        platform: string,
        query: string,
        limit: number,
        sort: SearchSort,
        filters?: SearchFilterCriteria,
      ): Promise<SearchResponse> => {
        try {
          const results = await searchService.search(platform, query, limit, sort, filters)
          return { kind: 'ok', results }
        } catch (error) {
          const code = error instanceof MfError ? error.code : 'MF_UNKNOWN'
          return { kind: 'error', code, message: ERROR_MESSAGES[code] }
        }
      },
      cancelSearch: async () => {
        await searchService.cancel()
        return { ok: true }
      },
      cancelPreview: async (requestId: string) => {
        await searchService.cancelPreviewRequest(requestId)
        return { ok: true }
      },
      fetchChapters: async (url: string, requestId?: string) => {
        const binary = await binariesService.locate('yt-dlp')
        if (!binary) return { chapters: [] }
        return await searchService.fetchChapters(binary.path, url, requestId)
      },
      fetchTranscript: async (url: string, requestId?: string) => {
        const binary = await binariesService.locate('yt-dlp')
        if (!binary) return { cues: [] }
        return await searchService.fetchTranscript(binary.path, url, requestId)
      },
      saveTextFile: async (defaultFilename: string, content: string) => {
        const safeName = sanitizeFileName(defaultFilename)
        const current = settings.load()
        const defaultPath = join(current.lastOutputDir || app.getPath('downloads'), safeName)
        const opts = {
          title: 'Save Transcript',
          defaultPath,
          filters: [
            { name: 'Text Document (*.txt)', extensions: ['txt'] },
            { name: 'All Files (*.*)', extensions: ['*'] },
          ],
        }
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, opts)
          : await dialog.showSaveDialog(opts)
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true }
        }
        try {
          writeFileSync(result.filePath, content, 'utf8')
          logger.info('transcript text file saved', { path: result.filePath })
          return { ok: true, filePath: result.filePath }
        } catch (err) {
          logger.error('failed to write transcript text file', { error: String(err) })
          return { ok: false }
        }
      },
    },
    logger,
  )

  mainWindow = createMainWindow(resolvedTheme(settings.load().theme))

  // Off the critical path: sweeping stale job dirs used to run before the window existed,
  // so it landed directly on cold-start time. The window never waits on it (P-02).
  mainWindow.once('ready-to-show', () => {
    void sweepOrphanedTempDirs(stagingRoots())
      .then((count) => {
        if (count > 0) logger.info('orphaned temp dirs swept', { count })
      })
      .catch((error) => logger.debug('temp sweep failed', { error: String(error) }))
  })

  nativeTheme.on('updated', () => {
    applyChromeTheme(resolvedTheme(settings.load().theme))
  })

  mainWindow.on('close', (event) => {
    if (forceClose || !orchestrator.isBusy()) return
    event.preventDefault()
    void dialog
      .showMessageBox(mainWindow!, {
        type: 'warning',
        title: 'Download in progress',
        message: 'A download is still running.',
        detail: 'Closing now will abort your active download.',
        buttons: ['Run in Background', 'Cancel Download & Exit', 'Stay'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          mainWindow?.hide()
          void ensureTray(mainWindow!)
        } else if (response === 1) {
          orchestrator.cancel()
          forceClose = true
          mainWindow?.close()
          app.quit()
        }
      })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createMainWindow(resolvedTheme(settings.load().theme))
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
