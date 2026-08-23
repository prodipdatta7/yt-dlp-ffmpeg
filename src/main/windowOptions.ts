import type { BrowserWindowConstructorOptions } from 'electron'

export interface WindowSecurityFlags {
  contextIsolation: boolean
  nodeIntegration: boolean
  sandbox: boolean
  webSecurity: boolean
}

const SECURITY_FLAGS: Readonly<WindowSecurityFlags> = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
}

export function getWindowSecurityFlags(): WindowSecurityFlags {
  return { ...SECURITY_FLAGS }
}

export function createWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 764,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'MediaForge Desktop',
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#05070d',
      symbolColor: '#94a3b8',
      height: 46,
    },
    webPreferences: { ...SECURITY_FLAGS },
  }
}
