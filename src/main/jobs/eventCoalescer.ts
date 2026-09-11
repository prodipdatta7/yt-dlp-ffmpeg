import type { JobEvent } from '../../shared/models'
import type { SendEvent } from './orchestrator'

/** Flush cadence for routine progress samples. ~6.7 publications/sec/job at worst. */
export const COALESCE_INTERVAL_MS = 150

/**
 * True for the repeating download-progress samples, which are safe to drop in favour of a
 * newer one. Anything carrying a `message`, and every other phase, is a state transition the
 * renderer must see exactly once.
 */
function isRoutineProgress(event: JobEvent): boolean {
  if (event.message !== undefined) return false
  return event.phase === 'downloading-video' || event.phase === 'downloading-audio'
}

interface PendingSample {
  event: JobEvent
  send: SendEvent
}

/**
 * Rate-limits routine progress events on their way to the renderer (P-04). Each job keeps at
 * most one pending sample, latest-wins, flushed on a shared timer; everything else is sent
 * immediately, behind any sample already queued for that job so ordering is preserved.
 *
 * The timer exists only while samples are pending and is `unref`'d, so an idle app keeps its
 * zero-timer profile.
 */
export class JobEventCoalescer {
  private readonly pending = new Map<string, PendingSample>()
  private timer: NodeJS.Timeout | null = null

  /** An interval of 0 or less disables coalescing — a test seam for per-sample assertions. */
  constructor(private readonly intervalMs: number = COALESCE_INTERVAL_MS) {}

  emit(event: JobEvent, send: SendEvent): void {
    if (this.intervalMs <= 0) {
      send(event)
      return
    }
    if (isRoutineProgress(event)) {
      // Latest-wins only within a phase. video→audio is a transition the renderer must see,
      // so flush the outgoing phase's last sample before queueing the new one.
      if (this.pending.get(event.jobId)?.event.phase !== event.phase) this.flushJob(event.jobId)
      this.pending.set(event.jobId, { event, send })
      this.start()
      return
    }
    this.flushJob(event.jobId)
    send(event)
  }

  /** Flushes a job's last sample and forgets it. Call on completion so none is stranded. */
  release(jobId: string): void {
    this.flushJob(jobId)
    this.stopIfIdle()
  }

  /** Test seam: drains everything pending without waiting for the timer. */
  flushAll(): void {
    for (const jobId of [...this.pending.keys()]) this.flushJob(jobId)
    this.stopIfIdle()
  }

  private flushJob(jobId: string): void {
    const sample = this.pending.get(jobId)
    if (!sample) return
    this.pending.delete(jobId)
    sample.send(sample.event)
  }

  private start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.flushAll(), this.intervalMs)
    this.timer.unref?.()
  }

  private stopIfIdle(): void {
    if (this.pending.size > 0 || this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }
}
