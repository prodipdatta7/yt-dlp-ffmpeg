import { useRef, useState } from 'preact/hooks'
import {
  clearAllQueueLeftovers,
  clearSettledQueueRows,
  patchQueueRow,
  queueLeftoverCount,
  queueRows,
  queueRunMode,
  queueRunning,
  removeQueueRow,
  reorderQueueRows,
  stopRequested,
} from '../signals/queueState'
import { jobEventsById, lastJobEvent } from '../signals/jobState'
import { fmtEta, fmtSize, fmtSpeed } from '../utils/format'
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  FolderIcon,
  GaugeIcon,
  HardDriveIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  Spinner,
} from './icons'

const STATUS_PILL: Record<string, string> = {
  pending: 'border-line-strong bg-wash-1 text-slate-500',
  downloading: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  paused: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  skipped: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  cancelled: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
}

function StatusGlyph({ status }: { status: string }) {
  if (status === 'downloading') return <Spinner class="size-3.5 shrink-0 text-sky-400" />
  if (status === 'paused') return <PauseIcon class="size-3.5 shrink-0 text-amber-400" />
  if (status === 'skipped') return <InfoIcon class="size-3.5 shrink-0 text-sky-400" />
  if (status === 'done') return <CheckIcon class="size-3.5 shrink-0 text-emerald-400" />
  if (status === 'failed') return <AlertIcon class="size-3.5 shrink-0 text-rose-400" />
  if (status === 'cancelled') return <CloseIcon class="size-3.5 shrink-0 text-amber-400" />
  return <ClockIcon class="size-3.5 shrink-0 text-slate-600" />
}

export function QueueList({
  onStopAfterCurrent,
  onCancelAll,
  onCancelRow,
  onRetryRow,
}: {
  onStopAfterCurrent?: () => void
  onCancelAll?: () => void
  onCancelRow?: (url: string) => void
  onRetryRow?: (url: string) => void
}) {
  const rows = queueRows.value
  const running = queueRunning.value
  const parallel = queueRunMode.value === 'parallel'
  const events = jobEventsById.value
  const legacyEvent = running && !parallel ? lastJobEvent.value : null
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [clearingUrl, setClearingUrl] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)

  async function clearRowPartial(url: string, partialDir: string) {
    setClearingUrl(url)
    try {
      const res = await window.mf.clearPartials(partialDir)
      if (res.ok) patchQueueRow(url, { partialDir: undefined })
    } finally {
      setClearingUrl((prev) => (prev === url ? null : prev))
    }
  }

  async function clearAllLeftovers() {
    setClearingAll(true)
    try {
      await clearAllQueueLeftovers()
    } finally {
      setClearingAll(false)
    }
  }

  const doneCount = rows.filter((r) => r.status === 'done').length
  const failedCount = rows.filter((r) => r.status === 'failed').length
  const settledCount = rows.filter(
    (r) => r.status === 'done' || r.status === 'failed' || r.status === 'cancelled',
  ).length
  const allSettled = rows.length > 0 && !running

  if (rows.length === 0) {
    return (
      <div class="rounded-2xl border border-dashed border-slate-700/50 px-6 py-16 text-center">
        <span class="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-line bg-wash-1 shadow-inner">
          <ClockIcon class="size-5 text-slate-600" />
        </span>
        <p class="text-sm font-medium text-slate-300">Queue is empty</p>
        <p class="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-slate-600">
          Analyze a playlist in the Downloader view and pick entries — run them sequentially or in
          parallel from there.
        </p>
      </div>
    )
  }

  return (
    <div class="mf-card overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div class="flex items-center gap-2.5">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Download Queue
          </h3>
          <span class="mf-num rounded-full border border-line-strong bg-wash-1 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
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
              {parallel ? 'parallel' : 'running'}
            </span>
          )}
        </div>
        {running ? (
          <span class="flex items-center gap-2">
            {onStopAfterCurrent && (
              <button
                onClick={onStopAfterCurrent}
                class="mf-focus-ring rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300"
              >
                Stop After Current
              </button>
            )}
            {onCancelAll && (
              <button
                onClick={onCancelAll}
                class="mf-focus-ring rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
              >
                Cancel All
              </button>
            )}
            {queueLeftoverCount.value > 0 && (
              <button
                type="button"
                disabled={clearingAll}
                onClick={() => void clearAllLeftovers()}
                title="Delete every leftover partial-download folder from disk"
                class="mf-focus-ring flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
              >
                <HardDriveIcon class="size-3.5" />
                {clearingAll ? 'Clearing…' : `Clear leftovers · ${queueLeftoverCount.value}`}
              </button>
            )}
          </span>
        ) : (
          <span class="flex items-center gap-2.5">
            <span
              className={`text-[11px] font-medium ${allSettled && doneCount > 0 && doneCount === rows.length ? 'text-emerald-400' : 'text-slate-600'}`}
            >
              {parallel ? 'parallel · capped' : 'sequential · one at a time'}
            </span>
            {settledCount > 0 && (
              <button
                onClick={clearSettledQueueRows}
                title="Remove completed, failed and cancelled entries"
                class="mf-focus-ring rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
              >
                Clear finished · {settledCount}
              </button>
            )}
            {queueLeftoverCount.value > 0 && (
              <button
                type="button"
                disabled={clearingAll}
                onClick={() => void clearAllLeftovers()}
                title="Delete every leftover partial-download folder from disk"
                class="mf-focus-ring flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
              >
                <HardDriveIcon class="size-3.5" />
                {clearingAll ? 'Clearing…' : `Clear leftovers · ${queueLeftoverCount.value}`}
              </button>
            )}
          </span>
        )}
      </div>

      <div class="h-0.5 w-full bg-wash-1">
        <div
          class={`h-full transition-[width] duration-500 ease-out ${
            failedCount > 0 && doneCount + failedCount === rows.length
              ? 'bg-gradient-to-r from-amber-400 to-rose-400'
              : 'bg-gradient-to-r from-go-500 to-go-400'
          }`}
          style={`width: ${rows.length === 0 ? 0 : ((doneCount + failedCount) / rows.length) * 100}%`}
        />
      </div>

      <ol class="max-h-[calc(100vh-320px)] space-y-1 overflow-y-auto p-2">
        {rows.map((row, i) => {
          const isLive = running && row.status === 'downloading'
          const event = (row.jobId ? events[row.jobId] : undefined) ?? (isLive ? legacyEvent : null)
          const livePercent =
            event?.percent !== null && event?.percent !== undefined
              ? Math.max(2, Math.min(100, event.percent))
              : null
          const canDrag = !running && row.status === 'pending'
          const displayStatus = row.status === 'done' && row.skipped ? 'skipped' : row.status
          return (
            <li
              key={row.url}
              draggable={canDrag}
              onDragStart={() => {
                dragFrom.current = i
              }}
              onDragOver={(e) => {
                if (!canDrag) return
                e.preventDefault()
                setDragOver(i)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragFrom.current
                setDragOver(null)
                dragFrom.current = null
                if (from !== null) reorderQueueRows(from, i)
              }}
              class={`group mf-skip-offscreen-row mf-row-hover rounded-xl border px-3 py-2.5 text-sm ${
                isLive
                  ? 'border-sky-500/25 bg-sky-500/[0.07]'
                  : dragOver === i
                    ? 'border-sky-400/40 bg-wash-2'
                    : 'border-transparent hover:bg-wash-1'
              } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              <div class="flex items-center justify-between gap-3">
                <span class="flex min-w-0 items-center gap-3">
                  <span class="mf-num w-6 shrink-0 text-right text-[10px] font-semibold text-slate-600">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <StatusGlyph status={displayStatus} />
                  <span
                    className={`mf-select-text truncate ${
                      isLive
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
                  {row.status === 'done' && row.skipped && (
                    <span class="hidden text-[10.5px] text-sky-400/80 sm:inline">
                      already exists
                    </span>
                  )}
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[displayStatus]}`}
                    title={
                      row.status === 'done' && row.skipped
                        ? 'A file for this video already exists at this quality'
                        : undefined
                    }
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {displayStatus}
                  </span>
                  {row.status === 'done' && row.outputPath && (
                    <>
                      <button
                        type="button"
                        onClick={() => void window.mf.openFile(row.outputPath!)}
                        title="Play video"
                        aria-label={`Play ${row.title}`}
                        class="mf-focus-ring flex size-6 items-center justify-center rounded-lg text-slate-500 transition hover:bg-wash-2 hover:text-emerald-300"
                      >
                        <PlayIcon class="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.mf.revealPath(row.outputPath!)}
                        title="Open file location"
                        aria-label={`Open file location for ${row.title}`}
                        class="mf-focus-ring flex size-6 items-center justify-center rounded-lg text-slate-500 transition hover:bg-wash-2 hover:text-sky-300"
                      >
                        <FolderIcon class="size-3" />
                      </button>
                    </>
                  )}
                  {isLive && onCancelRow && (
                    <button
                      onClick={() => onCancelRow(row.url)}
                      title="Cancel this download"
                      aria-label={`Cancel ${row.title}`}
                      class="mf-focus-ring flex size-6 items-center justify-center rounded-lg text-slate-500 transition hover:bg-wash-2 hover:text-rose-300"
                    >
                      <CloseIcon class="size-3" />
                    </button>
                  )}
                  {!running && row.status === 'failed' && onRetryRow && (
                    <button
                      onClick={() => onRetryRow(row.url)}
                      class="mf-focus-ring rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300 transition hover:bg-sky-500/20"
                    >
                      Retry
                    </button>
                  )}
                  {!running &&
                    (row.status === 'done' ||
                      row.status === 'failed' ||
                      row.status === 'cancelled' ||
                      row.status === 'paused') && (
                      <button
                        onClick={() => removeQueueRow(row.url)}
                        title="Remove from queue"
                        aria-label={`Remove ${row.title} from queue`}
                        class="mf-focus-ring flex size-6 items-center justify-center rounded-lg text-slate-600 opacity-0 transition hover:bg-wash-2 hover:text-rose-300 group-hover:opacity-100"
                      >
                        <CloseIcon class="size-3" />
                      </button>
                    )}
                </span>
              </div>

              {isLive && (
                <div class="mt-1.5 flex items-center gap-2.5 pl-9">
                  <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-500/20">
                    <div
                      role="progressbar"
                      aria-valuenow={livePercent !== null ? Math.round(livePercent) : undefined}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.title} download progress`}
                      class={`relative h-full rounded-full bg-gradient-to-r from-go-500 to-go-400 transition-[width] duration-500 ease-out ${
                        livePercent !== null && livePercent < 100 ? 'mf-progress-fill' : ''
                      }`}
                      style={`width: ${livePercent ?? 6}%;`}
                    />
                  </div>
                  <span class="mf-num w-9 shrink-0 text-right text-[11px] font-bold text-sky-400">
                    {livePercent !== null ? `${Math.round(livePercent)}%` : '···'}
                  </span>
                  {event?.downloadedBytes != null && (
                    <span class="mf-num hidden items-center gap-1 text-[10.5px] text-slate-500 lg:inline-flex">
                      {fmtSize(event.downloadedBytes)}
                      {event.totalBytes != null ? ` / ${fmtSize(event.totalBytes)}` : ''}
                    </span>
                  )}
                  <span class="mf-num hidden items-center gap-1 text-[10.5px] text-slate-500 sm:inline-flex">
                    <GaugeIcon class="size-3 shrink-0" />
                    {fmtSpeed(event?.speedBps ?? null)}
                  </span>
                  <span class="mf-num inline-flex items-center gap-1 text-[10.5px] text-slate-500">
                    <ClockIcon class="size-3 shrink-0" />
                    {fmtEta(event?.etaSec ?? null)}
                  </span>
                </div>
              )}

              {!running && row.partialDir && (
                <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 pl-9 text-[10.5px] text-amber-200/90">
                  <span class="inline-flex min-w-0 items-center gap-1.5">
                    <HardDriveIcon class="size-3 shrink-0" />
                    <span class="truncate" title={row.partialDir}>
                      Leftover partial download on disk
                    </span>
                  </span>
                  <span class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void window.mf.openPartialDir(row.partialDir!)}
                      class="mf-focus-ring flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 transition hover:text-sky-200"
                    >
                      <FolderIcon class="size-3" />
                      open
                    </button>
                    <button
                      type="button"
                      disabled={clearingUrl === row.url}
                      onClick={() => void clearRowPartial(row.url, row.partialDir!)}
                      class="mf-focus-ring rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                    >
                      {clearingUrl === row.url ? 'clearing…' : 'clear'}
                    </button>
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {stopRequested.value && running && queueRunMode.value === 'sequential' && (
        <p class="border-t border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          Stopping after the current entry…
        </p>
      )}
    </div>
  )
}
