import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

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

/** True when `candidate` resolves inside `tempRoot` (defense against path traversal). */
export function isUnderTempRoot(tempRoot: string, candidate: string): boolean {
  const root = resolve(tempRoot) + sep
  const target = resolve(candidate)
  return target === resolve(tempRoot) || target.startsWith(root)
}

export function listPartialDirs(tempRoot: string): PartialDirInfo[] {
  if (!existsSync(tempRoot)) return []
  const out: PartialDirInfo[] = []
  for (const name of readdirSync(tempRoot)) {
    if (!name.startsWith('job-')) continue
    const full = join(tempRoot, name)
    try {
      if (!statSync(full).isDirectory()) continue
      const { bytes, fileCount, mtimeMs } = dirBytesAndCount(full)
      out.push({ path: full, bytes, fileCount, mtimeMs })
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function clearPartialDir(tempRoot: string, dirPath: string): boolean {
  if (!isUnderTempRoot(tempRoot, dirPath)) return false
  const target = resolve(dirPath)
  if (target === resolve(tempRoot)) return false
  if (!existsSync(target)) return true
  try {
    rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function clearAllPartialDirs(tempRoot: string): { cleared: number; failed: number } {
  const items = listPartialDirs(tempRoot)
  let cleared = 0
  let failed = 0
  for (const item of items) {
    if (clearPartialDir(tempRoot, item.path)) cleared += 1
    else failed += 1
  }
  return { cleared, failed }
}
