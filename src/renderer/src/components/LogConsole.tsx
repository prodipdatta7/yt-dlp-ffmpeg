import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { LogEntryPayload } from '../../../shared/ipcContract'
import { clearLogs, logEntries } from '../signals/logState'
import { toggleLogDock } from '../signals/uiState'
import { CloseIcon, SearchIcon, TerminalIcon } from './icons'

const PROTOCOL_RE = /^MF(POST)?\|/

function fmtTs(ts: number): string {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

function lineClass(entry: LogEntryPayload): string {
  const text = entry.text
  if (PROTOCOL_RE.test(text)) return 'text-slate-600'
  if (/^\$ /.test(text)) return 'font-semibold text-emerald-200'
  if (/\bERROR\b/i.test(text)) return 'text-rose-300'
  if (/WARNING/i.test(text)) return 'text-amber-300'
  if (entry.stream === 'err') return 'text-rose-200/80'
  if (/\[(Merger|ExtractAudio|Metadata|VideoRemuxer|Fixup)/i.test(text)) return 'text-violet-300'
  if (/\[download\]/i.test(text)) return 'text-cyan-300/85'
  if (/exited with code/.test(text)) return 'font-medium text-emerald-300/90'
  return 'text-slate-400'
}

export function LogConsole({ dock = false }: { dock?: boolean }) {
  const entries = logEntries.value
  const [query, setQuery] = useState('')
  const [showProtocol, setShowProtocol] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(true)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (!showProtocol && PROTOCOL_RE.test(entry.text)) return false
      if (!q) return true
      return entry.text.toLowerCase().includes(q)
    })
  }, [entries, query, showProtocol])

  useEffect(() => {
    if (stuck && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  })

  function handleScroll(event: Event): void {
    const el = event.currentTarget as HTMLDivElement
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  return (
    <div
      class={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        dock ? 'border-t border-line bg-[var(--surface-console)]' : 'mf-card'
      }`}
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <span class="flex items-center gap-2">
          <TerminalIcon class="size-4 text-emerald-300" />
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
            Live Console
          </h3>
        </span>
        <span class="mf-num rounded-full border border-line-strong bg-wash-1 px-2 py-0.5 text-[10px] text-slate-500">
          {visible.length}/{entries.length}
        </span>
        <span
          class="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400/70"
          title="Streaming engine output"
        >
          <span class="mf-breathe size-1.5 rounded-full bg-emerald-400" />
          live
        </span>

        <div class="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowProtocol((v) => !v)}
            aria-pressed={showProtocol}
            title="Show raw MF| progress protocol lines"
            className={`mf-focus-ring rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
              showProtocol
                ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
                : 'border-line bg-wash-1 text-slate-500 hover:text-slate-300'
            }`}
          >
            protocol
          </button>
          <div class="relative">
            <SearchIcon class="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder="Filter…"
              spellcheck={false}
              class="w-36 rounded-lg border border-line bg-recess py-1 pl-7 pr-2 font-mono text-[11px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-sky-500/50"
            />
          </div>
          <button
            onClick={() => {
              clearLogs()
              void window.mf.logClear()
            }}
            class="mf-focus-ring rounded-lg border border-line bg-wash-1 px-2.5 py-1 text-[11px] font-medium text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300"
          >
            Clear
          </button>
          {dock && (
            <button
              onClick={toggleLogDock}
              title="Close console (Ctrl+`)"
              aria-label="Close console"
              class="mf-focus-ring flex size-6 items-center justify-center rounded-lg text-slate-500 transition hover:bg-wash-2 hover:text-slate-200"
            >
              <CloseIcon class="size-3" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        class="min-h-0 flex-1 overflow-y-auto bg-recess py-2 font-mono text-[11px] leading-[1.6]"
      >
        {visible.length === 0 ? (
          <p class="flex h-full items-center justify-center px-6 text-center font-sans text-xs text-slate-600">
            Waiting for engine output — analyze a link or start a download and the raw yt-dlp stream
            will appear here.
          </p>
        ) : (
          visible.map((entry, i) => (
            <div key={`${entry.ts}-${i}`} class="flex gap-2 px-3 py-px hover:bg-wash-1">
              <span class="shrink-0 select-none text-slate-700">{fmtTs(entry.ts)}</span>
              <span
                className={`shrink-0 select-none ${
                  entry.source === 'app' ? 'text-emerald-400/60' : 'text-sky-400/50'
                }`}
              >
                [{entry.source}]
              </span>
              <span
                className={`mf-select-text min-w-0 whitespace-pre-wrap break-all ${lineClass(entry)}`}
              >
                {entry.text}
              </span>
            </div>
          ))
        )}
      </div>

      {!stuck && visible.length > 0 && (
        <button
          onClick={() => setStuck(true)}
          class="absolute bottom-4 right-5 rounded-full border border-sky-400/30 bg-[var(--mf-console-chip)] px-3.5 py-1.5 text-[11px] font-semibold text-sky-300 shadow-lg transition hover:bg-wash-2"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
