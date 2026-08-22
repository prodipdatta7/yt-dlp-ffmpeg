import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const ORPHAN_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function sweepOrphanedTempDirs(
  tempRoot: string,
  maxAgeMs: number = ORPHAN_TEMP_MAX_AGE_MS,
  now: number = Date.now(),
): number {
  if (!existsSync(tempRoot)) return 0
  let removed = 0
  for (const name of readdirSync(tempRoot)) {
    if (!name.startsWith('job-')) continue
    const full = join(tempRoot, name)
    try {
      const age = now - statSync(full).mtimeMs
      if (age > maxAgeMs) {
        rmSync(full, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      return removed
    }
  }
  return removed
}
