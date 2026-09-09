import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LEFTOVER_RETENTION_MS } from '../../shared/models'

/** Leftover job dirs older than this are swept on startup — see LEFTOVER_RETENTION_MS. */
export const ORPHAN_TEMP_MAX_AGE_MS = LEFTOVER_RETENTION_MS

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
