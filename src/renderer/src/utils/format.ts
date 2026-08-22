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
