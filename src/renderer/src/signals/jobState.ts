import { signal } from '@preact/signals'
import type { JobConfig, JobDonePayload, JobEvent } from '../../../shared/ipcContract'

export const activeJob = signal<{ config: JobConfig; jobId: string } | null>(null)
export const lastJobEvent = signal<JobEvent | null>(null)
export const jobDone = signal<JobDonePayload | null>(null)

export function beginJob(config: JobConfig, jobId: string): void {
  jobDone.value = null
  lastJobEvent.value = null
  launchError.value = null
  activeJob.value = { config, jobId }
}

export function endJob(done: JobDonePayload): void {
  jobDone.value = done
  activeJob.value = null
}

export const lastFailedConfig = signal<JobConfig | null>(null)
export const launchError = signal<string | null>(null)
