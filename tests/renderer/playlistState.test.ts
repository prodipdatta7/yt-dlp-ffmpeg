import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyzeStreamEvent } from '../../src/shared/ipcContract'
import type { AnalyzeResult, PlaylistEntryPreview } from '../../src/shared/models'
import {
  analysis,
  applyAnalyzeStream,
  flushPlaylistEntries,
  hydratedEntries,
  playlistEntriesById,
  playlistHydration,
  resetAnalysis,
} from '../../src/renderer/src/signals/appState'
import { queueRunning } from '../../src/renderer/src/signals/queueState'

const ENTRY_FLUSH_MS = 80

function entry(index: number, over: Partial<PlaylistEntryPreview> = {}): PlaylistEntryPreview {
  return {
    index,
    title: `Entry ${index}`,
    url: `https://x.test/watch?v=${index}`,
    ...over,
  }
}

function outline(count: number): AnalyzeResult {
  return {
    kind: 'playlist',
    metadata: {
      id: 'PL1',
      title: 'Playlist',
      uploader: null,
      durationSec: null,
      viewCount: null,
      uploadDate: null,
      thumbnailUrl: null,
      isLive: false,
      webpageUrl: null,
    },
    formats: [],
    playlistCount: count,
    playlistEntries: Array.from({ length: count }, (_, i) => entry(i)),
  }
}

function hydrationEvent(index: number, done: number, total: number): AnalyzeStreamEvent {
  return {
    kind: 'entry',
    index,
    entry: entry(index, { title: `Hydrated ${index}`, durationSec: 100 + index }),
    done,
    total,
  }
}

describe('normalized playlist state (T10 / P-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    queueRunning.value = false
    resetAnalysis()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds the map from the outline so every row has an entry immediately', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(5) })

    expect(playlistEntriesById.value.size).toBe(5)
    expect(playlistEntriesById.value.get(3)?.title).toBe('Entry 3')
  })

  it('commits a burst of hydration events in one publication', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(200) })

    let publications = 0
    const stop = playlistEntriesById.subscribe(() => {
      publications += 1
    })
    publications = 0 // subscribe fires once with the current value

    for (let i = 0; i < 200; i += 1) applyAnalyzeStream(hydrationEvent(i, i + 1, 200))
    expect(publications).toBe(0)

    vi.advanceTimersByTime(ENTRY_FLUSH_MS)
    expect(publications).toBe(1)
    stop()

    expect(playlistEntriesById.value.get(0)?.title).toBe('Hydrated 0')
    expect(playlistEntriesById.value.get(199)?.durationSec).toBe(299)
  })

  it('does not republish analysis for hydration events', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(10) })
    const afterOutline = analysis.value

    for (let i = 0; i < 10; i += 1) applyAnalyzeStream(hydrationEvent(i, i + 1, 10))
    vi.advanceTimersByTime(ENTRY_FLUSH_MS)

    expect(analysis.value).toBe(afterOutline)
  })

  it('applies out-of-order indices to the right rows', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(10) })

    for (const i of [7, 2, 9, 0]) applyAnalyzeStream(hydrationEvent(i, i, 10))
    vi.advanceTimersByTime(ENTRY_FLUSH_MS)

    expect(playlistEntriesById.value.get(7)?.title).toBe('Hydrated 7')
    expect(playlistEntriesById.value.get(2)?.durationSec).toBe(102)
    expect(playlistEntriesById.value.get(1)?.title).toBe('Entry 1')
  })

  it('keeps the last value when one index is hydrated twice in a window', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(3) })

    applyAnalyzeStream(hydrationEvent(1, 1, 3))
    applyAnalyzeStream({
      kind: 'entry',
      index: 1,
      entry: entry(1, { title: 'Final', durationSec: 999 }),
      done: 2,
      total: 3,
    })
    vi.advanceTimersByTime(ENTRY_FLUSH_MS)

    expect(playlistEntriesById.value.get(1)?.title).toBe('Final')
  })

  it('publishes hydration progress with the same flush', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(40) })

    for (let i = 0; i < 40; i += 1) applyAnalyzeStream(hydrationEvent(i, i + 1, 40))
    expect(playlistHydration.value).toBeNull()

    vi.advanceTimersByTime(ENTRY_FLUSH_MS)
    expect(playlistHydration.value).toEqual({ done: 40, total: 40 })
  })

  it('clears buffer, timer and map on reset', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(10) })
    applyAnalyzeStream(hydrationEvent(0, 1, 10))

    resetAnalysis()
    expect(playlistEntriesById.value.size).toBe(0)
    expect(playlistHydration.value).toBeNull()

    // The pending flush must not resurrect the discarded entry.
    vi.advanceTimersByTime(ENTRY_FLUSH_MS * 2)
    expect(playlistEntriesById.value.size).toBe(0)
  })

  it('drops a buffered entry when a new outline arrives first', () => {
    applyAnalyzeStream({ kind: 'outline', result: outline(10) })
    applyAnalyzeStream(hydrationEvent(0, 1, 10))

    applyAnalyzeStream({ kind: 'outline', result: outline(3) })
    vi.advanceTimersByTime(ENTRY_FLUSH_MS * 2)

    expect(playlistEntriesById.value.size).toBe(3)
    expect(playlistEntriesById.value.get(0)?.title).toBe('Entry 0')
  })
})

describe('hydratedEntries overlay (T10)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    queueRunning.value = false
    resetAnalysis()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves outline order while overlaying hydrated detail', () => {
    const result = outline(5)
    applyAnalyzeStream({ kind: 'outline', result })
    applyAnalyzeStream(hydrationEvent(3, 1, 5))
    flushPlaylistEntries()

    const merged = hydratedEntries(result.playlistEntries!)
    expect(merged.map((e) => e.index)).toEqual([0, 1, 2, 3, 4])
    expect(merged[3].title).toBe('Hydrated 3')
    expect(merged[3].durationSec).toBe(103)
    expect(merged[4].title).toBe('Entry 4')
  })

  it('returns the input untouched when nothing is hydrated', () => {
    const rows = [entry(0), entry(1)]
    expect(hydratedEntries(rows)).toEqual(rows)
  })
})
