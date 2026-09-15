/**
 * Native window chrome colors — single source of truth for
 * `windowOptions.ts` and the renderer's `--color-ink-950` token.
 * A unit test asserts CSS stays in sync (see themeChrome.test.ts).
 */
export const THEME_CHROME = {
  light: {
    /** Must equal `--color-ink-950` in light theme (`global.css`). */
    ink950: '#f5f8ff',
    symbolColor: '#202b3a',
  },
  dark: {
    /** Must equal `--color-ink-950` in dark theme (`global.css`). */
    ink950: '#08111f',
    symbolColor: '#a5b5ca',
  },
} as const

export type ChromeThemeId = keyof typeof THEME_CHROME
