import { contextBridge, ipcRenderer } from 'electron'
import {
  MF_ANALYZE_CANCEL,
  MF_ANALYZE_START,
  MF_BINARIES_INFO,
  MF_PING,
  type AnalyzeResponse,
  type BinariesInfoResult,
  type MfApi,
  type PingResult,
} from '../shared/ipcContract'

const api: MfApi = {
  ping: (): Promise<PingResult> => ipcRenderer.invoke(MF_PING),
  getBinariesInfo: (): Promise<BinariesInfoResult> => ipcRenderer.invoke(MF_BINARIES_INFO),
  analyzeStart: (url: string): Promise<AnalyzeResponse> =>
    ipcRenderer.invoke(MF_ANALYZE_START, url),
  analyzeCancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(MF_ANALYZE_CANCEL),
}

contextBridge.exposeInMainWorld('mf', api)
