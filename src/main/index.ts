import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
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
import { ERROR_MESSAGES } from '../shared/models'
import { createLogger, type Logger } from './store/logger'
import { SettingsStore } from './store/settingsStore'
import { MfLaunchError } from './jobs/orchestrator'
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

app.whenReady().then(() => {
  const logger = createLogger({ dir: join(app.getPath('userData'), 'logs') })
  logger.info(`app starting v${app.getVersion()}`, { packaged: app.isPackaged })

  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))

  const binariesService = new BinariesService({
    platform: process.platform,
    arch: process.arch,
    candidates: binaryCandidates(logger),
    logger,
  })

  const analyzeService = new AnalyzeService({
    resolveYtDlp: () => binariesService.locate('yt-dlp'),
    logger,
  })

  const orchestrator = new DownloadOrchestrator({
    resolveYtDlp: () => binariesService.locate('yt-dlp'),
    resolveFfmpeg: () => binariesService.locate('ffmpeg'),
    tempRoot: join(app.getPath('userData'), 'tmp'),
    logger,
  })

  registerIpcHandlers(
    {
      getBinariesInfo: () => binariesService.getInfo(),
      analyze: async (url): Promise<AnalyzeResponse> => {
        try {
          return { kind: 'ok', result: await analyzeService.analyze(url) }
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
    },
    logger,
  )
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
