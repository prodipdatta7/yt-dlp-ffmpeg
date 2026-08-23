import {
  clearSettledQueueRows,
  queueRows,
  queueRunning,
  removeQueueRow,
  stopRequested,
} from '../signals/queueState'
import { CheckIcon, CloseIcon, ClockIcon, AlertIcon, Spinner } from './icons'

const STATUS_PILL: Record<string, string> = {
  pending: 'border-white/10 bg-white/[0.03] text-slate-500',
  downloading: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  cancelled: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
}

function StatusGlyph({ status }: { status: string }) {
  if (status === 'downloading') return <Spinner class="size-3.5 shrink-0 text-sky-400" />
  if (status === 'done') return <CheckIcon class="size-3.5 shrink-0 text-emerald-400" />
  if (status === 'failed') return <AlertIcon class="size-3.5 shrink-0 text-rose-400" />
  if (status === 'cancelled') return <CloseIcon class="size-3.5 shrink-0 text-amber-400" />
  return <ClockIcon class="size-3.5 shrink-0 text-slate-600" />
}

export function QueueList({ onCancelActive }: { onCancelActive?: () => void }) {
  const rows = queueRows.value
  const running = queueRunning.value

  const doneCount = rows.filter((r) => r.status === 'done').length
  const failedCount = rows.filter((r) => r.status === 'failed').length
  const settledCount = rows.filter(
    (r) => r.status === 'done' || r.status === 'failed' || r.status === 'cancelled',
  ).length
  const allSettled = rows.length > 0 && !running

  if (rows.length === 0) {
    return (
      <div class="rounded-2xl border border-dashed border-slate-700/50 px-6 py-16 text-center">
        <span class="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] shadow-inner">
          <ClockIcon class="size-5 text-slate-600" />
        </span>
        <p class="text-sm font-medium text-slate-300">Queue is empty</p>
        <p class="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-slate-600">
          Analyze a playlist in the Downloader view and pick entries — they will run here one at a
          time.
        </p>
      </div>
    )
  }

  return (
    <div class="mf-card overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div class="flex items-center gap-2.5">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Download Queue
          </h3>
          <span class="mf-num rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-slate-300">
            {doneCount}/{rows.length} complete
          </span>
          {failedCount > 0 && (
            <span class="mf-num rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
              {failedCount} failed
            </span>
          )}
          {running && (
            <span class="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
              <span class="mf-breathe size-1.5 rounded-full bg-sky-400" />
              running
            </span>
          )}
        </div>
        {running ? (
          onCancelActive && (
            <button
              onClick={onCancelActive}
              class="mf-focus-ring rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300"
            >
              Stop After Current
            </button>
          )
        ) : (
          <span class="flex items-center gap-2.5">
            <span
              className={`text-[11px] font-medium ${allSettled && doneCount > 0 && doneCount === rows.length ? 'text-emerald-400' : 'text-slate-600'}`}
            >
              sequential · one at a time
            </span>
            {settledCount > 0 && (
              <button
                onClick={clearSettledQueueRows}
                title="Remove completed, failed and cancelled entries"
                class="mf-focus-ring rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
              >
                Clear finished · {settledCount}
              </button>
            )}
          </span>
        )}
      </div>

      <div class="h-0.5 w-full bg-white/[0.04]">
        <div
          class={`h-full transition-[width] duration-500 ease-out ${
            failedCount > 0 && doneCount + failedCount === rows.length
              ? 'bg-gradient-to-r from-amber-400 to-rose-400'
              : 'bg-gradient-to-r from-sky-500 to-emerald-400'
          }`}
          style={`width: ${rows.length === 0 ? 0 : ((doneCount + failedCount) / rows.length) * 100}%`}
        />
      </div>

      <ol class="max-h-[calc(100vh-320px)] space-y-1 overflow-y-auto p-2">
        {rows.map((row, i) => (
          <li
            key={row.url}
            class={`group flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
              row.status === 'downloading'
                ? 'border-sky-500/25 bg-sky-500/[0.07]'
                : 'border-transparent hover:bg-white/[0.03]'
            }`}
          >
            <span class="flex min-w-0 items-center gap-3">
              <span class="mf-num w-6 shrink-0 text-right text-[10px] font-semibold text-slate-600">
                {String(i + 1).padStart(2, '0')}
              </span>
              <StatusGlyph status={row.status} />
              <span
                className={`truncate ${
                  row.status === 'downloading'
                    ? 'font-medium text-slate-100'
                    : row.status === 'pending'
                      ? 'text-slate-500'
                      : 'text-slate-300'
                }`}
              >
                {row.title}
              </span>
            </span>
            <span class="flex shrink-0 items-center gap-1.5">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[row.status]}`}
              >
                {row.status}
              </span>
              {!running &&
                (row.status === 'done' ||
                  row.status === 'failed' ||
                  row.status === 'cancelled') && (
                  <button
                    onClick={() => removeQueueRow(row.url)}
                    title="Remove from queue"
                    aria-label={`Remove ${row.title} from queue`}
                    class="mf-focus-ring flex size-6 items-center justify-center rounded-lg text-slate-600 opacity-0 transition hover:bg-white/[0.06] hover:text-rose-300 group-hover:opacity-100"
                  >
                    <CloseIcon class="size-3" />
                  </button>
                )}
            </span>
          </li>
        ))}
      </ol>

      {stopRequested.value && running && (
        <p class="border-t border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          Stopping after the current entry…
        </p>
      )}
    </div>
  )
}
