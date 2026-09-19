import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

describe('SettingsStore cache (P2)', () => {
  it('get() reads disk once, then serves the cached copy', () => {
    const store = new SettingsStore(freshStorePath())
    const first = store.get()
    const second = store.get()
    expect(second).toBe(first) // same object reference — no re-parse
    expect(second).toEqual(defaultSettings())
  })

  it('save() invalidates so the next get() returns the new object without disk', () => {
    const path = freshStorePath()
    const store = new SettingsStore(path)
    store.get() // prime the cache
    store.save({ ...defaultSettings(), lastOutputDir: 'D:/New/Dir' })
    expect(store.get().lastOutputDir).toBe('D:/New/Dir')
  })

  it('a fresh instance still cold-reads from disk after another instance saved', () => {
    const path = freshStorePath()
    new SettingsStore(path).save({ lastOutputDir: 'D:/Persisted' })
    expect(new SettingsStore(path).get().lastOutputDir).toBe('D:/Persisted')
  })

  it('a failed save leaves the previous cache authoritative', () => {
    // Bind a store whose file path lives *inside an existing file*, so the save's
    // mkdirSync(dirname) throws deterministically. Prime its cache first via get()
    // (missing file → defaults), then attempt the doomed save and confirm the cache
    // is not overwritten by the value that never reached disk.
    const dir = dirname(freshStorePath()) // the temp dir that holds the store file
    const blockerFile = join(dir, 'blocker')
    writeFileSync(blockerFile, 'x', 'utf8')
    const doomedPath = join(blockerFile, 'settings.json') // dirname is a file → save throws
    const doomedStore = new SettingsStore(doomedPath)

    expect(doomedStore.get()).toEqual(defaultSettings()) // primes cache with defaults
    doomedStore.save({ lastOutputDir: 'C:/never-written' }) // write fails internally, swallowed
    // Cache must still hold the last *successfully established* value, not the
    // un-persisted one — the §11.1 atomic-write contract now extends to the cache.
    expect(doomedStore.get()).toEqual(defaultSettings())
    expect(doomedStore.get().lastOutputDir).not.toBe('C:/never-written')
  })
})
