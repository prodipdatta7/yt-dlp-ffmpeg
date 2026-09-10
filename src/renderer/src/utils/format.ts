export function fmtDuration(totalSec: number | null): string {
  if (totalSec === null || !Number.isFinite(totalSec)) return '—'
  const s = Math.round(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function fmtCount(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function fmtSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

export function fmtSpeed(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return '— MB/s'
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

export function fmtRelativeTime(ms: number): string {
  const diffSec = Math.round((Date.now() - ms) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(ms).toLocaleDateString()
}

export function fmtEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '—:—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtUploadedAgo(
  timestamp?: number | null,
  uploadDate?: string | null,
): string | null {
  let ms: number | null = null
  if (typeof timestamp === 'number' && timestamp > 0) {
    ms = timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp
  } else if (uploadDate && /^\d{4}-\d{2}-\d{2}$/.test(uploadDate)) {
    const parsed = Date.parse(uploadDate)
    if (!Number.isNaN(parsed)) ms = parsed
  }

  if (ms === null) return null

  const now = Date.now()
  const diffSec = Math.max(0, Math.round((now - ms) / 1000))
  if (diffSec < 3600) return 'Uploaded just now'
  const diffHr = Math.round(diffSec / 3600)
  if (diffHr < 24) return `Uploaded ${diffHr}h ago`
  const diffDays = Math.round(diffHr / 24)
  if (diffDays === 1) return 'Uploaded 1 day ago'
  if (diffDays < 7) return `Uploaded ${diffDays} days ago`
  const diffWeeks = Math.round(diffDays / 7)
  if (diffWeeks === 1) return 'Uploaded 1 week ago'
  if (diffWeeks < 4) return `Uploaded ${diffWeeks} weeks ago`
  const diffMonths = Math.round(diffDays / 30.4)
  if (diffMonths <= 1) return 'Uploaded 1 month ago'
  if (diffMonths < 12) return `Uploaded ${diffMonths} months ago`
  const diffYears = Math.round(diffDays / 365)
  return diffYears <= 1 ? 'Uploaded 1 year ago' : `Uploaded ${diffYears} years ago`
}

export function fmtLikes(viewCount: number | null, likeCount?: number | null): string | null {
  if (likeCount != null && Number.isFinite(likeCount) && likeCount > 0) {
    if (viewCount != null && Number.isFinite(viewCount) && viewCount > 0) {
      const pct = Math.min(100, Math.max(0, (likeCount / viewCount) * 100)).toFixed(1)
      return `${pct}% (${fmtCount(likeCount)})`
    }
    return fmtCount(likeCount)
  }
  return null
}

export function formatTranscriptAsText(
  title: string,
  url: string,
  durationSec: number | null | undefined,
  cues: Array<{ time: string; text: string }>,
): string {
  const meta = [
    `Title: ${title}`,
    `URL: ${url}`,
    durationSec ? `Duration: ${fmtDuration(durationSec)}` : null,
    `Total Cues: ${cues.length}`,
    `Exported: ${new Date().toLocaleString()}`,
    'Source: MediaForge Desktop',
    '',
    '='.repeat(60),
    '',
  ]
    .filter((l) => l !== null)
    .join('\r\n')

  const body = cues.map((c) => `[${c.time}] ${c.text}`).join('\r\n\r\n')
  return meta + body + '\r\n'
}
