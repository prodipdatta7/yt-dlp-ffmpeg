import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger, redactUrls } from '../../src/main/store/logger'

const dirs: string[] = []

function tmpDir(): string {
  const dir = join(tmpdir(), `mf-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmRecursive(dir)
  }
})

function rmRecursive(dir: string): void {
  try {
    for (const name of readdirSafe(dir)) {
      rmRecursive(join(dir, name))
    }
    rmdir(dir)
  } catch {
    return
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function rmdir(dir: string): void {
  try {
    rmdirSync(dir)
  } catch {
    return
  }
}

describe('redactUrls', () => {
  it('strips query strings from URLs', () => {
    expect(redactUrls('failed https://youtu.be/abc?si=xyz&feature=share badly')).toBe(
      'failed https://youtu.be/abc badly',
    )
  })

  it('leaves non-URL text untouched', () => {
    expect(redactUrls('plain text with ? and & chars')).toBe('plain text with ? and & chars')
  })
})

describe('createLogger', () => {
  it('writes today’s log file with level and message', () => {
    const dir = tmpDir()
    const logger = createLogger({ dir, now: () => new Date('2026-08-22T10:00:00Z') })
    logger.info('hello world')
    const file = join(dir, 'mf-2026-08-22.log')
    expect(existsSync(file)).toBe(true)
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('INFO hello world')
  })

  it('redacts URL queries in messages and meta', () => {
    const dir = tmpDir()
    const logger = createLogger({ dir, now: () => new Date('2026-08-22T10:00:00Z') })
    logger.warn('analyze failed', { url: 'https://x.test/v?a=1&b=2' })
    const content = readFileSync(join(dir, 'mf-2026-08-22.log'), 'utf8')
    expect(content).not.toContain('a=1')
    expect(content).toContain('https://x.test/v')
  })

  it('respects minLevel filtering', () => {
    const dir = tmpDir()
    const logger = createLogger({
      dir,
      minLevel: 'WARN',
      now: () => new Date('2026-08-22T10:00:00Z'),
    })
    logger.debug('noisy detail')
    logger.error('real problem')
    const content = readFileSync(join(dir, 'mf-2026-08-22.log'), 'utf8')
    expect(content).not.toContain('noisy detail')
    expect(content).toContain('real problem')
  })

  it('sweeps log files older than retention window', () => {
    const dir = tmpDir()
    const old = join(dir, 'mf-2020-01-01.log')
    writeFileSync(old, 'old\n', 'utf8')
    const stale = new Date('2020-01-01T00:00:00Z')
    utimesSync(old, stale, stale)
    createLogger({ dir, retentionDays: 7, now: () => new Date('2026-08-22T10:00:00Z') })
    expect(existsSync(old)).toBe(false)
  })
})
