import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  BITRATE_TIERS,
  CONTAINERS,
  LOSSLESS_AUDIO_FORMATS,
  RESOLUTION_TIERS,
  type AudioFormat,
  type BitrateTier,
  type Container,
  type DownloadMode,
  type FormatRow,
} from '../../../shared/models'
import { estimateJobBytes } from '../utils/estimate'

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
}

const MODE_LABELS: Array<{ id: DownloadMode; label: string }> = [
  { id: 'video-audio', label: 'Video + Audio' },
  { id: 'audio-only', label: 'Audio Only' },
  { id: 'advanced', label: 'Advanced' },
]

function selectClass() {
  return 'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-slate-200 focus:border-sky-500'
}

const labelClass = 'flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400'

export function ModeSelector({
  formats,
  durationSec,
  onSelection,
  disabled,
}: {
  formats: FormatRow[]
  durationSec: number | null
  onSelection: (selection: JobSelection) => void
  disabled: boolean
}) {
  const [mode, setMode] = useState<DownloadMode>('video-audio')
  const [tier, setTier] = useState<number>(1080)
  const [container, setContainer] = useState<Container>('mp4')
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('mp3')
  const [bitrate, setBitrate] = useState<BitrateTier>('320K')
  const [videoFormatId, setVideoFormatId] = useState('')
  const [audioFormatId, setAudioFormatId] = useState('')
  const [destDir, setDestDir] = useState('')

  useEffect(() => {
    window.mf
      .getDefaultDestDir()
      .then((dir) => setDestDir((prev) => prev || dir))
      .catch(() => undefined)
  }, [])

  const isLossless = LOSSLESS_AUDIO_FORMATS.includes(audioFormat)
  const videoStreams = formats.filter((f) => f.vcodec !== null)
  const audioStreams = formats.filter((f) => f.acodec !== null)

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
  ])

  async function browse() {
    try {
      const dir = await window.mf.chooseDestDir()
      if (dir) setDestDir(dir)
    } catch {
      return
    }
  }

  function streamLabel(f: FormatRow): string {
    const res = f.height ? `${f.height}p${f.fps ? f.fps : ''}` : 'audio'
    return `#${f.formatId} · ${f.ext} · ${res}${f.abrKbps ? ` · ${Math.round(f.abrKbps)}k` : ''}`
  }

  return (
    <div class="flex w-full max-w-5xl flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div class="flex gap-2">
        {MODE_LABELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            disabled={disabled}
            class={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m.id
                ? 'bg-sky-600 text-white'
                : 'border border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {mode === 'video-audio' && (
          <>
            <label class={labelClass}>
              Resolution
              <select
                value={tier}
                onChange={(e) => setTier(Number((e.target as HTMLSelectElement).value))}
                disabled={disabled}
                class={selectClass()}
              >
                {RESOLUTION_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t === 4320 ? '8K' : t === 2160 ? '4K' : `${t}p`}
                  </option>
                ))}
              </select>
            </label>
            <label class={labelClass}>
              Container
              <select
                value={container}
                onChange={(e) => setContainer((e.target as HTMLSelectElement).value as Container)}
                disabled={disabled}
                class={selectClass()}
              >
                {CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {mode === 'audio-only' && (
          <>
            <label class={labelClass}>
              Format
              <select
                value={audioFormat}
                onChange={(e) =>
                  setAudioFormat((e.target as HTMLSelectElement).value as AudioFormat)
                }
                disabled={disabled}
                class={selectClass()}
              >
                <option value="mp3">MP3</option>
                <option value="m4a">M4A</option>
                <option value="ogg">OGG</option>
                <option value="flac">FLAC</option>
                <option value="wav">WAV</option>
              </select>
            </label>
            {!isLossless && (
              <label class={labelClass}>
                Quality
                <select
                  value={bitrate}
                  onChange={(e) => setBitrate((e.target as HTMLSelectElement).value as BitrateTier)}
                  disabled={disabled}
                  class={selectClass()}
                >
                  {BITRATE_TIERS.map((b) => (
                    <option key={b} value={b}>
                      {b === '320K'
                        ? 'High (320 kbps)'
                        : b === '192K'
                          ? 'Medium (192 kbps)'
                          : 'Low (128 kbps)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isLossless && (
              <p class="self-end text-xs text-slate-500">
                Lossless — transcoded from best source audio (no bitrate setting).
              </p>
            )}
          </>
        )}

        {mode === 'advanced' && (
          <>
            <label class={labelClass}>
              Video stream
              <select
                value={videoFormatId}
                onChange={(e) => setVideoFormatId((e.target as HTMLSelectElement).value)}
                disabled={disabled}
                class={selectClass()}
              >
                <option value="">Select…</option>
                {videoStreams.map((f) => (
                  <option key={`v-${f.formatId}`} value={f.formatId}>
                    {streamLabel(f)}
                  </option>
                ))}
              </select>
            </label>
            <label class={labelClass}>
              Audio stream
              <select
                value={audioFormatId}
                onChange={(e) => setAudioFormatId((e.target as HTMLSelectElement).value)}
                disabled={disabled}
                class={selectClass()}
              >
                <option value="">Select…</option>
                {audioStreams.map((f) => (
                  <option key={`a-${f.formatId}`} value={f.formatId}>
                    {streamLabel(f)}
                  </option>
                ))}
              </select>
            </label>
            <label class={labelClass}>
              Merge into
              <select
                value={container}
                onChange={(e) => setContainer((e.target as HTMLSelectElement).value as Container)}
                disabled={disabled}
                class={selectClass()}
              >
                {CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label class={`${labelClass} sm:col-span-2`}>
          Destination folder
          <div class="flex gap-2">
            <input
              type="text"
              value={destDir}
              onInput={(e) => setDestDir((e.target as HTMLInputElement).value)}
              disabled={disabled}
              placeholder="C:\Users\…\Downloads"
              class={selectClass() + ' flex-1'}
            />
            <button
              onClick={() => void browse()}
              disabled={disabled}
              class="shrink-0 rounded-lg border border-slate-600 px-3 text-sm text-slate-300 hover:border-sky-500 hover:text-white"
            >
              Browse…
            </button>
          </div>
        </label>
      </div>

      {estimatedBytes !== null && (
        <p class="text-xs text-slate-500">
          Estimated download size ≈ {(estimatedBytes / 1024 / 1024).toFixed(0)} MB (from stream
          metadata)
        </p>
      )}
    </div>
  )
}
