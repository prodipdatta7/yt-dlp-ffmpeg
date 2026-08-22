import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

export function redactUrls(input: string): string {
  return input.replace(/https?:\/\/[^\s"']+/g, (url) => url.split('?')[0])
}

function logFileName(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `mf-${y}-${m}-${d}.log`
}

export interface LoggerOptions {
  dir: string
  minLevel?: LogLevel
  retentionDays?: number
  mirrorConsole?: boolean
  now?: () => Date
}

export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export function createLogger(opts: LoggerOptions): Logger {
  const {
    dir,
    minLevel = 'DEBUG',
    retentionDays = 7,
    mirrorConsole = process.env.MF_LOG_CONSOLE === '1',
    now = () => new Date(),
  } = opts

  mkdirSync(dir, { recursive: true })
  sweepOldLogs(dir, retentionDays, now())

  function sweepOldLogs(logDir: string, days: number, current: Date): void {
    const cutoffMs = days * 86_400_000
    for (const name of readdirSync(logDir)) {
      const m = /^mf-\d{4}-\d{2}-\d{2}\.log$/.exec(name)
      if (!m) continue
      const stamp = Date.parse(name.slice(3, -4))
      if (Number.isFinite(stamp) && current.getTime() - stamp > cutoffMs) {
        try {
          unlinkSync(join(logDir, name))
        } catch {
          return
        }
      }
    }
  }

  function write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
    const ts = now().toISOString()
    const cleanMessage = redactUrls(message)
    let line = `${ts} ${level} ${cleanMessage}`
    if (meta !== undefined) {
      let metaText: string
      if (typeof meta === 'string') metaText = redactUrls(meta)
      else {
        try {
          metaText = redactUrls(JSON.stringify(meta) ?? '')
        } catch {
          metaText = '[unserializable]'
        }
      }
      line += ` | ${metaText}`
    }
    try {
      appendFileSync(join(dir, logFileName(now())), `${line}\n`, 'utf8')
    } catch {
      return
    }
    if (mirrorConsole) console.info(line)
  }

  return {
    debug: (m, meta) => write('DEBUG', m, meta),
    info: (m, meta) => write('INFO', m, meta),
    warn: (m, meta) => write('WARN', m, meta),
    error: (m, meta) => write('ERROR', m, meta),
  }
}
