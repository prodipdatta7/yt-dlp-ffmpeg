import { signal } from '@preact/signals'

export type ViewId = 'download' | 'search' | 'queue' | 'share' | 'settings'
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

export type UiDensity = 'comfortable' | 'compact'

function loadSaved<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return JSON.parse(v) as T
  } catch {
    /* fallback */
  }
  return fallback
}

export const uiDensity = signal<UiDensity>(loadSaved('mf_density', 'comfortable'))
export const ambientGridEnabled = signal<boolean>(loadSaved('mf_ambient_grid', true))
export const animationsEnabled = signal<boolean>(loadSaved('mf_animations', true))

export function setUiDensity(d: UiDensity): void {
  uiDensity.value = d
  try {
    localStorage.setItem('mf_density', JSON.stringify(d))
    document.documentElement.dataset.density = d
  } catch {
    /* localStorage may be restricted in some environments */
  }
}

export function setAmbientGrid(enabled: boolean): void {
  ambientGridEnabled.value = enabled
  try {
    localStorage.setItem('mf_ambient_grid', JSON.stringify(enabled))
  } catch {
    /* localStorage may be restricted */
  }
}

export function setAnimationsEnabled(enabled: boolean): void {
  animationsEnabled.value = enabled
  try {
    localStorage.setItem('mf_animations', JSON.stringify(enabled))
    if (!enabled) {
      document.documentElement.classList.add('mf-reduced-motion')
    } else {
      document.documentElement.classList.remove('mf-reduced-motion')
    }
  } catch {
    /* localStorage may be restricted */
  }
}

try {
  document.documentElement.dataset.density = uiDensity.value
  if (!animationsEnabled.value) {
    document.documentElement.classList.add('mf-reduced-motion')
  }
} catch {
  /* SSR or headless protection */
}
