import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export interface SwapResult {
  hadPrevious: boolean
  backupPath: string
}

/**
 * Atomically replace `target` with `source` (a file path to copy, or raw bytes).
 * Keeps a `.bak` copy of any previous file at `target` and restores it if the
 * swap itself fails, so callers never end up with `target` missing.
 */
export function swapBinary(target: string, source: string | Buffer): SwapResult {
  const backupPath = `${target}.bak`
  const hadPrevious = existsSync(target)
  if (hadPrevious) copyFileSync(target, backupPath)

  const tmp = `${target}.${Date.now()}.tmp`
  if (typeof source === 'string') copyFileSync(source, tmp)
  else writeFileSync(tmp, source)

  try {
    rmSync(target, { force: true })
    renameSync(tmp, target)
  } catch (swapError) {
    rmSync(tmp, { force: true })
    if (hadPrevious) copyFileSync(backupPath, target)
    throw swapError
  }

  return { hadPrevious, backupPath }
}

export function restoreBackup(target: string, backupPath: string): void {
  if (existsSync(backupPath)) copyFileSync(backupPath, target)
}
