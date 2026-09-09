/**
 * Native window chrome colors — single source of truth for
 * `windowOptions.ts` and the renderer's `--color-ink-950` token.
 * A unit test asserts CSS stays in sync (see themeChrome.test.ts).
 */
export const THEME_CHROME = {
  light: {
    /** Must equal `--color-ink-950` in light theme (`global.css`). */
    ink950: '#f1e9db',
    symbolColor: '#475569',
  },
  dark: {
    /** Must equal `--color-ink-950` in dark theme (`global.css`). */
    ink950: '#14100c',
    symbolColor: '#94a3b8',
  },
} as const

export type ChromeThemeId = keyof typeof THEME_CHROME
