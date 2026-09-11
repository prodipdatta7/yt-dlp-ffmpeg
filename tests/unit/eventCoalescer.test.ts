import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COALESCE_INTERVAL_MS, JobEventCoalescer } from '../../src/main/jobs/eventCoalescer'
import type { JobEvent, JobPhase } from '../../src/shared/models'

function sample(phase: JobPhase, percent: number, jobId = 'j1'): JobEvent {
  return { jobId, phase, percent, speedBps: 1024, etaSec: 10 }
}

describe('JobEventCoalescer (P-04)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('collapses a burst of same-phase samples to one publication per interval', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()

    for (let i = 0; i < 100; i++) c.emit(sample('downloading-video', i), (e) => sent.push(e))
    expect(sent).toHaveLength(0)

    vi.advanceTimersByTime(COALESCE_INTERVAL_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0].percent).toBe(99)
  })

  it('publishes at most ceil(elapsed / interval) + 1 routine events', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()
    const elapsed = COALESCE_INTERVAL_MS * 4

    for (let t = 0; t < elapsed; t += 10) {
      c.emit(sample('downloading-video', t), (e) => sent.push(e))
      vi.advanceTimersByTime(10)
    }
    c.release('j1')

    expect(sent.length).toBeLessThanOrEqual(Math.ceil(elapsed / COALESCE_INTERVAL_MS) + 1)
    expect(sent.length).toBeGreaterThan(0)
  })

  it('always delivers the last sample when the job is released', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()

    c.emit(sample('downloading-video', 41), (e) => sent.push(e))
    c.emit(sample('downloading-video', 42), (e) => sent.push(e))
    expect(sent).toHaveLength(0)

    c.release('j1')
    expect(sent).toHaveLength(1)
    expect(sent[0].percent).toBe(42)
  })

  it('never delays an event carrying a message', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()

    c.emit(sample('downloading-video', 10), (e) => sent.push(e))
    c.emit({ ...sample('queued', 10), message: 'Network issue — retrying…' }, (e) => sent.push(e))

    // The queued notice is sent immediately, behind the sample it was queued after.
    expect(sent).toHaveLength(2)
    expect(sent[0].phase).toBe('downloading-video')
    expect(sent[1].message).toBe('Network issue — retrying…')
  })

  it('never delays a non-routine phase such as merging or finalizing', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()

    c.emit(sample('downloading-audio', 90), (e) => sent.push(e))
    c.emit(sample('finalizing', 100), (e) => sent.push(e))

    expect(sent.map((e) => e.phase)).toEqual(['downloading-audio', 'finalizing'])
  })

  it('flushes the outgoing phase before queueing a new one, so transitions survive', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()

    c.emit(sample('downloading-video', 50), (e) => sent.push(e))
    c.emit(sample('downloading-audio', 25), (e) => sent.push(e))
    expect(sent.map((e) => e.phase)).toEqual(['downloading-video'])

    vi.advanceTimersByTime(COALESCE_INTERVAL_MS)
    expect(sent.map((e) => e.phase)).toEqual(['downloading-video', 'downloading-audio'])
  })

  it('keeps one pending sample per job and flushes them independently', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer()

    c.emit(sample('downloading-video', 10, 'a'), (e) => sent.push(e))
    c.emit(sample('downloading-video', 20, 'b'), (e) => sent.push(e))
    c.emit(sample('downloading-video', 30, 'a'), (e) => sent.push(e))

    c.release('a')
    expect(sent).toEqual([expect.objectContaining({ jobId: 'a', percent: 30 })])

    vi.advanceTimersByTime(COALESCE_INTERVAL_MS)
    expect(sent[1]).toMatchObject({ jobId: 'b', percent: 20 })
  })

  it('runs no timer while idle, so an idle app keeps zero timers', () => {
    const c = new JobEventCoalescer()
    expect(vi.getTimerCount()).toBe(0)

    c.emit(sample('downloading-video', 1), () => undefined)
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(COALESCE_INTERVAL_MS)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes everything straight through when the interval is disabled', () => {
    const sent: JobEvent[] = []
    const c = new JobEventCoalescer(0)

    c.emit(sample('downloading-video', 1), (e) => sent.push(e))
    c.emit(sample('downloading-video', 2), (e) => sent.push(e))

    expect(sent).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
