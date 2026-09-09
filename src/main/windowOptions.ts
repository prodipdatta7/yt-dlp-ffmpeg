import type { BrowserWindowConstructorOptions } from 'electron'
import { THEME_CHROME } from '../shared/themeChrome'

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
 * background). Values come from `THEME_CHROME` so they cannot drift from the
 * renderer's `--color-ink-950` without a test failure.
 */
export interface ChromeThemeColors {
  backgroundColor: string
  color: string
  symbolColor: string
}

export function chromeThemeColors(theme: 'light' | 'dark'): ChromeThemeColors {
  const c = THEME_CHROME[theme]
  return {
    backgroundColor: c.ink950,
    color: c.ink950,
    symbolColor: c.symbolColor,
  }
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
