import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { BinariesService } from './binaries/service'
import { platformDir, type BinaryCandidate } from './binaries/locator'
import { registerIpcHandlers } from './ipc/handlers'
import { createLogger, type Logger } from './store/logger'
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

  const binariesService = new BinariesService({
    platform: process.platform,
    arch: process.arch,
    candidates: binaryCandidates(logger),
    logger,
  })

  registerIpcHandlers({ getBinariesInfo: () => binariesService.getInfo() })
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
