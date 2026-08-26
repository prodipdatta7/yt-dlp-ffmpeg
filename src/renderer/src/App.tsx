import { useEffect, useRef, useState } from 'preact/hooks'
import { FormatMatrix } from './components/FormatMatrix'
import { ModeSelector, type AdvancedPick, type JobSelection } from './components/ModeSelector'
import { PipelineStatus } from './components/PipelineStatus'
import { SettingsScreen } from './components/SettingsScreen'
import {
  DetailsGrid,
  LoadingSkeleton,
  PlaylistBanner,
  PlaylistEntries,
  VideoBanner,
} from './components/PreviewPanel'
import { QueueList } from './components/QueueList'
import { UrlBar } from './components/UrlBar'
import { LogConsole } from './components/LogConsole'
import {
  DownloadIcon,
  FolderIcon,
  GearIcon,
  LinkIcon,
  LogoBolt,
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
import {
  activeView,
  logDockOpen,
  setThemePref,
  toggleLogDock,
  type ViewId,
} from './signals/uiState'
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
import { estimateEntryBytes } from './utils/estimate'
import { fmtSize } from './utils/format'
import { POPULAR_SOURCES } from './utils/source'

const APP_VERSION = 'v0.1.1'

type EngineInfo = { version: string | null; source: string | null }

function LogoMark() {
  return (
    <span class="app-no-drag flex size-8 items-center justify-center rounded-[10px] border border-sky-400/30 bg-gradient-to-br from-sky-500/25 to-indigo-500/25 shadow-inner">
      <LogoBolt class="size-5" />
    </span>
  )
}

function EngineBadge({ label, info, role }: { label: string; info: EngineInfo; role: string }) {
  if (!info.version || !info.source) {
    return (
      <span class="flex items-center gap-1.5" title={`${label}: missing — ${role}`}>
        <span class="size-1.5 rounded-full bg-red-500" />
        <span>{label}: missing</span>
      </span>
    )
  }
  return (
    <span
      class="flex items-center gap-1.5"
      title={`${label} ${info.version} (${info.source}) — ${role}`}
    >
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
      <EngineBadge label="yt-dlp" info={info.ytdlp} role="extracts info and downloads streams" />
      <EngineBadge
        label="ffmpeg"
        info={info.ffmpeg}
        role="driven by yt-dlp to merge video/audio and transcode audio"
      />
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
    <header class="app-drag relative z-20 flex h-[46px] shrink-0 items-center gap-3 border-b border-white/[0.06] bg-ink-950 pl-4 pr-40">
      <LogoMark />
      <div class="flex items-baseline gap-2">
        <h1 class="text-[15px] font-bold leading-none tracking-tight text-white">MediaForge</h1>
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

type StreamTab = 'entries' | 'streams' | 'details'

interface PausedQueueRun {
  entries: Array<{ url: string; title: string }>
  selection: JobSelection
  playlistTitle?: string
  index: number
}

function HeroState() {
  const focusUrl = (): void => {
    window.dispatchEvent(new CustomEvent('mf:focus-url'))
  }
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <div class="w-full max-w-xl text-center">
        <button
          type="button"
          onClick={focusUrl}
          class="mf-focus-ring group mx-auto flex w-full cursor-pointer flex-col items-center rounded-2xl border border-dashed border-slate-600/60 bg-[var(--surface-card-lo)] px-6 py-9 transition-all duration-200 hover:border-sky-400/70 hover:bg-[var(--step-active-bg)]"
        >
          <span class="mf-hairline mb-4 flex size-14 items-center justify-center rounded-3xl transition-transform duration-200 group-hover:scale-105">
            <span class="flex size-full items-center justify-center rounded-3xl bg-gradient-to-br from-go-500/25 to-indigo-500/20 shadow-inner">
              <LinkIcon class="size-6 text-sky-400" />
            </span>
          </span>
          <p class="text-base font-bold tracking-tight text-white">
            Paste a link, or drop one anywhere.
          </p>
          <p class="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
            Single videos, audio rips and full playlists all flow through the same verified
            pipeline. Press <kbd class="mf-kbd">Ctrl</kbd> <kbd class="mf-kbd">K</kbd> to jump to
            the link bar.
          </p>
        </button>

        <div class="mt-6 grid grid-cols-3 gap-3">
          {[
            { Icon: SlidersIcon, title: 'Analyze', text: 'Every stream mapped before you commit' },
            {
              Icon: DownloadIcon,
              title: 'Configure',
              text: 'Quality, container or raw format IDs',
            },
            { Icon: QueueIcon, title: 'Save', text: 'Muxed by FFmpeg, verified, delivered' },
          ].map(({ Icon, title, text }, i) => (
            <div
              key={title}
              class="mf-card mf-card-hover mf-rise p-3.5 text-left"
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
        <div class="mt-5 flex flex-wrap items-center justify-center gap-1.5">
          {POPULAR_SOURCES.map((site) => (
            <span
              key={site}
              class="rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-0.5 text-[11px] font-medium text-slate-500"
            >
              {site}
            </span>
          ))}
        </div>
        <p class="mt-3 text-[11px] text-slate-600">
          Works with any media link the engine supports — hundreds of sites beyond these examples.
        </p>
      </div>
    </div>
  )
}

export function App() {
  const [bridgeNote, setBridgeNote] = useState('bridge ok')
  const [selection, setSelection] = useState<JobSelection | null>(null)
  const [advancedPick, setAdvancedPick] = useState<AdvancedPick | null>(null)
  const [selectedEntries, setSelectedEntries] = useState<ReadonlySet<string>>(new Set())
  const [streamTab, setStreamTab] = useState<StreamTab>('streams')
  const [showNotice, setShowNotice] = useState(false)
  const [paused, setPaused] = useState<{ config: JobConfig; queue: PausedQueueRun | null } | null>(
    null,
  )
  const pausedRef = useRef(paused)
  const runCtxRef = useRef<{
    entries: Array<{ url: string; title: string }>
    selection: JobSelection
    playlistTitle?: string
  } | null>(null)
  const scrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    window.mf
      .getSettings()
      .then((s) => {
        setShowNotice(!s.firstRunNoticeSeen)
        if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'system') {
          setThemePref(s.theme)
        }
      })
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
      setStreamTab('entries')
      scrollRef.current?.scrollTo({ top: 0 })
    } else {
      setStreamTab('streams')
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

  async function runQueue(
    entries: Array<{ url: string; title: string }>,
    sel: JobSelection,
    playlistTitle: string | undefined,
    fromIndex: number,
  ): Promise<void> {
    stopRequested.value = false
    queueRunning.value = true
    if (fromIndex === 0) {
      queueRows.value = entries.map((e) => ({ url: e.url, title: e.title, status: 'pending' }))
    }
    try {
      for (let i = fromIndex; i < entries.length; i += 1) {
        if (stopRequested.value) break
        const config = configFor(entries[i].url, sel, false, playlistTitle)
        lastJobEvent.value = null
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
        if (status === 'cancelled' && pausedRef.current !== null) {
          queueRows.value = queueRows.value.map((row, idx) =>
            idx === i ? { ...row, status: 'paused' } : row,
          )
          break
        }
        queueRows.value = queueRows.value.map((row, idx) =>
          idx === i ? { ...row, status: status === 'completed' ? 'done' : status } : row,
        )
      }
      if (stopRequested.value && pausedRef.current === null) {
        queueRows.value = queueRows.value.map((row) =>
          row.status === 'pending' ? { ...row, status: 'cancelled' } : row,
        )
      }
    } finally {
      queueRunning.value = false
    }
  }

  async function startDownload() {
    const r = analysis.value
    if (!r || !selection || activeJob.value || queueRunning.value) return

    if (r.kind === 'playlist') {
      const entries = (r.playlistEntries ?? []).filter((e) => selectedEntries.has(e.url))
      if (entries.length === 0) return
      setPaused(null)
      runCtxRef.current = { entries, selection, playlistTitle: r.metadata.title }
      activeView.value = 'queue'
      await runQueue(entries, selection, r.metadata.title, 0)
      return
    }

    setPaused(null)
    runCtxRef.current = null
    await runSingleJob(configFor(r.metadata.webpageUrl ?? '', selection, r.metadata.isLive))
  }

  async function retryLastFailed() {
    const config = lastFailedConfig.value
    if (!config || busy || pausedRef.current !== null) return
    lastFailedConfig.value = null
    await runSingleJob(config)
  }

  function stopAfterCurrent() {
    stopRequested.value = true
  }

  function cancelActive() {
    stopRequested.value = true
    const job = activeJob.value
    if (job) void window.mf.downloadCancel(job.jobId)
  }

  function pauseActive() {
    const job = activeJob.value
    if (!job) return
    const ctx = runCtxRef.current
    const idx = queueRows.value.findIndex((row) => row.status === 'downloading')
    setPaused({
      config: job.config,
      queue: ctx && idx >= 0 ? { ...ctx, index: idx } : null,
    })
    void window.mf.downloadCancel(job.jobId)
  }

  function resumePaused() {
    const p = paused
    if (!p) return
    setPaused(null)
    runCtxRef.current = p.queue
      ? {
          entries: p.queue.entries,
          selection: p.queue.selection,
          playlistTitle: p.queue.playlistTitle,
        }
      : null
    if (p.queue) {
      void runQueue(p.queue.entries, p.queue.selection, p.queue.playlistTitle, p.queue.index)
    } else {
      void runSingleJob(p.config)
    }
  }

  const isPlaylist = result?.kind === 'playlist'
  const playlistTotal = isPlaylist ? (result?.playlistEntries ?? []).length : 0
  const playlistSelected = isPlaylist
    ? (result?.playlistEntries ?? []).filter((e) => selectedEntries.has(e.url)).length
    : 0

  const playlistSummary = (() => {
    if (!isPlaylist || result?.kind !== 'playlist' || !selection) return null
    const chosen = (result.playlistEntries ?? []).filter((e) => selectedEntries.has(e.url))
    let sum = 0
    let any = false
    for (const entry of chosen) {
      const bytes = estimateEntryBytes(entry.durationSec ?? null, {
        mode: selection.mode,
        durationSec: entry.durationSec ?? null,
        tier: selection.tier,
        container: selection.container,
        audioFormat: selection.audioFormat,
        bitrate: selection.bitrate,
        videoFormatId: '',
        audioFormatId: '',
      })
      if (bytes !== null) {
        sum += bytes
        any = true
      }
    }
    const tierLabel =
      selection.tier === 4320 ? '8K' : selection.tier === 2160 ? '4K' : `${selection.tier}p`
    const modeLabel =
      selection.mode === 'video-audio'
        ? `${tierLabel} ${selection.container.toUpperCase()}`
        : selection.mode === 'audio-only'
          ? `${selection.audioFormat.toUpperCase()}${selection.bitrate ? ` ${selection.bitrate}` : ''}`
          : 'Advanced'
    return {
      selected: chosen.length,
      total: playlistTotal,
      estimatedBytes: any ? sum : null,
      modeLabel,
    }
  })()
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
            <QueueList onStopAfterCurrent={stopAfterCurrent} onCancelAll={cancelActive} />
          </main>
        ) : (
          <main ref={scrollRef} class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-3 pt-3.5">
            <UrlBar />

            {!analyzing.value && !result ? (
              <HeroState />
            ) : analyzing.value && !result ? (
              <div class="min-h-0 flex-1">
                <LoadingSkeleton />
              </div>
            ) : (
              <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] items-stretch gap-3 overflow-hidden">
                <section class="flex min-h-0 flex-col gap-2.5">
                  {isPlaylist ? (
                    <PlaylistBanner result={result!} hydration={playlistHydration.value} />
                  ) : (
                    <VideoBanner result={result!} />
                  )}

                  {(() => {
                    const tabs: Array<{ id: StreamTab; label: string }> = isPlaylist
                      ? [
                          { id: 'entries', label: `Entries (${playlistTotal})` },
                          { id: 'streams', label: `Streams (${result!.formats.length})` },
                          { id: 'details', label: 'Details' },
                        ]
                      : [
                          { id: 'streams', label: `Streams (${result!.formats.length})` },
                          { id: 'details', label: 'Details' },
                        ]
                    return (
                      <div
                        role="tablist"
                        aria-label="Analysis sections"
                        class="flex shrink-0 gap-1 rounded-xl border border-white/[0.07] bg-black/25 p-1"
                      >
                        {tabs.map(({ id, label }) => (
                          <button
                            key={id}
                            role="tab"
                            aria-selected={streamTab === id}
                            onClick={() => setStreamTab(id)}
                            class={`mf-focus-ring flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
                              streamTab === id
                                ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-go-500/25'
                                : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )
                  })()}

                  <div class="flex min-h-0 flex-1 flex-col">
                    {streamTab === 'entries' && isPlaylist && (
                      <PlaylistEntries
                        result={result!}
                        selectedUrls={selectedEntries}
                        onToggleEntry={toggleEntry}
                        onToggleAll={toggleAll}
                      />
                    )}
                    {streamTab === 'streams' && (
                      <FormatMatrix
                        formats={result!.formats}
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
                    {streamTab === 'details' && (
                      <DetailsGrid
                        result={result!}
                        playlistSummary={playlistSummary ?? undefined}
                      />
                    )}
                  </div>
                </section>

                <aside class="flex min-h-0 flex-col gap-3">
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
                    <div class="mf-card shrink-0 p-3">
                      <div
                        class="flex items-center gap-2 rounded-lg border border-dashed border-slate-600/50 px-2.5 py-1.5"
                        title={
                          isPlaylist
                            ? `Saves into ${selection?.destDir ?? ''}\\${result.metadata.title}`
                            : `Saves into ${selection?.destDir ?? ''}`
                        }
                      >
                        <FolderIcon class="size-3.5 shrink-0 text-slate-500" />
                        <span class="mf-num min-w-0 flex-1 truncate text-[11px] text-slate-500">
                          {isPlaylist
                            ? `${playlistSelected}/${playlistTotal} entries · ${selection?.destDir ?? ''}`
                            : (selection?.destDir ?? '')}
                        </span>
                      </div>
                      {isPlaylist && playlistSummary !== null && (
                        <p class="mt-1.5 px-1 text-[10.5px] text-slate-500">
                          {playlistSummary.estimatedBytes !== null ? (
                            <>
                              ≈{' '}
                              <span class="mf-num font-semibold text-slate-400">
                                {fmtSize(playlistSummary.estimatedBytes)}
                              </span>{' '}
                              total for {playlistSummary.selected} entries ·{' '}
                              {playlistSummary.modeLabel}
                            </>
                          ) : (
                            <>{playlistSummary.modeLabel} — size unknown until analysis</>
                          )}
                        </p>
                      )}
                      {busy ? (
                        <button
                          onClick={isPlaylist ? stopAfterCurrent : cancelActive}
                          class="mt-2 w-full shrink-0 rounded-xl bg-gradient-to-br from-rose-600 to-rose-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:brightness-110 active:scale-[0.98]"
                        >
                          {isPlaylist ? 'Stop After Current' : 'Cancel Download'}
                        </button>
                      ) : (
                        <button
                          onClick={() => void startDownload()}
                          disabled={!canStart}
                          className={`mf-focus-ring mt-2 w-full shrink-0 rounded-xl bg-gradient-to-r from-go-500 to-go-400 px-5 py-3 text-sm font-bold text-white shadow-xl shadow-go-500/30 transition-all duration-150 hover:brightness-110 hover:shadow-go-400/40 active:scale-[0.98] ${
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

            <PipelineStatus
              onRetry={() => void retryLastFailed()}
              onCancel={cancelActive}
              onPause={pauseActive}
              paused={paused !== null}
              onResume={resumePaused}
            />
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

      <footer class="flex shrink-0 items-center justify-between gap-4 border-t border-white/[0.06] bg-ink-950 px-4 py-1.5 text-[11px] text-slate-500">
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
            {
              label: 'import cookies',
              title:
                'Load a cookies.txt file (Netscape format) to unlock age-gated, region-locked or bot-checked content. Optional for public videos.',
              fn: () => void window.mf.importCookies(),
            },
            {
              label: 'clear cookies',
              title: 'Remove the stored cookies.txt. Safe — it only affects restricted links.',
              fn: () => void window.mf.clearCookies(),
            },
            {
              label: 'logs folder',
              title: 'Open the folder where MediaForge keeps its diagnostic logs.',
              fn: () => void window.mf.openLogsFolder(),
            },
            {
              label: 'clear result',
              title: 'Dismiss the current analysis and start over.',
              fn: () => resetAnalysis(),
            },
          ].map((action) => (
            <button
              key={action.label}
              onClick={action.fn}
              title={action.title}
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
