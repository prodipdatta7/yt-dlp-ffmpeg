import { contextBridge, ipcRenderer } from 'electron'
import {
  MF_BINARIES_INFO,
  MF_PING,
  type BinariesInfoResult,
  type MfApi,
  type PingResult,
} from '../shared/ipcContract'

const api: MfApi = {
  ping: (): Promise<PingResult> => ipcRenderer.invoke(MF_PING),
  getBinariesInfo: (): Promise<BinariesInfoResult> => ipcRenderer.invoke(MF_BINARIES_INFO),
}

contextBridge.exposeInMainWorld('mf', api)
