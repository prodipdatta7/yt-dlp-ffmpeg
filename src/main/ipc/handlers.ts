import { ipcMain } from 'electron'
import {
  MF_BINARIES_INFO,
  MF_PING,
  type BinariesInfoResult,
  type PingResult,
} from '../../shared/ipcContract'

export interface IpcDeps {
  getBinariesInfo: () => Promise<BinariesInfoResult>
}

export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle(MF_PING, (): PingResult => ({ pong: 'mediaforge', ts: Date.now() }))

  ipcMain.handle(MF_BINARIES_INFO, async (): Promise<BinariesInfoResult> => {
    return deps.getBinariesInfo()
  })
}
