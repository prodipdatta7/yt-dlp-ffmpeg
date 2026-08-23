import type { JobEvent, JobPhase } from '../../../shared/models'
import { activeJob, jobDone, lastJobEvent, launchError } from '../signals/jobState'
import { AlertIcon, CheckIcon, ClockIcon, GaugeIcon, Spinner } from './icons'

const PHASE_STEPS: Array<{ id: JobPhase; label: string }> = [
  { id: 'queued', label: 'Queued' },
  { id: 'downloading-video', label: 'Video' },
  { id: 'downloading-audio', label: 'Audio' },
  { id: 'merging', label: 'Merge' },
  { id: 'finalizing', label: 'Finalize' },
]

const PHASE_LABELS: Record<JobPhase, string> = {
  queued: 'Queued',
  'downloading-video': 'Downloading video',
  'downloading-audio': 'Downloading audio',
  merging: 'Merging tracks',
  finalizing: 'Finalizing output',
  done: 'Done',
}

function fmtSpeed(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return '— MB/s'
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

function fmtEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '—:—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function MetricChip({
  icon,
  label,
  value,
}: {
  icon: preact.JSX.Element
  label: string
  value: string
}) {
  return (
    <span
      class="mf-num inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-1 text-[11px] font-medium text-slate-300"
      title={`${label}: ${value}`}
    >
      <span class="text-slate-500">{icon}</span>
      <span class="text-slate-600">{label}</span>
      {value}
    </span>
  )
}

export function PipelineStatus({ onRetry }: { onRetry?: () => void }) {
  const job = activeJob.value
  const done = jobDone.value
  const idle = !job && !done

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
    ? 'from-rose-600 to-rose-400'
    : done?.status === 'cancelled'
      ? 'from-amber-500 to-amber-300'
      : 'from-sky-500 via-cyan-400 to-emerald-400'

  return (
    <div class="mf-card mf-rise p-3.5">
      <div class="flex items-center gap-4">
        <div class="flex w-44 min-w-0 shrink-0 items-center gap-2">
          {job ? (
            <Spinner class="size-3.5 shrink-0 text-sky-400" />
          ) : (
            <span
              className={`size-2 shrink-0 rounded-full ${
                failed
                  ? 'bg-rose-500'
                  : done?.status === 'cancelled'
                    ? 'bg-amber-400'
                    : idle
                      ? 'bg-slate-700'
                      : 'bg-emerald-400'
              }`}
            />
          )}
          <span
            class="truncate text-[13px] font-semibold text-slate-100"
            title={event ? PHASE_LABELS[event.phase] : undefined}
          >
            {done
              ? done.status === 'completed'
                ? 'Complete'
                : done.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Failed'
              : job
                ? !event
                  ? 'Preparing…'
                  : isLiveJob
                    ? 'Recording live'
                    : PHASE_LABELS[event.phase]
                : 'Ready'}
          </span>
        </div>

        <div
          class="grid min-w-0 flex-1 items-start"
          style={`grid-template-columns: repeat(${PHASE_STEPS.length}, minmax(0, 1fr))`}
          aria-hidden="true"
        >
          {PHASE_STEPS.map((step, i) => {
            const isStepDone = completedAll || (activeIdx >= 0 && i < activeIdx)
            const isActive = !completedAll && i === activeIdx
            const isErrorActive = isActive && failed
            const reached = isStepDone || isActive
            return (
              <div key={step.id} class="relative flex min-w-0 flex-col items-center gap-1">
                {i > 0 && (
                  <span
                    className={`absolute right-1/2 top-[11px] h-px w-full transition-colors duration-300 ${
                      reached ? 'bg-emerald-400/50' : 'bg-white/[0.08]'
                    }`}
                  />
                )}
                {i < PHASE_STEPS.length - 1 && (
                  <span
                    className={`absolute left-1/2 top-[11px] h-px w-full transition-colors duration-300 ${
                      isStepDone ? 'bg-emerald-400/50' : 'bg-white/[0.08]'
                    }`}
                  />
                )}
                <span
                  className={`relative z-10 flex size-6 items-center justify-center rounded-full border text-[9px] font-bold transition-all duration-300 ${
                    isStepDone
                      ? 'border-emerald-400/70 bg-[#0c2118] text-emerald-300'
                      : isErrorActive
                        ? 'border-rose-500 bg-[#241119] text-rose-300'
                        : isActive
                          ? 'border-sky-400 bg-[#0b1b2c] text-sky-300 shadow-[0_0_10px_-2px_rgb(56_189_248/0.6)]'
                          : 'border-slate-800 bg-[#0d1421] text-slate-700'
                  }`}
                >
                  {isActive && !isErrorActive && (
                    <span class="absolute inline-flex size-full animate-ping rounded-full bg-sky-400/20" />
                  )}
                  {isStepDone ? <CheckIcon class="size-3" /> : i + 1}
                </span>
                <span
                  className={`max-w-full truncate text-[8.5px] font-semibold uppercase tracking-wider transition-colors duration-300 ${
                    isStepDone
                      ? 'text-emerald-400/80'
                      : isActive
                        ? 'text-sky-300'
                        : 'text-slate-700'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        <span className="mf-num w-[76px] shrink-0 bg-gradient-to-br from-white to-slate-400 bg-clip-text text-right text-xl font-bold leading-none text-transparent">
          {idle
            ? '—'
            : percent !== null
              ? `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`
              : '···'}
        </span>

        {job && (
          <button
            onClick={cancel}
            className={`mf-focus-ring shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow transition hover:brightness-110 active:scale-[0.98] ${
              isLiveJob
                ? 'bg-amber-500/90 text-slate-950'
                : 'bg-gradient-to-br from-rose-600 to-rose-500 text-white'
            }`}
          >
            {isLiveJob ? 'Stop & Save' : 'Cancel'}
          </button>
        )}
      </div>

      <div class="mt-3 flex items-center gap-2.5">
        <MetricChip
          icon={<GaugeIcon class="size-3" />}
          label="Speed"
          value={fmtSpeed(event?.speedBps ?? null)}
        />
        <div class="h-2 min-w-0 flex-1 overflow-hidden rounded-full border border-white/[0.05] bg-black/40">
          <div
            role="progressbar"
            aria-valuenow={percent !== null ? Math.round(percent) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            class={`relative h-full rounded-full bg-gradient-to-r ${barColor} transition-[width] duration-500 ease-out ${
              job && percent !== null && percent < 100 ? 'mf-progress-fill' : ''
            }`}
            style={`width: ${idle ? 0 : percent !== null ? Math.max(2, Math.min(100, percent)) : 8}%; box-shadow: 0 0 16px -2px rgb(56 189 248 / 0.45);`}
          />
        </div>
        <MetricChip
          icon={<ClockIcon class="size-3" />}
          label="ETA"
          value={fmtEta(event?.etaSec ?? null)}
        />
      </div>

      {(event?.message || launchError.value) && (
        <p class="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-950/40 px-3 py-1.5 text-xs leading-relaxed text-amber-200">
          <AlertIcon class="mt-0.5 size-3.5 shrink-0" />
          {launchError.value ?? `${event?.message} — partial files are kept and will resume.`}
        </p>
      )}

      {done && (
        <div
          class={`mt-2.5 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-[13px] ${
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
              class="mf-focus-ring shrink-0 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow shadow-sky-500/20 transition hover:brightness-110 active:scale-[0.98]"
            >
              {done.errorCode === 'MF_NETWORK' ? 'Resume Download' : 'Retry Download'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
