import { describe, expect, it, vi } from 'vitest'
import { MemoryProbe, type AppMetricsSource } from '../../src/main/telemetry/memoryProbe'

function fakeApp(overrides: Partial<Record<string, number>> = {}): AppMetricsSource {
  return {
    getAppMetrics: () => [
      {
        pid: 1,
        type: 'Browser',
        memory: {
          privateBytes: overrides.mainPrivate ?? 60_000,
          workingSetSize: 120_000,
          peakWorkingSetSize: 130_000,
        },
        cpu: { percentCPUUsage: 1.5, idleWakeupsPerSecond: 12 },
        creationTime: 1_700_000_000,
      },
      {
        pid: 2,
        type: 'Tab',
        name: 'MediaForge',
        memory: { privateBytes: 40_000, workingSetSize: 90_000, peakWorkingSetSize: 95_000 },
        cpu: { percentCPUUsage: 0.5, idleWakeupsPerSecond: 3 },
      },
    ],
  }
}

function probeWith(writes: string[], opts: Record<string, unknown> = {}): MemoryProbe {
  return new MemoryProbe({
    filePath: 'mem.jsonl',
    app: fakeApp(),
    isBusy: () => false,
    appendFile: async (_path, data) => {
      writes.push(data)
    },
    ...opts,
  })
}

describe('MemoryProbe (T14 / P-10)', () => {
  it('records per-process detail and both memory metrics, per AM-16', () => {
    const sample = probeWith([]).sample()

    expect(sample.processes).toHaveLength(2)
    expect(sample.processes[0]).toMatchObject({
      pid: 1,
      type: 'Browser',
      privateBytes: 60_000,
      peakWorkingSetSize: 130_000,
      idleWakeupsPerSecond: 12,
    })
    expect(sample.processes[1].name).toBe('MediaForge')

    // 100_000 KB private, 210_000 KB working set, summed across processes.
    expect(sample.totals.privateMB).toBeCloseTo(97.7, 1)
    expect(sample.totals.workingSetMB).toBeCloseTo(205.1, 1)
    expect(sample.totals.peakWorkingSetMB).toBeCloseTo(219.7, 1)
  })

  it('records main-process heap and event-loop delay alongside', () => {
    const probe = probeWith([])
    probe.start()
    const sample = probe.sample()
    void probe.stop()

    expect(sample.main.rssMB).toBeGreaterThan(0)
    expect(sample.main).toHaveProperty('arrayBuffersMB')
    expect(sample.eventLoopDelayMs).toHaveProperty('p99')
    expect(sample.eventLoopDelayMs.max).toBeGreaterThanOrEqual(0)
  })

  it('labels samples with the current scenario', () => {
    const probe = probeWith([])
    expect(probe.sample().scenario).toBe('idle')

    probe.setScenario('analyze-1000-playlist')
    expect(probe.sample().scenario).toBe('analyze-1000-playlist')
  })

  it('buffers rather than writing per sample', async () => {
    const writes: string[] = []
    const probe = probeWith(writes, { flushEverySamples: 50 })

    for (let i = 0; i < 10; i += 1) probe.sample()
    expect(writes).toHaveLength(0)
    expect(probe.pendingCount()).toBe(10)

    await probe.flush()
    expect(writes).toHaveLength(1)
    expect(writes[0].trim().split('\n')).toHaveLength(10)
    expect(probe.pendingCount()).toBe(0)
  })

  it('flushes on its own once the buffer reaches the cap', async () => {
    const writes: string[] = []
    const probe = probeWith(writes, { flushEverySamples: 3 })

    for (let i = 0; i < 3; i += 1) probe.sample()
    await probe.flush()

    expect(writes.length).toBeGreaterThanOrEqual(1)
    expect(probe.pendingCount()).toBe(0)
  })

  it('writes JSONL — one parseable object per line', async () => {
    const writes: string[] = []
    const probe = probeWith(writes)
    probe.sample()
    probe.sample()
    await probe.flush()

    const lines = writes.join('').trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('flushes what is buffered when it stops', async () => {
    const writes: string[] = []
    const probe = probeWith(writes)
    probe.start()
    probe.sample()

    await probe.stop()
    expect(writes.join('')).toContain('"scenario":"idle"')
    expect(probe.pendingCount()).toBe(0)
  })

  it('runs no timers once stopped, so it cannot outlive the app', async () => {
    vi.useFakeTimers()
    try {
      const probe = probeWith([])
      probe.start()
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      await probe.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('survives a failing write without throwing', async () => {
    const probe = new MemoryProbe({
      filePath: 'mem.jsonl',
      app: fakeApp(),
      isBusy: () => false,
      appendFile: async () => {
        throw new Error('disk full')
      },
    })
    probe.sample()
    await expect(probe.flush()).resolves.toBeUndefined()
  })
})
