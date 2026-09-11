import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { VideoChaptersResult, VideoTranscriptResult } from '../../../shared/ipcContract'
import {
  ERROR_MESSAGES,
  getSearchPlatform,
  type ChapterMarker,
  type SearchResultItem,
  type TranscriptCue,
} from '../../../shared/models'
import { activePreviewUrl, closePreview } from '../signals/searchState'
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
import {
  fmtCount,
  fmtDuration,
  fmtLikes,
  fmtSize,
  fmtUploadedAgo,
  formatTranscriptAsText,
} from '../utils/format'
import {
  BilibiliTvIcon,
  CalendarIcon,
  CheckCircleFilledIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CloseIcon,
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
  RotateCcwIcon,
  SoundcloudIcon,
  ThumbsUpIcon,
} from './icons'
import { InlineVideoPreview } from './InlineVideoPreview'
import { CheckSquare } from './PreviewPanel'

export type { ChapterMarker, TranscriptCue }

const chaptersCache = new Map<string, VideoChaptersResult>()
const transcriptCache = new Map<string, VideoTranscriptResult>()

function extractRealChapters(
  description?: string | null,
  totalDurationSec?: number | null,
): ChapterMarker[] {
  if (!description) return []
  const lines = description.split('\n')
  const parsed: ChapterMarker[] = []
  const timeRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/
  for (const line of lines) {
    const match = line.match(timeRegex)
    if (match) {
      const timeStr = match[0]
      const parts = timeStr.split(':').map(Number)
      let sec = 0
      if (parts.length === 3) {
        sec = parts[0] * 3600 + parts[1] * 60 + parts[2]
      } else if (parts.length === 2) {
        sec = parts[0] * 60 + parts[1]
      }
      const cleanTitle = line
        .replace(timeRegex, '')
        .replace(/^[\s\-–—:•|()[\]]+/, '')
        .replace(/[\s\-–—:•|()[\]]+$/, '')
        .trim()
      if (cleanTitle.length > 0) {
        parsed.push({
          time: timeStr,
          title: cleanTitle,
          seconds: sec,
        })
      }
    }
  }
  // Deduplicate identical timestamps and sort chronologically
  const unique = parsed
    .filter((ch, idx, self) => idx === self.findIndex((o) => o.seconds === ch.seconds))
    .sort((a, b) => a.seconds - b.seconds)

  // Calculate chapter durations
  for (let i = 0; i < unique.length; i++) {
    const nextSec = i < unique.length - 1 ? unique[i + 1].seconds : totalDurationSec
    if (nextSec && nextSec > unique[i].seconds) {
      const diff = nextSec - unique[i].seconds
      const m = Math.floor(diff / 60)
      const s = diff % 60
      unique[i].duration = `${m}:${s < 10 ? '0' : ''}${s}`
    }
  }
  return unique
}

export interface SearchResultCardProps {
  entry: SearchResultItem
  selected: boolean
  onToggleSelect: (url: string) => void
  onOpenInDownloader: (item: SearchResultItem) => void
  onQuickDownload: (item: SearchResultItem, preset: FormatPresetOption) => void
  onAddToQueue: (item: SearchResultItem, preset: FormatPresetOption) => void
  disabled?: boolean
  downloadDisabled?: boolean
}

export function SearchResultCard({
  entry,
  selected,
  onToggleSelect,
  onOpenInDownloader,
  onQuickDownload,
  onAddToQueue,
  disabled = false,
  downloadDisabled = false,
}: SearchResultCardProps) {
  const platformLabel = getSearchPlatform(entry.platform)?.label ?? entry.platform
  const isSoundCloud =
    entry.platform === 'soundcloud' || (entry.url != null && entry.url.includes('soundcloud.com'))

  const isBilibili =
    entry.platform === 'bilibili' ||
    (entry.url != null && (entry.url.includes('bilibili.com') || entry.url.includes('b23.tv')))

  const isPlaylist =
    entry.isPlaylist === true || (entry.url != null && entry.url.includes('/playlist?list='))

  const isReel =
    !isPlaylist &&
    (entry.isReel === true ||
      (entry.url != null && entry.url.includes('/shorts/')) ||
      Boolean(
        entry.durationSec != null &&
        entry.durationSec <= 180 &&
        /#shorts\b/i.test(`${entry.title} ${entry.description ?? ''}`),
      ))

  const isMusicVideo =
    !isPlaylist &&
    !isReel &&
    (entry.isMusicVideo === true ||
      /\b(official (music )?video|official mv|official m\/v|music video|official lyric video|official visualizer)\b/i.test(
        entry.title,
      ) ||
      /(?:\(|\[)(?:official video|official music video|music video|mv|m\/v|official visualizer)(?:\)|\])/i.test(
        entry.title,
      ) ||
      (entry.uploader != null &&
        (/\bvevo\b/i.test(entry.uploader) || entry.uploader.endsWith(' - Topic'))))

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
  const previewActive = activePreviewUrl.value === entry.url
  const setPreviewActive = (active: boolean) => {
    if (active) {
      activePreviewUrl.value = entry.url
    } else if (activePreviewUrl.value === entry.url) {
      closePreview()
      setSeekSec(undefined)
    }
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imgError, setImgError] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Lock body scroll and listen for Escape key while preview is active
  useEffect(() => {
    if (!previewActive) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewActive(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [previewActive])

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

  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const lastRealUpdateRef = useRef<number>(Date.now())
  const activeChapterRef = useRef<HTMLButtonElement>(null)
  const leftColRef = useRef<HTMLDivElement>(null)
  const [leftColHeight, setLeftColHeight] = useState<number | null>(null)
  const [seekSec, setSeekSec] = useState<number | undefined>(undefined)
  const [copiedLink, setCopiedLink] = useState(false)
  const [chapterFilter, setChapterFilter] = useState('')

  // Sync right-column height to video column on md+ screens to eliminate empty space and tab height jumps
  useEffect(() => {
    if (!previewActive) {
      setLeftColHeight(null)
      return
    }
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
  }, [previewActive])

  const [fetchedData, setFetchedData] = useState<VideoChaptersResult | null>(() => {
    return entry.url ? (chaptersCache.get(entry.url) ?? null) : null
  })
  const [loadingChapters, setLoadingChapters] = useState(false)

  // Fetch full chapters and description on demand when preview is activated
  useEffect(() => {
    if (!previewActive || !entry.url) return
    const cached = chaptersCache.get(entry.url)
    if (cached) {
      setFetchedData(cached)
      return
    }

    let cancelled = false
    setLoadingChapters(true)
    window.mf
      ?.fetchChapters(entry.url)
      .then((res) => {
        if (cancelled) return
        chaptersCache.set(entry.url, res)
        setFetchedData(res)
      })
      .catch(() => {
        if (cancelled) return
        const fallback: VideoChaptersResult = { chapters: [] }
        chaptersCache.set(entry.url, fallback)
        setFetchedData(fallback)
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingChapters(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [previewActive, entry.url])

  const fullDescription = fetchedData?.description ?? entry.description

  const chapters = useMemo(() => {
    if (fetchedData && fetchedData.chapters.length > 0) {
      return fetchedData.chapters
    }
    return extractRealChapters(fullDescription, entry.durationSec)
  }, [fetchedData, fullDescription, entry.durationSec])

  // Calculate the currently active/running chapter dynamically from playback time
  const activeChapterIndex = useMemo(() => {
    if (chapters.length === 0) return 0
    const cur = currentTimeSec
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (cur >= chapters[i].seconds) {
        return i
      }
    }
    return 0
  }, [chapters, currentTimeSec])

  // Fallback playback timer for embeds where postMessage is delayed or not emitted
  useEffect(() => {
    if (!previewActive || !isPlaying) return
    const interval = setInterval(() => {
      if (Date.now() - lastRealUpdateRef.current > 1500) {
        setCurrentTimeSec((prev) => {
          const maxSec = entry.durationSec ?? 999999
          return Math.min(maxSec, prev + 0.5)
        })
      }
    }, 500)
    return () => clearInterval(interval)
  }, [previewActive, isPlaying, entry.durationSec])

  // Reset time when a new preview URL opens
  useEffect(() => {
    setCurrentTimeSec(0)
    setSeekSec(undefined)
    lastRealUpdateRef.current = Date.now()
  }, [entry.url])

  // Auto-scroll active chapter into view as video plays through chapters
  useEffect(() => {
    if (previewActive && activeChapterRef.current) {
      activeChapterRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeChapterIndex, previewActive])

  const [previewTab, setPreviewTab] = useState<'chapters' | 'transcript' | 'info'>('chapters')

  const [transcriptData, setTranscriptData] = useState<VideoTranscriptResult | null>(() => {
    return entry.url ? (transcriptCache.get(entry.url) ?? null) : null
  })
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [transcriptFilter, setTranscriptFilter] = useState('')
  const [autoScrollTranscript, setAutoScrollTranscript] = useState(true)
  const activeCueRef = useRef<HTMLButtonElement>(null)

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

    setLoadingTranscript(true)
    window.mf
      ?.fetchTranscript(entry.url)
      .then((res) => {
        if (res && res.cues && res.cues.length > 0) {
          transcriptCache.set(entry.url, res)
        }
        setTranscriptData(res)
      })
      .catch(() => {
        setTranscriptData({ cues: [] })
      })
      .finally(() => {
        setLoadingTranscript(false)
      })
  }

  // Fetch full transcript on demand when preview is activated
  useEffect(() => {
    if (!previewActive || !entry.url) return
    const cached = transcriptCache.get(entry.url)
    if (cached && cached.cues.length > 0) {
      setTranscriptData(cached)
      return
    }
    fetchTranscriptForEntry(false)
  }, [previewActive, entry.url])

  const cues = useMemo(() => transcriptData?.cues ?? [], [transcriptData])

  // Calculate the currently active transcript cue dynamically from playback time
  const activeCueIndex = useMemo(() => {
    if (cues.length === 0) return -1
    const cur = currentTimeSec
    for (let i = cues.length - 1; i >= 0; i--) {
      if (cur >= cues[i].startSec) {
        return i
      }
    }
    return 0
  }, [cues, currentTimeSec])

  // Auto-scroll active transcript cue into view as playback advances
  useEffect(() => {
    if (
      previewActive &&
      previewTab === 'transcript' &&
      autoScrollTranscript &&
      activeCueRef.current
    ) {
      activeCueRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeCueIndex, previewActive, previewTab, autoScrollTranscript])

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
          setTimeout(() => setDownloadedTxt(false), 3000)
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
        setTimeout(() => setDownloadedTxt(false), 3000)
      }
    } catch {
      /* best-effort */
    } finally {
      setDownloadingTxt(false)
    }
  }

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
      setTimeout(() => setCopiedLink(false), 2000)
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

  const channelInitial = (entry.uploader?.trim() || 'U')[0].toUpperCase()
  const avatarBg = channelInitial === 'C' ? 'bg-[#2563eb]' : 'bg-[#ff5500]'
  const isVerified =
    entry.isVerified === true ||
    (Boolean(entry.uploader) &&
      /drama|records|vevo|music|channel|tv|official|sky|capital/i.test(entry.uploader!))

  return (
    <li class="list-none min-w-0">
      <div
        class={`w-full min-w-0 rounded-2xl border p-3.5 transition-all duration-150 sm:p-4 text-left ${
          selected
            ? 'border-[#ff5500]/70 bg-orange-50/40 shadow-md shadow-orange-500/10 dark:border-sky-500/50 dark:bg-[#161d2d]'
            : previewActive
              ? 'border-[#ea580c] bg-orange-50/20 shadow-md ring-2 ring-orange-500/20 dark:border-orange-500/60 dark:bg-orange-950/10'
              : 'border-neutral-200 bg-white shadow-xs hover:border-neutral-300 hover:shadow-sm dark:border-white/10 dark:bg-[#131722]/95 dark:hover:border-neutral-700'
        }`}
      >
        <div class="flex min-w-0 flex-col gap-3.5 sm:flex-row sm:items-start">
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
              <div class="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-inner sm:w-40 md:w-44 xl:w-52 dark:border-white/5 dark:bg-neutral-900">
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
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Download format:
                    </span>
                    <div class="relative min-w-0 max-w-full">
                      <select
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.currentTarget.value)}
                        disabled={disabled}
                        class="max-w-full cursor-pointer appearance-none rounded-lg border border-neutral-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-800 shadow-xs outline-none transition hover:border-neutral-400 focus:border-[#ff5500] focus:ring-1 focus:ring-[#ff5500] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-200 dark:hover:border-neutral-600 truncate"
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
                  <div class="flex shrink-0 items-center gap-2 sm:ml-auto">
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
              <div class="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-inner sm:w-48 md:w-56 xl:w-64 dark:border-white/5 dark:bg-neutral-900">
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
                      biliSpecs.isMultiPart ? 'bg-[#059669]' : 'border border-white/10 bg-black/80'
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
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Download format:
                    </span>
                    <div class="relative min-w-0 max-w-full">
                      <select
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.currentTarget.value)}
                        disabled={disabled}
                        class="max-w-full cursor-pointer appearance-none rounded-lg border border-neutral-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-800 shadow-xs outline-none transition hover:border-neutral-400 focus:border-[#00aeec] focus:ring-1 focus:ring-[#00aeec] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-200 dark:hover:border-neutral-600 truncate"
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
                  <div class="flex shrink-0 items-center gap-2 sm:ml-auto">
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
              <div class="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-inner sm:w-48 md:w-56 xl:w-64 dark:border-white/5 dark:bg-neutral-900">
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
                    if (!downloadDisabled) setPreviewActive(true)
                  }}
                  disabled={disabled || downloadDisabled}
                  title="Play inline video preview"
                  class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 hover:opacity-100 hover:bg-black/45 disabled:cursor-not-allowed"
                >
                  <span class="flex items-center gap-1.5 rounded-full bg-[#ff5500] px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-95">
                    <PlayIcon class="size-3.5 fill-white" />
                    <span>Preview</span>
                  </span>
                </button>

                {/* Overlaid Badges (Top-Left) */}
                <div class="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5">
                  {entry.platform !== 'youtube' && (
                    <span class="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm backdrop-blur-md">
                      {platformLabel}
                    </span>
                  )}
                  {entry.metadataState === 'loading' ? (
                    <span class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                      Validating
                    </span>
                  ) : entry.metadataState === 'unavailable' ? (
                    <span class="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                      Metadata unavailable
                    </span>
                  ) : isPlaylist ? (
                    <span class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm flex items-center gap-1">
                      <QueueIcon class="size-3 text-white" />
                      <span>PLAYLIST</span>
                    </span>
                  ) : isReel ? (
                    <span class="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm flex items-center gap-1">
                      <span>REEL / SHORT</span>
                    </span>
                  ) : isMusicVideo ? (
                    <span class="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm flex items-center gap-1">
                      <MusicIcon class="size-3 text-white" />
                      <span>MUSIC VIDEO</span>
                    </span>
                  ) : (
                    <>
                      <span class="rounded bg-[#ff5500] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                        {specs.resolutionBadge}
                      </span>
                      <span class="rounded border border-white/10 bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur-md">
                        {specs.codecBadge}
                      </span>
                    </>
                  )}
                </div>

                {/* Duration Badge (Bottom-Right) */}
                {isPlaylist ? (
                  <div class="pointer-events-none absolute bottom-2 right-2 z-10">
                    <span class="rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-400 shadow backdrop-blur-md">
                      Playlist
                    </span>
                  </div>
                ) : entry.durationSec != null ? (
                  <div class="pointer-events-none absolute bottom-2 right-2 z-10">
                    <span class="rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-bold font-mono text-white shadow backdrop-blur-md">
                      {fmtDuration(entry.durationSec)}
                    </span>
                  </div>
                ) : null}
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

                  {entry.metadataState === 'loading' && (
                    <p class="mt-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-300">
                      Validating this public link and loading metadata…
                    </p>
                  )}
                  {entry.metadataState === 'unavailable' && (
                    <p class="mt-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                      {entry.metadataErrorCode
                        ? ERROR_MESSAGES[entry.metadataErrorCode]
                        : 'Metadata could not be loaded.'}{' '}
                      Open in Downloader to analyze the link directly.
                    </p>
                  )}

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
                {!downloadDisabled && (
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
                )}

                {/* Action Bar (Bottom Row) */}
                <div class="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                  {/* Left: Format Dropdown */}
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    {isPlaylist ? (
                      <span class="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        <QueueIcon class="size-3.5" />
                        <span>Playlist Queue</span>
                      </span>
                    ) : (
                      <>
                        <span class="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          Download format:
                        </span>
                        <div class="relative min-w-0 max-w-full">
                          <select
                            value={selectedPresetId}
                            onChange={(e) => setSelectedPresetId(e.currentTarget.value)}
                            disabled={disabled || downloadDisabled}
                            class="max-w-full cursor-pointer appearance-none rounded-lg border border-neutral-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-800 shadow-xs outline-none transition hover:border-neutral-400 focus:border-[#ff5500] focus:ring-1 focus:ring-[#ff5500] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-200 dark:hover:border-neutral-600 truncate"
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
                            <svg
                              class="size-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div class="flex shrink-0 items-center gap-2 sm:ml-auto">
                    {/* Preview / Eye button */}
                    {!isPlaylist && (
                      <button
                        type="button"
                        onClick={() => setPreviewActive(!previewActive)}
                        disabled={disabled || downloadDisabled}
                        title={previewActive ? 'Close inline preview' : 'Quick preview video'}
                        class={`mf-focus-ring flex items-center justify-center rounded-lg border p-2 shadow-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          previewActive
                            ? 'border-[#ff5500] bg-[#fff5eb] text-[#ff5500] dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-400'
                            : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-[#141824] dark:text-neutral-300 dark:hover:bg-[#1e2536] dark:hover:text-white'
                        }`}
                      >
                        <EyeIcon class="size-4" />
                      </button>
                    )}

                    {/* Quick Download / Open Playlist CTA Button */}
                    {isPlaylist ? (
                      <button
                        type="button"
                        onClick={() => onOpenInDownloader(entry)}
                        disabled={disabled}
                        title="Open full playlist in Downloader"
                        class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <QueueIcon class="size-4" />
                        <span>Open Playlist</span>
                      </button>
                    ) : isReel ? (
                      <button
                        type="button"
                        onClick={() => onQuickDownload(entry, currentPreset)}
                        disabled={disabled || downloadDisabled}
                        title={
                          downloadDisabled
                            ? 'Waiting for link validation'
                            : `Download Reel as ${currentPreset.label}`
                        }
                        class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <DownloadIcon class="size-4" />
                        <span>Download Reel</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onQuickDownload(entry, currentPreset)}
                        disabled={disabled || downloadDisabled}
                        title={
                          downloadDisabled
                            ? 'Waiting for link validation'
                            : `Quick Download as ${currentPreset.label}`
                        }
                        class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-[#ff5500] hover:bg-[#e04e00] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <DownloadIcon class="size-4" />
                        <span>Quick Download</span>
                      </button>
                    )}

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
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <EyeIcon class="size-3.5 text-sky-500" />
                            <span>Open in Downloader</span>
                          </button>

                          <button
                            type="button"
                            disabled={downloadDisabled}
                            onClick={() => {
                              setMenuOpen(false)
                              const mp3Preset = SEARCH_FORMAT_PRESETS.find(
                                (p) => p.id === 'audio-mp3-320',
                              )!
                              onQuickDownload(entry, mp3Preset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            <MusicIcon class="size-3.5 text-amber-500" />
                            <span>Audio-only Rip (320k MP3)</span>
                          </button>

                          <button
                            type="button"
                            disabled={downloadDisabled}
                            onClick={() => {
                              setMenuOpen(false)
                              const flacPreset = SEARCH_FORMAT_PRESETS.find(
                                (p) => p.id === 'audio-flac',
                              )!
                              onQuickDownload(entry, flacPreset)
                            }}
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
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
                            disabled={downloadDisabled}
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

      {/* Focused Theater Overlay when previewActive is true */}
      {previewActive && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPreviewActive(false)
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
                  onClick={() => setPreviewActive(false)}
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
                    onClose={() => setPreviewActive(false)}
                    hideHeaderControls
                    onTimeUpdate={(t) => {
                      lastRealUpdateRef.current = Date.now()
                      setCurrentTimeSec(t)
                    }}
                    onPlayingChange={(playing) => {
                      setIsPlaying(playing)
                    }}
                    className="size-full"
                  />
                </div>

                {/* Video Quick Navigation Bar below player */}
                <div class="mt-2.5 flex w-full flex-wrap items-center justify-between gap-2 px-1">
                  {/* Quick Seek Scrubbing */}
                  <div class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
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
                      Transcript{' '}
                      {loadingTranscript ? '...' : cues.length > 0 ? `(${cues.length})` : ''}
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
                      <div class="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
                        {filteredChapters.map((ch, idx) => {
                          const isCurrent = ch.seconds === chapters[activeChapterIndex]?.seconds
                          return (
                            <button
                              key={idx}
                              ref={isCurrent ? activeChapterRef : undefined}
                              type="button"
                              onClick={() => {
                                setSeekSec(ch.seconds)
                                setCurrentTimeSec(ch.seconds)
                              }}
                              class={`group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                isCurrent
                                  ? 'border border-[#ea580c] bg-orange-50/90 font-semibold text-[#ea580c] shadow-xs dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-300'
                                  : 'border border-transparent hover:border-neutral-200 hover:bg-neutral-50 text-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60'
                              }`}
                            >
                              <div class="flex min-w-0 flex-1 items-center gap-2">
                                <span
                                  class={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold ${
                                    isCurrent
                                      ? 'bg-[#ea580c] text-white shadow-xs'
                                      : 'bg-neutral-100 text-neutral-600 group-hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400'
                                  }`}
                                >
                                  {ch.time}
                                </span>
                                <span class="truncate text-[11.5px] leading-tight" title={ch.title}>
                                  {ch.title}
                                </span>
                              </div>
                              <div class="flex items-center gap-1.5 shrink-0">
                                {isCurrent && (
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
                                )}
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
                            title={
                              autoScrollTranscript ? 'Auto-scroll is ON' : 'Auto-scroll is OFF'
                            }
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
                                autoScrollTranscript
                                  ? 'bg-[#ea580c] animate-pulse'
                                  : 'bg-neutral-400'
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

                      {/* Scrollable list of cues */}
                      <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
                        {filteredCues.map((cue) => {
                          const isCurrent = cue.id === cues[activeCueIndex]?.id
                          return (
                            <button
                              key={cue.id}
                              ref={isCurrent ? activeCueRef : undefined}
                              type="button"
                              onClick={() => {
                                setSeekSec(cue.startSec)
                                setCurrentTimeSec(cue.startSec)
                              }}
                              class={`group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
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
                              <span class="flex-1 text-[11.5px] leading-relaxed break-words">
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
                        })}
                        {filteredCues.length === 0 && (
                          <div class="py-6 text-center text-[11px] text-neutral-400">
                            No transcript lines match "{transcriptFilter}"
                          </div>
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
                        Captions or automated subtitles were not found for this video, or could not
                        be loaded.
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

                      {/* Description Box */}
                      {fullDescription && (
                        <div class="flex flex-col shrink-0">
                          <h4 class="mb-0.5 shrink-0 text-[9.5px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                            DESCRIPTION
                          </h4>
                          <div class="rounded-lg border border-neutral-100 bg-neutral-50/70 p-2 text-[11px] leading-relaxed text-neutral-600 dark:border-white/5 dark:bg-neutral-900/40 dark:text-neutral-300 whitespace-pre-wrap break-words select-text">
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
                      setPreviewActive(false)
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
      )}
    </li>
  )
}
