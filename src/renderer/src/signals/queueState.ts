import { computed, signal } from '@preact/signals'

export interface QueueRow {
  url: string
  title: string
  status: 'pending' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled'
  /** Bound while this row's download is in flight (parallel cancel). */
  jobId?: string
  /** Temp job folder left behind when this row's job was cancelled or failed. */
  partialDir?: string
  /** Final output file path, set once this row's download completes. */
  outputPath?: string
  /** True when this row's download was skipped because it already exists at this quality. */
  skipped?: boolean
}

export type QueueRunMode = 'sequential' | 'parallel'

export const queueRows = signal<QueueRow[]>([])
export const queueRunning = signal(false)
export const stopRequested = signal(false)
export const queueRunMode = signal<QueueRunMode>('sequential')

export interface JobResult {
  status: 'completed' | 'cancelled' | 'failed'
  outputPath?: string
  skipped?: boolean
}

const doneResolvers = new Map<string, (result: JobResult) => void>()

/**
 * Completions that arrived before anyone was waiting on them. `waitForJob` registers its
 * resolver only after `downloadStart` returns, so a `job:done` that beats the invoke reply
 * would otherwise find no resolver and the resolver registered afterwards would never
 * settle — the queue would wait forever (P-08). The window is narrow, but the failure is
 * unrecoverable, so this is cheap insurance rather than a hot path.
 */
const earlyResults = new Map<string, JobResult>()
const MAX_EARLY_RESULTS = 32

export function waitForJob(jobId: string): Promise<JobResult> {
  const early = earlyResults.get(jobId)
  if (early) {
    earlyResults.delete(jobId)
    return Promise.resolve(early)
  }
  return new Promise((resolve) => {
    doneResolvers.set(jobId, resolve)
  })
}

/** @deprecated Prefer waitForJob(jobId); kept for single-job callers that set one resolver. */
export function waitForCurrentJob(): Promise<JobResult> {
  return new Promise((resolve) => {
    doneResolvers.set('__current__', resolve)
  })
}

export function resolveCurrentJob(result: JobResult): void {
  const current = doneResolvers.get('__current__')
  if (current) {
    doneResolvers.delete('__current__')
    current(result)
  }
}

export function resolveJob(jobId: string, result: JobResult): void {
  const resolver = doneResolvers.get(jobId)
  if (resolver) {
    doneResolvers.delete(jobId)
    resolver(result)
  } else {
    // Map iterates in insertion order, so the first key is the oldest.
    if (earlyResults.size >= MAX_EARLY_RESULTS) {
      const oldest = earlyResults.keys().next()
      if (!oldest.done) earlyResults.delete(oldest.value)
    }
    earlyResults.set(jobId, result)
  }
  resolveCurrentJob(result)
}

/** Test seam: how many completions are buffered awaiting a waiter. */
export function earlyResultCount(): number {
  return earlyResults.size
}

const isSettled = (row: QueueRow): boolean =>
  row.status === 'done' ||
  row.status === 'failed' ||
  row.status === 'cancelled' ||
  row.status === 'paused'

/** Removes completed/failed/cancelled rows; ignored while a queue run owns the row order. */
export function clearSettledQueueRows(): void {
  if (queueRunning.value) return
  queueRows.value = queueRows.value.filter((row) => !isSettled(row))
}

export function removeQueueRow(url: string): void {
  if (queueRunning.value) return
  queueRows.value = queueRows.value.filter((row) => row.url !== url)
}

export function reorderQueueRows(fromIndex: number, toIndex: number): void {
  if (queueRunning.value) return
  const rows = [...queueRows.value]
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= rows.length ||
    toIndex >= rows.length ||
    fromIndex === toIndex
  ) {
    return
  }
  if (rows[fromIndex].status !== 'pending' || rows[toIndex].status !== 'pending') return
  const [moved] = rows.splice(fromIndex, 1)
  rows.splice(toIndex, 0, moved)
  queueRows.value = rows
}

export function patchQueueRow(
  url: string,
  patch: Partial<Pick<QueueRow, 'status' | 'jobId' | 'partialDir' | 'outputPath' | 'skipped'>>,
): void {
  queueRows.value = queueRows.value.map((row) => (row.url === url ? { ...row, ...patch } : row))
}

/** Count of queue rows with a known leftover partial-download folder. */
export const queueLeftoverCount = computed(
  () => queueRows.value.filter((row) => !!row.partialDir).length,
)

/**
 * Clears the queue tab for a brand-new analysis (e.g. a fresh "Analyze" submit).
 * Ignored while a queue run owns the rows — that run's own `finally` block clears
 * `queueRunning` and any leftover UI once it actually settles.
 */
export function resetQueueForNewAnalysis(): void {
  if (queueRunning.value) return
  queueRows.value = []
  stopRequested.value = false
  // Buffered completions belong to the queue that just went away.
  earlyResults.clear()
}

/** Sweeps every leftover partial folder on disk (not just ones tracked in the queue). */
export async function clearAllQueueLeftovers(): Promise<{ ok: boolean }> {
  const res = await window.mf.clearPartials()
  queueRows.value = queueRows.value.map((row) =>
    row.partialDir ? { ...row, partialDir: undefined } : row,
  )
  return { ok: res.ok }
}
