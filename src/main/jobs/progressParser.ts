import { existsSync } from 'node:fs'

export interface ParsedDownloadProgress {
  status: 'downloading' | 'finished' | 'unknown'
  downloadedBytes: number | null
  totalBytes: number | null
  speedBps: number | null
  etaSec: number | null
}

function parseNumeric(token: string | undefined): number | null {
  if (!token || token === 'NA') return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

export function parseDownloadLine(line: string): ParsedDownloadProgress | null {
  if (!line.startsWith('MF|')) return null
  const parts = line.split('|')
  const rawStatus = parts[1]
  const status = rawStatus === 'downloading' || rawStatus === 'finished' ? rawStatus : 'unknown'
  return {
    status,
    downloadedBytes: parseNumeric(parts[2]),
    totalBytes: parseNumeric(parts[3]) ?? parseNumeric(parts[4]),
    speedBps: parseNumeric(parts[5]),
    etaSec: parseNumeric(parts[6]),
  }
}

export function parsePostprocessLine(line: string): number | null {
  if (!line.startsWith('MFPOST|')) return null
  const percent = Number(line.slice('MFPOST|'.length).replace('%', '').trim())
  return Number.isFinite(percent) ? percent : null
}

const POSTPROCESSOR_LINE =
  /^\[(Merger|ExtractAudio|VideoConvertor|VideoRemuxer|Metadata|EmbedThumbnail|FixupM4a|FixupMp4|FixupM3u8)\]/

export function isPostprocessorLine(line: string): boolean {
  return POSTPROCESSOR_LINE.test(line)
}

export function computeSegmentPercent(progress: ParsedDownloadProgress): number | null {
  const { downloadedBytes, totalBytes } = progress
  if (totalBytes !== null && totalBytes > 0 && downloadedBytes !== null) {
    return Math.min(100, (downloadedBytes / totalBytes) * 100)
  }
  return progress.status === 'finished' ? 100 : null
}

/** True when a stdout line is the `--print after_move:filepath` payload (AM-01). */
export function isFinalPathLine(
  line: string,
  exists: (path: string) => boolean = existsSync,
): boolean {
  const candidate = line.trim()
  if (!candidate) return false
  if (candidate.startsWith('MF') || candidate.startsWith('[')) return false
  return exists(candidate)
}

export function extractFinalPathLine(
  lines: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i]
    if (candidate !== undefined && isFinalPathLine(candidate, exists)) return candidate.trim()
  }
  return null
}
