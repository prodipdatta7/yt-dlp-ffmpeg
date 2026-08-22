import { useEffect, useState } from 'preact/hooks'
import { FormatMatrix } from './components/FormatMatrix'
import { PreviewPanel } from './components/PreviewPanel'
import { UrlBar } from './components/UrlBar'
import { analyzing, analysis } from './signals/appState'

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

function EngineBadge({
  label,
  info,
}: {
  label: string
  info: { version: string | null; source: string | null }
}) {
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
  const [info, setInfo] = useState<{
    ytdlp: { version: string | null; source: string | null }
    ffmpeg: { version: string | null; source: string | null }
  } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    window.mf.getBinariesInfo().then(setInfo, () => setFailed(true))
  }, [])

  if (failed) return <span class="text-red-400">engine status unavailable</span>
  if (!info) return <span>engines: probing…</span>

  return (
    <span class="flex items-center gap-4">
      <EngineBadge label="yt-dlp" info={info.ytdlp} />
      <EngineBadge label="ffmpeg" info={info.ffmpeg} />
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

      <main class="flex flex-1 flex-col items-center gap-8 overflow-y-auto px-6 py-8">
        <UrlBar />
        <PreviewPanel result={analysis.value} loading={analyzing.value} />
        {analysis.value && <FormatMatrix formats={analysis.value.formats} />}
      </main>

      <footer class="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-5 py-2 text-xs text-slate-500">
        <EnginesStatus />
        <span>{bridgeNote}</span>
      </footer>
    </div>
  )
}
