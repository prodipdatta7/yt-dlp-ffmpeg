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

export function createWindowOptions(
  theme: 'light' | 'dark' = 'dark',
): BrowserWindowConstructorOptions {
  const dark = theme === 'dark'
  return {
    width: 1180,
    height: 764,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'MediaForge Desktop',
    backgroundColor: dark ? '#04060b' : '#eef2f7',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#05070d' : '#eef2f7',
      symbolColor: dark ? '#94a3b8' : '#475569',
      height: 46,
    },
    webPreferences: { ...SECURITY_FLAGS },
  }
}
