import type { JobEvent, JobPhase } from '../../../shared/models'
import { activeJob, jobDone, lastJobEvent } from '../signals/jobState'

const PHASE_LABELS: Record<JobPhase, string> = {
  queued: 'Queued',
  'downloading-video': 'Downloading Video Layer',
  'downloading-audio': 'Downloading Audio Layer',
  merging: 'Merging Media Tracks',
  finalizing: 'Finalizing File Output',
  done: 'Done',
}

const PHASE_ORDER: JobPhase[] = [
  'queued',
  'downloading-video',
  'downloading-audio',
  'merging',
  'finalizing',
  'done',
]

function fmtSpeed(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return '—'
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

function fmtEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function PipelineStatus() {
  const job = activeJob.value
  const done = jobDone.value
  if (!job && !done) return null

  const event: JobEvent | null = lastJobEvent.value
  const phaseIndex = event ? PHASE_ORDER.indexOf(event.phase) : -1
  const percent = event?.percent ?? (done?.status === 'completed' ? 100 : null)

  function cancel() {
    if (job) void window.mf.downloadCancel(job.jobId)
  }

  return (
    <div class="w-full max-w-5xl rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium text-slate-200">
          {event ? PHASE_LABELS[event.phase] : done ? 'Finished' : 'Preparing…'}
        </span>
        {job && (
          <button
            onClick={cancel}
            class="rounded-lg bg-red-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600"
          >
            Cancel Download
          </button>
        )}
      </div>

      <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          class={`h-full rounded-full transition-all duration-300 ${done?.status === 'failed' ? 'bg-red-500' : done?.status === 'cancelled' ? 'bg-amber-500' : 'bg-sky-500'}`}
          style={`width: ${percent !== null ? Math.max(2, Math.min(100, percent)) : 8}%`}
        />
      </div>

      <div class="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>{percent !== null ? `${percent.toFixed(1)}%` : 'Working…'}</span>
        <span class="flex gap-4">
          <span>Speed: {fmtSpeed(event?.speedBps ?? null)}</span>
          <span>ETA: {fmtEta(event?.etaSec ?? null)}</span>
        </span>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        {PHASE_ORDER.slice(0, 5).map((p, i) => (
          <span
            key={p}
            class={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
              event && i === phaseIndex
                ? 'border-sky-500 bg-sky-950 text-sky-300'
                : event && i < phaseIndex
                  ? 'border-emerald-800 bg-emerald-950/60 text-emerald-400'
                  : 'border-slate-800 text-slate-600'
            }`}
          >
            {PHASE_LABELS[p]}
          </span>
        ))}
      </div>

      {done && (
        <div
          class={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            done.status === 'completed'
              ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
              : done.status === 'cancelled'
                ? 'border-amber-800 bg-amber-950/50 text-amber-300'
                : 'border-red-800 bg-red-950/50 text-red-300'
          }`}
        >
          {done.status === 'completed' && (
            <span title={done.outputPath}>Saved to {done.outputPath}</span>
          )}
          {done.status === 'cancelled' && <span>Download cancelled — partial files kept.</span>}
          {done.status === 'failed' && <span>Download failed. Check the logs for details.</span>}
        </div>
      )}
    </div>
  )
}
