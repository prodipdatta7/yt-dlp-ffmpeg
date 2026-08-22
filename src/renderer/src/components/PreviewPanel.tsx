import type { AnalyzeResult } from '../../../shared/models'
import { fmtCount, fmtDuration } from '../utils/format'

function Spinner() {
  return (
    <svg
      class="size-8 animate-spin text-sky-400"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Analyzing"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
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
      <div class="flex flex-col items-center gap-3 py-14">
        <Spinner />
        <p class="text-sm text-slate-400">Analyzing source…</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div class="py-14 text-center">
        <p class="text-sm text-slate-600">Preview appears here after analysis.</p>
      </div>
    )
  }

  const { metadata } = result

  return (
    <div class="flex w-full max-w-5xl flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row">
      {metadata.thumbnailUrl && (
        <img
          src={metadata.thumbnailUrl}
          alt=""
          class="h-auto w-full max-w-[280px] self-start rounded-lg border border-slate-800 object-cover sm:w-[280px]"
        />
      )}

      <div class="flex flex-1 flex-col gap-2 overflow-hidden">
        {result.kind === 'playlist' && (
          <span class="w-fit rounded-full border border-sky-700 bg-sky-950 px-2.5 py-0.5 text-xs font-medium text-sky-300">
            Playlist · {result.playlistCount} entries (queued sequentially at download)
          </span>
        )}
        {metadata.isLive && (
          <span class="w-fit rounded-full border border-red-700 bg-red-950 px-2.5 py-0.5 text-xs font-medium text-red-300">
            LIVE — recording workflow in P6
          </span>
        )}

        <h2 class="truncate text-lg font-semibold" title={metadata.title}>
          {metadata.title}
        </h2>
        <p class="text-sm text-slate-400">{metadata.uploader ?? 'Unknown channel'}</p>

        <dl class="mt-1 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Duration</dt>
            <dd>{fmtDuration(metadata.durationSec)}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Views</dt>
            <dd>{fmtCount(metadata.viewCount)}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Uploaded</dt>
            <dd>{metadata.uploadDate ?? '—'}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Formats</dt>
            <dd>{result.formats.length || '—'}</dd>
          </div>
        </dl>

        {result.kind === 'playlist' &&
          result.playlistEntries &&
          result.playlistEntries.length > 0 && (
            <ol class="mt-3 max-h-40 list-decimal space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-3 pl-7 text-sm text-slate-400 marker:text-slate-600">
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
