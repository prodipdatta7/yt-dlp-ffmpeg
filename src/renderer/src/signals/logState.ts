import { signal } from '@preact/signals'
import type { LogEntryPayload } from '../../../shared/ipcContract'

const RENDER_CAP = 1500
const FLUSH_MS = 250

export const logEntries = signal<LogEntryPayload[]>([])

let pending: LogEntryPayload[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  flushTimer = null
  if (pending.length === 0) return
  const merged = [...logEntries.value, ...pending]
  pending = []
  logEntries.value = merged.length > RENDER_CAP ? merged.slice(-RENDER_CAP) : merged
}

export function appendLogEntry(entry: LogEntryPayload): void {
  pending.push(entry)
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
}

export function setLogHistory(entries: LogEntryPayload[]): void {
  pending = []
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  logEntries.value = entries.slice(-RENDER_CAP)
}

export function clearLogs(): void {
  pending = []
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  logEntries.value = []
}
