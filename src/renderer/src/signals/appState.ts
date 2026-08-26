import { signal } from '@preact/signals'
import type { AnalyzeResult, MfErrorCode } from '../../../shared/models'
import type { AnalyzeStreamEvent } from '../../../shared/ipcContract'
import { resetJobStatus } from './jobState'

export const analyzing = signal(false)
export const analysis = signal<AnalyzeResult | null>(null)
export const analyzeError = signal<{ code: MfErrorCode; message: string } | null>(null)
export const playlistHydration = signal<{ done: number; total: number } | null>(null)

/** The URL text in the link bar. Kept in a signal so it survives view switches/remounts. */
export const urlInput = signal('')

export function resetAnalysis(): void {
  analysis.value = null
  analyzeError.value = null
  playlistHydration.value = null
  resetJobStatus()
}

export function applyAnalyzeStream(event: AnalyzeStreamEvent): void {
  if (event.kind === 'outline') {
    analysis.value = event.result
    analyzing.value = false
    return
  }
  playlistHydration.value = { done: event.done, total: event.total }
  const current = analysis.value
  if (!current || current.kind !== 'playlist' || !current.playlistEntries) return
  const entries = [...current.playlistEntries]
  const idx = entries.findIndex((e) => e.index === event.index)
  if (idx === -1) return
  entries[idx] = { ...event.entry }
  analysis.value = { ...current, playlistEntries: entries }
}
