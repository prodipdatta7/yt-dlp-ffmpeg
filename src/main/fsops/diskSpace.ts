import { promises as fsp } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

export function existingAncestor(path: string): string {
  let current = path
  for (let i = 0; i < 40 && !existsSync(current); i += 1) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

export async function freeDiskSpaceBytes(targetPath: string): Promise<number | null> {
  const stats = await statDrive(targetPath)
  return stats?.free ?? null
}

export interface DriveStats {
  free: number
  total: number
}

export async function statDrive(targetPath: string): Promise<DriveStats | null> {
  try {
    const stats = await fsp.statfs(existingAncestor(targetPath))
    return {
      free: stats.bavail * stats.bsize,
      total: stats.blocks * stats.bsize,
    }
  } catch {
    return null
  }
}

export const DISK_SAFETY_MARGIN_BYTES = 50 * 1024 * 1024

export function isDiskSpaceInsufficient(
  freeBytes: number | null,
  estimatedBytes: number | null | undefined,
): boolean {
  if (freeBytes === null) return false
  if (estimatedBytes === null || estimatedBytes === undefined || estimatedBytes <= 0) return false
  return freeBytes < estimatedBytes + DISK_SAFETY_MARGIN_BYTES
}
