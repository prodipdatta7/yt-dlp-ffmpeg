import { useEffect, useState } from 'preact/hooks'
import { getEmbedInfo } from '../utils/source'
import { CloseIcon, DownloadIcon, FilmIcon, LinkIcon, MaximizeIcon } from './icons'

export interface InlineVideoPreviewProps {
  url?: string | null
  title?: string
  startSec?: number
  onClose?: () => void
  onExpand?: () => void
  className?: string
  hideHeaderControls?: boolean
}

export function InlineVideoPreview({
  url,
  title,
  startSec,
  onClose,
  onExpand,
  className = '',
  hideHeaderControls = false,
}: InlineVideoPreviewProps) {
  const embed = getEmbedInfo(url, startSec)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
  }, [embed?.src])

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
            src={embed.src}
            title={title ?? 'Video preview'}
            class="size-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            onLoad={() => setLoading(false)}
          />
        </>
      ) : (
        <video controls autoPlay src={embed.src} class="size-full object-contain" />
      )}

      {/* Floating Header Controls */}
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

export interface InlineVideoPreviewModalProps {
  url?: string | null
  title: string
  uploader?: string | null
  onClose: () => void
  onQuickDownload?: () => void
  onOpenInDownloader?: () => void
}

export function InlineVideoPreviewModal({
  url,
  title,
  uploader,
  onClose,
  onQuickDownload,
  onOpenInDownloader,
}: InlineVideoPreviewModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div class="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
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
            onClick={onClose}
            title="Close modal (Esc)"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-neutral-300 transition hover:bg-white/15 hover:text-white"
          >
            <CloseIcon class="size-4" />
          </button>
        </div>

        {/* 16:9 Video Player Container */}
        <div class="relative aspect-video w-full bg-black">
          <InlineVideoPreview url={url} title={title} className="rounded-none" />
        </div>

        {/* Modal Footer Actions */}
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-neutral-950/60 px-4 py-3">
          <div class="flex items-center gap-2 text-xs text-neutral-400">
            <span>
              {getEmbedInfo(url)?.platform === 'SoundCloud'
                ? 'Audio Preview Mode'
                : 'Video Preview Mode'}
            </span>
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
