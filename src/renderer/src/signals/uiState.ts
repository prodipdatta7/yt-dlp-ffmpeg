import { signal } from '@preact/signals'

export type ViewId = 'download' | 'queue' | 'settings'

export const activeView = signal<ViewId>('download')
export const logDockOpen = signal(false)

export function toggleLogDock(): void {
  logDockOpen.value = !logDockOpen.value
}

export function openSettings(): void {
  activeView.value = 'settings'
}
