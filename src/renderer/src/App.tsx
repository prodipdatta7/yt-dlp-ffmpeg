import { useEffect, useState } from 'preact/hooks'
import { FormatMatrix } from './components/FormatMatrix'
import { ModeSelector, type JobSelection } from './components/ModeSelector'
import { PipelineStatus } from './components/PipelineStatus'
import { PreviewPanel } from './components/PreviewPanel'
import { QueueList } from './components/QueueList'
import { UrlBar } from './components/UrlBar'
import { analyzing, analysis, resetAnalysis } from './signals/appState'
import { activeJob, beginJob, endJob, lastJobEvent } from './signals/jobState'
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

function configFor(url: string, selection: JobSelection): JobConfig {
  const base = {
    url,
    destDir: selection.destDir,
    estimatedBytes: selection.estimatedBytes ?? undefined,
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
  const response = await window.mf.downloadStart(config)
  if (response.kind !== 'ok') return 'failed'
  beginJob(config, response.jobId)
  return waitForCurrentJob()
}

export function App() {
  const [bridgeNote, setBridgeNote] = useState('bridge: probing…')
  const [selection, setSelection] = useState<JobSelection | null>(null)

  useEffect(() => {
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

    await runSingleJob(configFor(result.metadata.webpageUrl ?? '', selection))
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
    <div class="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header class="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <LogoMark />
        <h1 class="text-lg font-semibold tracking-tight">MediaForge Desktop</h1>
        <span class="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          {APP_VERSION}
        </span>
      </header>

      <main class="flex flex-1 flex-col items-center gap-6 overflow-y-auto px-6 py-8">
        <UrlBar />
        {analysis.value?.kind === 'video' && (
          <ModeSelector
            formats={analysis.value.formats}
            durationSec={analysis.value.metadata.durationSec}
            onSelection={setSelection}
            disabled={busy}
          />
        )}

        <div class="flex w-full max-w-5xl items-center justify-between gap-3">
          <p class="text-xs text-slate-500">
            {isPlaylist
              ? `Playlist — ${queueRows.value.length} entries will be processed sequentially`
              : 'Pick a mode above, then start.'}
          </p>
          {busy ? (
            <button
              onClick={cancelActive}
              class="rounded-lg bg-red-700 px-5 py-2 text-sm font-medium text-white hover:bg-red-600"
            >
              {isPlaylist ? 'Stop After Current' : 'Cancel Download'}
            </button>
          ) : (
            <button
              onClick={() => void startDownload()}
              disabled={!canStart}
              class="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPlaylist
                ? `Download All (${queueRows.value.length})`
                : 'Start Production-Grade Download'}
            </button>
          )}
        </div>

        <PipelineStatus />
        <QueueList />
        <PreviewPanel result={analysis.value} loading={analyzing.value} />
        {analysis.value && <FormatMatrix formats={analysis.value.formats} />}
      </main>

      <footer class="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-5 py-2 text-xs text-slate-500">
        <EnginesStatus />
        <button onClick={() => resetAnalysis()} class="hover:text-slate-300">
          clear
        </button>
        <span>{bridgeNote}</span>
      </footer>
    </div>
  )
}
