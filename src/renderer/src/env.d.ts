import type { MfApi } from '../../shared/ipcContract'

declare global {
  interface Window {
    mf: MfApi
  }
}

export {}
