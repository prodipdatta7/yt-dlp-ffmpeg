import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { SearchResultItem } from '../../../shared/models'
import {
  BILIBILI_FORMAT_PRESETS,
  BILIBILI_MULTI_P_PRESETS,
  SEARCH_FORMAT_PRESETS,
  SOUNDCLOUD_DJ_SET_PRESETS,
  SOUNDCLOUD_FORMAT_PRESETS,
  detectAudioSubtitleSpecs,
  detectBestFormatPreset,
  detectBilibiliSpecs,
  detectSoundcloudSpecs,
  detectVideoTechSpecs,
  estimatePresetBytes,
  type BilibiliSpecs,
  type FormatPresetOption,
  type SoundcloudSpecs,
} from '../utils/estimate'
import { fmtCount, fmtDuration, fmtLikes, fmtSize, fmtUploadedAgo } from '../utils/format'
import {
  BilibiliTvIcon,
  CheckCircleFilledIcon,
  ClipboardIcon,
  DownloadIcon,
  EyeIcon,
  FilmIcon,
  HeartFilledIcon,
  LinkIcon,
  MoreVerticalIcon,
  MusicIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  SoundcloudIcon,
  ThumbsUpIcon,
} from './icons'
import { InlineVideoPreview, InlineVideoPreviewModal } from './InlineVideoPreview'
import { CheckSquare } from './PreviewPanel'

export interface SearchResultCardProps {
  entry: SearchResultItem
  selected: boolean
  onToggleSelect: (url: string) => void
  onOpenInDownloader: (item: SearchResultItem) => void
  onQuickDownload: (item: SearchResultItem, preset: FormatPresetOption) => void
  onAddToQueue: (item: SearchResultItem, preset: FormatPresetOption) => void
  disabled?: boolean
}

export function SearchResultCard({
  entry,
  selected,
  onToggleSelect,
  onOpenInDownloader,
  onQuickDownload,
  onAddToQueue,
  disabled = false,
}: SearchResultCardProps) {
  const isSoundCloud =
    entry.platform === 'soundcloud' || (entry.url != null && entry.url.includes('soundcloud.com'))

  const isBilibili =
    entry.platform === 'bilibili' ||
    (entry.url != null && (entry.url.includes('bilibili.com') || entry.url.includes('b23.tv')))

  const scSpecs: SoundcloudSpecs | null = useMemo(
    () => (isSoundCloud ? detectSoundcloudSpecs(entry.title, entry.uploader, entry.url) : null),
    [isSoundCloud, entry.title, entry.uploader, entry.url],
  )

  const biliSpecs: BilibiliSpecs | null = useMemo(
    () =>
      isBilibili
        ? detectBilibiliSpecs(
            entry.title,
            entry.uploader,
            entry.url,
            entry.id,
            entry.durationSec,
            entry.viewCount,
            entry.likeCount,
            entry.commentCount,
            entry.isVerified,
          )
        : null,
    [
      isBilibili,
      entry.title,
      entry.uploader,
      entry.url,
      entry.id,
      entry.durationSec,
      entry.viewCount,
      entry.likeCount,
      entry.commentCount,
      entry.isVerified,
    ],
  )

  const defaultPresetId = useMemo(() => {
    if (isSoundCloud && scSpecs) {
      return scSpecs.isDjSet ? 'sc-split-tracks' : 'sc-flac-lossless'
    }
    if (isBilibili && biliSpecs) {
      return biliSpecs.isMultiPart ? 'bili-batch-all-1080p' : 'bili-4k-120'
    }
    return detectBestFormatPreset(entry.title)
  }, [isSoundCloud, scSpecs, isBilibili, biliSpecs, entry.title])

  const [selectedPresetId, setSelectedPresetId] = useState(defaultPresetId)
  const [previewActive, setPreviewActive] = useState(false)
  const [modalPreviewOpen, setModalPreviewOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imgError, setImgError] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Sync selected preset when default preset changes (e.g. results update)
  useEffect(() => {
    setSelectedPresetId(defaultPresetId)
  }, [defaultPresetId])

  const presets = useMemo(() => {
    if (isSoundCloud) {
      return scSpecs?.isDjSet ? SOUNDCLOUD_DJ_SET_PRESETS : SOUNDCLOUD_FORMAT_PRESETS
    }
    if (isBilibili) {
      return biliSpecs?.isMultiPart ? BILIBILI_MULTI_P_PRESETS : BILIBILI_FORMAT_PRESETS
    }
    return SEARCH_FORMAT_PRESETS
  }, [isSoundCloud, scSpecs?.isDjSet, isBilibili, biliSpecs?.isMultiPart])

  const currentPreset = useMemo(
    () => presets.find((p) => p.id === selectedPresetId) ?? presets[0],
    [presets, selectedPresetId],
  )

  const specs = useMemo(() => detectVideoTechSpecs(entry.title), [entry.title])
  const audioSub = useMemo(
    () => detectAudioSubtitleSpecs(entry.title, entry.uploader),
    [entry.title, entry.uploader],
  )

  // Dynamic size estimate linked to currently selected preset
  const selectedSize = useMemo(
    () => estimatePresetBytes(currentPreset, entry.durationSec ?? null),
    [currentPreset, entry.durationSec],
  )

  // Dynamic size badge summary for video cards
  const videoSizeSummary = useMemo(() => {
    const dur = entry.durationSec ?? null
    if (dur === null || dur <= 0) {
      return 'Size calculated upon analysis'
    }

    const p1080 = SEARCH_FORMAT_PRESETS[0]
    const p720 = SEARCH_FORMAT_PRESETS[2]
    const p4K = SEARCH_FORMAT_PRESETS[1]

    const bytes1080 = estimatePresetBytes(p1080, dur)
    const bytes720 = estimatePresetBytes(p720, dur)
    const bytes4K = estimatePresetBytes(p4K, dur)

    if (currentPreset.id === '1080p-fhd') {
      return `~${fmtSize(bytes1080)} (1080p) / ~${fmtSize(bytes720)} (720p)`
    }
    if (currentPreset.id === '720p-hd') {
      return `~${fmtSize(bytes720)} (720p) / ~${fmtSize(bytes1080)} (1080p)`
    }
    if (currentPreset.id === '4k-uhd') {
      return `~${fmtSize(bytes4K)} (4K) / ~${fmtSize(bytes1080)} (1080p)`
    }
    if (currentPreset.mode === 'audio-only') {
      return `~${fmtSize(selectedSize)} (${currentPreset.shortLabel})`
    }
    return `~${fmtSize(selectedSize)} (${currentPreset.shortLabel})`
  }, [currentPreset, entry.durationSec, selectedSize])

  // Dynamic size badge summary for SoundCloud cards
  const scSizeSummary = useMemo(() => {
    const dur = entry.durationSec ?? null
    if (!scSpecs) return ''
    if (scSpecs.isDjSet) {
      if (dur && dur > 0) {
        const mp3Bytes = estimatePresetBytes(SOUNDCLOUD_DJ_SET_PRESETS[0], dur)
        const flacBytes = estimatePresetBytes(SOUNDCLOUD_DJ_SET_PRESETS[2], dur)
        return `~${fmtSize(mp3Bytes)} (MP3 320k) / ~${fmtSize(flacBytes)} (FLAC)`
      }
      return '~185 MB (MP3 320k) / ~620 MB (FLAC)'
    } else {
      if (dur && dur > 0) {
        const flacBytes = estimatePresetBytes(SOUNDCLOUD_FORMAT_PRESETS[0], dur)
        const mp3Bytes = estimatePresetBytes(SOUNDCLOUD_FORMAT_PRESETS[1], dur)
        return `~${fmtSize(flacBytes)} (FLAC Lossless) / ~${fmtSize(mp3Bytes)} (MP3 320k)`
      }
      return '~48 MB (FLAC Lossless) / ~11 MB (MP3 320k)'
    }
  }, [scSpecs, entry.durationSec])

  // Dynamic size badge summary for Bilibili cards
  const biliSizeSummary = useMemo(() => {
    const dur = entry.durationSec ?? null
    if (!biliSpecs) return ''
    if (biliSpecs.isMultiPart) {
      const partCount = biliSpecs.partCount
      const effectiveDur = dur && dur > 0 ? dur : partCount * 21 * 60
      const totalBytes = estimatePresetBytes(currentPreset, effectiveDur) ?? 0
      const perPartBytes = Math.round(totalBytes / partCount)
      return `~${fmtSize(totalBytes)} (All ${partCount} Parts in ${currentPreset.shortLabel}) / ~${fmtSize(perPartBytes)} per part`
    }
    if (dur && dur > 0) {
      const p4k = BILIBILI_FORMAT_PRESETS[0]
      const p1080 = BILIBILI_FORMAT_PRESETS[1]
      const b4k = estimatePresetBytes(p4k, dur) ?? 0
      const b1080 = estimatePresetBytes(p1080, dur) ?? 0
      if (currentPreset.id === 'bili-4k-120') {
        return `~${fmtSize(b4k)} (4K 120fps HEVC) / ~${fmtSize(b1080)} (1080p60)`
      }
      const curBytes = estimatePresetBytes(currentPreset, dur)
      return curBytes != null
        ? `~${fmtSize(curBytes)} (${currentPreset.shortLabel})`
        : 'Size calculated upon analysis'
    }
    return 'Size calculated upon analysis'
  }, [biliSpecs, entry.durationSec, currentPreset])

  // Avatar initial logic matching mockup (single letter for solo, 2-letter for crews/DJ sets)
  const scAvatarInitial = useMemo(() => {
    const uploader = (entry.uploader ?? '').trim()
    if (!uploader) return 'A'
    const words = uploader.split(/\s+/)
    if (scSpecs?.isDjSet || words.length >= 3) {
      return words
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    }
    return (words[0]?.[0] ?? 'A').toUpperCase()
  }, [entry.uploader, scSpecs?.isDjSet])

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDocClick)
    return () => window.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(entry.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore clipboard err */
    }
    setMenuOpen(false)
  }

  const openInBrowser = () => {
    window.open(entry.url, '_blank', 'noopener,noreferrer')
    setMenuOpen(false)
  }

  const channelInitial = (entry.uploader?.trim() || 'U')[0].toUpperCase()
  const avatarBg = channelInitial === 'C' ? 'bg-[#2563eb]' : 'bg-[#ff5500]'
  const isVerified =
    entry.isVerified === true ||
    (Boolean(entry.uploader) &&
      /drama|records|vevo|music|channel|tv|official|sky|capital/i.test(entry.uploader!))

  return (
    <li class="list-none">
      <div
        class={`w-full rounded-2xl border p-3.5 transition-all duration-150 sm:p-4 text-left ${
          selected
            ? 'border-[#ff5500]/70 bg-orange-50/40 shadow-md shadow-orange-500/10 dark:border-sky-500/50 dark:bg-[#161d2d]'
            : 'border-neutral-200 bg-white shadow-xs hover:border-neutral-300 hover:shadow-sm dark:border-white/10 dark:bg-[#131722]/95 dark:hover:border-neutral-700'
        }`}
      >
        <div class="flex flex-col gap-3.5 sm:flex-row sm:items-start">
          {/* Checkbox column */}
          <div class="pt-0.5 sm:pt-1 shrink-0">
            <button
              type="button"
              onClick={() => onToggleSelect(entry.url)}
              title={selected ? 'Deselect item' : 'Select item'}
              class="mf-focus-ring flex items-center justify-center rounded p-0.5 transition"
            >
              <CheckSquare checked={selected} />
            </button>
          </div>

          {/* Dedicated SoundCloud Layout */}
          {isSoundCloud && scSpecs ? (
            <>
              {/* Artwork column (Square aspect-square) */}
              <div class="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-inner sm:w-44 md:w-52 dark:border-white/5 dark:bg-neutral-900">
                {previewActive ? (
                  <InlineVideoPreview
                    url={entry.url}
                    title={entry.title}
                    onClose={() => setPreviewActive(false)}
                    onExpand={() => setModalPreviewOpen(true)}
                    className="size-full"
                  />
                ) : (
                  <>
                    {entry.thumbnailUrl && !imgError ? (
                      <img
                        src={entry.thumbnailUrl}
                        alt={entry.title}
                        onError={() => setImgError(true)}
                        class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div class="flex size-full items-center justify-center bg-neutral-100 text-[#ff5500]/60 dark:bg-neutral-800 dark:text-orange-500/60">
                        <SoundcloudIcon class="size-10" />
                      </div>
                    )}

                    {/* Hover Play/Preview Overlay Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewActive(true)
                      }}
                      title="Play audio preview"
                      class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 hover:opacity-100 hover:bg-black/45"
                    >
                      <span class="flex items-center gap-1.5 rounded-full bg-[#ff5500] px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-95">
                        <PlayIcon class="size-3.5 fill-white" />
                        <span>Preview</span>
                      </span>
                    </button>

                    {/* Overlaid Badges (Top-Left) */}
                    <div class="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5">
                      <span class="flex items-center gap-1 rounded bg-[#ff5500] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                        <SoundcloudIcon class="size-3 fill-white" />
                        <span>{scSpecs.artworkBadge1}</span>
                      </span>
                      <span class="rounded border border-white/10 bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 shadow-sm backdrop-blur-md">
                        {scSpecs.artworkBadge2}
                      </span>
                    </div>

                    {/* Bottom-Left Overlay: Waveform or CUE pill */}
                    {scSpecs.bottomLeftOverlay === 'cue' ? (
                      <div class="pointer-events-none absolute bottom-2 left-2 z-10">
                        <span class="rounded border border-white/10 bg-black/80 px-1.5 py-0.5 text-[10px] font-mono text-neutral-300 shadow backdrop-blur-md">
                          CUE Sheet Detected
                        </span>
                      </div>
                    ) : (
                      <div class="pointer-events-none absolute bottom-2 left-2 z-10 flex items-end gap-0.5 rounded bg-black/60 px-1.5 py-1 backdrop-blur-md">
                        <span class="w-1 rounded-full bg-[#ff5500] h-2 animate-pulse" />
                        <span class="w-1 rounded-full bg-[#ff5500] h-4" />
                        <span
                          class="w-1 rounded-full bg-[#ff7700] h-3 animate-pulse"
                          style={{ animationDelay: '150ms' }}
                        />
                        <span class="w-1 rounded-full bg-[#ff5500] h-5" />
                        <span
                          class="w-1 rounded-full bg-[#ff7700] h-2.5 animate-pulse"
                          style={{ animationDelay: '300ms' }}
                        />
                        <span class="w-1 rounded-full bg-[#ff5500] h-4" />
                        <span class="w-1 rounded-full bg-[#ffaa00] h-1.5" />
                      </div>
                    )}

                    {/* Bottom-Right Duration Overlay */}
                    <div class="pointer-events-none absolute bottom-2 right-2 z-10">
                      {scSpecs.isDjSet ? (
                        <span class="rounded bg-black/85 px-1.5 py-0.5 text-[10.5px] font-mono font-bold text-white shadow backdrop-blur-md">
                          <span class="text-[#22c55e]">Auto Split OK</span>{' '}
                          <span>
                            {entry.durationSec != null ? fmtDuration(entry.durationSec) : '1:14:20'}
                          </span>
                        </span>
                      ) : (
                        <span class="rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-bold font-mono text-white shadow backdrop-blur-md">
                          {entry.durationSec != null ? fmtDuration(entry.durationSec) : '04:12'}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Details Column */}
              <div class="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
                {/* Header Row: Category Tag & Slug */}
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded border border-[#fed7aa] bg-[#fff7ed] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#ea580c] shadow-2xs dark:border-orange-500/30 dark:bg-orange-950/40 dark:text-orange-400">
                      {scSpecs.categoryTag}
                    </span>
                    <span
                      class="font-mono text-[11px] text-neutral-400 dark:text-neutral-500 truncate max-w-sm"
                      title={scSpecs.permalinkSlug}
                    >
                      {scSpecs.permalinkSlug}
                    </span>
                  </div>

                  {/* Title */}
                  <h3
                    class="mt-1.5 cursor-pointer text-[14.5px] font-bold leading-snug tracking-tight text-neutral-900 transition hover:text-[#ff5500] dark:text-white dark:hover:text-orange-400 sm:text-[15.5px]"
                    title={entry.title}
                    onClick={() => onOpenInDownloader(entry)}
                  >
                    {entry.title}
                  </h3>

                  {/* Artist & Stats Row */}
                  <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      class={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                        scSpecs.isDjSet ? 'bg-neutral-900 dark:bg-neutral-700' : 'bg-[#ff5500]'
                      } text-[10px] font-bold text-white shadow-sm`}
                    >
                      {scAvatarInitial}
                    </span>
                    <span
                      class="max-w-[170px] truncate font-semibold text-neutral-800 dark:text-neutral-200"
                      title={entry.uploader ?? ''}
                    >
                      {entry.uploader || 'SoundCloud Artist'}
                    </span>
                    {scSpecs.isPro && (
                      <span class="rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-400 shadow-xs dark:bg-neutral-800">
                        PRO
                      </span>
                    )}
                    <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                    <span class="font-medium text-neutral-700 dark:text-neutral-300">
                      {entry.viewCount
                        ? `${fmtCount(entry.viewCount)} plays`
                        : scSpecs.isDjSet
                          ? '1.1M plays'
                          : '482K plays'}
                    </span>
                    <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                    <span class="text-neutral-500 dark:text-neutral-400">
                      {fmtUploadedAgo(entry.timestamp, entry.uploadDate) ||
                        (scSpecs.isDjSet ? 'Uploaded 1 month ago' : '2 weeks ago')}
                    </span>
                    <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                    {scSpecs.isDjSet ? (
                      <span class="flex items-center gap-1 font-semibold text-[#15803d] dark:text-emerald-400">
                        <ThumbsUpIcon class="size-3 shrink-0" />
                        <span>
                          {entry.likeCount
                            ? `99.1% (${fmtCount(entry.likeCount)} likes)`
                            : '99.1% (34K likes)'}
                        </span>
                      </span>
                    ) : (
                      <span class="flex items-center gap-1 font-semibold text-[#e11d48] dark:text-rose-400">
                        <HeartFilledIcon class="size-3.5 shrink-0" />
                        <span>
                          {entry.likeCount ? `${fmtCount(entry.likeCount)} likes` : '18.4K likes'}
                        </span>
                      </span>
                    )}
                    {!scSpecs.isDjSet && (
                      <>
                        <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                        <span class="flex items-center gap-1 font-semibold text-[#2563eb] dark:text-blue-400">
                          <RepeatIcon class="size-3.5 shrink-0" />
                          <span>3.2K reposts</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Spec Badges Rows */}
                <div class="flex flex-col gap-1.5">
                  {/* Row 1: Size & Stream */}
                  <div class="flex flex-wrap items-center gap-2 text-[11px]">
                    <div class="rounded-lg border border-[#fed7aa] bg-[#fff8f2] px-2.5 py-1 text-neutral-700 dark:border-orange-500/30 dark:bg-[#1f1915] dark:text-neutral-200">
                      <span class="font-bold text-[#ea580c] dark:text-orange-400">Size:</span>{' '}
                      <span class="font-medium text-[#9a3412] dark:text-neutral-200">
                        {scSizeSummary}
                      </span>
                    </div>

                    <div class="rounded-lg border border-neutral-200 bg-[#f4f4f5] px-2.5 py-1 text-neutral-700 dark:border-white/10 dark:bg-[#161c28] dark:text-neutral-200">
                      <span class="font-bold text-neutral-800 dark:text-neutral-300">
                        {scSpecs.isDjSet ? 'Audio:' : 'Stream:'}
                      </span>{' '}
                      <span class="font-medium text-neutral-600 dark:text-neutral-300">
                        {scSpecs.streamBadge.replace(/^(Stream|Audio):\s*/, '')}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: ID3 / Tagging */}
                  <div class="flex flex-wrap items-center gap-2 text-[11px]">
                    <div class="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-2.5 py-1 text-[#047857] dark:border-emerald-800/40 dark:bg-[#062419]/60 dark:text-emerald-300">
                      {!scSpecs.isDjSet && (
                        <span class="font-bold text-[#059669] dark:text-emerald-400">ID3: </span>
                      )}
                      <span class="font-medium">
                        {scSpecs.isDjSet
                          ? scSpecs.id3Badge
                          : scSpecs.id3Badge.replace(/^ID3:\s*/, '')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Bar (Bottom Row) */}
                <div class="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                  {/* Left: Format Dropdown */}
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      Download format:
                    </span>
                    <div class="relative">
                      <select
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.currentTarget.value)}
                        disabled={disabled}
                        class="cursor-pointer appearance-none rounded-lg border border-neutral-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-800 shadow-xs outline-none transition hover:border-neutral-400 focus:border-[#ff5500] focus:ring-1 focus:ring-[#ff5500] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-200 dark:hover:border-neutral-600"
                      >
                        {presets.map((preset) => {
                          const bytes = estimatePresetBytes(preset, entry.durationSec ?? null)
                          let sizeStr = bytes !== null ? ` ~ ${fmtSize(bytes)}` : ''
                          if (!sizeStr) {
                            if (preset.id === 'sc-flac-lossless') sizeStr = ' ~ 48 MB'
                            else if (preset.id === 'sc-mp3-320') sizeStr = ' ~ 11 MB'
                            else if (preset.id === 'sc-artist-original') sizeStr = ' ~ 6 MB'
                            else if (preset.id === 'sc-aac-256') sizeStr = ' ~ 9 MB'
                            else if (preset.id === 'sc-split-tracks') sizeStr = ' ~ 185 MB'
                            else if (preset.id === 'sc-continuous-mp3') sizeStr = ' ~ 185 MB'
                            else if (preset.id === 'sc-continuous-flac') sizeStr = ' ~ 620 MB'
                          }
                          return (
                            <option
                              key={preset.id}
                              value={preset.id}
                              class="bg-white text-neutral-800 dark:bg-[#141824] dark:text-neutral-200"
                            >
                              {preset.label}
                              {sizeStr}
                            </option>
                          )
                        })}
                      </select>
                      <span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500">
                        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div class="flex items-center gap-2">
                    {/* Preview / Play button */}
                    <button
                      type="button"
                      onClick={() => setPreviewActive(!previewActive)}
                      disabled={disabled}
                      title={previewActive ? 'Close audio preview' : 'Play audio preview'}
                      class={`mf-focus-ring flex items-center justify-center rounded-lg border p-2 shadow-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        previewActive
                          ? 'border-[#ff5500] bg-[#fff5eb] text-[#ff5500] dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-400'
                          : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white'
                      }`}
                    >
                      <PlayIcon class="size-4 fill-current" />
                    </button>

                    {/* Quick Download CTA Button */}
                    <button
                      type="button"
                      onClick={() => onQuickDownload(entry, currentPreset)}
                      disabled={disabled}
                      title={`Quick Download as ${currentPreset.label}`}
                      class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-[#ff5500] hover:bg-[#e04e00] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <DownloadIcon class="size-4" />
                      <span>Quick Download</span>
                    </button>

                    {/* 3-dots Menu */}
                    <div class="relative" ref={menuRef}>
                      <button
                        type="button"
                        onClick={() => setMenuOpen(!menuOpen)}
                        disabled={disabled}
                        title="More actions"
                        aria-expanded={menuOpen}
                        class="mf-focus-ring flex items-center justify-center rounded-lg border border-neutral-300 bg-white p-2 text-neutral-600 shadow-xs transition hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white"
                      >
                        <MoreVerticalIcon class="size-4" />
                      </button>

                      {menuOpen && (
                        <div class="absolute right-0 bottom-full mb-1 z-30 w-56 rounded-xl border border-neutral-200 bg-white p-1.5 text-xs text-neutral-800 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 dark:border-neutral-700/90 dark:bg-[#161c28] dark:text-neutral-200">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onOpenInDownloader(entry)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <EyeIcon class="size-3.5 text-sky-500" />
                            <span>Open in Downloader</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              const topPreset = presets[0]
                              onQuickDownload(entry, topPreset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <MusicIcon class="size-3.5 text-amber-500" />
                            <span>Download {presets[0]?.shortLabel ?? 'Audio'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              const mp3Preset =
                                presets.find((p) => p.audioFormat === 'mp3') ?? presets[0]
                              onQuickDownload(entry, mp3Preset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <MusicIcon class="size-3.5 text-indigo-500" />
                            <span>Download MP3 320k</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onAddToQueue(entry, currentPreset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <QueueIcon class="size-3.5 text-emerald-500" />
                            <span>Add to Queue</span>
                          </button>

                          <div class="my-1 border-t border-neutral-100 dark:border-neutral-800" />

                          <button
                            type="button"
                            onClick={copyUrl}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <ClipboardIcon class="size-3.5 text-neutral-400" />
                            <span>{copied ? 'Copied!' : 'Copy Track Link'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={openInBrowser}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <LinkIcon class="size-3.5 text-neutral-400" />
                            <span>Open in Browser</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : isBilibili && biliSpecs ? (
            <>
              {/* Dedicated Bilibili Layout (Single 4K / Multi-P Course Series) */}
              {/* Thumbnail column with Bilibili Badges */}
              <div class="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-inner sm:w-56 md:w-64 dark:border-white/5 dark:bg-neutral-900">
                {previewActive ? (
                  <InlineVideoPreview
                    url={entry.url}
                    title={entry.title}
                    onClose={() => setPreviewActive(false)}
                    onExpand={() => setModalPreviewOpen(true)}
                    className="size-full"
                  />
                ) : (
                  <>
                    {entry.thumbnailUrl && !imgError ? (
                      <img
                        src={entry.thumbnailUrl}
                        alt={entry.title}
                        onError={() => setImgError(true)}
                        class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div class="flex size-full items-center justify-center bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600">
                        <FilmIcon class="size-8" />
                      </div>
                    )}

                    {/* Hover Play/Preview Overlay Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewActive(true)
                      }}
                      title="Play inline video preview"
                      class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 hover:opacity-100 hover:bg-black/45"
                    >
                      <span class="flex items-center gap-1.5 rounded-full bg-[#00aeec] px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-95">
                        <PlayIcon class="size-3.5 fill-white" />
                        <span>Preview</span>
                      </span>
                    </button>

                    {/* Overlaid Badges (Top-Left) */}
                    <div class="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-1.5">
                      <span class="flex items-center gap-1 rounded bg-[#00aeec] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-xs">
                        <BilibiliTvIcon class="size-3 text-white" />
                        <span>BILIBILI</span>
                      </span>
                      <span
                        class={`rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white shadow-xs ${
                          biliSpecs.isMultiPart ? 'bg-[#ea580c]' : 'bg-[#fb7299]'
                        }`}
                      >
                        {biliSpecs.partBadge}
                      </span>
                      <span
                        class={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs backdrop-blur-md ${
                          biliSpecs.isMultiPart
                            ? 'bg-[#059669]'
                            : 'border border-white/10 bg-black/80'
                        }`}
                      >
                        {biliSpecs.badge3}
                      </span>
                    </div>

                    {/* Danmaku Badge (Bottom-Left) */}
                    {biliSpecs.danmakuCount && (
                      <div class="pointer-events-none absolute bottom-2 left-2 z-10">
                        <span class="flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10.5px] font-medium text-[#fb7299] shadow backdrop-blur-md">
                          <span>弹幕</span>
                          <span class="font-semibold text-white">{biliSpecs.danmakuCount}</span>
                        </span>
                      </div>
                    )}

                    {/* Duration / Parts Badge (Bottom-Right) */}
                    {biliSpecs.durationText && (
                      <div class="pointer-events-none absolute bottom-2 right-2 z-10">
                        <span class="rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white shadow backdrop-blur-md">
                          {biliSpecs.durationText}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Details Column */}
              <div class="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
                {/* Header Row: BVID + Category Tag + SubCategory */}
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded border border-[#00aeec]/30 bg-[#00aeec]/10 px-2 py-0.5 font-mono text-[11px] font-bold text-[#00aeec] shadow-xs">
                    {biliSpecs.bvid}
                  </span>
                  <span
                    class={`rounded px-2 py-0.5 text-[11px] font-bold shadow-xs ${
                      biliSpecs.isMultiPart
                        ? 'border border-[#10b981]/30 bg-[#10b981]/10 text-[#059669] dark:text-[#34d399]'
                        : 'border border-[#fb7299]/30 bg-[#fb7299]/10 text-[#fb7299]'
                    }`}
                  >
                    {biliSpecs.categoryTag}
                  </span>
                  <span class="text-[11.5px] font-medium text-neutral-400 dark:text-neutral-500">
                    {biliSpecs.subCategory}
                  </span>
                </div>

                {/* Title */}
                <div>
                  <h3
                    class="cursor-pointer text-[14.5px] font-bold leading-snug tracking-tight text-neutral-900 transition hover:text-[#00aeec] dark:text-white dark:hover:text-[#00aeec] sm:text-[15.5px]"
                    title={entry.title}
                    onClick={() => onOpenInDownloader(entry)}
                  >
                    {entry.title}
                  </h3>

                  {/* Channel & Author Line */}
                  <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      class={`flex size-5 shrink-0 items-center justify-center rounded-full ${biliSpecs.avatarBg} text-[11px] font-bold text-white shadow-sm`}
                    >
                      {biliSpecs.avatarInitial}
                    </span>
                    <span
                      class="max-w-[180px] truncate font-semibold text-neutral-800 dark:text-neutral-200"
                      title={entry.uploader ?? ''}
                    >
                      {entry.uploader ||
                        (biliSpecs.isMultiPart ? 'CodeArchitect Studio' : 'bilibili Official')}
                    </span>
                    <span
                      class="shrink-0 rounded bg-[#00aeec] px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-white shadow-xs"
                      title={biliSpecs.upBadge}
                    >
                      {biliSpecs.upBadge}
                    </span>
                    <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                    <span class="font-medium text-neutral-700 dark:text-neutral-300">
                      {biliSpecs.viewsText}
                    </span>
                    {biliSpecs.danmakuCountFull && (
                      <>
                        <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                        <span class="font-semibold text-[#fb7299]">
                          弹幕 {biliSpecs.danmakuCountFull}
                        </span>
                      </>
                    )}
                    {biliSpecs.coinsOrFav && (
                      <>
                        <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                        <span class="font-semibold text-[#d97706] dark:text-amber-400">
                          {biliSpecs.coinsOrFav}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Spec Badges Row */}
                <div class="flex flex-wrap items-center gap-2 text-[11px]">
                  {/* Size badge */}
                  <div class="rounded-lg border border-[#fed7aa] bg-[#fff8f2] px-2.5 py-1 text-neutral-700 dark:border-orange-500/30 dark:bg-[#1f1915] dark:text-neutral-200">
                    <span class="font-bold text-[#ea580c] dark:text-orange-400">Size:</span>{' '}
                    <span class="font-medium text-[#9a3412] dark:text-neutral-200">
                      {biliSizeSummary}
                    </span>
                  </div>

                  {/* Codec / Audio */}
                  <div class="rounded-lg border border-neutral-200 bg-[#f4f4f5] px-2.5 py-1 text-neutral-700 dark:border-white/10 dark:bg-[#161c28] dark:text-neutral-200">
                    <span class="font-medium text-neutral-700 dark:text-neutral-300">
                      {biliSpecs.codecAudioBadge}
                    </span>
                  </div>

                  {/* Danmaku / Episode selector */}
                  <div class="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-2.5 py-1 text-[#047857] dark:border-emerald-800/40 dark:bg-[#062419]/60 dark:text-emerald-300">
                    <span class="font-medium">{biliSpecs.danmakuBadge}</span>
                  </div>
                </div>

                {/* Action Bar Row */}
                <div class="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                  {/* Left: Format Dropdown */}
                  <div class="flex items-center gap-2">
                    <span class="whitespace-nowrap text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Download format:
                    </span>
                    <div class="relative">
                      <select
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.currentTarget.value)}
                        disabled={disabled}
                        class="cursor-pointer appearance-none rounded-lg border border-neutral-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-800 shadow-xs outline-none transition hover:border-neutral-400 focus:border-[#00aeec] focus:ring-1 focus:ring-[#00aeec] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-200 dark:hover:border-neutral-600"
                      >
                        {presets.map((preset) => {
                          const bytes = estimatePresetBytes(preset, entry.durationSec ?? null)
                          return (
                            <option
                              key={preset.id}
                              value={preset.id}
                              class="bg-white text-neutral-800 dark:bg-[#141824] dark:text-neutral-200"
                            >
                              {preset.label}
                              {bytes !== null ? ` ~ ${fmtSize(bytes)}` : ''}
                            </option>
                          )
                        })}
                      </select>
                      <span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500">
                        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div class="flex items-center gap-2">
                    {/* Eye Preview button */}
                    <button
                      type="button"
                      onClick={() => setPreviewActive(!previewActive)}
                      disabled={disabled}
                      title={previewActive ? 'Close inline preview' : 'Quick preview video'}
                      class={`mf-focus-ring flex items-center justify-center rounded-lg border p-2 shadow-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        previewActive
                          ? 'border-[#00aeec] bg-[#00aeec]/10 text-[#00aeec] dark:border-[#00aeec] dark:bg-[#00aeec]/20'
                          : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white'
                      }`}
                    >
                      <EyeIcon class="size-4" />
                    </button>

                    {/* Primary CTA button (Quick Download or Download All Parts) */}
                    <button
                      type="button"
                      onClick={() => onQuickDownload(entry, currentPreset)}
                      disabled={disabled}
                      title={`Download as ${currentPreset.label}`}
                      class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-[#00aeec] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#009cd3] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <DownloadIcon class="size-4" />
                      <span>{biliSpecs.ctaText}</span>
                    </button>

                    {/* 3-dots Menu */}
                    <div class="relative" ref={menuRef}>
                      <button
                        type="button"
                        onClick={() => setMenuOpen(!menuOpen)}
                        disabled={disabled}
                        title="More actions"
                        aria-expanded={menuOpen}
                        class="mf-focus-ring flex items-center justify-center rounded-lg border border-neutral-300 bg-white p-2 text-neutral-600 shadow-xs transition hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white"
                      >
                        <MoreVerticalIcon class="size-4" />
                      </button>

                      {menuOpen && (
                        <div class="absolute bottom-full right-0 z-30 mb-1 w-56 rounded-xl border border-neutral-200 bg-white p-1.5 text-xs text-neutral-800 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 dark:border-neutral-700/90 dark:bg-[#161c28] dark:text-neutral-200">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onOpenInDownloader(entry)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <EyeIcon class="size-3.5 text-sky-500" />
                            <span>Open in Downloader</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onQuickDownload(entry, presets[0])
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <DownloadIcon class="size-3.5 text-[#00aeec]" />
                            <span>Download {presets[0]?.shortLabel ?? 'Video'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onAddToQueue(entry, currentPreset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <QueueIcon class="size-3.5 text-emerald-500" />
                            <span>Add to Queue</span>
                          </button>

                          <div class="my-1 border-t border-neutral-100 dark:border-neutral-800" />

                          <button
                            type="button"
                            onClick={copyUrl}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <ClipboardIcon class="size-3.5 text-neutral-400" />
                            <span>{copied ? 'Copied!' : 'Copy Video URL'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={openInBrowser}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <LinkIcon class="size-3.5 text-neutral-400" />
                            <span>Open in Browser</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Standard 16:9 Video Layout (YouTube, Bilibili) */}
              {/* Thumbnail column with Badges */}
              <div class="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-inner sm:w-56 md:w-64 dark:border-white/5 dark:bg-neutral-900">
                {previewActive ? (
                  <InlineVideoPreview
                    url={entry.url}
                    title={entry.title}
                    onClose={() => setPreviewActive(false)}
                    onExpand={() => setModalPreviewOpen(true)}
                    className="size-full"
                  />
                ) : (
                  <>
                    {entry.thumbnailUrl && !imgError ? (
                      <img
                        src={entry.thumbnailUrl}
                        alt={entry.title}
                        onError={() => setImgError(true)}
                        class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div class="flex size-full items-center justify-center bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600">
                        <FilmIcon class="size-8" />
                      </div>
                    )}

                    {/* Hover Play/Preview Overlay Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewActive(true)
                      }}
                      title="Play inline video preview"
                      class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 hover:opacity-100 hover:bg-black/45"
                    >
                      <span class="flex items-center gap-1.5 rounded-full bg-[#ff5500] px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-95">
                        <PlayIcon class="size-3.5 fill-white" />
                        <span>Preview</span>
                      </span>
                    </button>

                    {/* Overlaid Badges (Top-Left) */}
                    <div class="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5">
                      <span class="rounded bg-[#ff5500] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                        {specs.resolutionBadge}
                      </span>
                      <span class="rounded border border-white/10 bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur-md">
                        {specs.codecBadge}
                      </span>
                    </div>

                    {/* Duration Badge (Bottom-Right) */}
                    {entry.durationSec != null && (
                      <div class="pointer-events-none absolute bottom-2 right-2 z-10">
                        <span class="rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-bold font-mono text-white shadow backdrop-blur-md">
                          {fmtDuration(entry.durationSec)}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Details Column */}
              <div class="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
                {/* Title */}
                <div>
                  <h3
                    class="cursor-pointer text-[14.5px] font-bold leading-snug tracking-tight text-neutral-900 transition hover:text-[#ff5500] dark:text-white dark:hover:text-orange-400 sm:text-[15.5px]"
                    title={entry.title}
                    onClick={() => onOpenInDownloader(entry)}
                  >
                    {entry.title}
                  </h3>

                  {/* Channel & Metadata Row */}
                  <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      class={`flex size-5 shrink-0 items-center justify-center rounded-full ${avatarBg} text-[10.5px] font-bold text-white shadow-sm`}
                    >
                      {channelInitial}
                    </span>
                    <span
                      class="max-w-[170px] truncate font-semibold text-neutral-800 dark:text-neutral-200"
                      title={entry.uploader ?? ''}
                    >
                      {entry.uploader || 'Unknown Channel'}
                    </span>
                    {isVerified && (
                      <span class="shrink-0 text-[#3b82f6]" title="Verified Channel">
                        <CheckCircleFilledIcon class="size-3.5" />
                      </span>
                    )}
                    <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                    <span class="font-medium text-neutral-700 dark:text-neutral-300">
                      {fmtCount(entry.viewCount ?? null)} views
                    </span>
                    {fmtUploadedAgo(entry.timestamp, entry.uploadDate) && (
                      <>
                        <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                        <span class="text-neutral-500 dark:text-neutral-400">
                          {fmtUploadedAgo(entry.timestamp, entry.uploadDate)}
                        </span>
                      </>
                    )}
                    {fmtLikes(entry.viewCount ?? null, entry.likeCount) && (
                      <>
                        <span class="font-bold text-neutral-300 dark:text-neutral-600">•</span>
                        <span class="flex items-center gap-1 font-semibold text-[#15803d] dark:text-emerald-400">
                          <ThumbsUpIcon class="size-3 shrink-0" />
                          <span>{fmtLikes(entry.viewCount ?? null, entry.likeCount)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Spec Badges Row */}
                <div class="flex flex-wrap items-center gap-2 text-[11px]">
                  {/* Format-linked Dynamic Size Badge */}
                  <div class="rounded-lg border border-[#fed7aa] bg-[#fff8f2] px-2.5 py-1 text-neutral-700 dark:border-orange-500/30 dark:bg-[#1f1915] dark:text-neutral-200">
                    <span class="font-bold text-[#ea580c] dark:text-orange-400">Size:</span>{' '}
                    <span class="font-medium text-[#9a3412] dark:text-neutral-200">
                      {videoSizeSummary}
                    </span>
                  </div>

                  {/* Audio stream intelligence */}
                  <div class="rounded-lg border border-neutral-200 bg-[#f4f4f5] px-2.5 py-1 text-neutral-700 dark:border-white/10 dark:bg-[#161c28] dark:text-neutral-200">
                    <span class="font-bold text-neutral-800 dark:text-neutral-300">Audio:</span>{' '}
                    <span class="font-medium text-neutral-600 dark:text-neutral-300">
                      {audioSub.audioBadge}
                    </span>
                  </div>

                  {/* Subtitles intelligence */}
                  <div class="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-2.5 py-1 text-[#047857] dark:border-emerald-800/40 dark:bg-[#062419]/60 dark:text-emerald-300">
                    <span class="font-bold text-[#059669] dark:text-emerald-400">Subtitles:</span>{' '}
                    <span class="font-medium">{audioSub.subtitleBadge}</span>
                  </div>

                  {/* Technical Details Specs */}
                  <div class="pl-1 text-[11px] font-medium text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                    <span>
                      {specs.fpsBadge} • {specs.colorProfile}
                    </span>
                  </div>
                </div>

                {/* Action Bar (Bottom Row) */}
                <div class="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                  {/* Left: Format Dropdown */}
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      Download format:
                    </span>
                    <div class="relative">
                      <select
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.currentTarget.value)}
                        disabled={disabled}
                        class="cursor-pointer appearance-none rounded-lg border border-neutral-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-800 shadow-xs outline-none transition hover:border-neutral-400 focus:border-[#ff5500] focus:ring-1 focus:ring-[#ff5500] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-200 dark:hover:border-neutral-600"
                      >
                        {SEARCH_FORMAT_PRESETS.map((preset) => {
                          const bytes = estimatePresetBytes(preset, entry.durationSec ?? null)
                          return (
                            <option
                              key={preset.id}
                              value={preset.id}
                              class="bg-white text-neutral-800 dark:bg-[#141824] dark:text-neutral-200"
                            >
                              {preset.label}
                              {bytes !== null ? ` ~ ${fmtSize(bytes)}` : ''}
                            </option>
                          )
                        })}
                      </select>
                      <span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500">
                        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div class="flex items-center gap-2">
                    {/* Preview / Eye button */}
                    <button
                      type="button"
                      onClick={() => setPreviewActive(!previewActive)}
                      disabled={disabled}
                      title={previewActive ? 'Close inline preview' : 'Quick preview video'}
                      class={`mf-focus-ring flex items-center justify-center rounded-lg border p-2 shadow-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        previewActive
                          ? 'border-[#ff5500] bg-[#fff5eb] text-[#ff5500] dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-400'
                          : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white'
                      }`}
                    >
                      <EyeIcon class="size-4" />
                    </button>

                    {/* Quick Download CTA Button */}
                    <button
                      type="button"
                      onClick={() => onQuickDownload(entry, currentPreset)}
                      disabled={disabled}
                      title={`Quick Download as ${currentPreset.label}`}
                      class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-[#ff5500] hover:bg-[#e04e00] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <DownloadIcon class="size-4" />
                      <span>Quick Download</span>
                    </button>

                    {/* 3-dots Menu */}
                    <div class="relative" ref={menuRef}>
                      <button
                        type="button"
                        onClick={() => setMenuOpen(!menuOpen)}
                        disabled={disabled}
                        title="More actions"
                        aria-expanded={menuOpen}
                        class="mf-focus-ring flex items-center justify-center rounded-lg border border-neutral-300 bg-white p-2 text-neutral-600 shadow-xs transition hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white"
                      >
                        <MoreVerticalIcon class="size-4" />
                      </button>

                      {menuOpen && (
                        <div class="absolute right-0 bottom-full mb-1 z-30 w-56 rounded-xl border border-neutral-200 bg-white p-1.5 text-xs text-neutral-800 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 dark:border-neutral-700/90 dark:bg-[#161c28] dark:text-neutral-200">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onOpenInDownloader(entry)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <EyeIcon class="size-3.5 text-sky-500" />
                            <span>Open in Downloader</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              const mp3Preset = SEARCH_FORMAT_PRESETS.find(
                                (p) => p.id === 'audio-mp3-320',
                              )!
                              onQuickDownload(entry, mp3Preset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <MusicIcon class="size-3.5 text-amber-500" />
                            <span>Audio-only Rip (320k MP3)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              const flacPreset = SEARCH_FORMAT_PRESETS.find(
                                (p) => p.id === 'audio-flac',
                              )!
                              onQuickDownload(entry, flacPreset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <MusicIcon class="size-3.5 text-indigo-500" />
                            <span>Audio-only Rip (FLAC)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              onAddToQueue(entry, currentPreset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <QueueIcon class="size-3.5 text-emerald-500" />
                            <span>Add to Queue</span>
                          </button>

                          <div class="my-1 border-t border-neutral-100 dark:border-neutral-800" />

                          <button
                            type="button"
                            onClick={copyUrl}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <ClipboardIcon class="size-3.5 text-neutral-400" />
                            <span>{copied ? 'Copied!' : 'Copy Video URL'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={openInBrowser}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <LinkIcon class="size-3.5 text-neutral-400" />
                            <span>Open in Browser</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {modalPreviewOpen && (
        <InlineVideoPreviewModal
          url={entry.url}
          title={entry.title}
          uploader={entry.uploader}
          onClose={() => setModalPreviewOpen(false)}
          onQuickDownload={() => onQuickDownload(entry, currentPreset)}
          onOpenInDownloader={() => onOpenInDownloader(entry)}
        />
      )}
    </li>
  )
}
