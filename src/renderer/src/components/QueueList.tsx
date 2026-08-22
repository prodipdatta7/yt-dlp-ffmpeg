import { queueRows, stopRequested } from '../signals/queueState'

const STATUS_STYLE: Record<string, string> = {
  pending: 'border-slate-700 text-slate-500',
  downloading: 'border-sky-500 bg-sky-950 text-sky-300',
  done: 'border-emerald-800 bg-emerald-950/60 text-emerald-400',
  failed: 'border-red-800 bg-red-950/60 text-red-300',
  cancelled: 'border-amber-800 bg-amber-950/60 text-amber-300',
}

export function QueueList() {
  const rows = queueRows.value
  if (rows.length === 0) return null

  const doneCount = rows.filter((r) => r.status === 'done').length

  return (
    <div class="mf-card w-full max-w-3xl p-4">
      <div class="flex items-center justify-between px-1 pb-2">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Queue — {doneCount}/{rows.length} complete
        </span>
        <span class="text-[10px] uppercase tracking-wide text-slate-600">
          sequential · one at a time
        </span>
      </div>
      <ol class="max-h-56 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <li
            key={row.url}
            class="flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-800/40"
          >
            <span class="truncate text-slate-300">
              {row.status === 'downloading' && (
                <svg
                  class="mr-2 inline size-3 animate-spin align-[-1px] text-sky-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  />
                  <path
                    class="opacity-90"
                    fill="currentColor"
                    d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
                  />
                </svg>
              )}
              {row.title}
            </span>
            <span
              class={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase ${STATUS_STYLE[row.status]}`}
            >
              {row.status}
            </span>
          </li>
        ))}
      </ol>
      {stopRequested.value && (
        <p class="px-1 pt-2 text-xs text-amber-400">Stopping after the current entry…</p>
      )}
    </div>
  )
}
