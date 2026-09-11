import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import type { JobConfig } from '../../shared/models'

interface ManifestRecord {
  url: string
  qualityKey: string
  outputPath: string
  downloadedAt: number
}

const MANIFEST_FILENAME = '.mediaforge-manifest.json'

function manifestPath(destDir: string): string {
  return join(destDir, MANIFEST_FILENAME)
}

async function readManifest(destDir: string): Promise<ManifestRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await fsp.readFile(manifestPath(destDir), 'utf8'))
    const records = (parsed as { records?: unknown })?.records
    return Array.isArray(records) ? (records as ManifestRecord[]) : []
  } catch {
    return []
  }
}

async function writeManifest(destDir: string, records: ManifestRecord[]): Promise<void> {
  try {
    await fsp.writeFile(manifestPath(destDir), JSON.stringify({ records }, null, 2))
  } catch {
    /* best-effort — a failed write only means future runs won't skip a duplicate */
  }
}

/** Identifies "the same quality" for a job — same URL + this key means skippable. */
export function qualityKeyFor(config: JobConfig): string {
  switch (config.mode) {
    case 'video-audio':
      return `video-audio:${config.tier ?? 1080}:${config.container ?? 'mp4'}`
    case 'audio-only':
      return `audio-only:${config.audioFormat ?? 'mp3'}:${config.bitrate ?? ''}`
    case 'advanced':
      return `advanced:${config.videoFormatId ?? ''}:${config.audioFormatId ?? ''}:${config.container ?? ''}`
    default:
      return 'unknown'
  }
}

/** Path of a prior completed download of this exact URL + quality in destDir, if it still exists. */
export async function findExistingDownload(
  destDir: string,
  config: JobConfig,
): Promise<string | null> {
  const key = qualityKeyFor(config)
  const records = await readManifest(destDir)
  const match = records.find((r) => r.url === config.url && r.qualityKey === key)
  if (!match) return null
  const stillThere = await fsp
    .stat(match.outputPath)
    .then(() => true)
    .catch(() => false)
  return stillThere ? match.outputPath : null
}

/** Records a completed download so a future request for this URL + quality can be skipped. */
export async function recordDownload(
  destDir: string,
  config: JobConfig,
  outputPath: string,
): Promise<void> {
  const key = qualityKeyFor(config)
  const records = (await readManifest(destDir)).filter(
    (r) => !(r.url === config.url && r.qualityKey === key),
  )
  records.push({ url: config.url, qualityKey: key, outputPath, downloadedAt: Date.now() })
  await writeManifest(destDir, records)
}
