import * as fsp from 'node:fs/promises'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'

/** One sampled process from `app.getAppMetrics()`, per AM-16. */
export interface ProcessSample {
  pid: number
  type: string
  name?: string
  /** KB, as Electron reports it. */
  privateBytes: number
  workingSetSize: number
  peakWorkingSetSize: number
  percentCPUUsage: number
  idleWakeupsPerSecond: number
  creationTime?: number
}

export interface ProbeSample {
  t: string
  /** Free-form phase marker, so a benchmark run can label what the app was doing. */
  scenario: string
  processes: ProcessSample[]
  /** Summed across processes, MB. AM-16 makes `private` the primary figure. */
  totals: { privateMB: number; workingSetMB: number; peakWorkingSetMB: number }
  main: { rssMB: number; heapUsedMB: number; externalMB: number; arrayBuffersMB: number }
  /** Event-loop delay in ms since the previous sample — the stall signal. */
  eventLoopDelayMs: { p50: number; p95: number; p99: number; max: number }
  busy: boolean
}

/** Shape of the slice of Electron's `app` this probe needs, so it is testable off-Electron. */
export interface AppMetricsSource {
  getAppMetrics(): {
    pid: number
    type: string
    name?: string
    memory?: { privateBytes?: number; workingSetSize?: number; peakWorkingSetSize?: number }
    cpu?: { percentCPUUsage?: number; idleWakeupsPerSecond?: number }
    creationTime?: number
  }[]
}

export interface MemoryProbeOptions {
  filePath: string
  app: AppMetricsSource
  isBusy: () => boolean
  sampleIntervalMs?: number
  /** Samples buffered before a flush; also flushed on a timer and on stop. */
  flushEverySamples?: number
  flushIntervalMs?: number
  /** Test seam. */
  appendFile?: (path: string, data: string) => Promise<void>
  now?: () => Date
}

const MB = 1024 * 1024
const toMB = (kb: number): number => Math.round((kb / 1024) * 10) / 10
const bytesToMB = (bytes: number): number => Math.round((bytes / MB) * 10) / 10

/**
 * Opt-in memory/CPU probe (MF_MEMORY_PROBE=1). Replaces a `setInterval` + `appendFileSync`
 * that logged only summed workingSetSize — it could not tell a Chromium baseline from an
 * application leak, and its synchronous write was itself the kind of stall it was measuring
 * (P-10). Samples are buffered and flushed asynchronously; the probe must not create the
 * stalls it is there to find.
 */
export class MemoryProbe {
  private readonly opts: Required<
    Omit<MemoryProbeOptions, 'app' | 'isBusy' | 'filePath' | 'appendFile' | 'now'>
  > &
    MemoryProbeOptions
  private buffer: ProbeSample[] = []
  private sampleTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private histogram: IntervalHistogram | null = null
  private scenario = 'idle'
  private flushing: Promise<void> = Promise.resolve()

  constructor(options: MemoryProbeOptions) {
    this.opts = {
      sampleIntervalMs: 2000,
      flushEverySamples: 50,
      flushIntervalMs: 10_000,
      ...options,
    }
  }

  /** Labels subsequent samples, so a benchmark can mark phases. */
  setScenario(scenario: string): void {
    this.scenario = scenario
  }

  start(): void {
    if (this.sampleTimer !== null) return
    this.histogram = monitorEventLoopDelay({ resolution: 10 })
    this.histogram.enable()

    this.sampleTimer = setInterval(() => this.sample(), this.opts.sampleIntervalMs)
    this.sampleTimer.unref?.()
    this.flushTimer = setInterval(() => void this.flush(), this.opts.flushIntervalMs)
    this.flushTimer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.sampleTimer !== null) clearInterval(this.sampleTimer)
    if (this.flushTimer !== null) clearInterval(this.flushTimer)
    this.sampleTimer = null
    this.flushTimer = null
    this.histogram?.disable()
    this.histogram = null
    await this.flush()
  }

  /** Takes one sample immediately. Exposed so tests need no timers. */
  sample(): ProbeSample {
    const processes: ProcessSample[] = []
    let privateKB = 0
    let workingKB = 0
    let peakKB = 0

    for (const metric of this.opts.app.getAppMetrics()) {
      const memory = metric.memory ?? {}
      privateKB += memory.privateBytes ?? 0
      workingKB += memory.workingSetSize ?? 0
      peakKB += memory.peakWorkingSetSize ?? 0
      processes.push({
        pid: metric.pid,
        type: String(metric.type ?? 'unknown'),
        ...(metric.name === undefined ? {} : { name: metric.name }),
        privateBytes: memory.privateBytes ?? 0,
        workingSetSize: memory.workingSetSize ?? 0,
        peakWorkingSetSize: memory.peakWorkingSetSize ?? 0,
        percentCPUUsage: metric.cpu?.percentCPUUsage ?? 0,
        idleWakeupsPerSecond: metric.cpu?.idleWakeupsPerSecond ?? 0,
        ...(metric.creationTime === undefined ? {} : { creationTime: metric.creationTime }),
      })
    }

    const memoryUsage = process.memoryUsage()
    const h = this.histogram
    const sample: ProbeSample = {
      t: (this.opts.now?.() ?? new Date()).toISOString(),
      scenario: this.scenario,
      processes,
      totals: {
        privateMB: toMB(privateKB),
        workingSetMB: toMB(workingKB),
        peakWorkingSetMB: toMB(peakKB),
      },
      main: {
        rssMB: bytesToMB(memoryUsage.rss),
        heapUsedMB: bytesToMB(memoryUsage.heapUsed),
        externalMB: bytesToMB(memoryUsage.external),
        arrayBuffersMB: bytesToMB(memoryUsage.arrayBuffers),
      },
      eventLoopDelayMs: h
        ? {
            p50: round2(h.percentile(50) / 1e6),
            p95: round2(h.percentile(95) / 1e6),
            p99: round2(h.percentile(99) / 1e6),
            max: round2(h.max / 1e6),
          }
        : { p50: 0, p95: 0, p99: 0, max: 0 },
      busy: this.opts.isBusy(),
    }
    // Reset so each sample reports the delay since the previous one, not since startup.
    h?.reset()

    this.buffer.push(sample)
    if (this.buffer.length >= this.opts.flushEverySamples) void this.flush()
    return sample
  }

  /** Writes buffered samples as JSONL. Serialized so concurrent flushes cannot interleave. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    const payload = batch.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    const append = this.opts.appendFile ?? ((p, d) => fsp.appendFile(p, d))
    this.flushing = this.flushing
      .then(() => append(this.opts.filePath, payload))
      .catch(() => undefined)
    await this.flushing
  }

  /** Test seam: samples not yet written. */
  pendingCount(): number {
    return this.buffer.length
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
