import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AppSettings {
  lastOutputDir: string
  cookieFileSet?: boolean
}

export function defaultSettings(): AppSettings {
  return { lastOutputDir: '', cookieFileSet: false }
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (typeof raw.lastOutputDir !== 'string') return false
  if (raw.cookieFileSet !== undefined && typeof raw.cookieFileSet !== 'boolean') return false
  return true
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  load(): AppSettings {
    try {
      if (!existsSync(this.filePath)) return defaultSettings()
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!isAppSettings(parsed)) return defaultSettings()
      return { ...parsed }
    } catch {
      return defaultSettings()
    }
  }

  save(settings: AppSettings): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmpPath = `${this.filePath}.tmp`
      writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8')
      renameSync(tmpPath, this.filePath)
    } catch {
      return
    }
  }
}
