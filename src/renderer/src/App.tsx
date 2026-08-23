import { useEffect, useRef, useState } from 'preact/hooks'
import { FormatMatrix } from './components/FormatMatrix'
import { ModeSelector, type AdvancedPick, type JobSelection } from './components/ModeSelector'
import { PipelineStatus } from './components/PipelineStatus'
import { SettingsScreen } from './components/SettingsScreen'
import { PreviewPanel } from './components/PreviewPanel'
import { QueueList } from './components/QueueList'
import { UrlBar } from './components/UrlBar'
import { LogConsole } from './components/LogConsole'
import {
  DownloadIcon,
  FilmIcon,
  GearIcon,
  LogoBolt,
  PlayIcon,
  QueueIcon,
  ShieldIcon,
  SlidersIcon,
  TerminalIcon,
} from './components/icons'
import {
  analyzing,
  analysis,
  applyAnalyzeStream,
  playlistHydration,
  resetAnalysis,
} from './signals/appState'
import { activeView, logDockOpen, toggleLogDock, type ViewId } from './signals/uiState'
import { appendLogEntry, setLogHistory } from './signals/logState'
import {
  activeJob,
  beginJob,
  endJob,
  jobDone,
  lastFailedConfig,
  lastJobEvent,
  launchError,
} from './signals/jobState'
import {
  queueRows,
  queueRunning,
  resolveCurrentJob,
  stopRequested,
  waitForCurrentJob,
} from './signals/queueState'
import type { DownloadStartResponse } from '../../shared/ipcContract'
import type { FormatRow, JobConfig } from '../../shared/models'

const APP_VERSION = 'v0.1.1'

type EngineInfo = { version: string | null; source: string | null }

function LogoMark() {
  return (
    <span class="app-no-drag flex size-8 items-center justify-center rounded-[10px] border border-sky-400/30 bg-gradient-to-br from-sky-500/25 to-indigo-500/25 shadow-inner">
      <LogoBolt class="size-5" />
    </span>
  )
}

function EngineBadge({ label, info }: { label: string; info: EngineInfo }) {
  if (!info.version || !info.source) {
    return (
      <span class="flex items-center gap-1.5">
        <span class="size-1.5 rounded-full bg-red-500" />
        <span>{label}: missing</span>
      </span>
    )
  }
  return (
    <span class="flex items-center gap-1.5" title={`source: ${info.source}`}>
      <span class="size-1.5 rounded-full bg-emerald-500" />
      <span>
        {label} <span class="mf-num text-slate-400">{info.version}</span>
        <span class="ml-1 rounded border border-white/10 px-1 text-[9px] uppercase">
          {info.source === 'override' ? 'env' : info.source}
        </span>
      </span>
    </span>
  )
}

function EnginesStatus() {
  const [info, setInfo] = useState<{ ytdlp: EngineInfo; ffmpeg: EngineInfo } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    window.mf.getBinariesInfo().then(setInfo, () => setFailed(true))
  }, [])

  if (failed) return <span className="text-red-400">engine status unavailable</span>
  if (!info) return <span>engines: probing…</span>

  return (
    <span class="flex items-center gap-4">
      <EngineBadge label="yt-dlp" info={info.ytdlp} />
      <EngineBadge label="ffmpeg" info={info.ffmpeg} />
    </span>
  )
}

const NAV_ITEMS: Array<{ id: ViewId; label: string; Icon: typeof DownloadIcon }> = [
  { id: 'download', label: 'Downloader', Icon: DownloadIcon },
  { id: 'queue', label: 'Queue', Icon: QueueIcon },
  { id: 'settings', label: 'Settings', Icon: GearIcon },
]

function NavRail({ working, onShowNotice }: { working: boolean; onShowNotice: () => void }) {
  const view = activeView.value
  return (
    <nav class="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-white/[0.06] bg-black/25 py-3">
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const isActive = view === id
        return (
          <button
            key={id}
            onClick={() => (activeView.value = id)}
            title={label}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            class={`mf-focus-ring group relative flex size-11 items-center justify-center rounded-xl transition-all duration-150 ${
              isActive
                ? 'bg-gradient-to-br from-sky-500/25 to-indigo-500/20 text-sky-300 shadow-inner'
                : 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-200'
            }`}
          >
            {isActive && (
              <span class="absolute -left-2.5 h-5 w-[3px] rounded-full bg-gradient-to-b from-sky-400 to-indigo-400" />
            )}
            {id === 'queue' && working && !isActive && (
              <span class="mf-breathe absolute right-2 top-2 size-1.5 rounded-full bg-emerald-400" />
            )}
            <Icon class="size-5" />
          </button>
        )
      })}
      <button
        onClick={onShowNotice}
        title="Compliance notice"
        aria-label="Show compliance notice"
        class="mf-focus-ring mt-auto flex size-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/[0.05] hover:text-slate-300"
      >
        <ShieldIcon class="size-5" />
      </button>
    </nav>
  )
}

function TitleBar() {
  return (
    <header class="app-drag relative z-20 flex h-[46px] shrink-0 items-center gap-3 border-b border-white/[0.06] bg-ink-950/85 pl-4 pr-40 backdrop-blur">
      <LogoMark />
      <div class="flex items-baseline gap-2">
        <h1 class="text-sm font-bold leading-none tracking-tight text-white">MediaForge</h1>
        <span class="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-600">
          Desktop
        </span>
      </div>
      <span class="mf-num app-no-drag rounded-full border border-sky-400/20 bg-sky-400/5 px-2 py-0.5 text-[10px] font-semibold text-sky-300/90">
        {APP_VERSION}
      </span>
    </header>
  )
}

function configFor(
  url: string,
  selection: JobSelection,
  isLive = false,
  playlistTitle?: string,
): JobConfig {
  const base = {
    url,
    destDir: selection.destDir,
    estimatedBytes: selection.estimatedBytes ?? undefined,
    isLive,
    playlistTitle: playlistTitle || undefined,
  }
  switch (selection.mode) {
    case 'video-audio':
      return { ...base, mode: 'video-audio', tier: selection.tier, container: selection.container }
    case 'audio-only':
      return {
        ...base,
        mode: 'audio-only',
        audioFormat: selection.audioFormat,
        bitrate: selection.bitrate ?? undefined,
      }
    case 'advanced':
      return {
        ...base,
        mode: 'advanced',
        videoFormatId: selection.videoFormatId,
        audioFormatId: selection.audioFormatId,
        container: selection.container,
      }
  }
}

function HeroState() {
  const features = [
    { Icon: FilmIcon, title: 'Analyze', text: 'Every stream mapped before you commit' },
    { Icon: SlidersIcon, title: 'Configure', text: 'Resolution, container or raw format IDs' },
    { Icon: DownloadIcon, title: 'Save', text: 'Muxed by FFmpeg, verified, delivered' },
  ]
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <div class="w-full max-w-xl text-center">
        <div class="mf-hairline mx-auto mb-6 flex size-16 items-center justify-center rounded-3xl">
          <span class="flex size-full items-center justify-center rounded-3xl bg-gradient-to-br from-sky-500/25 to-indigo-500/20 shadow-inner">
            <PlayIcon class="size-7 text-sky-200" />
          </span>
        </div>
        <h2 class="text-2xl font-bold tracking-tight text-white">Download anything.</h2>
        <p class="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
          Paste a link above — single videos, audio rips and full playlists all flow through the
          same verified pipeline.
        </p>
        <div class="mt-8 grid grid-cols-3 gap-3">
          {features.map(({ Icon, title, text }, i) => (
            <div
              key={title}
              class="mf-card mf-card-hover mf-rise p-4 text-left"
              style={`animation-delay: ${80 + i * 70}ms`}
            >
              <span class="flex size-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-sky-300 shadow-inner">
                <Icon class="size-4" />
              </span>
              <p class="mt-2.5 text-xs font-semibold text-slate-200">{title}</p>
              <p class="mt-1 text-[11px] leading-relaxed text-slate-600">{text}</p>
            </div>
          ))}
        </div>
        <div class="mt-6 flex flex-wrap items-center justify-center gap-1.5">
          {['YouTube', 'Vimeo', 'Twitch', 'SoundCloud', 'TikTok'].map((site) => (
            <span
              key={site}
              class="rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-0.5 text-[11px] font-medium text-slate-500"
            >
              {site}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function App() {
  const [bridgeNote, setBridgeNote] = useState('bridge ok')
  const [selection, setSelection] = useState<JobSelection | null>(null)
  const [advancedPick, setAdvancedPick] = useState<AdvancedPick | null>(null)
  const [selectedEntries, setSelectedEntries] = useState<ReadonlySet<string>>(new Set())
  const [showNotice, setShowNotice] = useState(false)
  const scrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    window.mf
      .getSettings()
      .then((s) => setShowNotice(!s.firstRunNoticeSeen))
      .catch(() => undefined)
    window.mf
      .ping()
      .then(() => setBridgeNote('ipc ready'))
      .catch(() => setBridgeNote('ipc error'))

    const offEvent = window.mf.onJobEvent((event) => {
      lastJobEvent.value = event
    })
    const offDone = window.mf.onJobDone((done) => {
      endJob(done)
      resolveCurrentJob(done.status)
    })
    const offEntry = window.mf.onAnalyzeEntry((event) => {
      applyAnalyzeStream(event)
    })
    window.mf
      .logHistory()
      .then((res) => setLogHistory(res.lines))
      .catch(() => undefined)
    const offLog = window.mf.onLogLine((entry) => {
      appendLogEntry(entry)
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key === '`') {
        event.preventDefault()
        toggleLogDock()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      offEvent()
      offDone()
      offEntry()
      offLog()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const result = analysis.value
  const busy = activeJob.value !== null || queueRunning.value

  useEffect(() => {
    const r = analysis.value
    setAdvancedPick(null)
    playlistHydration.value = null
    if (r?.kind === 'playlist') {
      setSelectedEntries(new Set((r.playlistEntries ?? []).map((e) => e.url)))
      scrollRef.current?.scrollTo({ top: 0 })
    }
  }, [analysis.value?.metadata.id])

  function toggleEntry(url: string): void {
    if (busy) return
    setSelectedEntries((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  function handleStreamPick(row: FormatRow): void {
    const r = analysis.value
    if (!r || busy) return
    let pick: { videoId: string; audioId: string } | null = null
    if (row.vcodec !== null) {
      const bestAudio = [...r.formats]
        .filter((f) => f.vcodec === null && f.acodec !== null)
        .sort((a, b) => (b.abrKbps ?? b.tbrKbps ?? 0) - (a.abrKbps ?? a.tbrKbps ?? 0))[0]
      pick = { videoId: row.formatId, audioId: bestAudio?.formatId ?? '' }
    } else if (row.acodec !== null) {
      const bestVideo = [...r.formats]
        .filter((f) => f.vcodec !== null)
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
      pick = { videoId: bestVideo?.formatId ?? '', audioId: row.formatId }
    }
    if (!pick) return
    setAdvancedPick({ ...pick, nonce: Date.now() })
  }

  function toggleAll(select: boolean): void {
    if (busy || result?.kind !== 'playlist') return
    setSelectedEntries(select ? new Set(result.playlistEntries!.map((e) => e.url)) : new Set())
  }

  async function runSingleJob(config: JobConfig): Promise<'completed' | 'cancelled' | 'failed'> {
    launchError.value = null
    let response: DownloadStartResponse
    try {
      response = await window.mf.downloadStart(config)
    } catch {
      response = { kind: 'error', code: 'MF_UNKNOWN', message: 'Unexpected IPC failure.' }
    }
    if (response.kind !== 'ok') {
      lastFailedConfig.value = config
      jobDone.value = { jobId: 'launch', status: 'failed', errorCode: response.code }
      launchError.value = response.message
      return 'failed'
    }
    beginJob(config, response.jobId)
    const status = await waitForCurrentJob()
    if (status === 'failed') lastFailedConfig.value = config
    return status
  }

  async function startDownload() {
    const r = analysis.value
    if (!r || !selection || activeJob.value || queueRunning.value) return

    if (r.kind === 'playlist') {
      const entries = (r.playlistEntries ?? []).filter((e) => selectedEntries.has(e.url))
      if (entries.length === 0) return
      stopRequested.value = false
      queueRunning.value = true
      queueRows.value = entries.map((e) => ({ url: e.url, title: e.title, status: 'pending' }))
      activeView.value = 'queue'
      try {
        for (let i = 0; i < entries.length; i += 1) {
          if (stopRequested.value) break
          const config = configFor(entries[i].url, selection, false, r.metadata.title)
          queueRows.value = queueRows.value.map((row, idx) =>
            idx === i ? { ...row, status: 'downloading' } : row,
          )
          let status: 'completed' | 'cancelled' | 'failed'
          try {
            status = await runSingleJob(config)
          } catch {
            lastFailedConfig.value = config
            status = 'failed'
          }
          queueRows.value = queueRows.value.map((row, idx) =>
            idx === i ? { ...row, status: status === 'completed' ? 'done' : status } : row,
          )
        }
      } finally {
        queueRunning.value = false
      }
      return
    }

    await runSingleJob(configFor(r.metadata.webpageUrl ?? '', selection, r.metadata.isLive))
  }

  async function retryLastFailed() {
    const config = lastFailedConfig.value
    if (!config || busy) return
    lastFailedConfig.value = null
    await runSingleJob(config)
  }

  function cancelActive() {
    stopRequested.value = true
    const job = activeJob.value
    if (job) void window.mf.downloadCancel(job.jobId)
  }

  const isPlaylist = result?.kind === 'playlist'
  const playlistTotal = isPlaylist ? (result?.playlistEntries ?? []).length : 0
  const playlistSelected = isPlaylist
    ? (result?.playlistEntries ?? []).filter((e) => selectedEntries.has(e.url)).length
    : 0
  const advancedReady =
    selection?.mode !== 'advanced' ||
    (selection.videoFormatId.length > 0 && selection.audioFormatId.length > 0)
  const canStart =
    result !== null &&
    selection !== null &&
    selection.destDir.length > 0 &&
    advancedReady &&
    !busy &&
    (!isPlaylist || playlistSelected > 0)

  return (
    <div class="flex h-full flex-col">
      <TitleBar />

      <div class="flex min-h-0 flex-1">
        <NavRail working={busy} onShowNotice={() => setShowNotice(true)} />

        {activeView.value === 'settings' ? (
          <main class="mf-rise min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <SettingsScreen />
          </main>
        ) : activeView.value === 'queue' ? (
          <main class="mf-rise min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <QueueList onCancelActive={cancelActive} />
          </main>
        ) : (
          <main ref={scrollRef} class="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-3 pt-4">
            <UrlBar />

            {!analyzing.value && !result ? (
              <HeroState />
            ) : (
              <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] items-stretch gap-3 overflow-hidden">
                <section class="flex min-h-0 flex-col gap-3">
                  <PreviewPanel
                    result={result}
                    loading={analyzing.value && result === null}
                    hydration={isPlaylist ? playlistHydration.value : null}
                    selectedUrls={isPlaylist ? selectedEntries : undefined}
                    onToggleEntry={isPlaylist ? toggleEntry : undefined}
                    onToggleAll={isPlaylist ? toggleAll : undefined}
                  />
                  {result && (
                    <FormatMatrix
                      formats={result.formats}
                      onRowActivate={handleStreamPick}
                      pickedIds={
                        selection?.mode === 'advanced'
                          ? new Set(
                              [selection.videoFormatId, selection.audioFormatId].filter(Boolean),
                            )
                          : undefined
                      }
                    />
                  )}
                </section>

                <aside class="flex min-h-0 flex-col gap-3 overflow-y-auto pb-1 pr-0.5">
                  {result && (
                    <ModeSelector
                      key={result.metadata.id}
                      formats={result.formats}
                      durationSec={result.metadata.durationSec}
                      onSelection={setSelection}
                      disabled={busy}
                      advancedPick={advancedPick}
                    />
                  )}
                  {result && (
                    <div class="mt-auto flex flex-col gap-1.5 pt-1">
                      <p
                        class="truncate px-1 text-[11px] text-slate-500"
                        title={
                          isPlaylist
                            ? `Saves into ${selection?.destDir ?? ''}\\${result.metadata.title}`
                            : selection?.destDir
                        }
                      >
                        {isPlaylist
                          ? `${playlistSelected}/${playlistTotal} entries · ${selection?.destDir ?? ''}\\${result.metadata.title}`
                          : (selection?.destDir ?? '')}
                      </p>
                      {busy ? (
                        <button
                          onClick={cancelActive}
                          class="shrink-0 rounded-xl bg-gradient-to-br from-rose-600 to-rose-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:brightness-110 active:scale-[0.98]"
                        >
                          {isPlaylist ? 'Stop After Current' : 'Cancel Download'}
                        </button>
                      ) : (
                        <button
                          onClick={() => void startDownload()}
                          disabled={!canStart}
                          className={`mf-focus-ring shrink-0 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-xl shadow-emerald-500/25 transition-all duration-150 hover:brightness-110 hover:shadow-emerald-400/30 active:scale-[0.98] ${
                            canStart ? '' : 'cursor-not-allowed opacity-40 shadow-none'
                          }`}
                        >
                          {isPlaylist
                            ? playlistSelected === playlistTotal
                              ? `Download All · ${playlistTotal}`
                              : `Download Selected · ${playlistSelected}`
                            : 'Start Download'}
                        </button>
                      )}
                    </div>
                  )}
                </aside>
              </div>
            )}

            <PipelineStatus onRetry={() => void retryLastFailed()} />
          </main>
        )}
      </div>

      {logDockOpen.value && (
        <section class="flex h-[280px] shrink-0 flex-col">
          <LogConsole dock />
        </section>
      )}

      {showNotice && (
        <div class="flex items-center justify-between gap-4 border-t border-amber-900/60 bg-amber-950/40 px-5 py-2 text-xs text-amber-200">
          <p class="flex items-center gap-2">
            <ShieldIcon class="size-4 shrink-0" />
            MediaForge is a passive client — you are responsible for complying with the terms and
            copyright of the sites you download from.
          </p>
          <button
            onClick={() => {
              setShowNotice(false)
              void window.mf.markFirstRunSeen()
            }}
            class="app-no-drag mf-focus-ring shrink-0 rounded-lg border border-amber-700 px-3 py-1 font-medium transition hover:bg-amber-900/50"
          >
            Understood
          </button>
        </div>
      )}

      <footer class="flex shrink-0 items-center justify-between gap-4 border-t border-white/[0.06] bg-ink-950/85 px-4 py-1.5 text-[11px] text-slate-500 backdrop-blur">
        <EnginesStatus />
        <span class="flex items-center gap-1">
          <button
            onClick={toggleLogDock}
            title="Toggle live console (Ctrl+`)"
            aria-pressed={logDockOpen.value}
            className={`mf-focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition ${
              logDockOpen.value
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'hover:bg-white/[0.06] hover:text-slate-200'
            }`}
          >
            <TerminalIcon class="size-3.5" />
            console
          </button>
          {[
            { label: 'import cookies', fn: () => void window.mf.importCookies() },
            { label: 'clear cookies', fn: () => void window.mf.clearCookies() },
            { label: 'logs folder', fn: () => void window.mf.openLogsFolder() },
            { label: 'clear result', fn: () => resetAnalysis() },
          ].map((action) => (
            <button
              key={action.label}
              onClick={action.fn}
              class="rounded-md px-2 py-1 transition hover:bg-white/[0.06] hover:text-slate-200"
            >
              {action.label}
            </button>
          ))}
        </span>
        <span class="mf-num">{bridgeNote}</span>
      </footer>
    </div>
  )
}
