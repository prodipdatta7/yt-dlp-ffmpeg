import { batch, signal } from '@preact/signals'
import type { AnalyzeResult, MfErrorCode, PlaylistEntryPreview } from '../../../shared/models'
import { PLAYLIST_HYDRATION_WINDOW } from '../../../shared/models'
import type { AnalyzeStreamEvent } from '../../../shared/ipcContract'
import { resetJobStatus } from './jobState'
import { resetQueueForNewAnalysis } from './queueState'

export const analyzing = signal(false)
export const analysis = signal<AnalyzeResult | null>(null)
export const analyzeError = signal<{ code: MfErrorCode; message: string } | null>(null)
export const playlistHydration = signal<{ done: number; total: number } | null>(null)

/**
 * Hydrated playlist entries keyed by `index`, so one arriving entry is an O(1) patch rather
 * than a rebuild-and-republish of the whole `analysis` object (P-05). Row order still comes
 * from the outline's array; this only carries detail.
 */
export const playlistEntriesById = signal<Map<number, PlaylistEntryPreview>>(new Map())

/** Outline rows with hydrated detail overlaid, preserving the outline's order. */
export function hydratedEntries(entries: readonly PlaylistEntryPreview[]): PlaylistEntryPreview[] {
  const byIndex = playlistEntriesById.value
  if (byIndex.size === 0) return entries as PlaylistEntryPreview[]
  return entries.map((entry) => byIndex.get(entry.index) ?? entry)
}

/** Hydration events are applied in one commit per window rather than one per entry. */
const ENTRY_FLUSH_MS = 80
let entryBuffer: PlaylistEntryPreview[] = []
let pendingHydration: { done: number; total: number } | null = null
let entryFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushEntries(): void {
  entryFlushTimer = null
  if (entryBuffer.length === 0 && pendingHydration === null) return
  const buffered = entryBuffer
  const hydration = pendingHydration
  entryBuffer = []
  pendingHydration = null

  batch(() => {
    if (buffered.length > 0) {
      const next = new Map(playlistEntriesById.value)
      for (const entry of buffered) next.set(entry.index, entry)
      playlistEntriesById.value = next
    }
    if (hydration) playlistHydration.value = hydration
  })
}

function clearEntryBuffer(): void {
  entryBuffer = []
  pendingHydration = null
  if (entryFlushTimer !== null) {
    clearTimeout(entryFlushTimer)
    entryFlushTimer = null
  }
}

/** Test seam: applies any buffered hydration without waiting for the timer. */
export function flushPlaylistEntries(): void {
  if (entryFlushTimer !== null) clearTimeout(entryFlushTimer)
  flushEntries()
}

/** The URL text in the link bar. Kept in a signal so it survives view switches/remounts. */
export const urlInput = signal('')

/**
 * Exclusive upper bound of the playlist range whose hydration has been requested. Main
 * hydrates the first window itself (R-02); everything past it is asked for as the list
 * scrolls, and this cursor keeps repeated scroll events from re-requesting the same slice.
 */
let hydrationRequestedTo = 0

/**
 * Asks main for the next slice of playlist metadata. Cheap to call on every scroll event —
 * it only advances the cursor, and main no-ops on an already-hydrated range.
 */
export function requestMorePlaylistHydration(): void {
  const current = analysis.value
  if (!current || current.kind !== 'playlist') return
  const total = current.playlistEntries?.length ?? 0
  if (hydrationRequestedTo >= total) return
  const from = hydrationRequestedTo
  hydrationRequestedTo = Math.min(total, from + PLAYLIST_HYDRATION_WINDOW)
  void window.mf.analyzeHydrateRange(from, PLAYLIST_HYDRATION_WINDOW).catch(() => undefined)
}

export function resetAnalysis(): void {
  analyzeGeneration += 1
  clearEntryBuffer()
  analysis.value = null
  analyzeError.value = null
  playlistHydration.value = null
  playlistEntriesById.value = new Map()
  hydrationRequestedTo = 0
  resetJobStatus()
  resetQueueForNewAnalysis()
}

/**
 * Identifies the current analysis. Every write below is guarded by it, so a superseded
 * request cannot land its result — or clear `analyzing` — under the one that replaced it
 * (P-08). Cancel-then-reanalyze overlaps in practice now that hydration runs in the
 * background (R-02).
 */
let analyzeGeneration = 0

/**
 * Automates pasting a URL into the link bar and triggering metadata analysis.
 * Safely cancels any in-flight analyze before launching the new request.
 */
export async function triggerAnalyze(url: string): Promise<void> {
  const cleanUrl = url.trim()
  if (!cleanUrl) return
  if (analyzing.value) {
    try {
      // Awaited on the main side too, so this means the old process tree is gone (AM-09).
      await window.mf?.analyzeCancel?.()
    } catch {
      /* ignore cancel err */
    }
  }
  urlInput.value = cleanUrl
  resetAnalysis() // bumps the generation, invalidating anything still in flight
  const gen = analyzeGeneration
  analyzing.value = true
  try {
    const response = await window.mf.analyzeStart(cleanUrl)
    if (gen !== analyzeGeneration) return
    if (response.kind === 'ok') {
      analysis.value = response.result
    } else {
      analyzeError.value = { code: response.code, message: response.message }
    }
  } catch {
    if (gen !== analyzeGeneration) return
    analyzeError.value = { code: 'MF_UNKNOWN', message: 'Unexpected IPC failure.' }
  } finally {
    if (gen === analyzeGeneration) analyzing.value = false
  }
}

/** Test seam: the generation in-flight writes are checked against. */
export function currentAnalyzeGeneration(): number {
  return analyzeGeneration
}

/**
 * Applies a streamed analysis event. Superseded analyses are filtered in main, which owns
 * the generation counter and stops emitting the moment a cancel or a newer analysis lands
 * (see AnalyzeService) — the renderer cannot compare generations it never receives.
 */
export function applyAnalyzeStream(event: AnalyzeStreamEvent): void {
  if (event.kind === 'outline') {
    clearEntryBuffer()
    batch(() => {
      analysis.value = event.result
      analyzing.value = false
      playlistEntriesById.value = new Map(
        (event.result.playlistEntries ?? []).map((entry) => [entry.index, entry]),
      )
    })
    // main hydrates the first window itself before analyze() resolves.
    hydrationRequestedTo = PLAYLIST_HYDRATION_WINDOW
    return
  }

  // Buffered rather than published per event: a hydration window is 40 entries arriving
  // within a few hundred milliseconds, and each publication re-renders the whole list.
  entryBuffer.push({ ...event.entry })
  pendingHydration = { done: event.done, total: event.total }
  if (entryFlushTimer === null) entryFlushTimer = setTimeout(flushEntries, ENTRY_FLUSH_MS)
}
