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
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
