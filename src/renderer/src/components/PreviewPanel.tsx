import { useState } from 'preact/hooks'
import type { AnalyzeResult } from '../../../shared/models'
import { fmtCount, fmtDuration, fmtEta, fmtSize, fmtSpeed } from '../utils/format'
import { sourceLabel } from '../utils/source'
import { jobEventsById, lastJobEvent } from '../signals/jobState'
import {
  clearAllQueueLeftovers,
  patchQueueRow,
  queueLeftoverCount,
  queueRows,
  queueRunMode,
  queueRunning,
} from '../signals/queueState'
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EyeIcon,
  FilmIcon,
  FolderIcon,
  GaugeIcon,
  HardDriveIcon,
  InfoIcon,
  LayersIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  SlidersIcon,
  Spinner,
} from './icons'
import { Pill, StatTile } from './ui'
import { InlineVideoPreview, InlineVideoPreviewModal } from './InlineVideoPreview'

function LiveBadge() {
  return (
    <span class="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-rose-600/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
      <span class="mf-breathe size-1.5 rounded-full bg-white" />
      Live
    </span>
  )
}

function DurationBadge({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null
  return (
    <span class="mf-num absolute bottom-1.5 right-1.5 rounded-md bg-scrim/80 px-1.5 py-0.5 text-[11px] font-semibold text-paper backdrop-blur-sm">
      {fmtDuration(seconds)}
    </span>
  )
}

export function CheckSquare({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      class={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 ${
        checked || partial
          ? 'border-sky-500 bg-sky-500 text-white'
          : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-transparent group-hover:border-neutral-400 dark:group-hover:border-neutral-600'
      }`}
      aria-hidden="true"
    >
      {checked && <CheckIcon class="size-3" />}
      {partial && !checked && <span class="h-[2px] w-2 rounded-full bg-white" />}
    </span>
  )
}

function ThumbFrame({
  children,
  className = '',
}: {
  children?: preact.ComponentChildren
  className?: string
}) {
  return (
    <div
      className={`group relative shrink-0 overflow-hidden rounded-xl border border-line-strong shadow-[var(--mf-thumb-shadow)] ${className}`}
    >
      {children}
      <div class="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-line" />
    </div>
  )
}

export function LoadingSkeleton() {
  return (
    <div class="mf-card w-full p-5">
      <div class="flex flex-col gap-5 sm:flex-row">
        <div class="mf-skeleton aspect-video shrink-0 rounded-xl sm:w-72" />
        <div class="flex min-w-0 flex-1 flex-col gap-3 py-1">
          <div class="mf-skeleton h-5 w-3/4" />
          <div class="mf-skeleton h-3.5 w-1/3" />
          <div class="mt-auto grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} class="mf-skeleton h-14 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
      <p class="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
        Fetching metadata and stream details…
      </p>
    </div>
  )
}

/** Horizontal banner for a single video — pairs with the tabbed panel below it. */
export function VideoBanner({ result }: { result: AnalyzeResult }) {
  const { metadata } = result
  const [previewActive, setPreviewActive] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const source = sourceLabel(metadata.webpageUrl)
  const chips: Array<{ Icon: typeof ClockIcon; text: string }> = []
  if (metadata.durationSec !== null)
    chips.push({ Icon: ClockIcon, text: fmtDuration(metadata.durationSec) })
  if (metadata.viewCount !== null)
    chips.push({ Icon: EyeIcon, text: `${fmtCount(metadata.viewCount)} views` })
  if (metadata.uploadDate) chips.push({ Icon: CalendarIcon, text: metadata.uploadDate })
  chips.push({ Icon: LayersIcon, text: `${result.formats.length} streams` })

  return (
    <div class="mf-card mf-card-hover flex shrink-0 items-stretch gap-4 p-3.5">
      {previewActive ? (
        <ThumbFrame className="w-52 sm:w-60 aspect-video">
          <InlineVideoPreview
            url={metadata.webpageUrl}
            title={metadata.title}
            onClose={() => setPreviewActive(false)}
            onExpand={() => setModalOpen(true)}
            className="size-full"
          />
        </ThumbFrame>
      ) : metadata.thumbnailUrl ? (
        <ThumbFrame className="group relative w-44 sm:w-52 aspect-video cursor-pointer">
          <img
            src={metadata.thumbnailUrl}
            alt=""
            class="aspect-video size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
          <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-scrim/45 via-transparent to-transparent" />
          <button
            type="button"
            onClick={() => setPreviewActive(true)}
            title="Play inline video preview"
            class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-black/45"
          >
            <span class="flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-95">
              <PlayIcon class="size-3.5 fill-white" />
              <span>Preview</span>
            </span>
          </button>
          {metadata.isLive ? <LiveBadge /> : <DurationBadge seconds={metadata.durationSec} />}
        </ThumbFrame>
      ) : (
        <ThumbFrame className="group relative flex w-44 items-center justify-center sm:w-52 aspect-video cursor-pointer">
          <span class="flex aspect-video size-full items-center justify-center bg-gradient-to-br from-sky-500/20 to-indigo-500/15">
            <PlayIcon class="size-6 text-slate-400" />
          </span>
          <button
            type="button"
            onClick={() => setPreviewActive(true)}
            title="Play inline video preview"
            class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-black/45"
          >
            <span class="flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-95">
              <PlayIcon class="size-3.5 fill-white" />
              <span>Preview</span>
            </span>
          </button>
          {metadata.isLive ? <LiveBadge /> : <DurationBadge seconds={metadata.durationSec} />}
        </ThumbFrame>
      )}

      <div class="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <h2
          class="mf-select-text line-clamp-2 text-lg font-bold leading-snug tracking-tight text-ink"
          title={metadata.title}
        >
          {metadata.title}
        </h2>
        <p class="truncate text-[13px] font-medium text-sky-300/90">
          {metadata.uploader ?? 'Unknown channel'}
        </p>
        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500">
          {source && (
            <Pill tone="sky">
              <FilmIcon class="size-3" />
              {source}
            </Pill>
          )}
          {chips.map(({ Icon, text }, i) => (
            <span key={i} class="inline-flex items-center gap-1.5">
              <Icon class="size-3 shrink-0" />
              <span class="mf-num">{text}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setPreviewActive(!previewActive)}
            title={previewActive ? 'Close inline preview' : 'Preview video'}
            class={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold transition ${
              previewActive
                ? 'border-sky-500 bg-sky-500/15 text-sky-400'
                : 'border-line-strong bg-recess/60 text-ink hover:bg-wash-1 hover:text-sky-400'
            }`}
          >
            <EyeIcon class="size-3" />
            <span>{previewActive ? 'Close Preview' : 'Preview Video'}</span>
          </button>
          {metadata.isLive && (
            <Pill tone="rose">
              <span class="mf-breathe size-1.5 rounded-full bg-current" />
              live now
            </Pill>
          )}
        </div>
      </div>

      {modalOpen && (
        <InlineVideoPreviewModal
          url={metadata.webpageUrl}
          title={metadata.title}
          uploader={metadata.uploader}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

/** Compact header banner for playlists — pairs with the tabbed panel below it. */
export function PlaylistBanner({
  result,
  hydration,
}: {
  result: AnalyzeResult
  hydration?: { done: number; total: number } | null
}) {
  const { metadata } = result
  const total = (result.playlistEntries ?? []).length
  const hydrating = !!hydration && hydration.done < hydration.total
  const source = sourceLabel(metadata.webpageUrl)

  return (
    <div class="mf-card mf-card-hover flex shrink-0 items-center gap-3.5 p-3.5">
      {metadata.thumbnailUrl ? (
        <img
          src={metadata.thumbnailUrl}
          alt=""
          class="size-14 shrink-0 rounded-xl border border-line-strong object-cover shadow-[var(--mf-thumb-shadow)]"
        />
      ) : (
        <span class="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-sky-400/25 bg-gradient-to-br from-sky-500/30 via-indigo-500/25 to-violet-500/20 shadow-inner">
          <LayersIcon class="size-6 text-ink/85" />
          <span class="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-line" />
        </span>
      )}
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex flex-wrap items-center gap-2">
          <Pill tone="violet">
            <LayersIcon class="size-3" />
            Playlist
          </Pill>
          {source && (
            <Pill tone="sky">
              <FilmIcon class="size-3" />
              {source}
            </Pill>
          )}
          <Pill>{total} entries</Pill>
          {hydrating && (
            <Pill tone="sky">
              <Spinner class="size-3" />
              fetching details {hydration!.done}/{hydration!.total}
            </Pill>
          )}
        </div>
        <h2
          class="mf-select-text line-clamp-1 text-base font-semibold leading-snug tracking-tight text-ink"
          title={metadata.title}
        >
          {metadata.title}
        </h2>
        <p class="truncate text-[12.5px] font-medium text-sky-300/90">
          {metadata.uploader ?? 'Unknown channel'}
        </p>
      </div>
    </div>
  )
}

export function EntryThumb({
  url,
  durationSec,
}: {
  url: string | null
  durationSec: number | null
}) {
  return (
    <span class="relative block h-9 w-16 shrink-0 overflow-hidden rounded-md border border-line-strong bg-recess">
      {url ? (
        <img src={url} alt="" loading="lazy" class="size-full object-cover" />
      ) : (
        <span class="flex size-full items-center justify-center bg-gradient-to-br from-sky-500/15 to-indigo-500/10">
          <LayersIcon class="size-3 text-slate-600" />
        </span>
      )}
      {durationSec !== null && durationSec !== undefined && (
        <span class="mf-num absolute bottom-0 right-0 rounded-tl-md bg-scrim/85 px-1 py-px text-[9px] font-semibold leading-none text-paper">
          {fmtDuration(durationSec)}
        </span>
      )}
    </span>
  )
}

/** Scrollable entry list for playlists — lives inside the Entries tab. */
export function PlaylistEntries({
  result,
  selectedUrls,
  onToggleEntry,
  onToggleAll,
}: {
  result: AnalyzeResult
  selectedUrls?: ReadonlySet<string>
  onToggleEntry?: (url: string) => void
  onToggleAll?: (select: boolean) => void
}) {
  const entries = result.playlistEntries ?? []
  const total = entries.length
  const selectedCount = entries.filter((e) => selectedUrls?.has(e.url) ?? true).length
  const allSelected = total > 0 && selectedCount === total
  const someSelected = selectedCount > 0 && !allSelected

  const statusByUrl = new Map(queueRows.value.map((r) => [r.url, r.status] as const))
  const partialDirByUrl = new Map(queueRows.value.map((r) => [r.url, r.partialDir] as const))
  const outputPathByUrl = new Map(queueRows.value.map((r) => [r.url, r.outputPath] as const))
  const skippedByUrl = new Map(queueRows.value.map((r) => [r.url, r.skipped] as const))
  const jobIdByUrl = new Map(queueRows.value.map((r) => [r.url, r.jobId] as const))
  const running = queueRunning.value
  const parallel = queueRunMode.value === 'parallel'
  const events = jobEventsById.value
  const legacyEvent = running && !parallel ? lastJobEvent.value : null
  const [clearingUrl, setClearingUrl] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)

  async function clearEntryPartial(url: string, partialDir: string) {
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

  function statusGlyph(status: string) {
    if (status === 'skipped') return <InfoIcon class="size-4 shrink-0 text-sky-400" />
    if (status === 'done') return <CheckIcon class="size-4 shrink-0 text-emerald-400" />
    if (status === 'failed') return <AlertIcon class="size-4 shrink-0 text-rose-400" />
    if (status === 'cancelled') return <CloseIcon class="size-4 shrink-0 text-amber-400" />
    if (status === 'paused') return <PauseIcon class="size-4 shrink-0 text-amber-400" />
    if (status === 'downloading') return <Spinner class="size-4 shrink-0 text-sky-400" />
    return null
  }

  return (
    <div class="mf-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-3 pt-2.5">
        <button
          onClick={() => onToggleAll?.(!allSelected)}
          disabled={!onToggleAll || total === 0}
          class="group mf-focus-ring -ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-slate-400 transition hover:text-ink"
        >
          <CheckSquare checked={allSelected} partial={someSelected} />
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span class="flex items-center gap-2">
          {queueLeftoverCount.value > 0 && (
            <button
              type="button"
              disabled={clearingAll}
              onClick={() => void clearAllLeftovers()}
              title="Delete every leftover partial-download folder from disk"
              class="mf-focus-ring flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              <HardDriveIcon class="size-3.5" />
              {clearingAll ? 'Clearing…' : `Clear leftovers · ${queueLeftoverCount.value}`}
            </button>
          )}
          <span class="mf-num text-[11px] font-medium text-slate-500">
            {selectedCount}/{total}
          </span>
        </span>
      </div>
      <div class="mx-3 mt-1.5 h-0.5 overflow-hidden rounded-full bg-wash-2">
        <div
          class="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-400 transition-[width] duration-300"
          style={`width: ${total === 0 ? 0 : (selectedCount / total) * 100}%`}
        />
      </div>

      {total > 0 ? (
        <ol class="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5 text-[13px]">
          {entries.map((entry) => {
            const checked = selectedUrls?.has(entry.url) ?? true
            const rowStatus = statusByUrl.get(entry.url)
            const partialDir = partialDirByUrl.get(entry.url)
            const outputPath = outputPathByUrl.get(entry.url)
            const skipped = skippedByUrl.get(entry.url)
            const displayStatus = rowStatus === 'done' && skipped ? 'skipped' : rowStatus
            const isLive = rowStatus === 'downloading'
            const jobId = jobIdByUrl.get(entry.url)
            const liveEvent = isLive ? ((jobId ? events[jobId] : undefined) ?? legacyEvent) : null
            const livePercent =
              liveEvent?.percent !== null && liveEvent?.percent !== undefined
                ? Math.max(2, Math.min(100, liveEvent.percent))
                : null
            const glyph = displayStatus ? statusGlyph(displayStatus) : null
            const row = (
              <>
                {glyph ?? <CheckSquare checked={checked} />}
                <span
                  className={`mf-num w-7 shrink-0 text-right text-[10px] font-semibold ${
                    rowStatus === 'done'
                      ? 'text-emerald-400/80'
                      : isLive
                        ? 'text-sky-400'
                        : checked
                          ? 'text-sky-400/70'
                          : 'text-slate-700'
                  }`}
                >
                  {String(entry.index).padStart(2, '0')}
                </span>
                <EntryThumb
                  url={entry.thumbnailUrl ?? null}
                  durationSec={entry.durationSec ?? null}
                />
                <span class="min-w-0 flex-1">
                  <span
                    className={`block truncate leading-tight transition-opacity duration-150 ${
                      rowStatus === 'downloading'
                        ? 'font-medium text-slate-100'
                        : checked
                          ? 'text-slate-200'
                          : 'text-slate-600'
                    }`}
                  >
                    {entry.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] leading-tight text-slate-500">
                    {entry.uploader ? (
                      <span class="truncate">{entry.uploader}</span>
                    ) : (
                      <span class="italic text-slate-700">fetching…</span>
                    )}
                    {entry.viewCount !== null && entry.viewCount !== undefined && (
                      <>
                        <span class="text-slate-700">·</span>
                        <EyeIcon class="size-2.5 shrink-0" />
                        <span class="mf-num shrink-0">{fmtCount(entry.viewCount)}</span>
                      </>
                    )}
                  </span>
                </span>
                {rowStatus === 'done' && skipped && (
                  <span class="hidden shrink-0 text-[10px] text-sky-400/80 sm:inline">
                    already exists
                  </span>
                )}
                {displayStatus && displayStatus !== 'downloading' && (
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      displayStatus === 'skipped'
                        ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                        : displayStatus === 'done'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : displayStatus === 'failed'
                            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}
                    title={
                      rowStatus === 'done' && skipped
                        ? 'A file for this video already exists at this quality'
                        : undefined
                    }
                  >
                    {displayStatus}
                  </span>
                )}
              </>
            )
            if (isLive) {
              return (
                <li
                  key={entry.url}
                  class="mf-row-hover rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-2 py-1.5"
                >
                  <div class="flex items-center gap-3">{row}</div>
                  <div class="mt-1.5 flex items-center gap-2.5 pl-[52px]">
                    <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-500/20">
                      <div
                        role="progressbar"
                        aria-valuenow={livePercent !== null ? Math.round(livePercent) : undefined}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${entry.title} download progress`}
                        class={`relative h-full rounded-full bg-gradient-to-r from-go-500 to-go-400 transition-[width] duration-500 ease-out ${
                          livePercent !== null && livePercent < 100 ? 'mf-progress-fill' : ''
                        }`}
                        style={`width: ${livePercent ?? 6}%;`}
                      />
                    </div>
                    <span class="mf-num w-9 shrink-0 text-right text-[11px] font-bold text-sky-400">
                      {livePercent !== null ? `${Math.round(livePercent)}%` : '···'}
                    </span>
                    {liveEvent?.downloadedBytes != null && (
                      <span class="mf-num hidden items-center gap-1 text-[10.5px] text-slate-500 lg:inline-flex">
                        {fmtSize(liveEvent.downloadedBytes)}
                        {liveEvent.totalBytes != null ? ` / ${fmtSize(liveEvent.totalBytes)}` : ''}
                      </span>
                    )}
                    <span class="mf-num hidden items-center gap-1 text-[10.5px] text-slate-500 sm:inline-flex">
                      <GaugeIcon class="size-3 shrink-0" />
                      {fmtSpeed(liveEvent?.speedBps ?? null)}
                    </span>
                    <span class="mf-num inline-flex items-center gap-1 text-[10.5px] text-slate-500">
                      <ClockIcon class="size-3 shrink-0" />
                      {fmtEta(liveEvent?.etaSec ?? null)}
                    </span>
                  </div>
                </li>
              )
            }
            return onToggleEntry && !rowStatus ? (
              <li key={entry.url}>
                <button
                  onClick={() => onToggleEntry(entry.url)}
                  title={checked ? 'Exclude from download' : 'Include in download'}
                  class={`mf-row-hover group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:bg-wash-2 ${
                    checked ? '' : 'opacity-60'
                  }`}
                >
                  {row}
                </button>
              </li>
            ) : (
              <li
                key={entry.url}
                class="mf-row-hover rounded-lg border border-transparent px-2 py-1.5"
              >
                <div class="flex items-center gap-3">{row}</div>
                {rowStatus === 'done' && outputPath && (
                  <div class="mt-1.5 flex items-center justify-end gap-1 pl-[52px]">
                    <button
                      type="button"
                      onClick={() => void window.mf.openFile(outputPath)}
                      title="Play video"
                      aria-label={`Play ${entry.title}`}
                      class="mf-focus-ring flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 transition hover:text-emerald-300"
                    >
                      <PlayIcon class="size-3" />
                      play
                    </button>
                    <button
                      type="button"
                      onClick={() => void window.mf.revealPath(outputPath)}
                      title="Open file location"
                      aria-label={`Open file location for ${entry.title}`}
                      class="mf-focus-ring flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 transition hover:text-sky-300"
                    >
                      <FolderIcon class="size-3" />
                      open
                    </button>
                  </div>
                )}
                {partialDir && (
                  <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 pl-[52px] text-[10.5px] text-amber-200/90">
                    <span class="inline-flex min-w-0 items-center gap-1.5">
                      <HardDriveIcon class="size-3 shrink-0" />
                      <span class="truncate" title={partialDir}>
                        Leftover partial download on disk
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void window.mf.openPartialDir(partialDir)}
                        class="mf-focus-ring flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 transition hover:text-sky-200"
                      >
                        <FolderIcon class="size-3" />
                        open
                      </button>
                      <button
                        type="button"
                        disabled={clearingUrl === entry.url}
                        onClick={() => void clearEntryPartial(entry.url, partialDir)}
                        class="mf-focus-ring rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                      >
                        {clearingUrl === entry.url ? 'clearing…' : 'clear'}
                      </button>
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p class="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center text-xs text-slate-600">
          No entries were returned for this playlist.
        </p>
      )}

      <div class="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-wash-1 px-3 py-2 text-[10px] text-slate-500">
        <span class="inline-flex items-center gap-1.5">
          <QueueIcon class="size-3" />
          Sequential — one entry at a time
        </span>
        <span class="inline-flex min-w-0 items-center gap-1.5">
          <FolderIcon class="size-3 shrink-0" />
          Saves into{' '}
          <span
            class="max-w-[200px] truncate font-medium text-slate-400"
            title={result.metadata.title}
          >
            {result.metadata.title}
            <span class="text-slate-600">\…</span>
          </span>
        </span>
      </div>
    </div>
  )
}

/** Metadata stat tiles — the Details tab content. */
export function DetailsGrid({
  result,
  playlistSummary,
}: {
  result: AnalyzeResult
  playlistSummary?: {
    selected: number
    total: number
    estimatedBytes: number | null
    modeLabel: string
  }
}) {
  const { metadata } = result
  return (
    <div class="mf-card min-h-0 flex-1 overflow-y-auto p-4">
      {playlistSummary && (
        <div class="mb-4 rounded-xl border border-sky-500/25 bg-sky-500/[0.07] p-3.5">
          <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">
            Download summary
          </p>
          <div class="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            <StatTile
              icon={<LayersIcon class="size-3" />}
              label="Entries"
              value={`${playlistSummary.selected} of ${playlistSummary.total}`}
            />
            <StatTile
              icon={<HardDriveIcon class="size-3" />}
              label="Estimated size"
              value={
                playlistSummary.estimatedBytes !== null
                  ? fmtSize(playlistSummary.estimatedBytes)
                  : '—'
              }
            />
            <StatTile
              icon={<SlidersIcon class="size-3" />}
              label="Quality"
              value={playlistSummary.modeLabel}
            />
          </div>
          <p class="mt-2 text-[10px] leading-relaxed text-slate-500">
            Estimated from typical bitrates for the chosen quality — actual size varies per video.
          </p>
        </div>
      )}
      <div class="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          icon={<ClockIcon class="size-3" />}
          label="Duration"
          value={fmtDuration(metadata.durationSec)}
        />
        <StatTile
          icon={<EyeIcon class="size-3" />}
          label="Views"
          value={fmtCount(metadata.viewCount)}
        />
        <StatTile
          icon={<CalendarIcon class="size-3" />}
          label="Uploaded"
          value={metadata.uploadDate ?? '—'}
        />
        <StatTile
          icon={<LayersIcon class="size-3" />}
          label="Streams"
          value={result.formats.length ? String(result.formats.length) : '—'}
        />
      </div>
      <dl class="mt-4 flex flex-col gap-2 text-xs">
        {(() => {
          const source = sourceLabel(metadata.webpageUrl)
          return (
            <>
              {source && (
                <div class="flex items-baseline justify-between gap-4 border-b border-line pb-1.5">
                  <dt class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Source
                  </dt>
                  <dd class="mf-num min-w-0 truncate text-right text-slate-300">{source}</dd>
                </div>
              )}
              {metadata.webpageUrl && (
                <div class="flex items-baseline justify-between gap-4 border-b border-line pb-1.5">
                  <dt class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Webpage URL
                  </dt>
                  <dd
                    class="mf-num min-w-0 truncate text-right text-slate-300"
                    title={metadata.webpageUrl}
                  >
                    {metadata.webpageUrl}
                  </dd>
                </div>
              )}
            </>
          )
        })()}
      </dl>
    </div>
  )
}
