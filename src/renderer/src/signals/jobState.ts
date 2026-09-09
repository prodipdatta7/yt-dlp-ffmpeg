import { signal } from '@preact/signals'
import type { JobConfig, JobDonePayload, JobEvent } from '../../../shared/ipcContract'
import { queueRunning } from './queueState'

/** Per-jobId live events (D2a parallel progress). */
export const jobEventsById = signal<Record<string, JobEvent>>({})

/** Active in-flight jobs keyed by jobId. */
export const activeJobsById = signal<Record<string, { config: JobConfig; jobId: string }>>({})

/**
 * Primary/singleton view used by PipelineStatus for single-job runs.
 * When multiple jobs are active (parallel playlist), this prefers the
 * most recently updated event's job, else the first active entry.
 */
export const activeJob = signal<{ config: JobConfig; jobId: string } | null>(null)
export const lastJobEvent = signal<JobEvent | null>(null)
export const jobDone = signal<JobDonePayload | null>(null)

export function beginJob(config: JobConfig, jobId: string): void {
  launchError.value = null
  activeJobsById.value = { ...activeJobsById.value, [jobId]: { config, jobId } }
  activeJob.value = { config, jobId }
  lastJobEvent.value = null
  jobDone.value = null
}

export function applyJobEvent(event: JobEvent): void {
  jobEventsById.value = { ...jobEventsById.value, [event.jobId]: event }
  if (activeJob.value?.jobId === event.jobId || Object.keys(activeJobsById.value).length <= 1) {
    lastJobEvent.value = event
    if (activeJobsById.value[event.jobId]) {
      activeJob.value = activeJobsById.value[event.jobId]
    }
  }
}

export function endJob(done: JobDonePayload): void {
  const rest = { ...activeJobsById.value }
  delete rest[done.jobId]
  activeJobsById.value = rest
  const eventsRest = { ...jobEventsById.value }
  delete eventsRest[done.jobId]
  jobEventsById.value = eventsRest

  jobDone.value = done
  const remaining = Object.values(rest)
  if (remaining.length === 0) {
    activeJob.value = null
    lastJobEvent.value = null
  } else {
    activeJob.value = remaining[0]
    lastJobEvent.value = jobEventsById.value[remaining[0].jobId] ?? null
  }
}

export const lastFailedConfig = signal<JobConfig | null>(null)
export const launchError = signal<string | null>(null)

export function resetJobStatus(): void {
  if (Object.keys(activeJobsById.value).length > 0 || queueRunning.value) return
  jobDone.value = null
  lastJobEvent.value = null
  launchError.value = null
  lastFailedConfig.value = null
  jobEventsById.value = {}
  activeJobsById.value = {}
}
