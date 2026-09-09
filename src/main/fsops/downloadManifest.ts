import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

function readManifest(destDir: string): ManifestRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(destDir), 'utf8'))
    const records = (parsed as { records?: unknown })?.records
    return Array.isArray(records) ? (records as ManifestRecord[]) : []
  } catch {
    return []
  }
}

function writeManifest(destDir: string, records: ManifestRecord[]): void {
  try {
    writeFileSync(manifestPath(destDir), JSON.stringify({ records }, null, 2))
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
export function findExistingDownload(destDir: string, config: JobConfig): string | null {
  const key = qualityKeyFor(config)
  const match = readManifest(destDir).find((r) => r.url === config.url && r.qualityKey === key)
  return match && existsSync(match.outputPath) ? match.outputPath : null
}

/** Records a completed download so a future request for this URL + quality can be skipped. */
export function recordDownload(destDir: string, config: JobConfig, outputPath: string): void {
  const key = qualityKeyFor(config)
  const records = readManifest(destDir).filter(
    (r) => !(r.url === config.url && r.qualityKey === key),
  )
  records.push({ url: config.url, qualityKey: key, outputPath, downloadedAt: Date.now() })
  writeManifest(destDir, records)
}
