import { computed, signal } from '@preact/signals'

export interface QueueRow {
  url: string
  title: string
  status: 'pending' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled'
  /** Bound while this row's download is in flight (parallel cancel). */
  jobId?: string
  /** Temp job folder left behind when this row's job was cancelled or failed. */
  partialDir?: string
}

export type QueueRunMode = 'sequential' | 'parallel'

export const queueRows = signal<QueueRow[]>([])
export const queueRunning = signal(false)
export const stopRequested = signal(false)
export const queueRunMode = signal<QueueRunMode>('sequential')

const doneResolvers = new Map<string, (status: 'completed' | 'cancelled' | 'failed') => void>()

export function waitForJob(jobId: string): Promise<'completed' | 'cancelled' | 'failed'> {
  return new Promise((resolve) => {
    doneResolvers.set(jobId, resolve)
  })
}

/** @deprecated Prefer waitForJob(jobId); kept for single-job callers that set one resolver. */
export function waitForCurrentJob(): Promise<'completed' | 'cancelled' | 'failed'> {
  return new Promise((resolve) => {
    doneResolvers.set('__current__', resolve)
  })
}

export function resolveCurrentJob(status: 'completed' | 'cancelled' | 'failed'): void {
  const current = doneResolvers.get('__current__')
  if (current) {
    doneResolvers.delete('__current__')
    current(status)
  }
}

export function resolveJob(jobId: string, status: 'completed' | 'cancelled' | 'failed'): void {
  const resolver = doneResolvers.get(jobId)
  if (resolver) {
    doneResolvers.delete(jobId)
    resolver(status)
  }
  resolveCurrentJob(status)
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
  patch: Partial<Pick<QueueRow, 'status' | 'jobId' | 'partialDir'>>,
): void {
  queueRows.value = queueRows.value.map((row) => (row.url === url ? { ...row, ...patch } : row))
}

/** Count of queue rows with a known leftover partial-download folder. */
export const queueLeftoverCount = computed(
  () => queueRows.value.filter((row) => !!row.partialDir).length,
)

/** Sweeps every leftover partial folder on disk (not just ones tracked in the queue). */
export async function clearAllQueueLeftovers(): Promise<{ ok: boolean }> {
  const res = await window.mf.clearPartials()
  queueRows.value = queueRows.value.map((row) =>
    row.partialDir ? { ...row, partialDir: undefined } : row,
  )
  return { ok: res.ok }
}
