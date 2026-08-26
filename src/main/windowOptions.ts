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

/**
 * Chrome palette for the native window chrome (title bar overlay + pre-paint
 * background). These MUST match the renderer's title bar background
 * (`bg-ink-950` = --color-ink-950 in `renderer/src/styles/global.css`) or the
 * OS-drawn window controls in the top-right sit on a different colour than the
 * rest of the title bar (visible colour seam). Keep in sync with that CSS token.
 */
export interface ChromeThemeColors {
  backgroundColor: string
  color: string
  symbolColor: string
}

export function chromeThemeColors(theme: 'light' | 'dark'): ChromeThemeColors {
  return theme === 'dark'
    ? { backgroundColor: '#14100c', color: '#14100c', symbolColor: '#94a3b8' }
    : { backgroundColor: '#f1e9db', color: '#f1e9db', symbolColor: '#475569' }
}

export function createWindowOptions(
  theme: 'light' | 'dark' = 'dark',
): BrowserWindowConstructorOptions {
  const chrome = chromeThemeColors(theme)
  return {
    width: 1180,
    height: 764,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'MediaForge Desktop',
    backgroundColor: chrome.backgroundColor,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: chrome.color,
      symbolColor: chrome.symbolColor,
      height: 46,
    },
    webPreferences: { ...SECURITY_FLAGS },
  }
}
