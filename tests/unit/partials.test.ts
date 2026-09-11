import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearAllPartialDirs,
  clearPartialDir,
  isUnderAnyRoot,
  isUnderTempRoot,
  listPartialDirs,
  sameVolume,
  STAGING_DIR_NAME,
} from '../../src/main/fsops/partials'

function root(): string {
  return mkdtempSync(join(tmpdir(), 'mf-partials-'))
}

function jobDir(under: string, name: string, bytes = 16): string {
  const dir = join(under, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'video.f137.mp4.part'), 'x'.repeat(bytes))
  return dir
}

describe('sameVolume (R-03)', () => {
  it.runIf(process.platform === 'win32')('compares Windows drive roots case-insensitively', () => {
    expect(sameVolume('C:\\a\\b', 'C:\\c')).toBe(true)
    expect(sameVolume('c:\\a', 'C:\\b')).toBe(true)
    expect(sameVolume('C:\\a', 'D:\\b')).toBe(false)
  })

  it.runIf(process.platform === 'win32')('treats UNC paths as distinct volumes', () => {
    expect(sameVolume('\\\\server\\share\\a', '\\\\server\\share\\b')).toBe(false)
    expect(sameVolume('\\\\server\\share\\a', 'C:\\b')).toBe(false)
  })

  it('treats two paths under one POSIX root as the same volume', () => {
    expect(sameVolume(tmpdir(), tmpdir())).toBe(true)
  })
})

describe('isUnderAnyRoot', () => {
  it('accepts a path under any listed root', () => {
    expect(isUnderAnyRoot(['/a', '/b'], '/b/job-1')).toBe(true)
    expect(isUnderAnyRoot(['/a', '/b'], '/c/job-1')).toBe(false)
  })

  it('accepts a root itself but rejects a sibling with a shared prefix', () => {
    expect(isUnderAnyRoot(['/a'], '/a')).toBe(true)
    expect(isUnderAnyRoot(['/a'], '/ab/job-1')).toBe(false)
  })

  it('rejects traversal out of every root', () => {
    expect(isUnderAnyRoot(['/a', '/b'], '/a/../../etc/passwd')).toBe(false)
    expect(isUnderAnyRoot(['/a', '/b'], '/b/job-1/../../../etc')).toBe(false)
  })

  it('keeps isUnderTempRoot as a single-root wrapper', () => {
    expect(isUnderTempRoot('/a', '/a/job-1')).toBe(true)
    expect(isUnderTempRoot('/a', '/a/../b')).toBe(false)
  })
})

describe('listPartialDirs over multiple roots', () => {
  it('returns the union, still sorted by mtime descending', async () => {
    const a = root()
    const b = join(root(), STAGING_DIR_NAME)
    mkdirSync(b, { recursive: true })

    jobDir(a, 'job-aaa')
    await new Promise((r) => setTimeout(r, 20))
    jobDir(b, 'job-bbb')

    const items = listPartialDirs([a, b])
    expect(items).toHaveLength(2)
    expect(items[0].path).toContain('job-bbb')
    expect(items[1].path).toContain('job-aaa')
    expect(items[0].mtimeMs).toBeGreaterThanOrEqual(items[1].mtimeMs)
    expect(items.every((i) => i.bytes > 0 && i.fileCount === 1)).toBe(true)
  })

  it('visits a duplicated root only once', () => {
    const a = root()
    jobDir(a, 'job-aaa')
    expect(listPartialDirs([a, a])).toHaveLength(1)
  })

  it('skips a root that does not exist', () => {
    const a = root()
    jobDir(a, 'job-aaa')
    expect(listPartialDirs([a, join(a, 'nope', STAGING_DIR_NAME)])).toHaveLength(1)
  })

  it('still accepts a single root as a string', () => {
    const a = root()
    jobDir(a, 'job-aaa')
    expect(listPartialDirs(a)).toHaveLength(1)
  })
})

describe('clearPartialDir / clearAllPartialDirs over multiple roots', () => {
  it('clears a dir belonging to either root', () => {
    const a = root()
    const b = root()
    const inA = jobDir(a, 'job-aaa')
    const inB = jobDir(b, 'job-bbb')

    expect(clearPartialDir([a, b], inA)).toBe(true)
    expect(clearPartialDir([a, b], inB)).toBe(true)
    expect(listPartialDirs([a, b])).toHaveLength(0)
  })

  it('refuses a path outside every root', () => {
    const a = root()
    const outside = jobDir(root(), 'job-ccc')
    expect(clearPartialDir([a], outside)).toBe(false)
    expect(listPartialDirs([outside])).toHaveLength(0) // outside is a job dir, not a root
  })

  it('refuses to remove a root itself', () => {
    const a = root()
    const b = root()
    expect(clearPartialDir([a, b], a)).toBe(false)
    expect(clearPartialDir([a, b], b)).toBe(false)
  })

  it('clears every root in one pass', () => {
    const a = root()
    const b = root()
    jobDir(a, 'job-aaa')
    jobDir(a, 'job-bbb')
    jobDir(b, 'job-ccc')

    expect(clearAllPartialDirs([a, b])).toEqual({ cleared: 3, failed: 0 })
    expect(listPartialDirs([a, b])).toHaveLength(0)
  })
})
