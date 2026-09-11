import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { LEFTOVER_RETENTION_MS } from '../../shared/models'

/** Leftover job dirs older than this are swept on startup — see LEFTOVER_RETENTION_MS. */
export const ORPHAN_TEMP_MAX_AGE_MS = LEFTOVER_RETENTION_MS

export interface SweepOptions {
  maxAgeMs?: number
  now?: number
  /**
   * Test seam: stat implementation. Lets the "one entry is locked" path be exercised
   * deterministically — it is the case that used to abort the whole sweep.
   */
  stat?: (path: string) => Promise<{ mtimeMs: number }>
}

async function sweepOneRoot(
  root: string,
  maxAgeMs: number,
  now: number,
  stat: (path: string) => Promise<{ mtimeMs: number }>,
): Promise<number> {
  let names: string[]
  try {
    names = await fsp.readdir(root)
  } catch {
    return 0
  }

  let removed = 0
  for (const name of names) {
    if (!name.startsWith('job-')) continue
    const full = join(root, name)
    try {
      const age = now - (await stat(full)).mtimeMs
      if (age > maxAgeMs) {
        await fsp.rm(full, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      // One locked or unstattable entry must not end the sweep — that leaked temp space
      // permanently, because the next run would hit the same entry and stop there again.
      continue
    }
  }
  return removed
}

/**
 * Removes stale job dirs from every staging root (T4). Runs off the startup critical path;
 * failures are expected and non-fatal — a locked partial is normal when a prior run is
 * still shutting down.
 */
export async function sweepOrphanedTempDirs(
  roots: readonly string[] | string,
  options: SweepOptions = {},
): Promise<number> {
  const { maxAgeMs = ORPHAN_TEMP_MAX_AGE_MS, now = Date.now(), stat = fsp.stat } = options
  const list = typeof roots === 'string' ? [roots] : [...new Set(roots)]
  let removed = 0
  for (const root of list) removed += await sweepOneRoot(root, maxAgeMs, now, stat)
  return removed
}
