import { signal } from '@preact/signals'

export interface QueueRow {
  url: string
  title: string
  status: 'pending' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled'
}

export const queueRows = signal<QueueRow[]>([])
export const queueRunning = signal(false)
export const stopRequested = signal(false)

let doneResolver: ((status: 'completed' | 'cancelled' | 'failed') => void) | null = null

export function waitForCurrentJob(): Promise<'completed' | 'cancelled' | 'failed'> {
  return new Promise((resolve) => {
    doneResolver = resolve
  })
}

export function resolveCurrentJob(status: 'completed' | 'cancelled' | 'failed'): void {
  const resolver = doneResolver
  doneResolver = null
  resolver?.(status)
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
