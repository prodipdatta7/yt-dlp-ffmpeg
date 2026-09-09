import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_CHROME } from '../../src/shared/themeChrome'
import { chromeThemeColors } from '../../src/main/windowOptions'

const CSS_PATH = resolve(__dirname, '../../src/renderer/src/styles/global.css')

function extractInk950(css: string, theme: 'light' | 'dark'): string | null {
  if (theme === 'light') {
    // First --color-ink-950 in the file lives in @theme / :root light defaults
    const match = css.match(/@theme\s*\{[\s\S]*?--color-ink-950:\s*(#[0-9a-fA-F]{3,8})\s*;/)
    return match?.[1]?.toLowerCase() ?? null
  }
  const darkBlock = css.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)
  if (!darkBlock) return null
  const match = darkBlock[1].match(/--color-ink-950:\s*(#[0-9a-fA-F]{3,8})\s*;/)
  return match?.[1]?.toLowerCase() ?? null
}

describe('THEME_CHROME sync', () => {
  it('windowOptions chrome uses THEME_CHROME', () => {
    expect(chromeThemeColors('light').backgroundColor).toBe(THEME_CHROME.light.ink950)
    expect(chromeThemeColors('dark').backgroundColor).toBe(THEME_CHROME.dark.ink950)
    expect(chromeThemeColors('light').symbolColor).toBe(THEME_CHROME.light.symbolColor)
    expect(chromeThemeColors('dark').symbolColor).toBe(THEME_CHROME.dark.symbolColor)
  })

  it('global.css --color-ink-950 matches THEME_CHROME in both themes', () => {
    const css = readFileSync(CSS_PATH, 'utf8')
    expect(extractInk950(css, 'light')).toBe(THEME_CHROME.light.ink950.toLowerCase())
    expect(extractInk950(css, 'dark')).toBe(THEME_CHROME.dark.ink950.toLowerCase())
  })
})
