import type { JobEvent, JobPhase } from '../../../shared/models'
import { activeJob, jobDone, lastJobEvent, launchError } from '../signals/jobState'
import { Spinner } from './UrlBar'

const PHASE_STEPS: Array<{ id: JobPhase; label: string }> = [
  { id: 'queued', label: 'Queued' },
  { id: 'downloading-video', label: 'Video' },
  { id: 'downloading-audio', label: 'Audio' },
  { id: 'merging', label: 'Merge' },
  { id: 'finalizing', label: 'Finalize' },
]

const PHASE_LABELS: Record<JobPhase, string> = {
  queued: 'Queued',
  'downloading-video': 'Downloading Video Layer',
  'downloading-audio': 'Downloading Audio Layer',
  merging: 'Merging Media Tracks',
  finalizing: 'Finalizing File Output',
  done: 'Done',
}

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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      class="size-3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  )
}

export function PipelineStatus({ onRetry }: { onRetry?: () => void }) {
  const job = activeJob.value
  const done = jobDone.value
  if (!job && !done) return null

  const event: JobEvent | null = lastJobEvent.value
  const activeIdx = event ? PHASE_STEPS.findIndex((s) => s.id === event.phase) : -1
  const percent = event?.percent ?? (done?.status === 'completed' ? 100 : null)
  const isLiveJob = job?.config.isLive === true
  const failed = done?.status === 'failed'
  const completedAll = done?.status === 'completed'

  function cancel() {
    if (job) void window.mf.downloadCancel(job.jobId)
  }

  const barColor = failed
    ? 'bg-gradient-to-r from-rose-600 to-rose-400'
    : done?.status === 'cancelled'
      ? 'bg-gradient-to-r from-amber-500 to-amber-300'
      : 'bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400'

  return (
    <div class="mf-card w-full max-w-3xl p-5">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2.5">
          {job && <Spinner className="size-4 shrink-0 text-sky-400" />}
          <span class="truncate text-sm font-semibold text-slate-100">
            {!event && !done
              ? 'Preparing…'
              : isLiveJob
                ? 'Recording Live Stream'
                : event
                  ? PHASE_LABELS[event.phase]
                  : done
                    ? 'Finished'
                    : ''}
          </span>
        </div>
        {job && (
          <button
            onClick={cancel}
            class={`shrink-0 rounded-lg px-4 py-1.5 text-xs font-semibold text-white shadow transition hover:brightness-110 active:scale-[0.98] ${
              isLiveJob
                ? 'bg-amber-500/90 text-slate-950'
                : 'bg-gradient-to-br from-rose-600 to-rose-500'
            }`}
          >
            {isLiveJob ? 'Stop Recording & Save' : 'Cancel Download'}
          </button>
        )}
      </div>

      <div class="mt-4 flex items-center">
        {PHASE_STEPS.map((step, i) => {
          const isDone = completedAll || (activeIdx >= 0 && i < activeIdx)
          const isActive = !completedAll && i === activeIdx
          const isErrorActive = isActive && failed
          return (
            <div key={step.id} class="flex flex-1 items-center last:flex-none">
              {i > 0 && (
                <span
                  class={`h-px flex-1 ${isDone || activeIdx > i ? 'bg-emerald-400/50' : 'bg-white/[0.08]'}`}
                />
              )}
              <div class="flex flex-col items-center gap-1.5">
                <span
                  class={`relative flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all duration-300 ${
                    isDone
                      ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300'
                      : isErrorActive
                        ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                        : isActive
                          ? 'border-sky-400 bg-sky-400/15 text-sky-300'
                          : 'border-slate-700 text-slate-600'
                  }`}
                >
                  {isActive && !isErrorActive && (
                    <span class="absolute inline-flex size-full animate-ping rounded-full bg-sky-400/25" />
                  )}
                  {isDone ? <CheckIcon /> : i + 1}
                </span>
                <span
                  className={`text-[9px] font-semibold uppercase tracking-wider ${
                    isDone ? 'text-emerald-400/80' : isActive ? 'text-sky-300' : 'text-slate-600'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          class={`relative h-full rounded-full transition-[width] duration-500 ease-out ${barColor} ${
            job && percent !== null && percent < 100 ? 'mf-progress-fill' : ''
          }`}
          style={`width: ${percent !== null ? Math.max(2, Math.min(100, percent)) : 8}%`}
        />
      </div>

      <div class="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span class="mf-num font-semibold text-slate-200">
          {percent !== null ? `${percent.toFixed(1)}%` : 'Working…'}
        </span>
        <span class="mf-num flex gap-4">
          <span>Speed: {fmtSpeed(event?.speedBps ?? null)}</span>
          <span>ETA: {fmtEta(event?.etaSec ?? null)}</span>
        </span>
      </div>

      {event?.message && (
        <p class="mt-3 rounded-lg border-l-4 border-amber-500/80 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          {event.message} — partial files are kept and will resume automatically.
        </p>
      )}

      {done && (
        <div
          class={`mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm ${
            done.status === 'completed'
              ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-200'
              : done.status === 'cancelled'
                ? 'border-amber-500/30 bg-amber-950/40 text-amber-200'
                : 'border-rose-500/30 bg-rose-950/40 text-rose-200'
          }`}
        >
          <span class="min-w-0 truncate">
            {done.status === 'completed' && (
              <span title={done.outputPath}>✓ Saved to {done.outputPath}</span>
            )}
            {done.status === 'cancelled' && <span>Download cancelled — partial files kept.</span>}
            {done.status === 'failed' && (
              <span>
                {done.errorCode === 'MF_NETWORK'
                  ? 'Network dropped — the download can resume where it stopped.'
                  : done.errorCode === 'MF_RATE_LIMITED'
                    ? 'The platform is rate-limiting requests. Try again shortly.'
                    : 'Download failed. Check the logs for details.'}
              </span>
            )}
          </span>
          {done.status === 'failed' && onRetry && (
            <button
              onClick={onRetry}
              class="shrink-0 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 px-4 py-1.5 text-xs font-semibold text-white shadow shadow-sky-500/20 transition hover:brightness-110 active:scale-[0.98]"
            >
              {done.errorCode === 'MF_NETWORK' ? 'Resume Download' : 'Retry Download'}
            </button>
          )}
        </div>
      )}

      {launchError.value && (
        <p class="mt-2 rounded-lg border-l-4 border-rose-500/80 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          Could not start: {launchError.value}
        </p>
      )}
    </div>
  )
}
