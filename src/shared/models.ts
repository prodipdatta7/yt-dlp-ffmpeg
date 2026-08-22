export type MfErrorCode =
  | 'MF_OFFLINE_OR_PRIVATE'
  | 'MF_AGE_RESTRICTED'
  | 'MF_BOT_CHECK'
  | 'MF_NETWORK'
  | 'MF_RATE_LIMITED'
  | 'MF_EXTRACTOR_STALE'
  | 'MF_DISK_FULL'
  | 'MF_LIVE_STREAM'
  | 'MF_CANCELLED'
  | 'MF_INVALID_URL'
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
  MF_DISK_FULL: 'Not enough free disk space to complete this operation.',
  MF_LIVE_STREAM: 'This is a live stream and will be recorded.',
  MF_CANCELLED: 'Operation cancelled.',
  MF_INVALID_URL: 'Enter a valid media link starting with http:// or https://.',
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
}

export interface AnalyzeResult {
  kind: 'video' | 'playlist'
  metadata: MediaMetadata
  formats: FormatRow[]
  playlistCount?: number
  playlistEntries?: PlaylistEntryPreview[]
}
