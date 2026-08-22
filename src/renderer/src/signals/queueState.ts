import { signal } from '@preact/signals'

export interface QueueRow {
  url: string
  title: string
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled'
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
