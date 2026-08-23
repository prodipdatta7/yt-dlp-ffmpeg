import { existsSync, copyFileSync, rmSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, Tray, shell, nativeImage } from 'electron'
import { BinariesService } from './binaries/service'
import { platformDir, type BinaryCandidate } from './binaries/locator'
import { registerIpcHandlers } from './ipc/handlers'
import { AnalyzeService, MfError } from './media/metadata'
import { DownloadOrchestrator } from './jobs/orchestrator'
import type {
  AnalyzeResponse,
  DownloadStartResponse,
  JobConfig,
  JobDonePayload,
  JobEvent,
} from '../shared/ipcContract'
import { MF_LOG_LINE } from '../shared/ipcContract'
import { LogBus } from './logs/logBus'
import { ERROR_MESSAGES } from '../shared/models'
import { createLogger, type Logger } from './store/logger'
import { SettingsStore } from './store/settingsStore'
import { MfLaunchError } from './jobs/orchestrator'
import { sweepOrphanedTempDirs } from './fsops/tempSweep'
import { platformDir as platformDirName } from './binaries/locator'
import { YtDlpUpdater } from './binaries/updater'
import { createWindowOptions, getWindowSecurityFlags } from './windowOptions'

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

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...createWindowOptions(),
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

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData')
  const logsDir = join(userDataDir, 'logs')
  const tempRoot = join(userDataDir, 'tmp')
  const cookiesFile = join(userDataDir, 'cookies.txt')

  const logger = createLogger({ dir: logsDir })
  logger.info(`app starting v${app.getVersion()}`, { packaged: app.isPackaged })

  const settings = new SettingsStore(join(userDataDir, 'settings.json'))

  const swept = sweepOrphanedTempDirs(tempRoot)
  if (swept > 0) logger.info('orphaned temp dirs swept', { count: swept })

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

  const orchestrator = new DownloadOrchestrator({
    resolveYtDlp: () => binariesService.locate('yt-dlp'),
    resolveFfmpeg: () => binariesService.locate('ffmpeg'),
    tempRoot,
    logger,
    getCookiesPath: resolveCookiesPath,
    onProcessLine: tapProcessLines,
  })

  const overrideDir = join(userDataDir, 'binaries', platformDirName(process.platform, process.arch))
  const updater = new YtDlpUpdater({
    overrideDir,
    getCurrentVersion: async () => (await binariesService.getInfo()).ytdlp.version,
    logger,
  })

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
      cancelAnalyze: () => {
        analyzeService.cancel()
        return { ok: true }
      },
      startDownload: async (
        config: JobConfig,
        sendEvent: (event: JobEvent) => void,
        sendDone: (done: JobDonePayload) => void,
      ): Promise<DownloadStartResponse> => {
        try {
          const jobId = await orchestrator.launch(config, sendEvent, sendDone)
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
      chooseDirectory: async () => {
        const current = settings.load()
        const result = await dialog.showOpenDialog({
          title: 'Choose download destination',
          defaultPath: current.lastOutputDir || app.getPath('downloads'),
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) return null
        const chosen = result.filePaths[0]
        settings.save({ lastOutputDir: chosen })
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
      logClear: () => {
        logBus.clear()
        logger.info('live console cleared by user')
        return { ok: true }
      },
      getSettings: () => {
        const s = settings.load()
        return {
          lastOutputDir: s.lastOutputDir,
          cookieFileSet: s.cookieFileSet === true,
          firstRunNoticeSeen: s.firstRunNoticeSeen === true,
        }
      },
      markFirstRunSeen: () => {
        settings.save({ ...settings.load(), firstRunNoticeSeen: true })
        return true
      },
      updaterCheck: () => updater.check(),
      updaterApply: async () => {
        const result = await updater.apply()
        if (result.ok) binariesService.invalidate()
        return result
      },
    },
    logger,
  )

  mainWindow = createMainWindow()

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
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
