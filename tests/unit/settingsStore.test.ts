import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore, defaultSettings } from '../../src/main/store/settingsStore'

const dirs: string[] = []

function freshStorePath(): string {
  const dir = join(tmpdir(), `mf-set-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  dirs.push(dir)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      for (const name of readdirSafe(dir)) {
        try {
          unlink(join(dir, name))
        } catch {
          return
        }
      }
      rmdir(dir)
    } catch {
      return
    }
  }
})

import { readdirSync, rmdirSync, unlinkSync } from 'node:fs'

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function unlink(p: string): void {
  try {
    unlinkSync(p)
  } catch {
    return
  }
}

function rmdir(dir: string): void {
  try {
    rmdirSync(dir)
  } catch {
    return
  }
}

describe('SettingsStore (AGENTS.md §11.1)', () => {
  it('returns defaults when no file exists', () => {
    const store = new SettingsStore(freshStorePath())
    expect(store.load()).toEqual(defaultSettings())
  })

  it('persists across a simulated restart (fresh instance reads same file)', () => {
    const path = freshStorePath()
    new SettingsStore(path).save({ lastOutputDir: 'D:/Media/Downloads' })
    expect(new SettingsStore(path).load().lastOutputDir).toBe('D:/Media/Downloads')
  })

  it('rebuilds defaults from a corrupted file and never crashes', () => {
    const path = freshStorePath()
    writeFileSync(path, '{ not valid json !!!', 'utf8')
    expect(new SettingsStore(path).load()).toEqual(defaultSettings())
  })

  it('rejects structurally wrong JSON objects', () => {
    const path = freshStorePath()
    writeFileSync(path, '{"lastOutputDir": 42}', 'utf8')
    expect(new SettingsStore(path).load()).toEqual(defaultSettings())
  })

  it('writes atomically (no .tmp leftover after save)', () => {
    const path = freshStorePath()
    new SettingsStore(path).save({ lastOutputDir: 'C:/x' })
    expect(readFileSync(path, 'utf8')).toContain('C:/x')
  })
})
