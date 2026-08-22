import { useEffect, useState } from 'preact/hooks'
import type { BinariesInfoResult, BinaryInfo, BinaryKind } from '../../shared/ipcContract'

const APP_VERSION = 'v0.1.0'

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16l-2.5 6H19l-9 8 2.2-6.5H7.5L10 7H4z"
        stroke="#38bdf8"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function EngineBadge({ label, info }: { label: string; info: BinaryInfo }) {
  if (!info.version || !info.source) {
    return (
      <span class="flex items-center gap-1.5">
        <span class="inline-block size-2 rounded-full bg-red-500" />
        <span class="text-red-400">{label}: missing</span>
      </span>
    )
  }
  const sourceLabel = info.source === 'override' ? 'env' : info.source
  return (
    <span class="flex items-center gap-1.5" title={`source: ${info.source}`}>
      <span class="inline-block size-2 rounded-full bg-emerald-500" />
      <span>
        {label}: <span class="text-slate-300">v{info.version}</span>{' '}
        <span class="rounded border border-slate-700 px-1 text-[10px] uppercase">
          {sourceLabel}
        </span>
      </span>
    </span>
  )
}

function EnginesStatus() {
  const [info, setInfo] = useState<BinariesInfoResult | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    window.mf.getBinariesInfo().then(setInfo, () => setFailed(true))
  }, [])

  if (failed) return <span class="text-red-400">engine status unavailable</span>
  if (!info) return <span>engines: probing…</span>

  const order: Record<BinaryKind, BinaryInfo> = { 'yt-dlp': info.ytdlp, ffmpeg: info.ffmpeg }
  return (
    <span class="flex items-center gap-4">
      <EngineBadge label="yt-dlp" info={order['yt-dlp']} />
      <EngineBadge label="ffmpeg" info={order.ffmpeg} />
    </span>
  )
}

export function App() {
  const [bridgeNote, setBridgeNote] = useState('bridge: probing…')

  useEffect(() => {
    window.mf
      .ping()
      .then((r) => setBridgeNote(`bridge ok · ${new Date(r.ts).toLocaleTimeString()}`))
      .catch(() => setBridgeNote('bridge error'))
  }, [])

  return (
    <div class="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header class="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <LogoMark />
        <h1 class="text-lg font-semibold tracking-tight">MediaForge Desktop</h1>
        <span class="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          {APP_VERSION}
        </span>
      </header>

      <main class="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <p class="text-sm text-slate-400">Paste a link to begin</p>
        <div class="flex w-full max-w-xl gap-2">
          <input
            type="url"
            placeholder="https://…"
            disabled
            class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500 disabled:opacity-60"
          />
          <button
            disabled
            class="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Analyze
          </button>
        </div>
        <p class="text-xs text-slate-600">
          URL analysis lands in Phase P2 · download pipeline in P3
        </p>
      </main>

      <footer class="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-5 py-2 text-xs text-slate-500">
        <EnginesStatus />
        <span>{bridgeNote}</span>
      </footer>
    </div>
  )
}
