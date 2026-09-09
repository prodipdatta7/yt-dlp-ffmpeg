export type MfErrorCode =
  | 'MF_OFFLINE_OR_PRIVATE'
  | 'MF_AGE_RESTRICTED'
  | 'MF_BOT_CHECK'
  | 'MF_NETWORK'
  | 'MF_RATE_LIMITED'
  | 'MF_EXTRACTOR_STALE'
  | 'MF_UNSUPPORTED_SOURCE'
  | 'MF_DISK_FULL'
  | 'MF_LIVE_STREAM'
  | 'MF_CANCELLED'
  | 'MF_INVALID_URL'
  | 'MF_INVALID_QUERY'
  | 'MF_UNKNOWN'

export const ERROR_MESSAGES: Record<MfErrorCode, string> = {
  MF_OFFLINE_OR_PRIVATE: 'This media link appears to be private, deleted, or offline.',
  MF_AGE_RESTRICTED:
    'This video is age-restricted. Import a cookies file in Settings to access it.',
  MF_BOT_CHECK:
    'The platform is asking for verification. Import a cookies file in Settings to continue.',
  MF_NETWORK: 'Network problem detected. Check your connection and try again.',
  MF_RATE_LIMITED: 'The platform is rate-limiting requests. Please retry later.',
  MF_EXTRACTOR_STALE: 'Engine update required. Use "Update Core Drivers" in Settings.',
  MF_UNSUPPORTED_SOURCE:
    "This link doesn't point to a supported media source. Try a video or audio page on a supported site.",
  MF_DISK_FULL: 'Not enough free disk space to complete this operation.',
  MF_LIVE_STREAM: 'This is a live stream and will be recorded.',
  MF_CANCELLED: 'Operation cancelled.',
  MF_INVALID_URL: 'Enter a valid media link starting with http:// or https://.',
  MF_INVALID_QUERY: 'Enter a search term.',
  MF_UNKNOWN: 'Something went wrong. Open the logs folder for details.',
}

export interface FormatRow {
  formatId: string
  ext: string
  vcodec: string | null
  acodec: string | null
  height: number | null
  fps: number | null
  abrKbps: number | null
  tbrKbps: number | null
  filesizeBytes: number | null
}

export interface MediaMetadata {
  id: string | null
  title: string
  uploader: string | null
  durationSec: number | null
  viewCount: number | null
  uploadDate: string | null
  thumbnailUrl: string | null
  isLive: boolean
  webpageUrl: string | null
}

export interface PlaylistEntryPreview {
  index: number
  title: string
  url: string
  durationSec?: number | null
  uploader?: string | null
  viewCount?: number | null
  thumbnailUrl?: string | null
}

export interface AnalyzeResult {
  kind: 'video' | 'playlist'
  metadata: MediaMetadata
  formats: FormatRow[]
  playlistCount?: number
  playlistEntries?: PlaylistEntryPreview[]
}

export type Container = 'mp4' | 'mkv' | 'webm'
export const CONTAINERS: readonly Container[] = ['mp4', 'mkv', 'webm']
export const RESOLUTION_TIERS = [4320, 2160, 1440, 1080, 720, 480, 360] as const

export type AudioFormat = 'mp3' | 'm4a' | 'ogg' | 'flac' | 'wav'
export const LOSSY_AUDIO_FORMATS: readonly AudioFormat[] = ['mp3', 'm4a', 'ogg']
export const LOSSLESS_AUDIO_FORMATS: readonly AudioFormat[] = ['flac', 'wav']
export type BitrateTier = '320K' | '192K' | '128K'
export const BITRATE_TIERS: readonly BitrateTier[] = ['320K', '192K', '128K']

/**
 * In-app keyword search (M8) only covers platforms yt-dlp itself can query via a native
 * `PREFIXn:query` pseudo-URL extractor — it cannot browse a site that has no search API.
 * Verified against yt-dlp's supportedsites.md (search-capable extractors: ytsearch,
 * ytsearchdate, scsearch, bilisearch, plus niche ones like nicosearch/yvsearch/rkfnsearch
 * that we don't surface). Do not add a platform here without confirming its prefix still
 * exists in that list — everything else (TikTok, Instagram, Facebook, X, Vimeo, Twitch,
 * Reddit, Rumble, Dailymotion…) stays paste-a-link-only in the Downloader tab.
 */
export interface SearchPlatform {
  id: string
  label: string
  /** yt-dlp search-prefix extractor name, e.g. "ytsearch" (combines with a count + query as `${prefix}${n}:${query}`). */
  prefix: string
  /** Prefix that sorts by upload date (newest first) instead of relevance, when the extractor has one. */
  dateSortPrefix?: string
}

export const SEARCH_PLATFORMS: readonly SearchPlatform[] = [
  { id: 'youtube', label: 'YouTube', prefix: 'ytsearch', dateSortPrefix: 'ytsearchdate' },
  { id: 'soundcloud', label: 'SoundCloud', prefix: 'scsearch' },
  { id: 'bilibili', label: 'Bilibili', prefix: 'bilisearch' },
]

export type SearchSort = 'relevance' | 'newest'
export const SEARCH_RESULT_LIMITS = [10, 20, 30, 50] as const
export const DEFAULT_SEARCH_LIMIT = 20
export const MAX_SEARCH_LIMIT = 50
export const MAX_SEARCH_QUERY_LENGTH = 200

/** One search hit — the flat-playlist row yt-dlp's search extractor returned, tagged with its platform. */
export interface SearchResultItem extends PlaylistEntryPreview {
  platform: string
}

export type DownloadMode = 'video-audio' | 'audio-only' | 'advanced'

export interface JobConfig {
  url: string
  mode: DownloadMode
  tier?: number
  container?: Container
  audioFormat?: AudioFormat
  bitrate?: BitrateTier
  videoFormatId?: string
  audioFormatId?: string
  destDir: string
  estimatedBytes?: number
  isLive?: boolean
  /** Playlist downloads nest into a sanitized subfolder named after this title. */
  playlistTitle?: string
}

export type JobPhase =
  'queued' | 'downloading-video' | 'downloading-audio' | 'merging' | 'finalizing' | 'done'

export interface JobEvent {
  jobId: string
  phase: JobPhase
  percent: number | null
  speedBps: number | null
  etaSec: number | null
  downloadedBytes?: number | null
  totalBytes?: number | null
  message?: string
}

export interface JobDonePayload {
  jobId: string
  status: 'completed' | 'cancelled' | 'failed'
  errorCode?: MfErrorCode
  outputPath?: string
  /** Temp job folder retained on cancel/failure so the user can inspect or discard partials. */
  partialDir?: string
  /** True when no download ran because this exact URL + quality already exists at outputPath. */
  skipped?: boolean
}

export type UpdaterPhase =
  'checking' | 'downloading' | 'verifying' | 'swapping' | 'verifying-install'

/** Which core driver an update targets. */
export type UpdaterDriverKind = 'yt-dlp' | 'ffmpeg'

/** Phases of the app's own download-and-install-installer flow (AM-15). */
export type AppUpdatePhase = 'checking' | 'downloading' | 'verifying' | 'launching-installer'

/**
 * Leftover partial-download folders (from cancelled/failed jobs) are kept as a
 * recovery safety net for this many days, then swept automatically on app
 * startup. Single source of truth for both the main-process sweep and the
 * Storage settings UI copy.
 */
export const LEFTOVER_RETENTION_DAYS = 7
export const LEFTOVER_RETENTION_MS = LEFTOVER_RETENTION_DAYS * 24 * 60 * 60 * 1000
