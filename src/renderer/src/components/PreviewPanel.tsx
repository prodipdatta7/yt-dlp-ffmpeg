import type { AnalyzeResult } from '../../../shared/models'
import { fmtCount, fmtDuration } from '../utils/format'
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  FolderIcon,
  LayersIcon,
  PlayIcon,
  QueueIcon,
  Spinner,
} from './icons'
import { Pill, StatTile } from './ui'

function LiveBadge() {
  return (
    <span class="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-rose-600/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
      <span class="mf-breathe size-1.5 rounded-full bg-white" />
      Live
    </span>
  )
}

function DurationBadge({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null
  return (
    <span class="mf-num absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
      {fmtDuration(seconds)}
    </span>
  )
}

function CheckSquare({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      class={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 ${
        checked || partial
          ? 'border-sky-400 bg-sky-500 text-white'
          : 'border-slate-600 bg-transparent group-hover:border-slate-500'
      }`}
      aria-hidden="true"
    >
      {checked && <CheckIcon class="size-3" />}
      {partial && !checked && <span class="h-[2px] w-2 rounded-full bg-white" />}
    </span>
  )
}

function LoadingSkeleton() {
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

function EmptyState() {
  return (
    <div class="rounded-2xl border border-dashed border-slate-700/50 px-6 py-12 text-center">
      <span class="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] shadow-inner">
        <PlayIcon class="size-5 text-slate-600" />
      </span>
      <p class="text-sm font-medium text-slate-300">Nothing analyzed yet</p>
      <p class="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-slate-600">
        Paste a link above and hit Analyze — MediaForge maps every available stream before you
        commit to a download.
      </p>
      <div class="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        {['YouTube', 'Vimeo', 'Twitch', 'SoundCloud', 'TikTok'].map((site) => (
          <Pill key={site}>{site}</Pill>
        ))}
      </div>
    </div>
  )
}

function VideoCard({ result }: { result: AnalyzeResult }) {
  const { metadata } = result
  return (
    <div class="mf-card mf-card-hover p-4">
      <div class="flex flex-col gap-4 sm:flex-row">
        {metadata.thumbnailUrl && (
          <div class="group relative shrink-0 overflow-hidden rounded-xl border border-white/10 shadow-lg shadow-black/40 sm:w-56">
            <img
              src={metadata.thumbnailUrl}
              alt=""
              class="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
            <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
            {metadata.isLive ? <LiveBadge /> : <DurationBadge seconds={metadata.durationSec} />}
            <div class="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
          </div>
        )}

        <div class="min-w-0 flex-1">
          <h2
            class="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-white"
            title={metadata.title}
          >
            {metadata.title}
          </h2>
          <p class="mt-0.5 truncate text-[13px] font-medium text-sky-300/90">
            {metadata.uploader ?? 'Unknown channel'}
          </p>

          <div class="mt-3 grid grid-cols-4 gap-2">
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
        </div>
      </div>
    </div>
  )
}

interface PlaylistCardProps {
  result: AnalyzeResult
  hydration?: { done: number; total: number } | null
  selectedUrls?: ReadonlySet<string>
  onToggleEntry?: (url: string) => void
  onToggleAll?: (select: boolean) => void
}

function EntryThumb({ url, durationSec }: { url: string | null; durationSec: number | null }) {
  return (
    <span class="relative block h-9 w-16 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
      {url ? (
        <img src={url} alt="" loading="lazy" class="size-full object-cover" />
      ) : (
        <span class="flex size-full items-center justify-center bg-gradient-to-br from-sky-500/15 to-indigo-500/10">
          <LayersIcon class="size-3 text-slate-600" />
        </span>
      )}
      {durationSec !== null && durationSec !== undefined && (
        <span class="mf-num absolute bottom-0 right-0 rounded-tl-md bg-black/85 px-1 py-px text-[9px] font-semibold leading-none text-white">
          {fmtDuration(durationSec)}
        </span>
      )}
    </span>
  )
}

function PlaylistCard({
  result,
  hydration,
  selectedUrls,
  onToggleEntry,
  onToggleAll,
}: PlaylistCardProps) {
  const { metadata } = result
  const entries = result.playlistEntries ?? []
  const total = entries.length
  const selectedCount = entries.filter((e) => selectedUrls?.has(e.url) ?? true).length
  const allSelected = total > 0 && selectedCount === total
  const someSelected = selectedCount > 0 && !allSelected
  const hydrating = !!hydration && hydration.done < hydration.total

  return (
    <div class="mf-card overflow-hidden">
      <div class="flex items-start gap-3.5 p-4 pb-3">
        {metadata.thumbnailUrl ? (
          <img
            src={metadata.thumbnailUrl}
            alt=""
            class="size-14 shrink-0 rounded-xl border border-white/10 object-cover shadow-lg shadow-black/40"
          />
        ) : (
          <span class="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-sky-400/25 bg-gradient-to-br from-sky-500/30 via-indigo-500/25 to-violet-500/20 shadow-inner">
            <LayersIcon class="size-6 text-white/85" />
            <span class="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/15" />
          </span>
        )}

        <div class="min-w-0 flex-1">
          <div class="mb-1 flex flex-wrap items-center gap-2">
            <Pill tone="violet">
              <LayersIcon class="size-3" />
              Playlist
            </Pill>
            <Pill>{total} entries</Pill>
            {hydrating && (
              <Pill tone="sky">
                <Spinner class="size-3" />
                fetching details {hydration.done}/{hydration.total}
              </Pill>
            )}
          </div>
          <h2
            class="line-clamp-1 text-base font-semibold leading-snug tracking-tight text-white"
            title={metadata.title}
          >
            {metadata.title}
          </h2>
          <p class="truncate text-[13px] font-medium text-sky-300/90">
            {metadata.uploader ?? 'Unknown channel'}
          </p>
        </div>
      </div>

      <div class="px-4">
        <div class="overflow-hidden rounded-xl border border-white/[0.07] bg-black/25">
          <div class="flex items-center justify-between gap-3 px-3 py-2">
            <button
              onClick={() => onToggleAll?.(!allSelected)}
              disabled={!onToggleAll || total === 0}
              class="group mf-focus-ring -ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-slate-400 transition hover:text-white"
            >
              <CheckSquare checked={allSelected} partial={someSelected} />
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span class="mf-num text-[11px] font-medium text-slate-500">
              {selectedCount}/{total}
            </span>
          </div>
          <div class="mx-3 h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              class="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-400 transition-[width] duration-300"
              style={`width: ${total === 0 ? 0 : (selectedCount / total) * 100}%`}
            />
          </div>

          {total > 0 ? (
            <ol class="max-h-[320px] space-y-0.5 overflow-y-auto p-1.5 text-[13px]">
              {entries.map((entry) => {
                const checked = selectedUrls?.has(entry.url) ?? true
                const row = (
                  <>
                    <CheckSquare checked={checked} />
                    <span
                      className={`mf-num w-7 shrink-0 text-right text-[10px] font-semibold ${
                        checked ? 'text-sky-400/70' : 'text-slate-700'
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
                          checked ? 'text-slate-200' : 'text-slate-600'
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
                  </>
                )
                return onToggleEntry ? (
                  <li key={entry.url}>
                    <button
                      onClick={() => onToggleEntry(entry.url)}
                      title={checked ? 'Exclude from download' : 'Include in download'}
                      class={`group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05] ${
                        checked ? '' : 'opacity-60'
                      }`}
                    >
                      {row}
                    </button>
                  </li>
                ) : (
                  <li key={entry.url} class="flex items-center gap-3 rounded-lg px-2 py-1.5">
                    {row}
                  </li>
                )
              })}
            </ol>
          ) : (
            <p class="px-4 py-6 text-center text-xs text-slate-600">
              No entries were returned for this playlist.
            </p>
          )}
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] bg-white/[0.015] px-4 py-2 text-[10px] text-slate-500">
        <span class="inline-flex items-center gap-1.5">
          <QueueIcon class="size-3" />
          Sequential — one entry at a time
        </span>
        <span class="inline-flex min-w-0 items-center gap-1.5">
          <FolderIcon class="size-3 shrink-0" />
          Saves into{' '}
          <span class="max-w-[200px] truncate font-medium text-slate-400" title={metadata.title}>
            {metadata.title}
            <span class="text-slate-600">\…</span>
          </span>
        </span>
      </div>
    </div>
  )
}

export function PreviewPanel({
  result,
  loading,
  hydration,
  selectedUrls,
  onToggleEntry,
  onToggleAll,
}: {
  result: AnalyzeResult | null
  loading: boolean
  hydration?: { done: number; total: number } | null
  selectedUrls?: ReadonlySet<string>
  onToggleEntry?: (url: string) => void
  onToggleAll?: (select: boolean) => void
}) {
  if (loading) return <LoadingSkeleton />
  if (!result) return <EmptyState />

  return result.kind === 'playlist' ? (
    <PlaylistCard
      result={result}
      hydration={hydration}
      selectedUrls={selectedUrls}
      onToggleEntry={onToggleEntry}
      onToggleAll={onToggleAll}
    />
  ) : (
    <VideoCard result={result} />
  )
}
