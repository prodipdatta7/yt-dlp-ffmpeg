import { describe, expect, it } from 'vitest'
import type { RunResult, SpawnHandle } from '../../src/main/binaries/runner'
import {
  AnalyzeService,
  HYDRATION_WINDOW,
  type AnalyzeServiceOptions,
} from '../../src/main/media/metadata'
import type { AnalyzeStreamEvent } from '../../src/shared/ipcContract'

const BINARY = { kind: 'yt-dlp' as const, path: 'fake-ytdlp', source: 'bundled' as const }
const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLfake'

function playlistJson(count: number): string {
  return JSON.stringify({
    _type: 'playlist',
    id: 'PLfake',
    title: 'Fake Playlist',
    entries: Array.from({ length: count }, (_, i) => ({
      id: `v${i}`,
      title: `Entry ${i}`,
      url: `https://x.test/watch?v=${i}`,
    })),
  })
}

function entryJson(url: string): string {
  return JSON.stringify({
    _type: 'video',
    id: url.slice(-3),
    title: `Hydrated ${url}`,
    duration: 123,
    uploader: 'Someone',
    view_count: 4242,
    thumbnail: 'https://x.test/thumb.jpg',
    formats: [{ format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a' }],
  })
}

interface SpawnRecord {
  args: string[]
  /** Resolves this spawn's RunResult; unset until the harness is told to release it. */
  release: () => void
  killed: boolean
}

interface Harness {
  service: AnalyzeService
  spawns: SpawnRecord[]
  /** Spawns made for per-entry hydration (i.e. excluding the --flat-playlist outline call). */
  entrySpawns: () => SpawnRecord[]
  events: AnalyzeStreamEvent[]
  killTreeCalls: number
}

/**
 * Builds an AnalyzeService whose spawns resolve immediately (`hold: false`) or only when
 * released (`hold: true`), so hydration can be counted and interrupted mid-flight.
 */
function harness(entryCount: number, opts: { hold?: boolean; killDelayMs?: number } = {}): Harness {
  const spawns: SpawnRecord[] = []
  const events: AnalyzeStreamEvent[] = []
  const state = { killTreeCalls: 0 }

  const spawn = (_bin: string, args: string[]): SpawnHandle => {
    const isOutline = args.includes('--flat-playlist')
    const url = args[args.length - 1]
    const stdout = isOutline ? playlistJson(entryCount) : entryJson(url)

    let settle: (() => void) | undefined
    const record: SpawnRecord = { args, release: () => settle?.(), killed: false }
    spawns.push(record)

    const result = new Promise<RunResult>((resolve) => {
      const done = (): void =>
        resolve({
          code: 0,
          signal: null,
          stdoutLines: [stdout],
          stderrLines: [],
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        })
      // The outline call always resolves — holding is about per-entry hydration.
      if (opts.hold && !isOutline) settle = done
      else done()
    })

    return {
      pid: spawns.length,
      result,
      killTree: async () => {
        state.killTreeCalls += 1
        record.killed = true
        if (opts.killDelayMs) await new Promise((r) => setTimeout(r, opts.killDelayMs))
        record.release()
      },
    }
  }

  const service = new AnalyzeService({
    resolveYtDlp: async () => BINARY,
    spawn: spawn as unknown as AnalyzeServiceOptions['spawn'],
  })

  return {
    service,
    spawns,
    entrySpawns: () => spawns.filter((s) => !s.args.includes('--flat-playlist')),
    events,
    get killTreeCalls() {
      return state.killTreeCalls
    },
  }
}

describe('windowed playlist hydration (T7 / R-02)', () => {
  it('hydrates only the first window before analyze() resolves', async () => {
    const h = harness(500)
    const result = await h.service.analyze(PLAYLIST_URL, (e) => h.events.push(e))

    expect(result.kind).toBe('playlist')
    expect(result.playlistEntries).toHaveLength(500)
    // One outline spawn plus at most a window of per-entry spawns — not 500.
    expect(h.entrySpawns()).toHaveLength(HYDRATION_WINDOW)
    expect(h.events.filter((e) => e.kind === 'entry')).toHaveLength(HYDRATION_WINDOW)
  })

  it('leaves un-hydrated entries with their flat-playlist preview row', async () => {
    const h = harness(100)
    const result = await h.service.analyze(PLAYLIST_URL)
    const entries = result.playlistEntries!

    expect(entries[0].title).toContain('Hydrated')
    expect(entries[0].uploader).toBe('Someone')
    // Past the window the row still renders — it just has no detail yet.
    expect(entries[HYDRATION_WINDOW].title).toBe(`Entry ${HYDRATION_WINDOW}`)
    expect(entries[HYDRATION_WINDOW].uploader).toBeFalsy()
    expect(entries[HYDRATION_WINDOW].viewCount).toBeFalsy()
    expect(entries[HYDRATION_WINDOW].url).toBe(`https://x.test/watch?v=${HYDRATION_WINDOW}`)
  })

  it('hydrateRange spawns exactly the requested slice and emits its entry events', async () => {
    const h = harness(500)
    await h.service.analyze(PLAYLIST_URL)
    const afterWindow = h.entrySpawns().length

    const ranged: AnalyzeStreamEvent[] = []
    await h.service.hydrateRange(HYDRATION_WINDOW, 40, (e) => ranged.push(e))

    expect(h.entrySpawns().length - afterWindow).toBe(40)
    expect(ranged).toHaveLength(40)
    expect(ranged.every((e) => e.kind === 'entry')).toBe(true)
  })

  it('does not re-hydrate a range it has already covered', async () => {
    const h = harness(500)
    await h.service.analyze(PLAYLIST_URL)

    await h.service.hydrateRange(HYDRATION_WINDOW, 40)
    const afterFirst = h.entrySpawns().length

    const second: AnalyzeStreamEvent[] = []
    await h.service.hydrateRange(HYDRATION_WINDOW, 40, (e) => second.push(e))

    expect(h.entrySpawns()).toHaveLength(afterFirst)
    expect(second).toHaveLength(0)
  })

  it('hydrates only the not-yet-covered part of an overlapping range', async () => {
    const h = harness(500)
    await h.service.analyze(PLAYLIST_URL)
    const afterWindow = h.entrySpawns().length

    // [20, 80) overlaps the initial [0, 40) window by 20 entries.
    await h.service.hydrateRange(20, 60)
    expect(h.entrySpawns().length - afterWindow).toBe(40)
  })

  it('clamps a range that runs past the end of the playlist', async () => {
    const h = harness(50)
    await h.service.analyze(PLAYLIST_URL)
    const afterWindow = h.entrySpawns().length

    await h.service.hydrateRange(HYDRATION_WINDOW, 40)
    expect(h.entrySpawns().length - afterWindow).toBe(50 - HYDRATION_WINDOW)
  })

  it('no-ops when there is no current playlist', async () => {
    const h = harness(10)
    await h.service.hydrateRange(0, 40)
    expect(h.spawns).toHaveLength(0)
  })
})

describe('hydration cancellation (T7 / AM-09)', () => {
  it('resolves only after every in-flight handle reports killed', async () => {
    const h = harness(500, { hold: true, killDelayMs: 20 })
    const analyzing = h.service.analyze(PLAYLIST_URL).catch(() => null)

    // Let the outline land and the first hydration workers start.
    await new Promise((r) => setTimeout(r, 20))
    const inFlight = h.entrySpawns()
    expect(inFlight.length).toBeGreaterThan(0)

    await h.service.cancel()

    expect(h.killTreeCalls).toBeGreaterThan(0)
    expect(inFlight.filter((s) => s.killed).length).toBe(h.killTreeCalls)
    await analyzing
  }, 15_000)

  it('emits no entry event after cancel() resolves', async () => {
    const h = harness(500, { hold: true })
    const seen: AnalyzeStreamEvent[] = []
    const analyzing = h.service.analyze(PLAYLIST_URL, (e) => seen.push(e)).catch(() => null)

    await new Promise((r) => setTimeout(r, 20))
    await h.service.cancel()
    const countAtCancel = seen.filter((e) => e.kind === 'entry').length

    // Release everything that was still held; none of it may reach the sink.
    for (const record of h.spawns) record.release()
    await analyzing
    await new Promise((r) => setTimeout(r, 20))

    expect(seen.filter((e) => e.kind === 'entry')).toHaveLength(countAtCancel)
  }, 15_000)

  it('is a safe no-op with nothing in flight', async () => {
    const h = harness(10)
    await expect(h.service.cancel()).resolves.toBeUndefined()
  })

  it('drops a superseded analysis so its entries never reach the new one', async () => {
    const h = harness(500, { hold: true })
    const first: AnalyzeStreamEvent[] = []
    const firstRun = h.service.analyze(PLAYLIST_URL, (e) => first.push(e)).catch(() => null)

    await new Promise((r) => setTimeout(r, 20))
    await h.service.cancel()
    const atCancel = first.filter((e) => e.kind === 'entry').length

    for (const record of h.spawns) record.release()
    await firstRun
    await new Promise((r) => setTimeout(r, 20))

    expect(first.filter((e) => e.kind === 'entry')).toHaveLength(atCancel)
  }, 15_000)
})
