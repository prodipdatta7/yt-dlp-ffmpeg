import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, parse, resolve, sep } from 'node:path'

/**
 * Staging directory placed inside the download folder when it lives on a different volume
 * from `<userData>/tmp`, so finalization is a rename rather than a full second write (R-03).
 * Dot-prefixed so it sorts out of the way; never offered as a download destination.
 */
export const STAGING_DIR_NAME = '.mediaforge-part'

/**
 * True when both paths sit on the same volume root, so a rename across them cannot raise
 * EXDEV. UNC paths are treated as distinct: two UNC paths sharing a prefix are not
 * necessarily the same volume, and guessing wrong costs a failed rename.
 */
export function sameVolume(a: string, b: string): boolean {
  const ra = parse(resolve(a)).root.toLowerCase()
  const rb = parse(resolve(b)).root.toLowerCase()
  return ra.length > 0 && ra === rb && !ra.startsWith(`${sep}${sep}`)
}

export interface PartialDirInfo {
  path: string
  bytes: number
  fileCount: number
  mtimeMs: number
}

function dirBytesAndCount(dir: string): { bytes: number; fileCount: number; mtimeMs: number } {
  let bytes = 0
  let fileCount = 0
  let mtimeMs = 0
  const walk = (current: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(current, name)
      try {
        const st = statSync(full)
        if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs
        if (st.isDirectory()) walk(full)
        else {
          bytes += st.size
          fileCount += 1
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  walk(dir)
  try {
    const rootStat = statSync(dir)
    if (rootStat.mtimeMs > mtimeMs) mtimeMs = rootStat.mtimeMs
  } catch {
    /* ignore */
  }
  return { bytes, fileCount, mtimeMs }
}

/** True when `candidate` resolves inside any of `roots` (defense against path traversal). */
export function isUnderAnyRoot(roots: readonly string[], candidate: string): boolean {
  const target = resolve(candidate)
  return roots.some((root) => {
    const resolved = resolve(root)
    return target === resolved || target.startsWith(resolved + sep)
  })
}

/** Single-root form of {@link isUnderAnyRoot}. */
export function isUnderTempRoot(tempRoot: string, candidate: string): boolean {
  return isUnderAnyRoot([tempRoot], candidate)
}

function listOneRoot(root: string): PartialDirInfo[] {
  if (!existsSync(root)) return []
  const out: PartialDirInfo[] = []
  for (const name of readdirSync(root)) {
    if (!name.startsWith('job-')) continue
    const full = join(root, name)
    try {
      if (!statSync(full).isDirectory()) continue
      const { bytes, fileCount, mtimeMs } = dirBytesAndCount(full)
      out.push({ path: full, bytes, fileCount, mtimeMs })
    } catch {
      /* skip */
    }
  }
  return out
}

/** Job dirs across every staging root, newest first. Duplicate roots are visited once. */
export function listPartialDirs(roots: readonly string[] | string): PartialDirInfo[] {
  const list = typeof roots === 'string' ? [roots] : [...new Set(roots)]
  return list.flatMap(listOneRoot).sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function clearPartialDir(roots: readonly string[] | string, dirPath: string): boolean {
  const list = typeof roots === 'string' ? [roots] : roots
  if (!isUnderAnyRoot(list, dirPath)) return false
  const target = resolve(dirPath)
  // A root itself is never a job dir; removing one would take the staging tree with it.
  if (list.some((root) => resolve(root) === target)) return false
  if (!existsSync(target)) return true
  try {
    rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function clearAllPartialDirs(roots: readonly string[] | string): {
  cleared: number
  failed: number
} {
  const list = typeof roots === 'string' ? [roots] : roots
  let cleared = 0
  let failed = 0
  for (const item of listPartialDirs(list)) {
    if (clearPartialDir(list, item.path)) cleared += 1
    else failed += 1
  }
  return { cleared, failed }
}
