import { useEffect, useRef, useState } from 'preact/hooks'
import { FormatMatrix } from './components/FormatMatrix'
import { ModeSelector, type JobSelection } from './components/ModeSelector'
import { PipelineStatus } from './components/PipelineStatus'
import { SettingsScreen } from './components/SettingsScreen'
import { PreviewPanel } from './components/PreviewPanel'
import { QueueList } from './components/QueueList'
import { UrlBar } from './components/UrlBar'
import { analyzing, analysis, resetAnalysis } from './signals/appState'
import { settingsOpen } from './signals/uiState'
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
import type { JobConfig } from '../../shared/models'

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

function configFor(url: string, selection: JobSelection, isLive = false): JobConfig {
  const base = {
    url,
    destDir: selection.destDir,
    estimatedBytes: selection.estimatedBytes ?? undefined,
    isLive,
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

async function runSingleJob(config: JobConfig): Promise<'completed' | 'cancelled' | 'failed'> {
  launchError.value = null
  const response = await window.mf.downloadStart(config)
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

export function App() {
  const [bridgeNote, setBridgeNote] = useState('bridge: probing…')
  const [selection, setSelection] = useState<JobSelection | null>(null)
  const mainScrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (analysis.value) {
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [analysis.value?.metadata.id])
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => {
    window.mf
      .getSettings()
      .then((s) => setShowNotice(!s.firstRunNoticeSeen))
      .catch(() => undefined)
    window.mf
      .ping()
      .then((r) => setBridgeNote(`bridge ok · ${new Date(r.ts).toLocaleTimeString()}`))
      .catch(() => setBridgeNote('bridge error'))

    const offEvent = window.mf.onJobEvent((event) => {
      lastJobEvent.value = event
    })
    const offDone = window.mf.onJobDone((done) => {
      endJob(done)
      resolveCurrentJob(done.status)
    })
    return () => {
      offEvent()
      offDone()
    }
  }, [])

  async function startDownload() {
    const result = analysis.value
    if (!result || !selection || activeJob.value || queueRunning.value) return

    if (result.kind === 'playlist') {
      const entries = result.playlistEntries ?? []
      if (entries.length === 0) return
      stopRequested.value = false
      queueRunning.value = true
      queueRows.value = entries.map((e) => ({ url: e.url, title: e.title, status: 'pending' }))
      for (let i = 0; i < entries.length; i += 1) {
        if (stopRequested.value) break
        queueRows.value = queueRows.value.map((r, idx) =>
          idx === i ? { ...r, status: 'downloading' } : r,
        )
        const status = await runSingleJob(configFor(entries[i].url, selection))
        queueRows.value = queueRows.value.map((r, idx) =>
          idx === i ? { ...r, status: status === 'completed' ? 'done' : status } : r,
        )
        if (status !== 'completed') continue
      }
      queueRunning.value = false
      return
    }

    await runSingleJob(
      configFor(result.metadata.webpageUrl ?? '', selection, result.metadata.isLive),
    )
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

  const busy = activeJob.value !== null || queueRunning.value
  const isPlaylist = analysis.value?.kind === 'playlist'
  const advancedReady =
    selection?.mode !== 'advanced' ||
    (selection.videoFormatId.length > 0 && selection.audioFormatId.length > 0)
  const canStart =
    analysis.value !== null &&
    selection !== null &&
    selection.destDir.length > 0 &&
    advancedReady &&
    !busy

  return (
    <div class="flex h-screen flex-col text-slate-200">
      <header class="flex items-center gap-3 border-b border-white/[0.06] bg-slate-950/70 px-5 py-3 backdrop-blur">
        <span class="flex size-9 items-center justify-center rounded-xl border border-sky-400/30 bg-gradient-to-br from-sky-500/20 to-indigo-500/20 shadow-inner">
          <LogoMark />
        </span>
        <div>
          <h1 class="text-base font-bold leading-tight tracking-tight text-white">
            MediaForge Desktop
          </h1>
          <p class="text-[10px] uppercase tracking-wider text-slate-500">
            Media downloader & transcoder
          </p>
        </div>
        <span class="mf-num rounded-full border border-sky-400/20 bg-sky-400/5 px-2 py-0.5 text-[10px] font-semibold text-sky-300/90">
          {APP_VERSION}
        </span>
        <button
          onClick={() => (settingsOpen.value = !settingsOpen.value)}
          title="Settings"
          class={`mf-focus-ring ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            settingsOpen.value
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
              : 'border-white/[0.08] text-slate-400 hover:border-white/20 hover:text-white'
          }`}
        >
          Settings
        </button>
      </header>

      {settingsOpen.value ? (
        <main class="flex flex-1 flex-col overflow-y-auto px-6 py-8">
          <SettingsScreen />
        </main>
      ) : (
        <main
          ref={mainScrollRef}
          class="flex flex-1 flex-col items-center gap-5 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8"
        >
          <UrlBar />

          <PreviewPanel result={analysis.value} loading={analyzing.value} />
          {analysis.value && <FormatMatrix formats={analysis.value.formats} />}

          {analysis.value?.kind === 'video' && (
            <ModeSelector
              formats={analysis.value.formats}
              durationSec={analysis.value.metadata.durationSec}
              onSelection={setSelection}
              disabled={busy}
            />
          )}

          <div class="flex w-full max-w-3xl min-w-0 items-center justify-between gap-3">
            <p class="min-w-0 truncate text-xs text-slate-500">
              {isPlaylist
                ? `Playlist — ${queueRows.value.length} entries will be processed sequentially`
                : analysis.value
                  ? 'Pick a mode above, then start.'
                  : 'Paste a link and hit Analyze to begin.'}
            </p>
            {busy ? (
              <button
                onClick={cancelActive}
                class="shrink-0 rounded-lg bg-gradient-to-br from-rose-600 to-rose-500 px-5 py-2 text-sm font-semibold text-white shadow shadow-rose-500/20 transition hover:brightness-110 active:scale-[0.98]"
              >
                {isPlaylist ? 'Stop After Current' : 'Cancel Download'}
              </button>
            ) : (
              <button
                onClick={() => void startDownload()}
                disabled={!canStart}
                class="mf-focus-ring shrink-0 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 px-6 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {isPlaylist
                  ? `Download All (${queueRows.value.length})`
                  : 'Start Production-Grade Download'}
              </button>
            )}
          </div>

          <PipelineStatus onRetry={() => void retryLastFailed()} />
          <QueueList />
        </main>
      )}

      <footer class="flex items-center justify-between gap-4 border-t border-white/[0.06] bg-slate-950/70 px-5 py-2 text-xs text-slate-500 backdrop-blur">
        <EnginesStatus />
        <span class="flex items-center gap-3">
          <button onClick={() => void window.mf.importCookies()} class="hover:text-slate-300">
            import cookies
          </button>
          <button onClick={() => void window.mf.clearCookies()} class="hover:text-slate-300">
            clear
          </button>
          <button onClick={() => void window.mf.openLogsFolder()} class="hover:text-slate-300">
            logs folder
          </button>
          <button onClick={() => resetAnalysis()} class="hover:text-slate-300">
            clear result
          </button>
        </span>
        <span>{bridgeNote}</span>
      </footer>

      {showNotice && (
        <div class="flex items-center justify-between gap-4 border-t border-amber-900/60 bg-amber-950/40 px-5 py-2 text-xs text-amber-200">
          <p>
            MediaForge is a passive download client. You are responsible for complying with the
            terms of service and copyright of the sites you download from.
          </p>
          <button
            onClick={() => {
              setShowNotice(false)
              void window.mf.markFirstRunSeen()
            }}
            class="shrink-0 rounded-lg border border-amber-700 px-3 py-1 font-medium hover:bg-amber-900/50"
          >
            Understood
          </button>
        </div>
      )}
    </div>
  )
}
