import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { SearchResultItem } from '../../../shared/models'
import type { VideoChaptersResult, VideoTranscriptResult } from '../../../shared/ipcContract'
import {
  detectAudioSubtitleSpecs,
  detectVideoTechSpecs,
  type FormatPresetOption,
} from '../utils/estimate'
import { fmtCount, fmtDuration, fmtUploadedAgo, formatTranscriptAsText } from '../utils/format'
import { findActiveIndex } from '../utils/activeIndex'
import { useFeedbackTimer } from '../utils/useFeedbackTimer'
import {
  chaptersCache,
  extractRealChapters,
  fetchChaptersDeduped,
  fetchTranscriptDeduped,
  fmtClockTime,
  formatChapterTime,
  newRequestId,
  transcriptCache,
} from './searchPreviewShared'
import { InlineVideoPreview, VolumeBoosterControl } from './InlineVideoPreview'
import { VirtualList } from './VirtualList'
import {
  CalendarIcon,
  CheckCircleFilledIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  FilmIcon,
  LinkIcon,
  RotateCcwIcon,
} from './icons'

/**
 * The expanded "theater" preview: player, chapters, transcript and info tabs.
 *
 * Split out of SearchResultCard (P-06). The playback clock lives here, so a tick re-renders
 * this subtree instead of re-executing the card's entire 2,500-line body and diffing the
 * collapsed card along with the modal. Props are stable across ticks by construction.
 */
export function TheaterPreview({
  entry,
  currentPreset,
  onClose,
  onOpenInDownloader,
}: {
  entry: SearchResultItem
  /** Drives the bitrate/resolution readouts; changes only when the user picks a preset. */
  currentPreset: FormatPresetOption
  onClose: () => void
  onOpenInDownloader: (item: SearchResultItem) => void
}) {
  const [previewVolumeBoost, setPreviewVolumeBoost] = useState<number>(1)
  const specs = useMemo(() => detectVideoTechSpecs(entry.title), [entry.title])
  const audioSub = useMemo(
    () => detectAudioSubtitleSpecs(entry.title, entry.uploader),
    [entry.title, entry.uploader],
  )
  const isVerified =
    entry.isVerified === true ||
    (Boolean(entry.uploader) &&
      /drama|records|vevo|music|channel|tv|official|sky|capital/i.test(entry.uploader!))

  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const lastRealUpdateRef = useRef<number>(Date.now())

  /**
   * Player callbacks, stable for the life of the component. The inline arrows they replace
   * were new identities on every render, which tore down and re-installed the player's global
   * `message` listener on every playback tick (P-06). `setCurrentTimeSec`/`setIsPlaying` are
   * themselves stable, so the empty dependency arrays are genuine.
   *
   * The clock is rounded to 0.25 s and identical values are dropped, capping renders at 4 Hz
   * regardless of how fast the embed reports progress (P-07).
   */
  const handleTimeUpdate = useCallback((t: number) => {
    lastRealUpdateRef.current = Date.now()
    const rounded = Math.round(t * 4) / 4
    setCurrentTimeSec((prev) => (prev === rounded ? prev : rounded))
  }, [])
  const handlePlayingChange = useCallback((playing: boolean) => setIsPlaying(playing), [])

  const { schedule: scheduleFeedback, mounted: mountedRef } = useFeedbackTimer()
  /** Request ids of preview fetches still in flight, so closing cancels them. */
  const previewRequestsRef = useRef(new Set<string>())

  useEffect(() => {
    const inFlight = previewRequestsRef.current
    return () => {
      // Closing the preview used to flip a local boolean and leave main's yt-dlp running.
      for (const id of inFlight) {
        void window.mf?.previewCancel?.(id).catch(() => undefined)
      }
      inFlight.clear()
    }
  }, [])
  const activeChapterRef = useRef<HTMLDivElement>(null)
  const leftColRef = useRef<HTMLDivElement>(null)
  const [leftColHeight, setLeftColHeight] = useState<number | null>(null)
  const [seekSec, setSeekSec] = useState<number | undefined>(undefined)
  const [copiedLink, setCopiedLink] = useState(false)
  const [chapterFilter, setChapterFilter] = useState('')

  // Sync right-column height to video column on md+ screens to eliminate empty space and tab height jumps
  useEffect(() => {
    const el = leftColRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.round(entry.contentRect.height)
        if (h > 100) {
          setLeftColHeight(h)
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [fetchedData, setFetchedData] = useState<VideoChaptersResult | null>(() => {
    return entry.url ? (chaptersCache.get(entry.url) ?? null) : null
  })
  const [loadingChapters, setLoadingChapters] = useState(false)

  // Fetch full chapters and description on demand when preview is activated
  useEffect(() => {
    if (!entry.url) return
    const cached = chaptersCache.get(entry.url)
    if (cached) {
      setFetchedData(cached)
      return
    }

    let cancelled = false
    const requestId = newRequestId()
    previewRequestsRef.current.add(requestId)
    setLoadingChapters(true)

    fetchChaptersDeduped(entry.url, requestId)
      .then((res) => {
        if (cancelled || !mountedRef.current) return
        chaptersCache.set(entry.url, res)
        setFetchedData(res)
      })
      .finally(() => {
        previewRequestsRef.current.delete(requestId)
        if (!cancelled && mountedRef.current) setLoadingChapters(false)
      })

    return () => {
      cancelled = true
      // Closing the preview kills the child; it is no longer left to run to completion.
      if (previewRequestsRef.current.delete(requestId)) {
        void window.mf?.previewCancel?.(requestId).catch(() => undefined)
      }
    }
  }, [entry.url])

  const fullDescription = fetchedData?.description ?? entry.description

  const chapters = useMemo(() => {
    if (fetchedData && fetchedData.chapters.length > 0) {
      return fetchedData.chapters
    }
    return extractRealChapters(fullDescription, entry.durationSec)
  }, [fetchedData, fullDescription, entry.durationSec])

  // Currently running chapter, from playback time. O(log n) — chapters are ascending by
  // `seconds`, and this runs on every tick (P-06). Contract preserved: 0 when none match.
  const activeChapterIndex = useMemo(() => {
    if (chapters.length === 0) return 0
    return Math.max(
      0,
      findActiveIndex(chapters, currentTimeSec, (c) => c.seconds),
    )
  }, [chapters, currentTimeSec])

  // Fallback playback timer for embeds where postMessage is delayed or not emitted. Paused
  // while the window is hidden — the clock advances on resume from the real player (P-07).
  useEffect(() => {
    if (!isPlaying) return
    let interval: ReturnType<typeof setInterval> | null = null

    const tick = (): void => {
      if (Date.now() - lastRealUpdateRef.current <= 1500) return
      setCurrentTimeSec((prev) => {
        const maxSec = entry.durationSec ?? 999999
        return Math.min(maxSec, prev + 0.5)
      })
    }
    const start = (): void => {
      if (interval === null) interval = setInterval(tick, 500)
    }
    const stop = (): void => {
      if (interval === null) return
      clearInterval(interval)
      interval = null
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [isPlaying, entry.durationSec])

  // Reset time when a new preview URL opens
  useEffect(() => {
    setCurrentTimeSec(0)
    setSeekSec(undefined)
    lastRealUpdateRef.current = Date.now()
  }, [entry.url])

  // Auto-scroll active chapter into view as video plays through chapters
  useEffect(() => {
    if (activeChapterRef.current) {
      activeChapterRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeChapterIndex])

  const [previewTab, setPreviewTab] = useState<'chapters' | 'transcript' | 'info'>('chapters')

  const [transcriptData, setTranscriptData] = useState<VideoTranscriptResult | null>(() => {
    return entry.url ? (transcriptCache.get(entry.url) ?? null) : null
  })
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [transcriptFilter, setTranscriptFilter] = useState('')
  const [autoScrollTranscript, setAutoScrollTranscript] = useState(true)

  const fetchTranscriptForEntry = (force = false) => {
    if (!entry.url) return
    if (!force) {
      const cached = transcriptCache.get(entry.url)
      if (cached && cached.cues.length > 0) {
        setTranscriptData(cached)
        return
      }
    } else {
      transcriptCache.delete(entry.url)
    }

    const requestId = newRequestId()
    previewRequestsRef.current.add(requestId)
    setLoadingTranscript(true)

    void fetchTranscriptDeduped(entry.url, requestId)
      .then((res) => {
        if (!mountedRef.current) return
        if (res && res.cues && res.cues.length > 0) {
          transcriptCache.set(entry.url, res)
        }
        setTranscriptData(res)
      })
      .finally(() => {
        previewRequestsRef.current.delete(requestId)
        if (mountedRef.current) setLoadingTranscript(false)
      })
  }

  // Fetch full transcript on demand when preview is activated
  useEffect(() => {
    if (!entry.url) return
    const cached = transcriptCache.get(entry.url)
    if (cached && cached.cues.length > 0) {
      setTranscriptData(cached)
      return
    }
    fetchTranscriptForEntry(false)
  }, [entry.url])

  const cues = useMemo(() => transcriptData?.cues ?? [], [transcriptData])

  // Active transcript cue, from playback time. O(log n); cues are ascending by `startSec`
  // (P-06). Contract preserved: -1 on an empty array, 0 when playback is before the first cue.
  const activeCueIndex = useMemo(
    () => findActiveIndex(cues, currentTimeSec, (c) => c.startSec),
    [cues, currentTimeSec],
  )

  // Auto-scroll active transcript cue into view as playback advances
  const [downloadingTxt, setDownloadingTxt] = useState(false)
  const [downloadedTxt, setDownloadedTxt] = useState(false)

  const handleDownloadTranscriptTxt = async () => {
    if (!cues.length) return
    const filename = `${entry.title || 'Video'} - Transcript.txt`
    const content = formatTranscriptAsText(entry.title, entry.url, entry.durationSec, cues)

    setDownloadingTxt(true)
    try {
      if (window.mf?.saveTextFile) {
        const res = await window.mf.saveTextFile(filename, content)
        if (res?.ok) {
          setDownloadedTxt(true)
          scheduleFeedback(() => setDownloadedTxt(false), 3000)
        }
      } else {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        setDownloadedTxt(true)
        scheduleFeedback(() => setDownloadedTxt(false), 3000)
      }
    } catch {
      /* best-effort */
    } finally {
      setDownloadingTxt(false)
    }
  }

  /**
   * Fixed row height for the windowed transcript (T13). Two lines of 11.5px/leading-relaxed
   * text (~37px) plus py-1.5 and the border, with ~5px of gap baked in.
   */
  const TRANSCRIPT_ROW_HEIGHT = 56

  const filteredCues = useMemo(() => {
    if (!transcriptFilter.trim()) return cues
    const q = transcriptFilter.toLowerCase()
    return cues.filter((c) => c.text.toLowerCase().includes(q) || c.time.includes(q))
  }, [cues, transcriptFilter])

  useEffect(() => {
    if (chapters.length > 0) {
      setPreviewTab('chapters')
    }
    setChapterFilter('')
    setTranscriptFilter('')
  }, [entry.url, chapters.length])

  /** Position of the active cue within the filtered list, for the windowed auto-scroll. */
  const activeFilteredCueIndex = useMemo(() => {
    const activeId = cues[activeCueIndex]?.id
    if (activeId === undefined) return -1
    return filteredCues.findIndex((cue) => cue.id === activeId)
  }, [cues, activeCueIndex, filteredCues])

  const filteredChapters = useMemo(() => {
    if (!chapterFilter.trim()) return chapters
    const q = chapterFilter.toLowerCase()
    return chapters.filter((c) => c.title.toLowerCase().includes(q) || c.time.includes(q))
  }, [chapters, chapterFilter])

  const handleCopyLink = async () => {
    if (!entry.url) return
    try {
      await navigator.clipboard.writeText(entry.url)
      setCopiedLink(true)
      scheduleFeedback(() => setCopiedLink(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const uploadDateStr = useMemo(() => {
    return fmtUploadedAgo(entry.timestamp, entry.uploadDate) ?? entry.uploadDate ?? 'Recent'
  }, [entry.timestamp, entry.uploadDate])

  const viewsStr = useMemo(() => {
    return typeof entry.viewCount === 'number' && entry.viewCount >= 0
      ? `${fmtCount(entry.viewCount)} views`
      : '—'
  }, [entry.viewCount])

  const likesStr = useMemo(() => {
    return typeof entry.likeCount === 'number' && entry.likeCount >= 0
      ? `${fmtCount(entry.likeCount)} likes`
      : null
  }, [entry.likeCount])

  const targetBitrateText = useMemo(() => {
    if (currentPreset.id === '4k-uhd') return '12,800 kbps'
    if (currentPreset.id === '1080p-fhd') return '3,420 kbps'
    if (currentPreset.id === '720p-hd') return '1,850 kbps'
    if (currentPreset.id === '480p-sd') return '850 kbps'
    if (currentPreset.mode === 'audio-only') return '320 kbps'
    return '3,420 kbps'
  }, [currentPreset.id, currentPreset.mode])

  const sourceDimensionsText = useMemo(() => {
    if (specs.resolutionBadge === '4K UHD' || currentPreset.id === '4k-uhd') {
      return '3840x2160 (16:9)'
    }
    if (specs.resolutionBadge === '720p HD' || currentPreset.id === '720p-hd') {
      return '1280x720 (16:9)'
    }
    if (specs.resolutionBadge === '480p' || currentPreset.id === '480p-sd') {
      return '854x480 (16:9)'
    }
    return '1920x1080 (16:9)'
  }, [specs.resolutionBadge, currentPreset.id])

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        class="flex w-full max-w-[96vw] xl:max-w-[94vw] 2xl:max-w-[1560px] max-h-[96vh] flex-col overflow-y-auto rounded-2xl border-2 border-[#ea580c] bg-white p-3 sm:p-4 md:p-5 shadow-2xl ring-1 ring-[#ea580c]/30 text-left transition-all dark:border-orange-500/80 dark:bg-[#131722]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Row */}
        <div class="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-100 pb-2.5 mb-3 dark:border-white/5">
          {/* Left Header info */}
          <div class="flex min-w-0 flex-1 items-center gap-2">
            {/* Theater Preview Active Pill */}
            <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-orange-200 bg-[#fff7ed] px-2.5 py-1 text-[11px] font-bold text-[#ea580c] dark:border-orange-500/30 dark:bg-orange-950/50 dark:text-orange-400">
              <span class="size-1.5 rounded-full bg-[#ea580c] animate-pulse" />
              <span>Focused Preview</span>
            </span>

            {/* Title & Author */}
            <div class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
              <span
                class="truncate text-xs sm:text-sm font-bold text-neutral-900 transition hover:text-[#ea580c] dark:text-white"
                title={entry.title}
              >
                {entry.title}
              </span>
              <span class="shrink-0 text-[11px] font-normal text-neutral-500 dark:text-neutral-400 sm:text-xs">
                by {entry.uploader || 'Unknown Channel'}
              </span>
              {isVerified && (
                <span class="shrink-0 text-[#3b82f6]" title="Verified Channel">
                  <CheckCircleFilledIcon class="size-3" />
                </span>
              )}
            </div>
          </div>

          {/* Right Header action */}
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              title="Copy Video URL"
              class="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-2xs transition hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {copiedLink ? (
                <>
                  <CheckIcon class="size-3.5 text-emerald-500" />
                  <span class="text-emerald-600 dark:text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <ClipboardIcon class="size-3.5 text-neutral-500 dark:text-neutral-400" />
                  <span>Copy URL</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onClose()}
              title="Collapse Preview (Esc)"
              class="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-2xs transition hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <CloseIcon class="size-3.5 text-neutral-500 dark:text-neutral-400" />
              <span>Collapse Preview</span>
            </button>
          </div>
        </div>

        {/* Responsive Body: Side-by-side on md+ screens, stacked on small screens */}
        <div class="flex flex-col md:flex-row items-start gap-4 lg:gap-6 flex-1 min-h-0">
          {/* Main/Left Column: Video Player Container scaled dynamically */}
          <div
            ref={leftColRef}
            class="flex-1 min-w-0 w-full flex flex-col items-center justify-start"
          >
            <div class="relative aspect-video w-full max-h-[48vh] sm:max-h-[54vh] md:max-h-[60vh] lg:max-h-[66vh] xl:max-h-[72vh] overflow-hidden rounded-xl border border-neutral-200/80 bg-black shadow-inner dark:border-white/10">
              {/* Inline Video Player */}
              <InlineVideoPreview
                url={entry.url}
                title={entry.title}
                startSec={seekSec}
                volumeBoost={previewVolumeBoost}
                onClose={() => onClose()}
                hideHeaderControls
                onTimeUpdate={handleTimeUpdate}
                onPlayingChange={handlePlayingChange}
                className="size-full"
              />
            </div>

            {/* Video Quick Navigation Bar below player */}
            <div class="mt-2.5 flex w-full flex-wrap items-center justify-between gap-2 px-1">
              {/* Quick Seek Scrubbing & Volume Booster */}
              <div class="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const target = Math.max(0, currentTimeSec - 10)
                      setSeekSec(target)
                      setCurrentTimeSec(target)
                    }}
                    title="Jump 10 seconds backward"
                    class="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-orange-400 hover:bg-orange-50 hover:text-[#ea580c] transition dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-orange-950/40"
                  >
                    <RotateCcwIcon class="size-3 text-neutral-400" />
                    <span>-10s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = Math.min(entry.durationSec ?? 999999, currentTimeSec + 10)
                      setSeekSec(target)
                      setCurrentTimeSec(target)
                    }}
                    title="Jump 10 seconds forward"
                    class="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-orange-400 hover:bg-orange-50 hover:text-[#ea580c] transition dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-orange-950/40"
                  >
                    <span>+10s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSeekSec(0)
                      setCurrentTimeSec(0)
                    }}
                    title="Restart from beginning"
                    class="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-orange-400 hover:bg-orange-50 hover:text-[#ea580c] transition dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-orange-950/40"
                  >
                    <span>Restart (0:00)</span>
                  </button>
                </div>

                <div class="hidden h-3.5 w-px bg-neutral-300 sm:block dark:bg-neutral-700" />

                <VolumeBoosterControl
                  volumeBoost={previewVolumeBoost}
                  onChange={setPreviewVolumeBoost}
                  isIframe={true}
                />
              </div>

              {/* Shortcuts & Webpage link */}
              <div class="hidden sm:flex items-center gap-3 text-[10.5px] text-neutral-400 dark:text-neutral-500">
                <span>
                  <kbd class="rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700">
                    Esc
                  </kbd>{' '}
                  Close
                </span>
                {entry.url && (
                  <button
                    type="button"
                    onClick={() => window.open(entry.url, '_blank', 'noopener,noreferrer')}
                    class="hover:text-neutral-600 dark:hover:text-neutral-300 transition underline underline-offset-2"
                  >
                    Open Original Webpage ↗
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Side/Right Column: Video Info & Chapters Navigation Hub */}
          <div
            style={
              leftColHeight && typeof window !== 'undefined' && window.innerWidth >= 768
                ? { height: `${leftColHeight}px`, maxHeight: `${leftColHeight}px` }
                : undefined
            }
            class="w-full md:w-80 lg:w-[350px] xl:w-96 shrink-0 flex flex-col justify-between gap-2.5 min-h-0"
          >
            {/* Top Section: Tab switcher & Content */}
            <div class="flex flex-col flex-1 min-h-0">
              {/* Segmented Switch */}
              <div class="shrink-0 flex items-center gap-1 rounded-lg border border-neutral-200/80 bg-neutral-100/80 p-0.5 dark:border-white/10 dark:bg-neutral-800/60 mb-2.5">
                <button
                  type="button"
                  onClick={() => setPreviewTab('chapters')}
                  class={`flex-1 rounded-md py-1 text-center text-xs font-semibold transition ${
                    previewTab === 'chapters'
                      ? 'bg-white text-[#ea580c] shadow-xs dark:bg-neutral-900 dark:text-orange-400'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                >
                  Chapters{' '}
                  {loadingChapters ? '...' : chapters.length > 0 ? `(${chapters.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('transcript')}
                  class={`flex-1 rounded-md py-1 text-center text-xs font-semibold transition ${
                    previewTab === 'transcript'
                      ? 'bg-white text-[#ea580c] shadow-xs dark:bg-neutral-900 dark:text-orange-400'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                >
                  Transcript {loadingTranscript ? '...' : cues.length > 0 ? `(${cues.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('info')}
                  class={`flex-1 rounded-md py-1 text-center text-xs font-semibold transition ${
                    previewTab === 'info'
                      ? 'bg-white text-[#ea580c] shadow-xs dark:bg-neutral-900 dark:text-orange-400'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                >
                  Details & Specs
                </button>
              </div>

              {/* Tab 1: Chapters (while scanning) */}
              {previewTab === 'chapters' && loadingChapters && (
                <div class="flex flex-col flex-1 min-h-0 items-center justify-center p-6 text-center gap-3">
                  <div class="size-6 animate-spin rounded-full border-2 border-[#ea580c] border-t-transparent dark:border-orange-400" />
                  <p class="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Scanning video chapters & timeline...
                  </p>
                  <p class="text-[11px] text-neutral-400 dark:text-neutral-500">
                    Extracting real chapter titles and navigation points.
                  </p>
                </div>
              )}

              {/* Tab 1: Chapters (if chapters.length > 0) */}
              {previewTab === 'chapters' && !loadingChapters && chapters.length > 0 && (
                <div class="flex flex-col flex-1 min-h-0">
                  {/* Chapter Header & Prev/Next */}
                  <div class="mb-2 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                      <span>Chapters</span>
                      <span class="rounded bg-orange-50 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[#ea580c] border border-orange-200/60 dark:border-orange-900/40 dark:bg-orange-950/60 dark:text-orange-400 normal-case tracking-normal">
                        {chapters[activeChapterIndex]?.time ?? '00:00'}
                      </span>
                    </div>
                    <div class="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100/70 p-0.5 shadow-xs dark:border-neutral-700 dark:bg-neutral-800/70">
                      <button
                        type="button"
                        disabled={activeChapterIndex <= 0}
                        onClick={() => {
                          const newIdx = Math.max(0, activeChapterIndex - 1)
                          const targetSec = chapters[newIdx].seconds
                          setSeekSec(targetSec)
                          setCurrentTimeSec(targetSec)
                        }}
                        title="Previous chapter"
                        class="flex size-6 items-center justify-center rounded-md text-neutral-600 transition hover:bg-white hover:text-neutral-900 hover:shadow-xs disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                      >
                        <ChevronLeftIcon class="size-3.5" />
                      </button>
                      <span class="px-2 font-mono text-[11px] font-semibold text-neutral-700 select-none dark:text-neutral-200">
                        {activeChapterIndex + 1}
                        <span class="font-normal text-neutral-400 dark:text-neutral-500">
                          {' '}
                          / {chapters.length}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={activeChapterIndex >= chapters.length - 1}
                        onClick={() => {
                          const newIdx = Math.min(chapters.length - 1, activeChapterIndex + 1)
                          const targetSec = chapters[newIdx].seconds
                          setSeekSec(targetSec)
                          setCurrentTimeSec(targetSec)
                        }}
                        title="Next chapter"
                        class="flex size-6 items-center justify-center rounded-md text-neutral-600 transition hover:bg-white hover:text-neutral-900 hover:shadow-xs disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                      >
                        <ChevronRightIcon class="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Filter chapters search if > 6 chapters */}
                  {chapters.length > 6 && (
                    <div class="mb-2 shrink-0">
                      <input
                        type="text"
                        value={chapterFilter}
                        onInput={(e) => setChapterFilter(e.currentTarget.value)}
                        placeholder="Filter chapters by title..."
                        class="w-full rounded-md border border-neutral-200 bg-neutral-50/80 px-2 py-1 text-[11px] text-neutral-800 placeholder-neutral-400 outline-none transition focus:border-[#ea580c] focus:bg-white dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-200"
                      />
                    </div>
                  )}

                  {/* Scrollable list of chapters */}
                  <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
                    {filteredChapters.map((ch, idx) => {
                      const isCurrent = ch.seconds === chapters[activeChapterIndex]?.seconds

                      if (isCurrent) {
                        const fullIdx = chapters.findIndex((c) => c.seconds === ch.seconds)
                        const segIdx = fullIdx >= 0 ? fullIdx : activeChapterIndex
                        const nextChapter =
                          segIdx + 1 < chapters.length ? chapters[segIdx + 1] : undefined
                        const endSec = nextChapter
                          ? nextChapter.seconds
                          : (entry.durationSec ?? ch.seconds + 60)
                        const chapterDurationSec = Math.max(1, endSec - ch.seconds)
                        const elapsedSec = Math.max(
                          0,
                          Math.min(chapterDurationSec, currentTimeSec - ch.seconds),
                        )
                        const progressPct = Math.min(
                          100,
                          Math.max(0, Math.round((elapsedSec / chapterDurationSec) * 100)),
                        )

                        return (
                          <div
                            key={idx}
                            ref={activeChapterRef}
                            class="group flex flex-col w-full rounded-xl border border-[#ea580c] bg-orange-50/90 p-2.5 text-left text-xs shadow-xs dark:border-orange-500 dark:bg-orange-950/40 transition"
                          >
                            {/* Top Row: Click to seek */}
                            <button
                              type="button"
                              onClick={() => {
                                setSeekSec(ch.seconds)
                                setCurrentTimeSec(ch.seconds)
                              }}
                              title="Jump to start of this chapter"
                              class="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-[#ea580c] dark:text-orange-300"
                            >
                              <div class="flex min-w-0 flex-1 items-center gap-2">
                                <span class="shrink-0 rounded bg-[#ea580c] px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-white shadow-xs">
                                  {ch.time}
                                </span>
                                <span class="truncate text-[11.5px] leading-tight" title={ch.title}>
                                  {ch.title}
                                </span>
                              </div>
                              <div class="flex items-center gap-1.5 shrink-0">
                                <div
                                  class="flex items-end gap-0.5 h-3 shrink-0"
                                  title="Currently playing"
                                >
                                  <span class="w-0.5 h-3 bg-[#ea580c] dark:bg-orange-400 rounded-full animate-pulse" />
                                  <span class="w-0.5 h-1.5 bg-[#ea580c] dark:bg-orange-400 rounded-full" />
                                  <span
                                    class="w-0.5 h-2.5 bg-[#ea580c] dark:bg-orange-400 rounded-full animate-pulse"
                                    style={{ animationDelay: '150ms' }}
                                  />
                                </div>
                                {ch.duration && (
                                  <span class="text-[10px] font-mono text-orange-600/80 dark:text-orange-400/80">
                                    {ch.duration}
                                  </span>
                                )}
                              </div>
                            </button>

                            {/* In-Chapter Progress Sub-Card */}
                            <div class="mt-2.5 rounded-lg border border-orange-200/80 bg-white/95 p-2 space-y-1.5 shadow-2xs dark:border-orange-800/40 dark:bg-neutral-900/90">
                              <div class="flex items-center justify-between text-[11px] font-mono">
                                <span class="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                                  In-Chapter Progress:
                                </span>
                                <span class="font-bold text-[#ea580c] dark:text-orange-400">
                                  {formatChapterTime(elapsedSec)} /{' '}
                                  {formatChapterTime(chapterDurationSec)} ({progressPct}%)
                                </span>
                              </div>

                              {/* Progress Bar */}
                              <div class="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden dark:bg-neutral-800">
                                <div
                                  class="h-full rounded-full bg-[#ea580c] transition-all duration-200"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>

                              {/* Segment Info & Replay Section */}
                              <div class="flex items-center justify-between gap-2 pt-0.5 text-[10.5px]">
                                <div class="flex items-center gap-1 text-neutral-500 dark:text-neutral-400 font-medium truncate">
                                  <ClockIcon class="size-3 shrink-0 text-neutral-400 dark:text-neutral-500" />
                                  <span class="truncate">
                                    Seg {segIdx + 1} of {chapters.length} • Ends at{' '}
                                    {fmtClockTime(endSec)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSeekSec(ch.seconds)
                                    setCurrentTimeSec(ch.seconds)
                                  }}
                                  title="Replay from start of this chapter"
                                  class="inline-flex shrink-0 items-center gap-1 rounded border border-orange-200/80 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-[#ea580c] shadow-2xs transition hover:bg-orange-100 hover:border-orange-300 dark:border-orange-800/50 dark:bg-orange-950/60 dark:text-orange-300 dark:hover:bg-orange-900/60"
                                >
                                  <RotateCcwIcon class="size-2.5 text-[#ea580c] dark:text-orange-300" />
                                  <span>Replay Section</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSeekSec(ch.seconds)
                            setCurrentTimeSec(ch.seconds)
                          }}
                          class="group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition border border-transparent hover:border-neutral-200 hover:bg-neutral-50 text-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60"
                        >
                          <div class="flex min-w-0 flex-1 items-center gap-2">
                            <span class="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-neutral-600 group-hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400">
                              {ch.time}
                            </span>
                            <span class="truncate text-[11.5px] leading-tight" title={ch.title}>
                              {ch.title}
                            </span>
                          </div>
                          <div class="flex items-center gap-1.5 shrink-0">
                            {ch.duration && (
                              <span class="text-[10px] font-mono text-neutral-400 dark:text-neutral-500">
                                {ch.duration}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Tab 1 (Fallback when chapters === 0): Timeline Jump & Scrub */}
              {previewTab === 'chapters' && !loadingChapters && chapters.length === 0 && (
                <div class="flex flex-col flex-1 min-h-0 gap-3">
                  <div class="rounded-lg border border-neutral-100 bg-neutral-50/70 p-3 text-center dark:border-white/5 dark:bg-neutral-900/40">
                    <FilmIcon class="mx-auto mb-1.5 size-5 text-neutral-400" />
                    <p class="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      No embedded chapters detected
                    </p>
                    <p class="text-[11px] text-neutral-400 dark:text-neutral-500">
                      Use the quick jump markers below to scrub through key video segments.
                    </p>
                  </div>

                  <div>
                    <h4 class="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                      TIMELINE JUMP MARKERS
                    </h4>
                    <div class="grid grid-cols-4 gap-1.5">
                      {[
                        { label: '0:00 Intro', pct: 0 },
                        { label: '15%', pct: 0.15 },
                        { label: '30%', pct: 0.3 },
                        { label: '45%', pct: 0.45 },
                        { label: '60%', pct: 0.6 },
                        { label: '75%', pct: 0.75 },
                        { label: '90%', pct: 0.9 },
                        { label: 'End', pct: 0.98 },
                      ].map((step, idx) => {
                        const dur = entry.durationSec ?? 600
                        const targetSec = Math.round(dur * step.pct)
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setSeekSec(targetSec)}
                            class="flex items-center justify-center rounded-md border border-neutral-200 bg-white py-1.5 text-[10.5px] font-medium text-neutral-700 transition hover:border-[#ea580c] hover:bg-orange-50/50 hover:text-[#ea580c] dark:border-white/10 dark:bg-neutral-900/50 dark:text-neutral-300 dark:hover:bg-orange-950/30"
                          >
                            {step.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Transcript */}
              {previewTab === 'transcript' && loadingTranscript && (
                <div class="flex flex-col flex-1 min-h-0 items-center justify-center p-6 text-center gap-3">
                  <div class="size-6 animate-spin rounded-full border-2 border-[#ea580c] border-t-transparent dark:border-orange-400" />
                  <p class="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Extracting live video transcript...
                  </p>
                  <p class="text-[11px] text-neutral-400 dark:text-neutral-500">
                    Fetching synchronized captions and timestamps.
                  </p>
                </div>
              )}

              {previewTab === 'transcript' && !loadingTranscript && cues.length > 0 && (
                <div class="flex flex-col flex-1 min-h-0">
                  {/* Header with search and auto-scroll switch */}
                  <div class="mb-2 flex items-center justify-between gap-2 shrink-0">
                    <div class="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                      <span class="truncate">Live Transcript ({cues.length})</span>
                      {activeCueIndex >= 0 && cues[activeCueIndex] && (
                        <span class="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[#ea580c] border border-orange-200/60 dark:border-orange-900/40 dark:bg-orange-950/60 dark:text-orange-400 normal-case tracking-normal">
                          {cues[activeCueIndex].time}
                        </span>
                      )}
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleDownloadTranscriptTxt}
                        disabled={downloadingTxt}
                        title="Download full transcript as formatted .txt file"
                        class="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-neutral-200 bg-white px-2 text-[10.5px] font-semibold text-neutral-700 shadow-xs transition hover:border-[#ea580c] hover:bg-orange-50/50 hover:text-[#ea580c] disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-orange-500 dark:hover:bg-orange-950/30"
                      >
                        {downloadedTxt ? (
                          <>
                            <CheckIcon class="size-3 text-emerald-500" />
                            <span class="text-emerald-600 dark:text-emerald-400">Saved</span>
                          </>
                        ) : (
                          <>
                            <DownloadIcon class="size-3 text-[#ea580c] dark:text-orange-400" />
                            <span>Export .txt</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setAutoScrollTranscript(!autoScrollTranscript)}
                        title={autoScrollTranscript ? 'Auto-scroll is ON' : 'Auto-scroll is OFF'}
                        aria-label={
                          autoScrollTranscript ? 'Auto-scroll is ON' : 'Auto-scroll is OFF'
                        }
                        class={`flex size-6 shrink-0 items-center justify-center rounded-md border transition ${
                          autoScrollTranscript
                            ? 'border-orange-200 bg-orange-100 text-[#ea580c] hover:bg-orange-200/80 dark:border-orange-800/40 dark:bg-orange-950/60 dark:text-orange-300 dark:hover:bg-orange-900/60'
                            : 'border-neutral-200 bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
                        }`}
                      >
                        <span
                          class={`size-2 rounded-full ${
                            autoScrollTranscript ? 'bg-[#ea580c] animate-pulse' : 'bg-neutral-400'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Filter Search */}
                  <div class="mb-2 shrink-0">
                    <input
                      type="text"
                      value={transcriptFilter}
                      onInput={(e) => setTranscriptFilter(e.currentTarget.value)}
                      placeholder="Search spoken words in transcript..."
                      class="w-full rounded-md border border-neutral-200 bg-neutral-50/80 px-2 py-1 text-[11px] text-neutral-800 placeholder-neutral-400 outline-none transition focus:border-[#ea580c] focus:bg-white dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-200"
                    />
                  </div>

                  {/* Scrollable list of cues — windowed (T13): a 5,000-cue transcript
                      rendered ~6 DOM nodes per cue and diffed all of them on every
                      active-cue change. */}
                  <div class="flex-1 min-h-0 pr-1">
                    {filteredCues.length === 0 ? (
                      <div class="py-6 text-center text-[11px] text-neutral-400">
                        No transcript lines match "{transcriptFilter}"
                      </div>
                    ) : (
                      <VirtualList
                        items={filteredCues}
                        rowHeight={TRANSCRIPT_ROW_HEIGHT}
                        height="100%"
                        keyFor={(cue) => cue.id}
                        scrollToIndex={
                          autoScrollTranscript && activeFilteredCueIndex >= 0
                            ? activeFilteredCueIndex
                            : undefined
                        }
                        renderRow={(cue) => {
                          const isCurrent = cue.id === cues[activeCueIndex]?.id
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                setSeekSec(cue.startSec)
                                setCurrentTimeSec(cue.startSec)
                              }}
                              class={`group flex h-[calc(100%-6px)] w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                isCurrent
                                  ? 'border border-[#ea580c] bg-orange-50/90 font-medium text-[#ea580c] shadow-xs dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-300'
                                  : 'border border-transparent hover:border-neutral-200 hover:bg-neutral-50 text-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60'
                              }`}
                            >
                              <span
                                class={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                  isCurrent
                                    ? 'bg-[#ea580c] text-white shadow-xs'
                                    : 'bg-neutral-100 text-neutral-600 group-hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400'
                                }`}
                              >
                                {cue.time}
                              </span>
                              <span class="line-clamp-2 flex-1 text-[11.5px] leading-relaxed break-words">
                                {cue.text}
                              </span>
                              {isCurrent && (
                                <div
                                  class="flex items-end gap-0.5 h-3 shrink-0 mt-0.5"
                                  title="Currently playing"
                                >
                                  <span class="w-0.5 h-3 bg-[#ea580c] dark:bg-orange-400 rounded-full animate-pulse" />
                                  <span class="w-0.5 h-1.5 bg-[#ea580c] dark:bg-orange-400 rounded-full" />
                                  <span
                                    class="w-0.5 h-2.5 bg-[#ea580c] dark:bg-orange-400 rounded-full animate-pulse"
                                    style={{ animationDelay: '150ms' }}
                                  />
                                </div>
                              )}
                            </button>
                          )
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {previewTab === 'transcript' && !loadingTranscript && cues.length === 0 && (
                <div class="flex flex-col flex-1 min-h-0 items-center justify-center p-6 text-center gap-3">
                  <FilmIcon class="size-6 text-neutral-400" />
                  <p class="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    No transcript available
                  </p>
                  <p class="text-[11px] text-neutral-400 dark:text-neutral-500 max-w-[260px]">
                    Captions or automated subtitles were not found for this video, or could not be
                    loaded.
                  </p>
                  <button
                    type="button"
                    onClick={() => fetchTranscriptForEntry(true)}
                    class="mt-1 flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-xs transition hover:border-[#ea580c] hover:text-[#ea580c] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-orange-500"
                  >
                    <RotateCcwIcon class="size-3.5" />
                    <span>Retry Extraction</span>
                  </button>
                </div>
              )}

              {/* Tab 3: Details & Specs */}
              {previewTab === 'info' && (
                <div class="flex flex-col flex-1 min-h-0 gap-2 overflow-y-auto pr-1">
                  {/* Video Metrics Grid */}
                  <div class="shrink-0">
                    <h4 class="mb-0.5 text-[9.5px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                      VIDEO OVERVIEW & METRICS
                    </h4>
                    <div class="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-100 bg-neutral-50/80 p-1.5 sm:p-2 text-[10.5px] sm:text-[11px] dark:border-white/5 dark:bg-neutral-900/40">
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Duration
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {fmtDuration(entry.durationSec ?? null)}
                        </span>
                      </div>
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Total Views
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {viewsStr}
                        </span>
                      </div>
                      <div>
                        <span class="flex items-center gap-1 text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          <CalendarIcon class="size-2.5" />
                          <span>Upload Date</span>
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {uploadDateStr}
                        </span>
                      </div>
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Likes
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {likesStr ?? 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stream & Codec Specifications */}
                  <div class="shrink-0">
                    <h4 class="mb-0.5 text-[9.5px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                      STREAM & CODEC SPECS
                    </h4>
                    <div class="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-100 bg-neutral-50/80 p-1.5 sm:p-2 text-[10.5px] sm:text-[11px] dark:border-white/5 dark:bg-neutral-900/40">
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Video Codec
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {specs.codecBadge ? `${specs.codecBadge} High@L4.2` : 'H.264'}
                        </span>
                      </div>
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Audio Codec
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {audioSub.audioBadge
                            ? `${audioSub.audioBadge} (2ch)`
                            : 'AAC 128 kbps (2ch)'}
                        </span>
                      </div>
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Resolution
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {sourceDimensionsText}
                        </span>
                      </div>
                      <div>
                        <span class="block text-[9px] font-medium text-neutral-400 dark:text-neutral-500">
                          Bitrate
                        </span>
                        <span class="block truncate font-mono font-medium text-neutral-800 dark:text-neutral-200">
                          {targetBitrateText}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/*
                    Description takes the leftover height and scrolls on its own, so the
                    metrics and codec tables above stay put instead of scrolling away with it.
                    It keeps a floor so it can never collapse to just a heading; if the window
                    is too short to honour that, the tab's own `overflow-y-auto` takes over.
                    Below md the right column has no fixed height, so this is inert and the
                    modal scrolls as before.
                  */}
                  {fullDescription && (
                    <div class="flex min-h-[7.5rem] flex-1 flex-col">
                      <h4 class="mb-0.5 shrink-0 text-[9.5px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                        DESCRIPTION
                      </h4>
                      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-neutral-100 bg-neutral-50/70 p-2 text-[11px] leading-relaxed text-neutral-600 dark:border-white/5 dark:bg-neutral-900/40 dark:text-neutral-300 whitespace-pre-wrap break-words select-text">
                        {fullDescription}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Action: Open in Downloader for Format Options */}
            <div class="mt-auto pt-2.5 border-t border-neutral-100 dark:border-white/5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenInDownloader(entry)
                }}
                class="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800/80 px-3.5 py-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 shadow-2xs transition hover:border-[#ea580c] hover:text-[#ea580c] hover:bg-orange-50/50 dark:hover:bg-orange-950/30"
              >
                <LinkIcon class="size-3.5 text-neutral-500 dark:text-neutral-400" />
                <span>Open in Downloader for Format Options</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
