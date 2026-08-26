import type { JobEvent, JobPhase } from '../../../shared/models'
import { ERROR_MESSAGES } from '../../../shared/models'
import { activeJob, jobDone, lastJobEvent, launchError } from '../signals/jobState'
import { fmtEta, fmtSize, fmtSpeed } from '../utils/format'
import {
  AlertIcon,
  ClockIcon,
  GaugeIcon,
  HardDriveIcon,
  PauseIcon,
  PlayIcon,
  Spinner,
} from './icons'

const PHASE_LABELS: Record<JobPhase, string> = {
  queued: 'Queued',
  'downloading-video': 'Downloading video',
  'downloading-audio': 'Downloading audio',
  merging: 'Merging tracks',
  finalizing: 'Finalizing output',
  done: 'Done',
}

const PHASE_STEPS: Array<{ id: JobPhase; label: string }> = [
  { id: 'downloading-video', label: 'Video' },
  { id: 'downloading-audio', label: 'Audio' },
  { id: 'merging', label: 'Merge' },
  { id: 'finalizing', label: 'Finalize' },
]

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
      class="mf-num inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-400"
      title={`${label}: ${value}`}
    >
      {icon}
      {value}
    </span>
  )
}

export function PipelineStatus({
  onRetry,
  onCancel,
  onPause,
  paused = false,
  onResume,
}: {
  onRetry?: () => void
  onCancel?: () => void
  onPause?: () => void
  paused?: boolean
  onResume?: () => void
}) {
  const job = activeJob.value
  const done = jobDone.value
  const idle = !job && !done

  const event: JobEvent | null = lastJobEvent.value
  const percent = event?.percent ?? (done?.status === 'completed' ? 100 : null)
  const isLiveJob = job?.config.isLive === true
  const failed = done?.status === 'failed'
  const completedAll = done?.status === 'completed'

  function cancel() {
    if (onCancel) {
      onCancel()
      return
    }
    if (job) void window.mf.downloadCancel(job.jobId)
  }

  function statusLabel(): string {
    if (paused) return 'Paused'
    if (done) {
      if (done.status === 'completed') return 'Complete'
      if (done.status === 'cancelled') return 'Cancelled'
      return failed && done.errorCode === 'MF_NETWORK' ? 'Network lost' : 'Failed'
    }
    if (!job) return 'Ready'
    if (!event) return 'Preparing…'
    return isLiveJob ? 'Recording live' : PHASE_LABELS[event.phase]
  }

  function pauseBlocked(): boolean {
    return (
      event?.phase === 'merging' ||
      event?.phase === 'finalizing' ||
      event?.phase === 'queued' ||
      isLiveJob
    )
  }

  const barColor = failed
    ? 'from-rose-600 to-rose-400'
    : done?.status === 'cancelled'
      ? 'from-amber-500 to-amber-300'
      : 'from-go-500 to-go-400'

  const pctColor = paused
    ? 'text-amber-400'
    : failed
      ? 'text-rose-400'
      : done?.status === 'cancelled'
        ? 'text-amber-400'
        : completedAll
          ? 'text-emerald-400'
          : 'text-sky-400'

  const activeIdx = event ? PHASE_STEPS.findIndex((s) => s.id === event.phase) : -1
  const showStepper = (!!job && !!event) || paused

  return (
    <div class="mf-rise shrink-0 rounded-xl border border-[var(--mf-line)] bg-[var(--surface-card-hi)] shadow-sm">
      <div class="flex items-center gap-3 px-3.5 py-2">
        {job ? (
          <Spinner class="size-3.5 shrink-0 text-sky-400" />
        ) : (
          <span
            className={`size-2 shrink-0 rounded-full ${
              paused
                ? 'bg-amber-400'
                : failed
                  ? 'bg-rose-500'
                  : done?.status === 'cancelled'
                    ? 'bg-amber-400'
                    : idle
                      ? 'bg-slate-600'
                      : 'bg-emerald-400'
            }`}
          />
        )}
        <span
          class="w-28 min-w-0 shrink-0 truncate text-xs font-semibold text-slate-200"
          title={event ? PHASE_LABELS[event.phase] : undefined}
        >
          {statusLabel()}
        </span>

        {showStepper && (
          <div class="flex min-w-0 shrink-0 items-center gap-1" aria-hidden="true">
            {PHASE_STEPS.map((step, i) => {
              const stepDone = paused
                ? activeIdx > 0 && i < activeIdx
                : completedAll || (activeIdx >= 0 && i < activeIdx)
              const stepActive = !completedAll && !paused && i === activeIdx
              return (
                <span key={step.id} class="flex items-center gap-1">
                  {i > 0 && (
                    <span
                      className={`h-px w-3.5 ${stepDone || (paused && i <= activeIdx) ? 'bg-emerald-400/50' : 'bg-slate-600/50'}`}
                    />
                  )}
                  <span
                    className={`size-1.5 rounded-full transition-colors duration-300 ${
                      stepDone ? 'bg-emerald-400' : stepActive ? 'bg-sky-400' : 'bg-slate-600'
                    } ${stepActive ? 'mf-breathe' : ''}`}
                  />
                  <span
                    className={`text-[9px] font-semibold uppercase tracking-wider transition-colors duration-300 ${
                      stepDone
                        ? 'text-emerald-400/80'
                        : stepActive
                          ? 'text-sky-300'
                          : 'text-slate-600'
                    }`}
                  >
                    {step.label}
                  </span>
                </span>
              )
            })}
          </div>
        )}

        <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-500/20">
          <div
            role="progressbar"
            aria-valuenow={percent !== null ? Math.round(percent) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Download progress"
            class={`relative h-full rounded-full bg-gradient-to-r ${barColor} transition-[width] duration-500 ease-out ${
              job && percent !== null && percent < 100 ? 'mf-progress-fill' : ''
            }`}
            style={`width: ${idle || (!paused && done && !completedAll) ? 0 : percent !== null ? Math.max(2, Math.min(100, percent)) : 8}%;`}
          />
        </div>

        <span
          className={`mf-num w-[52px] shrink-0 text-right text-sm font-bold leading-none ${pctColor}`}
        >
          {idle
            ? '—'
            : percent !== null
              ? `${Math.max(0, Math.min(100, Math.round(percent)))}%`
              : '···'}
        </span>

        {event?.downloadedBytes != null && event.downloadedBytes > 0 && (
          <MetricChip
            icon={<HardDriveIcon class="size-3" />}
            label="Size"
            value={
              event.totalBytes != null
                ? `${fmtSize(event.downloadedBytes)} / ${fmtSize(event.totalBytes)}`
                : fmtSize(event.downloadedBytes)
            }
          />
        )}
        <MetricChip
          icon={<GaugeIcon class="size-3" />}
          label="Speed"
          value={fmtSpeed(event?.speedBps ?? null)}
        />
        <MetricChip
          icon={<ClockIcon class="size-3" />}
          label="ETA"
          value={fmtEta(event?.etaSec ?? null)}
        />

        {job ? (
          <span class="flex shrink-0 items-center gap-1.5">
            {!pauseBlocked() && (
              <button
                onClick={() => onPause?.()}
                title="Pause — keeps partial files, resume continues where it stopped"
                class="mf-focus-ring inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20 active:scale-[0.98]"
              >
                <PauseIcon class="size-3" />
                Pause
              </button>
            )}
            <button
              onClick={cancel}
              className={`mf-focus-ring rounded-lg border px-3 py-1 text-xs font-semibold transition hover:brightness-110 active:scale-[0.98] ${
                isLiveJob
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
              }`}
            >
              {isLiveJob ? 'Stop & Save' : 'Cancel'}
            </button>
          </span>
        ) : paused ? (
          <button
            onClick={onResume}
            class="mf-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-go-500 to-go-400 px-3 py-1 text-xs font-bold text-white shadow shadow-go-500/25 transition hover:brightness-110 active:scale-[0.98]"
          >
            <PlayIcon class="size-3" />
            Resume
          </button>
        ) : (
          done &&
          done.status === 'failed' &&
          onRetry && (
            <button
              onClick={onRetry}
              class="mf-focus-ring shrink-0 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 px-3 py-1 text-xs font-semibold text-white shadow shadow-sky-500/20 transition hover:brightness-110 active:scale-[0.98]"
            >
              {done.errorCode === 'MF_NETWORK' ? 'Resume Download' : 'Retry Download'}
            </button>
          )
        )}
      </div>

      {paused ? (
        <p class="flex items-start gap-2 border-t border-[var(--mf-line)] px-3.5 py-1.5 text-xs leading-relaxed text-slate-400">
          <PauseIcon class="mt-0.5 size-3.5 shrink-0 text-amber-400" />
          Paused — partial files are kept. Resume continues from where it stopped.
        </p>
      ) : (
        (event?.message || launchError.value) && (
          <p class="flex items-start gap-2 border-t border-[var(--mf-line)] px-3.5 py-1.5 text-xs leading-relaxed text-amber-300">
            <AlertIcon class="mt-0.5 size-3.5 shrink-0" />
            {launchError.value ?? `${event?.message} — partial files are kept and will resume.`}
          </p>
        )
      )}

      {done && !paused && (
        <div
          class={`flex items-center justify-between gap-3 border-t border-[var(--mf-line)] px-3.5 py-1.5 text-xs ${
            done.status === 'completed'
              ? 'text-emerald-300'
              : done.status === 'cancelled'
                ? 'text-amber-300'
                : 'text-rose-300'
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
                    : (ERROR_MESSAGES[done.errorCode ?? 'MF_UNKNOWN'] ??
                      'Download failed. Check the logs for details.')}
              </span>
            )}
          </span>
          {done.status === 'completed' && (
            <button
              onClick={() => void window.mf.openLogsFolder()}
              class="mf-focus-ring shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 transition hover:text-slate-200"
            >
              open folder
            </button>
          )}
        </div>
      )}
    </div>
  )
}
