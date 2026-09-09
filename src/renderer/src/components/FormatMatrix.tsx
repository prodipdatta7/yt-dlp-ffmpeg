import { useMemo, useState } from 'preact/hooks'
import type { FormatRow } from '../../../shared/models'
import { fmtSize } from '../utils/format'
import { FilmIcon, MusicIcon, SearchIcon } from './icons'

type StreamFilter = 'all' | 'video' | 'audio'

const VIDEO_PILL = 'border-sky-500/25 bg-sky-500/10 text-sky-300'
const AUDIO_PILL = 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'

const CODEC_NAMES: Array<[RegExp, string]> = [
  [/^avc|^h264/i, 'H.264'],
  [/^h265|^hevc|^hvc1/i, 'HEVC'],
  [/^av01/i, 'AV1'],
  [/^vp9/i, 'VP9'],
  [/^vp8/i, 'VP8'],
  [/^mp4a/i, 'AAC'],
  [/^opus/i, 'Opus'],
  [/^vorbis/i, 'Vorbis'],
  [/^flac/i, 'FLAC'],
  [/^ac-?3/i, 'AC-3'],
  [/^ec-?3/i, 'E-AC-3'],
]

function codecLabel(codec: string | null): string {
  if (!codec) return '—'
  for (const [pattern, name] of CODEC_NAMES) {
    if (pattern.test(codec)) return name
  }
  const dot = codec.indexOf('.')
  return (dot > 0 ? codec.slice(0, dot) : codec).toUpperCase()
}

function CodecPill({ codec, kind }: { codec: string | null; kind: 'video' | 'audio' }) {
  if (!codec) return <span class="text-slate-700">—</span>
  return (
    <span
      class={`inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${kind === 'video' ? VIDEO_PILL : AUDIO_PILL}`}
    >
      {codecLabel(codec)}
    </span>
  )
}

function ResCell({ row }: { row: FormatRow }) {
  if (!row.height) {
    return (
      <span class="inline-flex items-center gap-1 text-xs text-emerald-300/80">
        <MusicIcon class="size-3" />
        audio
      </span>
    )
  }
  return (
    <span class="mf-num text-sm font-semibold text-slate-100">
      {row.height}p
      {row.fps && row.fps > 30 ? (
        <span class="ml-1 rounded bg-amber-500/10 px-1 py-px text-[10px] font-semibold text-amber-300">
          {row.fps}fps
        </span>
      ) : null}
    </span>
  )
}

export function FormatMatrix({
  formats,
  onRowActivate,
  pickedIds,
}: {
  formats: FormatRow[]
  onRowActivate?: (row: FormatRow) => void
  pickedIds?: ReadonlySet<string>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StreamFilter>('all')

  const videoRows = useMemo(() => formats.filter((f) => f.vcodec !== null), [formats])
  const audioRows = useMemo(
    () => formats.filter((f) => f.vcodec === null && f.acodec !== null),
    [formats],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (rows: FormatRow[]) =>
      rows.filter((f) => {
        if (filter === 'video' && f.vcodec === null) return false
        if (filter === 'audio' && f.acodec === null) return false
        if (!q) return true
        return `${f.formatId} ${f.ext} ${f.vcodec ?? ''} ${f.acodec ?? ''}`
          .toLowerCase()
          .includes(q)
      })
    return [...matches(videoRows), ...matches(audioRows)]
  }, [formats, videoRows, audioRows, query, filter])

  if (formats.length === 0) return null

  const tabs: Array<{ id: StreamFilter; label: string }> = [
    { id: 'all', label: `All ${formats.length}` },
    { id: 'video', label: `Video ${videoRows.length}` },
    { id: 'audio', label: `Audio ${audioRows.length}` },
  ]

  return (
    <div class="mf-card mf-card-hover flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div class="flex items-baseline gap-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Available Streams
          </h3>
          <span class="mf-num rounded-full border border-line-strong bg-wash-1 px-2 text-[11px] text-slate-400">
            {visible.length}/{formats.length}
          </span>
          {onRowActivate && (
            <span class="hidden rounded-full border border-sky-500/20 bg-sky-500/[0.06] px-2 py-0.5 text-[10px] font-medium text-sky-400/70 xl:inline">
              click a row → Advanced
            </span>
          )}
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder="Filter streams…"
              class="w-40 rounded-lg border border-line bg-recess py-1.5 pl-8 pr-2 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-sky-500/50"
            />
          </div>
          <div class="flex rounded-lg border border-line bg-recess p-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                aria-pressed={filter === t.id}
                class={`mf-focus-ring rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  filter === t.id
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full min-w-[620px] text-left text-sm">
          <thead class="sticky top-0 z-10 bg-[var(--thead-bg)] text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur">
            <tr>
              <th scope="col" class="px-4 py-2.5 font-semibold">
                ID
              </th>
              <th scope="col" class="px-3 py-2.5 font-semibold">
                Type
              </th>
              <th scope="col" class="px-3 py-2.5 font-semibold">
                Video
              </th>
              <th scope="col" class="px-3 py-2.5 font-semibold">
                Audio
              </th>
              <th scope="col" class="px-3 py-2.5 font-semibold">
                Quality
              </th>
              <th scope="col" class="px-3 py-2.5 text-right font-semibold">
                Bitrate
              </th>
              <th scope="col" class="px-4 py-2.5 text-right font-semibold">
                Size
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line text-slate-300">
            {visible.map((f) => {
              const isVideo = f.vcodec !== null
              const isAudioOnly = f.vcodec === null && f.acodec !== null
              const picked = pickedIds?.has(f.formatId) === true
              const activate = onRowActivate ? () => onRowActivate(f) : undefined
              return (
                <tr
                  key={`${f.formatId}-${f.ext}`}
                  title={activate ? 'Click to target this stream in Advanced mode' : undefined}
                  onClick={activate}
                  onKeyDown={
                    activate
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            activate()
                          }
                        }
                      : undefined
                  }
                  tabIndex={activate ? 0 : undefined}
                  role={activate ? 'button' : undefined}
                  aria-selected={picked}
                  class={`mf-focus-ring transition-colors odd:bg-wash-1 ${activate ? 'cursor-pointer' : ''} ${
                    picked ? 'bg-sky-500/[0.09] hover:bg-sky-500/[0.12]' : 'hover:bg-sky-500/[0.06]'
                  }`}
                >
                  <td
                    className={`px-4 py-1.5 font-mono text-xs ${
                      picked ? 'font-bold text-sky-200' : 'text-sky-300'
                    }`}
                  >
                    {picked ? '› ' : ''}
                    {f.formatId}
                  </td>
                  <td class="px-3 py-1.5">
                    <span
                      class={`inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                        isVideo
                          ? 'border-violet-500/25 bg-violet-500/10 text-violet-300'
                          : 'border-line-strong bg-wash-1 text-slate-400'
                      }`}
                    >
                      {isVideo ? (
                        <FilmIcon class="size-2.5" />
                      ) : isAudioOnly ? (
                        <MusicIcon class="size-2.5" />
                      ) : null}
                      {f.ext || '?'}
                    </span>
                  </td>
                  <td class="px-3 py-1.5">
                    <CodecPill codec={f.vcodec} kind="video" />
                  </td>
                  <td class="px-3 py-1.5">
                    <CodecPill codec={f.acodec} kind="audio" />
                  </td>
                  <td class="px-3 py-1.5">
                    <ResCell row={f} />
                  </td>
                  <td class="mf-num px-3 py-1.5 text-right text-xs text-slate-400">
                    {f.abrKbps
                      ? `${Math.round(f.abrKbps)}k`
                      : f.tbrKbps
                        ? `${Math.round(f.tbrKbps)}k`
                        : '—'}
                  </td>
                  <td class="mf-num px-4 py-1.5 text-right text-xs text-slate-500">
                    {fmtSize(f.filesizeBytes)}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} class="px-4 py-8 text-center text-xs text-slate-600">
                  No streams match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
