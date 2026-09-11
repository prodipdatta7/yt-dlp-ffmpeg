import * as fsp from 'node:fs/promises'
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

async function dirBytesAndCount(
  dir: string,
): Promise<{ bytes: number; fileCount: number; mtimeMs: number }> {
  let bytes = 0
  let fileCount = 0
  let mtimeMs = 0

  const walk = async (current: string): Promise<void> => {
    let entries: string[]
    try {
      entries = await fsp.readdir(current)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(current, name)
      try {
        const st = await fsp.stat(full)
        if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs
        if (st.isDirectory()) await walk(full)
        else {
          bytes += st.size
          fileCount += 1
        }
      } catch {
        /* skip unreadable */
      }
    }
  }

  await walk(dir)
  try {
    const rootStat = await fsp.stat(dir)
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

async function listOneRoot(root: string): Promise<PartialDirInfo[]> {
  let names: string[]
  try {
    names = await fsp.readdir(root)
  } catch {
    return []
  }

  const out: PartialDirInfo[] = []
  for (const name of names) {
    if (!name.startsWith('job-')) continue
    const full = join(root, name)
    try {
      if (!(await fsp.stat(full)).isDirectory()) continue
      const { bytes, fileCount, mtimeMs } = await dirBytesAndCount(full)
      out.push({ path: full, bytes, fileCount, mtimeMs })
    } catch {
      /* skip */
    }
  }
  return out
}

/** Job dirs across every staging root, newest first. Duplicate roots are visited once. */
export async function listPartialDirs(
  roots: readonly string[] | string,
): Promise<PartialDirInfo[]> {
  const list = typeof roots === 'string' ? [roots] : [...new Set(roots)]
  const perRoot = await Promise.all(list.map(listOneRoot))
  return perRoot.flat().sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export async function clearPartialDir(
  roots: readonly string[] | string,
  dirPath: string,
): Promise<boolean> {
  const list = typeof roots === 'string' ? [roots] : roots
  // The traversal guard runs before any filesystem call touches the path.
  if (!isUnderAnyRoot(list, dirPath)) return false
  const target = resolve(dirPath)
  // A root itself is never a job dir; removing one would take the staging tree with it.
  if (list.some((root) => resolve(root) === target)) return false
  try {
    await fsp.rm(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export async function clearAllPartialDirs(
  roots: readonly string[] | string,
): Promise<{ cleared: number; failed: number }> {
  const list = typeof roots === 'string' ? [roots] : roots
  let cleared = 0
  let failed = 0
  for (const item of await listPartialDirs(list)) {
    if (await clearPartialDir(list, item.path)) cleared += 1
    else failed += 1
  }
  return { cleared, failed }
}
