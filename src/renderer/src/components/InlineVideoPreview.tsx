import { useEffect, useRef, useState } from 'preact/hooks'
import { getEmbedInfo } from '../utils/source'
import { CloseIcon, DownloadIcon, FilmIcon, LinkIcon, MaximizeIcon, VolumeIcon } from './icons'

export interface InlineVideoPreviewProps {
  url?: string | null
  title?: string
  startSec?: number
  volumeBoost?: number
  onClose?: () => void
  onExpand?: () => void
  className?: string
  hideHeaderControls?: boolean
  onTimeUpdate?: (currentTimeSec: number) => void
  onPlayingChange?: (isPlaying: boolean) => void
}

export function InlineVideoPreview({
  url,
  title,
  startSec,
  volumeBoost = 1,
  onClose,
  onExpand,
  className = '',
  hideHeaderControls = false,
  onTimeUpdate,
  onPlayingChange,
}: InlineVideoPreviewProps) {
  const embed = getEmbedInfo(url, startSec)
  const [loading, setLoading] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)

  useEffect(() => {
    setLoading(true)
  }, [embed?.src])

  // Cleanup Web Audio graph on unmount or src change to prevent leaks
  useEffect(() => {
    return () => {
      try {
        sourceNodeRef.current?.disconnect()
        gainNodeRef.current?.disconnect()
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
          void audioCtxRef.current.close()
        }
      } catch {
        /* ignore */
      }
      sourceNodeRef.current = null
      gainNodeRef.current = null
      audioCtxRef.current = null
    }
  }, [embed?.src])

  const applyGainBoost = (boost: number) => {
    if (embed?.type === 'video' && videoRef.current) {
      try {
        if (!audioCtxRef.current) {
          const AudioContextClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (AudioContextClass) {
            const ctx = new AudioContextClass()
            const source = ctx.createMediaElementSource(videoRef.current)
            const gain = ctx.createGain()
            gain.gain.value = boost
            source.connect(gain)
            gain.connect(ctx.destination)

            audioCtxRef.current = ctx
            sourceNodeRef.current = source
            gainNodeRef.current = gain
          }
        } else if (gainNodeRef.current) {
          gainNodeRef.current.gain.value = boost
          if (audioCtxRef.current.state === 'suspended') {
            void audioCtxRef.current.resume()
          }
        }
      } catch (err) {
        console.warn('[InlineVideoPreview] Web Audio gain boost error:', err)
      }
    } else if (embed?.type === 'iframe') {
      // Un-mute and ensure maximum player volume
      sendIframeCommand('unMute')
      sendIframeCommand('setVolume', [100])
    }
    // Broadcast boost to Electron child frames (iframes)
    void window.mf.setPreviewVolumeBoost(boost)
  }

  useEffect(() => {
    applyGainBoost(volumeBoost)
  }, [volumeBoost, embed?.type])

  // Send command to iframe safely via postMessage
  const sendIframeCommand = (func: string, args: unknown[] = []) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*',
      )
    } catch {
      /* cross-origin ignore */
    }
  }

  // When startSec changes, seek without reloading if iframe is already active
  useEffect(() => {
    if (startSec !== undefined && startSec !== null) {
      if (embed?.type === 'iframe') {
        sendIframeCommand('seekTo', [startSec, true])
      } else if (videoRef.current) {
        videoRef.current.currentTime = startSec
      }
    }
  }, [startSec, embed?.type])

  // Periodic time poll for YouTube iframe embeds
  useEffect(() => {
    if (embed?.type !== 'iframe') return
    const interval = setInterval(() => {
      sendIframeCommand('getCurrentTime')
    }, 400)
    return () => clearInterval(interval)
  }, [embed?.type])

  // Listen to postMessage from YouTube, SoundCloud, and Vimeo embeds
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      let data = e.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return
        }
      }
      if (!data || typeof data !== 'object') return
      const msg = data as Record<string, unknown>

      // YouTube player API
      if (msg.event === 'infoDelivery' && msg.info && typeof msg.info === 'object') {
        const info = msg.info as Record<string, unknown>
        if (typeof info.currentTime === 'number' && Number.isFinite(info.currentTime)) {
          onTimeUpdate?.(info.currentTime)
        }
        if (typeof info.playerState === 'number') {
          // 1 = playing, 2 = paused
          const isPlaying = info.playerState === 1
          onPlayingChange?.(isPlaying)
          if (isPlaying && volumeBoost > 1) {
            void window.mf.setPreviewVolumeBoost(volumeBoost)
          }
        }
      }
      if (msg.event === 'onStateChange' && typeof msg.info === 'number') {
        onPlayingChange?.(msg.info === 1)
      }

      // SoundCloud widget events
      if (msg.method === 'playProgress' && msg.data && typeof msg.data === 'object') {
        const scData = msg.data as Record<string, unknown>
        if (typeof scData.currentPosition === 'number') {
          onTimeUpdate?.(scData.currentPosition / 1000)
        }
      }
      if (msg.method === 'pause') onPlayingChange?.(false)
      if (msg.method === 'play') onPlayingChange?.(true)

      // Vimeo player events
      if (msg.event === 'timeupdate' && msg.data && typeof msg.data === 'object') {
        const vimeoData = msg.data as Record<string, unknown>
        if (typeof vimeoData.seconds === 'number') {
          onTimeUpdate?.(vimeoData.seconds)
        }
      }
      if (msg.event === 'play') onPlayingChange?.(true)
      if (msg.event === 'pause') onPlayingChange?.(false)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onTimeUpdate, onPlayingChange])

  if (!embed) {
    return (
      <div
        class={`relative flex size-full flex-col items-center justify-center gap-2.5 rounded-xl bg-neutral-900 p-4 text-center text-white ${className}`}
      >
        <FilmIcon class="size-7 text-neutral-400" />
        <p class="text-xs font-medium text-neutral-300">Direct embed preview unavailable</p>
        <div class="flex items-center gap-2">
          {url && (
            <button
              type="button"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              class="rounded-lg bg-sky-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-500"
            >
              Open in Browser
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              class="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-400 transition hover:text-white"
            >
              Close
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      class={`group relative size-full overflow-hidden rounded-xl bg-black shadow-inner ${className}`}
    >
      {embed.type === 'iframe' ? (
        <>
          {loading && (
            <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-neutral-950 text-neutral-400">
              <span class="size-5 animate-spin rounded-full border-2 border-neutral-600 border-t-[#ff5500]" />
              <span class="text-[10.5px] font-medium text-neutral-400">Loading player...</span>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={embed.src}
            title={title ?? 'Video preview'}
            class="size-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            onLoad={() => {
              setLoading(false)
              try {
                iframeRef.current?.contentWindow?.postMessage(
                  JSON.stringify({ event: 'listening' }),
                  '*',
                )
                iframeRef.current?.contentWindow?.postMessage(
                  JSON.stringify({
                    event: 'command',
                    func: 'addEventListener',
                    args: ['onStateChange'],
                  }),
                  '*',
                )
              } catch {
                /* cross-origin ignore */
              }
              if (volumeBoost > 1) {
                void window.mf.setPreviewVolumeBoost(volumeBoost)
              }
            }}
          />
        </>
      ) : (
        <video
          ref={videoRef}
          controls
          autoPlay
          src={embed.src}
          class="size-full object-contain"
          onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
          onPlay={() => onPlayingChange?.(true)}
          onPause={() => onPlayingChange?.(false)}
        />
      )}

      {/* Floating Header Controls: only badge and close/expand, never obstructing player controls */}
      {!hideHeaderControls && (
        <div class="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-2">
          <span class="rounded-md border border-white/15 bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm backdrop-blur-md">
            {embed.platform} Preview
          </span>

          <div class="pointer-events-auto flex items-center gap-1.5">
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                title="Expand to Full Preview"
                class="flex size-6 items-center justify-center rounded-md border border-white/10 bg-black/80 text-white shadow transition hover:bg-black hover:scale-105 active:scale-95"
              >
                <MaximizeIcon class="size-3.5" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title="Close preview"
                class="flex size-6 items-center justify-center rounded-md border border-white/10 bg-black/80 text-white shadow transition hover:bg-black hover:scale-105 active:scale-95"
              >
                <CloseIcon class="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function VolumeBoosterControl({
  volumeBoost = 1,
  onChange,
  isIframe = false,
  className = '',
}: {
  volumeBoost?: number
  onChange?: (boost: number) => void
  isIframe?: boolean
  className?: string
}) {
  return (
    <div
      class={`inline-flex items-center rounded-md border border-line bg-wash-1 p-0.5 text-xs ${className}`}
      title={
        isIframe
          ? 'Volume Booster: Sets embed player to 100% volume. (For +6 dB boost, download with Smart Loudness or Volume Boost).'
          : 'Volume Booster: Amplify preview audio (100%, 150%, or 200% / +6 dB)'
      }
    >
      <span class="flex items-center gap-1 px-1.5 font-medium text-slate-400">
        <VolumeIcon class="size-3 text-amber-400" />
        <span class="text-[10px] font-bold uppercase tracking-wider">Boost</span>
      </span>
      {([1, 1.5, 2] as const).map((level) => {
        const active = volumeBoost === level
        return (
          <button
            key={level}
            type="button"
            onClick={() => onChange?.(level)}
            title={
              level === 1
                ? 'Standard Volume (100%)'
                : level === 1.5
                  ? 'Boost Volume to 150%'
                  : 'Maximum Boost (200% / +6 dB)'
            }
            class={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold transition ${
              active
                ? 'bg-amber-500 font-bold text-white shadow-sm'
                : 'text-slate-400 hover:bg-wash-2 hover:text-ink'
            }`}
          >
            {level === 1 ? '100%' : level === 1.5 ? '150%' : '200%'}
          </button>
        )
      })}
    </div>
  )
}

export interface InlineVideoPreviewModalProps {
  url?: string | null
  title: string
  uploader?: string | null
  startSec?: number
  onClose: (lastTimeSec?: number) => void
  onQuickDownload?: () => void
  onOpenInDownloader?: () => void
}

export function InlineVideoPreviewModal({
  url,
  title,
  uploader,
  startSec,
  onClose,
  onQuickDownload,
  onOpenInDownloader,
}: InlineVideoPreviewModalProps) {
  const [modalVolumeBoost, setModalVolumeBoost] = useState<number>(1)
  const lastTimeRef = useRef<number | undefined>(startSec)

  const handleClose = () => {
    onClose(lastTimeRef.current)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div class="flex w-full max-w-[96vw] xl:max-w-6xl 2xl:max-w-7xl max-h-[95vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
        {/* Modal Header */}
        <div class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div class="flex min-w-0 flex-1 flex-col">
            <h3 class="truncate text-sm font-bold text-white sm:text-base" title={title}>
              {title}
            </h3>
            {uploader && <p class="text-xs text-neutral-400">{uploader}</p>}
          </div>
          <button
            type="button"
            onClick={handleClose}
            title="Close modal (Esc)"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-neutral-300 transition hover:bg-white/15 hover:text-white"
          >
            <CloseIcon class="size-4" />
          </button>
        </div>

        {/* 16:9 Video Player Container with responsive max height */}
        <div class="relative flex aspect-video w-full max-h-[78vh] items-center justify-center bg-black">
          <InlineVideoPreview
            url={url}
            title={title}
            startSec={startSec}
            volumeBoost={modalVolumeBoost}
            onTimeUpdate={(sec) => {
              lastTimeRef.current = sec
            }}
            hideHeaderControls
            className="rounded-none size-full"
          />
        </div>

        {/* Modal Footer Actions */}
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-neutral-950/60 px-4 py-3">
          <div class="flex items-center gap-3 text-xs text-neutral-400">
            <span>
              {getEmbedInfo(url)?.platform === 'SoundCloud'
                ? 'Audio Preview Mode'
                : 'Video Preview Mode'}
            </span>
            <VolumeBoosterControl
              volumeBoost={modalVolumeBoost}
              onChange={setModalVolumeBoost}
              isIframe={getEmbedInfo(url)?.type === 'iframe'}
              className="border-white/15 bg-black/60 text-slate-200"
            />
          </div>
          <div class="flex items-center gap-2">
            {onOpenInDownloader && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenInDownloader()
                }}
                class="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:bg-white/10 hover:text-white"
              >
                <LinkIcon class="size-3.5" />
                <span>Open in Downloader</span>
              </button>
            )}
            {onQuickDownload && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onQuickDownload()
                }}
                class="flex items-center gap-1.5 rounded-lg bg-[#ff5500] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#e04e00] active:scale-[0.98]"
              >
                <DownloadIcon class="size-3.5" />
                <span>Quick Download</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
