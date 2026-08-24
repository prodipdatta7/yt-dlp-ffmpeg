import { signal } from '@preact/signals'

export type ViewId = 'download' | 'queue' | 'settings'
export type ThemePref = 'system' | 'light' | 'dark'

export const activeView = signal<ViewId>('download')
export const logDockOpen = signal(false)
export const themePref = signal<ThemePref>('light')

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function resolved(): 'light' | 'dark' {
  if (themePref.value === 'light' || themePref.value === 'dark') return themePref.value
  return systemDark.matches ? 'dark' : 'light'
}

function paint(): void {
  document.documentElement.dataset.theme = resolved()
}

export function setThemePref(pref: ThemePref): void {
  themePref.value = pref
  paint()
}

systemDark.addEventListener('change', () => {
  if (themePref.value === 'system') paint()
})
paint()

export function toggleLogDock(): void {
  logDockOpen.value = !logDockOpen.value
}

export function openSettings(): void {
  activeView.value = 'settings'
}
