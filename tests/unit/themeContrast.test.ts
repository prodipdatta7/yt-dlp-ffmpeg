import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS_PATH = resolve(__dirname, '../../src/renderer/src/styles/global.css')

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const value = hex.slice(1)
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    channel(Number.parseInt(value.slice(offset, offset + 2), 16)),
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function themeBlock(css: string, theme: 'light' | 'dark'): string {
  const pattern =
    theme === 'light'
      ? /\n:root\s*\{([\s\S]*?)\n\}/
      : /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/
  const block = css.match(pattern)?.[1]
  expect(block).toBeDefined()
  return block ?? ''
}

function token(block: string, name: string): string {
  const value = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]
  expect(value).toBeDefined()
  return value ?? '#000000'
}

describe('theme contrast', () => {
  const css = readFileSync(CSS_PATH, 'utf8')

  it('keeps small light-theme supporting text at WCAG AA contrast', () => {
    const light = themeBlock(css, 'light')
    const supportingText = token(light, '--color-slate-600')

    expect(contrast(supportingText, token(light, '--mf-canvas'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(supportingText, token(light, '--mf-surface'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['light', 'dark'] as const)(
    'keeps white action labels at WCAG AA contrast in the %s theme',
    (theme) => {
      const block = themeBlock(css, theme)

      expect(contrast('#ffffff', token(block, '--mf-action-start'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#ffffff', token(block, '--mf-action-end'))).toBeGreaterThanOrEqual(4.5)
    },
  )
})
