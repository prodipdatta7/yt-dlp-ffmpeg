import type { AnalyzeResult } from '../../../shared/models'
import { fmtCount, fmtDuration } from '../utils/format'

function LiveBadge() {
  return (
    <span class="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-rose-600/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow">
      <span class="size-1.5 animate-pulse rounded-full bg-white" />
      Live
    </span>
  )
}

function DurationBadge({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null
  return (
    <span class="mf-num absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
      {fmtDuration(seconds)}
    </span>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2">
      <p class="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p class="mf-num mt-0.5 text-sm font-medium text-slate-200">{value}</p>
    </div>
  )
}

export function PreviewPanel({
  result,
  loading,
}: {
  result: AnalyzeResult | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div class="mf-card flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-16">
        <svg
          class="size-10 animate-spin text-sky-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            class="opacity-20"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="3"
          />
          <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
        </svg>
        <div class="text-center">
          <p class="text-sm font-medium text-slate-300">Analyzing source…</p>
          <p class="mt-1 text-xs text-slate-500">Fetching metadata and stream details</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div class="flex w-full max-w-3xl flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-700/60 px-6 py-14 text-center">
        <svg
          class="size-10 text-slate-700"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        <p class="text-sm font-medium text-slate-400">Nothing analyzed yet</p>
        <p class="max-w-sm text-xs leading-relaxed text-slate-600">
          Paste a link above and hit Analyze — supported sources include YouTube, Vimeo, Twitch,
          SoundCloud and TikTok.
        </p>
      </div>
    )
  }

  const { metadata } = result

  return (
    <div class="mf-card flex w-full max-w-3xl flex-col gap-5 p-5 sm:flex-row">
      {metadata.thumbnailUrl && (
        <div class="group relative shrink-0 overflow-hidden rounded-xl border border-white/10 shadow-lg shadow-black/40 sm:w-72">
          <img
            src={metadata.thumbnailUrl}
            alt=""
            class="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          {metadata.isLive ? <LiveBadge /> : <DurationBadge seconds={metadata.durationSec} />}
          <div class="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
        </div>
      )}

      <div class="flex min-w-0 flex-1 flex-col">
        {result.kind === 'playlist' && (
          <span class="mb-2 w-fit rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
            Playlist · {result.playlistCount} entries
          </span>
        )}

        <h2
          class="line-clamp-2 text-lg font-semibold leading-snug tracking-tight text-white"
          title={metadata.title}
        >
          {metadata.title}
        </h2>
        <p class="mt-1 truncate text-sm text-sky-300/90">
          {metadata.uploader ?? 'Unknown channel'}
        </p>

        <div class="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile label="Duration" value={fmtDuration(metadata.durationSec)} />
          <StatTile label="Views" value={fmtCount(metadata.viewCount)} />
          <StatTile label="Uploaded" value={metadata.uploadDate ?? '—'} />
          <StatTile
            label="Streams"
            value={result.formats.length ? String(result.formats.length) : '—'}
          />
        </div>

        {result.kind === 'playlist' &&
          result.playlistEntries &&
          result.playlistEntries.length > 0 && (
            <ol class="mt-4 max-h-36 list-decimal space-y-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 p-3 pl-8 text-xs text-slate-400 marker:text-slate-600">
              {result.playlistEntries.map((entry) => (
                <li key={entry.index} class="truncate">
                  {entry.title}
                </li>
              ))}
            </ol>
          )}
      </div>
    </div>
  )
}
