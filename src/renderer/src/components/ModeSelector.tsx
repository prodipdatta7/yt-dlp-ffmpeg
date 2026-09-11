import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  CONTAINERS,
  LOSSLESS_AUDIO_FORMATS,
  RESOLUTION_TIERS,
  type AudioBoostOption,
  type AudioFormat,
  type BitrateTier,
  type Container,
  type DownloadMode,
  type FormatRow,
} from '../../../shared/models'
import { estimateJobBytes } from '../utils/estimate'
import {
  FilmIcon,
  FolderIcon,
  HardDriveIcon,
  InfoIcon,
  MusicIcon,
  SlidersIcon,
  VolumeIcon,
} from './icons'
import { Chip, SectionLabel } from './ui'

export interface JobSelection {
  mode: DownloadMode
  tier: number
  container: Container
  audioFormat: AudioFormat
  bitrate: BitrateTier | null
  videoFormatId: string
  audioFormatId: string
  destDir: string
  estimatedBytes: number | null
  audioBoost?: AudioBoostOption
}

export interface AdvancedPick {
  videoId: string
  audioId: string
  nonce: number
}

const MODES: Array<{
  id: DownloadMode
  label: string
  Icon: typeof FilmIcon
}> = [
  { id: 'video-audio', label: 'Video + Audio', Icon: FilmIcon },
  { id: 'audio-only', label: 'Audio Only', Icon: MusicIcon },
  { id: 'advanced', label: 'Advanced', Icon: SlidersIcon },
]

const AUDIO_FORMAT_OPTIONS: Array<{ id: AudioFormat; label: string; kind: 'lossy' | 'lossless' }> =
  [
    { id: 'mp3', label: 'MP3', kind: 'lossy' },
    { id: 'm4a', label: 'M4A', kind: 'lossy' },
    { id: 'ogg', label: 'OGG', kind: 'lossy' },
    { id: 'flac', label: 'FLAC', kind: 'lossless' },
    { id: 'wav', label: 'WAV', kind: 'lossless' },
  ]

const AUDIO_BOOST_SETTINGS: Array<{
  id: AudioBoostOption
  label: string
  description: string
  tooltip: string
}> = [
  {
    id: 'none',
    label: 'Original',
    description: 'Preserves original audio levels without modification.',
    tooltip: 'No volume adjustment. Source audio is untouched.',
  },
  {
    id: 'normalize',
    label: 'Normalize',
    description:
      'EBU R128 loudness normalization. Evens out quiet and loud sections to standard broadcast volume.',
    tooltip:
      'Standardizes loudness to broadcast level (EBU R128). Best for videos with uneven audio.',
  },
  {
    id: 'dynamic',
    label: 'Speech',
    description:
      'Dynamic speech compressor (dynaudnorm). Amplifies quiet dialogue while preventing loud spikes.',
    tooltip: 'Intelligently raises quiet dialogue while preventing loud audio spikes.',
  },
  {
    id: 'boost-6db',
    label: '+6 dB (2x)',
    description:
      '2x linear volume boost (+6 dB). Ideal for videos recorded with low microphone levels.',
    tooltip:
      'Doubles audio amplitude (+6 dB). Ideal for videos recorded with very low microphone volume.',
  },
]

function tierLabel(t: number): string {
  return t === 4320 ? '8K' : t === 2160 ? '4K' : `${t}p`
}

const selectClass =
  'w-full rounded-lg border border-line-strong bg-recess px-2.5 py-1.5 text-xs text-slate-200 outline-none transition focus:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-50'

export function ModeSelector({
  formats,
  durationSec,
  onSelection,
  disabled,
  advancedPick,
}: {
  formats: FormatRow[]
  durationSec: number | null
  onSelection: (selection: JobSelection) => void
  disabled: boolean
  advancedPick?: AdvancedPick | null
}) {
  const [mode, setMode] = useState<DownloadMode>('video-audio')
  const [tier, setTier] = useState<number>(1080)
  const [container, setContainer] = useState<Container>('mp4')
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('mp3')
  const [bitrate, setBitrate] = useState<BitrateTier>('320K')
  const [videoFormatId, setVideoFormatId] = useState('')
  const [audioFormatId, setAudioFormatId] = useState('')
  const [destDir, setDestDir] = useState('')
  const [audioBoost, setAudioBoost] = useState<AudioBoostOption>('none')

  useEffect(() => {
    window.mf
      .getDefaultDestDir()
      .then((dir) => setDestDir((prev) => prev || dir))
      .catch(() => undefined)
  }, [])

  const isLossless = LOSSLESS_AUDIO_FORMATS.includes(audioFormat)

  const estimatedBytes = useMemo(
    () =>
      estimateJobBytes(formats, {
        mode,
        durationSec,
        tier,
        container,
        audioFormat,
        bitrate: isLossless ? null : bitrate,
        videoFormatId,
        audioFormatId,
      }),
    [
      formats,
      mode,
      durationSec,
      tier,
      container,
      audioFormat,
      bitrate,
      videoFormatId,
      audioFormatId,
      isLossless,
    ],
  )

  useEffect(() => {
    if (destDir) {
      onSelection({
        mode,
        tier,
        container,
        audioFormat,
        bitrate: isLossless ? null : bitrate,
        videoFormatId,
        audioFormatId,
        destDir,
        estimatedBytes,
        audioBoost,
      })
    }
  }, [
    mode,
    tier,
    container,
    audioFormat,
    bitrate,
    videoFormatId,
    audioFormatId,
    destDir,
    estimatedBytes,
    audioBoost,
  ])

  async function browse() {
    try {
      const dir = await window.mf.chooseDestDir()
      if (dir) setDestDir(dir)
    } catch {
      return
    }
  }

  const videoStreams = formats.filter((f) => f.vcodec !== null)
  const audioStreams = formats.filter((f) => f.acodec !== null)
  const hasStreams = videoStreams.length > 0 || audioStreams.length > 0

  useEffect(() => {
    if (!hasStreams && mode === 'advanced') setMode('video-audio')
  }, [hasStreams, mode])

  useEffect(() => {
    if (!advancedPick || !hasStreams) return
    setMode('advanced')
    setVideoFormatId(advancedPick.videoId)
    setAudioFormatId(advancedPick.audioId)
  }, [advancedPick?.nonce, hasStreams])

  function streamLabel(f: FormatRow): string {
    const res = f.height ? `${f.height}p${f.fps ?? ''}` : 'audio'
    return `#${f.formatId} · ${f.ext} · ${res}${f.abrKbps ? ` · ${Math.round(f.abrKbps)}k` : ''}`
  }

  return (
    <div class="mf-card flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      <div class="grid grid-cols-3 gap-1 rounded-xl border border-line bg-recess p-1">
        {MODES.map(({ id, label, Icon }) => {
          const active = mode === id
          const streamlessAdvanced = id === 'advanced' && !hasStreams
          return (
            <button
              key={id}
              onClick={() => setMode(id)}
              disabled={disabled || streamlessAdvanced}
              title={
                streamlessAdvanced ? 'Per-stream picking needs a single video analysis' : label
              }
              aria-pressed={active}
              class={`mf-focus-ring flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-semibold leading-none transition-all duration-150 ${
                active
                  ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/25'
                  : 'text-slate-400 hover:bg-wash-2 hover:text-ink'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <Icon class="size-4" />
              <span class="truncate">{label}</span>
            </button>
          )
        })}
      </div>

      {mode === 'video-audio' && (
        <>
          <div class="flex flex-col gap-1.5">
            <SectionLabel title="Resolution ceiling" />
            <div class="flex flex-wrap gap-1">
              {RESOLUTION_TIERS.map((t) => (
                <Chip key={t} active={tier === t} onClick={() => setTier(t)} disabled={disabled}>
                  {tierLabel(t)}
                </Chip>
              ))}
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <SectionLabel title="Container" />
            <div class="grid grid-cols-3 gap-1">
              {CONTAINERS.map((c) => (
                <Chip
                  key={c}
                  active={container === c}
                  onClick={() => setContainer(c)}
                  disabled={disabled}
                >
                  <span class="block w-full text-center">{c.toUpperCase()}</span>
                </Chip>
              ))}
            </div>
          </div>
        </>
      )}

      {mode === 'audio-only' && (
        <>
          <div class="flex flex-col gap-1.5">
            <SectionLabel title="Audio format" />
            <div class="flex flex-wrap gap-1">
              {AUDIO_FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setAudioFormat(opt.id)}
                  disabled={disabled}
                  aria-pressed={audioFormat === opt.id}
                  className={`mf-focus-ring rounded-lg border px-2.5 py-1 text-left transition-all duration-150 ${
                    audioFormat === opt.id
                      ? 'border-sky-400/60 bg-sky-500/15 shadow-[0_0_10px_-4px_var(--mf-glow)]'
                      : 'border-line bg-wash-1 hover:border-line-strong'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span
                    className={`text-[11px] font-bold ${
                      audioFormat === opt.id ? 'text-sky-200' : 'text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span
                    className={`ml-1.5 text-[9px] font-medium uppercase tracking-wide ${
                      opt.kind === 'lossless' ? 'text-emerald-400/70' : 'text-slate-600'
                    }`}
                  >
                    {opt.kind === 'lossless' ? '∞' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <SectionLabel title="Quality" />
            {!isLossless ? (
              <div class="grid grid-cols-3 gap-1">
                {(
                  [
                    ['320K', 'High'],
                    ['192K', 'Med'],
                    ['128K', 'Low'],
                  ] as Array<[BitrateTier, string]>
                ).map(([value, label]) => (
                  <Chip
                    key={value}
                    active={bitrate === value}
                    onClick={() => setBitrate(value)}
                    disabled={disabled}
                  >
                    <span class="block w-full text-center">{label}</span>
                  </Chip>
                ))}
              </div>
            ) : (
              <p class="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11px] leading-relaxed text-emerald-300/80">
                Lossless — transcoded from best source audio.
              </p>
            )}
          </div>
        </>
      )}

      {mode === 'advanced' && hasStreams && (
        <div class="flex flex-col gap-2.5">
          <label class="flex flex-col gap-1">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Video stream
            </span>
            <select
              value={videoFormatId}
              onChange={(e) => setVideoFormatId((e.target as HTMLSelectElement).value)}
              disabled={disabled}
              class={selectClass}
            >
              <option value="">Select…</option>
              {videoStreams.map((f) => (
                <option key={`v-${f.formatId}`} value={f.formatId}>
                  {streamLabel(f)}
                </option>
              ))}
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Audio stream
            </span>
            <select
              value={audioFormatId}
              onChange={(e) => setAudioFormatId((e.target as HTMLSelectElement).value)}
              disabled={disabled}
              class={selectClass}
            >
              <option value="">Select…</option>
              {audioStreams.map((f) => (
                <option key={`a-${f.formatId}`} value={f.formatId}>
                  {streamLabel(f)}
                </option>
              ))}
            </select>
          </label>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Merge into
            </span>
            <div class="grid grid-cols-3 gap-1">
              {CONTAINERS.map((c) => (
                <Chip
                  key={c}
                  active={container === c}
                  onClick={() => setContainer(c)}
                  disabled={disabled}
                >
                  <span class="block w-full text-center">{c.toUpperCase()}</span>
                </Chip>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Audio Volume & Processing */}
      <div class="flex flex-col gap-1.5 border-t border-line pt-3">
        <div class="flex items-center justify-between">
          <SectionLabel
            title="Audio Volume Boost"
            icon={<VolumeIcon class="size-3.5 text-sky-400" />}
          />
          <span
            class="flex cursor-help items-center gap-1 text-[10px] text-slate-500 transition hover:text-slate-400"
            title="FFmpeg filters adjust volume during muxing. Video stream is copied directly without re-encoding (zero quality loss)."
          >
            <InfoIcon class="size-3 text-slate-500" />
            <span>Lossless Video Copy</span>
          </span>
        </div>

        <div class="grid grid-cols-4 gap-1">
          {AUDIO_BOOST_SETTINGS.map((opt) => (
            <Chip
              key={opt.id}
              active={audioBoost === opt.id}
              onClick={() => setAudioBoost(opt.id)}
              disabled={disabled}
              title={opt.tooltip}
            >
              <span class="block w-full text-center truncate">{opt.label}</span>
            </Chip>
          ))}
        </div>

        {audioBoost !== 'none' && (
          <p class="text-[11px] leading-tight text-slate-400">
            <span class="font-medium text-slate-300">
              {AUDIO_BOOST_SETTINGS.find((o) => o.id === audioBoost)?.label}:
            </span>{' '}
            {AUDIO_BOOST_SETTINGS.find((o) => o.id === audioBoost)?.description}
          </p>
        )}
      </div>

      <label class="flex flex-col gap-1.5 border-t border-line pt-3">
        <SectionLabel title="Destination" />
        <div class="flex gap-1.5">
          <div class="relative min-w-0 flex-1">
            <FolderIcon class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              spellcheck={false}
              value={destDir}
              onInput={(e) => setDestDir((e.target as HTMLInputElement).value)}
              disabled={disabled}
              placeholder="Output folder"
              class={`${selectClass} pl-8`}
            />
          </div>
          <button
            onClick={() => void browse()}
            disabled={disabled}
            title="Browse…"
            aria-label="Browse for output folder"
            class="mf-focus-ring shrink-0 rounded-lg border border-line-strong px-2.5 text-slate-300 transition hover:border-sky-500/60 hover:text-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderIcon class="size-4" />
          </button>
        </div>
      </label>

      {estimatedBytes !== null && (
        <p class="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-2 py-0.5 font-semibold text-emerald-300/90">
            <HardDriveIcon class="size-3" />≈ {(estimatedBytes / 1024 / 1024).toFixed(0)} MB
          </span>
          estimated size
        </p>
      )}
    </div>
  )
}
