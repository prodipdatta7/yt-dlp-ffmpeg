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
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MediaForge Desktop',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: { ...SECURITY_FLAGS },
  }
}
