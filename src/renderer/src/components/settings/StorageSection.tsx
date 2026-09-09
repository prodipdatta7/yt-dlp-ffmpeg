import { useEffect, useState } from 'preact/hooks'
import type { PartialDirInfo } from '../../../../shared/ipcContract'
import { LEFTOVER_RETENTION_DAYS, LEFTOVER_RETENTION_MS } from '../../../../shared/models'
import { fmtRelativeTime, fmtSize } from '../../utils/format'
import { CheckIcon, HardDriveIcon, InfoIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btnDanger } from './buttonStyles'

/** Above this many leftover folders the list scrolls instead of growing the page. */
const LIST_MAX_HEIGHT_CLASS = 'max-h-72 overflow-y-auto pr-1'

const DAY_MS = 24 * 60 * 60 * 1000

/** "expires today" / "expires tomorrow" / "expires in 4 days" — never negative. */
function expiryLabel(mtimeMs: number): string {
  const daysLeft = Math.max(0, Math.ceil((mtimeMs + LEFTOVER_RETENTION_MS - Date.now()) / DAY_MS))
  if (daysLeft === 0) return 'expires today'
  if (daysLeft === 1) return 'expires tomorrow'
  return `expires in ${daysLeft} days`
}

export function StorageSection({
  onCountChange,
}: {
  /** Reports the current leftover count upward (drives the sidebar badge). */
  onCountChange?: (count: number) => void
}) {
  const [partials, setPartials] = useState<PartialDirInfo[] | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingPath, setClearingPath] = useState<string | null>(null)

  function refresh() {
    window.mf
      .listPartials()
      .then((res) => {
        setPartials(res.items)
        onCountChange?.(res.items.length)
      })
      .catch(() => {
        setPartials([])
        onCountChange?.(0)
      })
  }

  useEffect(() => {
    refresh()
  }, [])

  async function clearOne(path: string) {
    setClearingPath(path)
    try {
      await window.mf.clearPartials(path)
      refresh()
    } finally {
      setClearingPath(null)
    }
  }

  async function clearAll() {
    setClearingAll(true)
    try {
      await window.mf.clearPartials()
      refresh()
    } finally {
      setClearingAll(false)
    }
  }

  const leftoverBytes = partials?.reduce((sum, p) => sum + p.bytes, 0) ?? 0

  return (
    <SettingsCard
      icon={<HardDriveIcon class="size-4" />}
      title="Storage"
      description="Partially downloaded files left behind by cancelled or failed jobs."
      footer={
        partials && partials.length > 0 ? (
          <>
            <span class="text-[11px] text-slate-500">
              {partials.length} left-over {partials.length === 1 ? 'folder' : 'folders'} ·{' '}
              {fmtSize(leftoverBytes)}
            </span>
            <button
              type="button"
              disabled={clearingAll}
              onClick={() => void clearAll()}
              className={btnDanger}
            >
              {clearingAll ? 'Clearing…' : 'Clear all'}
            </button>
          </>
        ) : undefined
      }
    >
      <div class="mb-3 flex items-start gap-2.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2.5 text-xs leading-relaxed text-sky-200">
        <InfoIcon class="mt-0.5 size-3.5 shrink-0 text-sky-400" />
        <p>
          Kept for <strong class="font-semibold text-ink">{LEFTOVER_RETENTION_DAYS} days</strong> as
          a safety net in case you want to resume, then deleted automatically.
        </p>
      </div>

      {partials === null ? (
        <div class="flex flex-col gap-2">
          <div class="mf-skeleton h-11 rounded-lg" />
          <div class="mf-skeleton h-11 rounded-lg" />
        </div>
      ) : partials.length === 0 ? (
        <div class="flex items-center gap-2.5 rounded-lg border border-line bg-recess px-3 py-2.5 text-sm text-slate-500">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <CheckIcon class="size-3.5" />
          </span>
          No partial downloads left on disk.
        </div>
      ) : (
        <ul class={`flex flex-col gap-2 ${LIST_MAX_HEIGHT_CLASS}`}>
          {partials.map((item) => (
            <li
              key={item.path}
              class="flex items-center justify-between gap-3 rounded-lg border border-line bg-recess px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="mf-select-text mf-num truncate text-xs text-slate-300" title={item.path}>
                  {item.path}
                </p>
                <p class="mt-0.5 text-[11px] text-slate-500">
                  {fmtSize(item.bytes)} · {item.fileCount} {item.fileCount === 1 ? 'file' : 'files'}{' '}
                  ·{' '}
                  <span title={new Date(item.mtimeMs).toLocaleString()}>
                    {fmtRelativeTime(item.mtimeMs)}
                  </span>{' '}
                  · <span class="text-amber-500/90">{expiryLabel(item.mtimeMs)}</span>
                </p>
              </div>
              <span class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void window.mf.openPartialDir(item.path)}
                  class="mf-focus-ring rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 transition hover:text-sky-200"
                >
                  open folder
                </button>
                <button
                  type="button"
                  disabled={clearingPath === item.path}
                  onClick={() => void clearOne(item.path)}
                  class="mf-focus-ring rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                >
                  {clearingPath === item.path ? 'clearing…' : 'clear'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}
