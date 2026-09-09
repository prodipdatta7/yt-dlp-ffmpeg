import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ThemePreference = 'system' | 'light' | 'dark'

/** Playlist parallel concurrency — bounded 2–5 (D2a). */
export const PLAYLIST_CONCURRENCY_MIN = 2
export const PLAYLIST_CONCURRENCY_MAX = 5
export const PLAYLIST_CONCURRENCY_DEFAULT = 3

export interface QueueRowSnapshot {
  url: string
  title: string
  status: 'pending' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled'
}

export interface QueueSnapshot {
  rows: QueueRowSnapshot[]
  runMode: 'sequential' | 'parallel'
  /** Opaque selection blob restored by the renderer. */
  selectionJson?: string
  playlistTitle?: string
}

export interface AppSettings {
  lastOutputDir: string
  cookieFileSet?: boolean
  firstRunNoticeSeen?: boolean
  theme?: ThemePreference
  /** Max simultaneous playlist downloads when using parallel mode (2–5). */
  playlistConcurrency?: number
  /** OS notification when a job finishes while the window is unfocused. */
  notifyOnComplete?: boolean
  /** Persisted queue so a crash/relaunch can recover prior rows (D2). */
  queueSnapshot?: QueueSnapshot | null
}

export function defaultSettings(): AppSettings {
  return {
    lastOutputDir: '',
    cookieFileSet: false,
    firstRunNoticeSeen: false,
    theme: 'light',
    playlistConcurrency: PLAYLIST_CONCURRENCY_DEFAULT,
    notifyOnComplete: true,
    queueSnapshot: null,
  }
}

const THEME_VALUES = new Set<ThemePreference>(['system', 'light', 'dark'])
const QUEUE_STATUSES = new Set(['pending', 'downloading', 'paused', 'done', 'failed', 'cancelled'])

export function clampPlaylistConcurrency(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return PLAYLIST_CONCURRENCY_DEFAULT
  return Math.min(PLAYLIST_CONCURRENCY_MAX, Math.max(PLAYLIST_CONCURRENCY_MIN, Math.round(v)))
}

function isQueueSnapshot(value: unknown): value is QueueSnapshot {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (raw.runMode !== 'sequential' && raw.runMode !== 'parallel') return false
  if (!Array.isArray(raw.rows)) return false
  for (const row of raw.rows) {
    if (!row || typeof row !== 'object') return false
    const r = row as Record<string, unknown>
    if (typeof r.url !== 'string' || typeof r.title !== 'string') return false
    if (typeof r.status !== 'string' || !QUEUE_STATUSES.has(r.status)) return false
  }
  if (raw.selectionJson !== undefined && typeof raw.selectionJson !== 'string') return false
  if (raw.playlistTitle !== undefined && typeof raw.playlistTitle !== 'string') return false
  return true
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (typeof raw.lastOutputDir !== 'string') return false
  if (raw.cookieFileSet !== undefined && typeof raw.cookieFileSet !== 'boolean') return false
  if (raw.firstRunNoticeSeen !== undefined && typeof raw.firstRunNoticeSeen !== 'boolean') {
    return false
  }
  if (
    raw.theme !== undefined &&
    !(typeof raw.theme === 'string' && THEME_VALUES.has(raw.theme as ThemePreference))
  ) {
    return false
  }
  if (raw.playlistConcurrency !== undefined && typeof raw.playlistConcurrency !== 'number') {
    return false
  }
  if (raw.notifyOnComplete !== undefined && typeof raw.notifyOnComplete !== 'boolean') {
    return false
  }
  if (
    raw.queueSnapshot !== undefined &&
    raw.queueSnapshot !== null &&
    !isQueueSnapshot(raw.queueSnapshot)
  ) {
    return false
  }
  return true
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  load(): AppSettings {
    try {
      if (!existsSync(this.filePath)) return defaultSettings()
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!isAppSettings(parsed)) return defaultSettings()
      return {
        ...defaultSettings(),
        ...parsed,
        playlistConcurrency: clampPlaylistConcurrency(
          parsed.playlistConcurrency ?? PLAYLIST_CONCURRENCY_DEFAULT,
        ),
      }
    } catch {
      return defaultSettings()
    }
  }

  save(settings: AppSettings): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmpPath = `${this.filePath}.tmp`
      const normalized: AppSettings = {
        ...settings,
        playlistConcurrency: clampPlaylistConcurrency(
          settings.playlistConcurrency ?? PLAYLIST_CONCURRENCY_DEFAULT,
        ),
      }
      writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf8')
      renameSync(tmpPath, this.filePath)
    } catch {
      return
    }
  }
}
