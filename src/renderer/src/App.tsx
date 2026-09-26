import { useEffect, useRef, useState } from 'preact/hooks'
import { FormatMatrix } from './components/FormatMatrix'
import { ModeSelector, type AdvancedPick, type JobSelection } from './components/ModeSelector'
import { PipelineStatus } from './components/PipelineStatus'
import { DownloadCompleteSummary } from './components/DownloadCompleteSummary'
import { PlaylistDownloadSummary } from './components/PlaylistDownloadSummary'
import { SettingsScreen } from './components/SettingsScreen'
import {
  DetailsGrid,
  LoadingSkeleton,
  PlaylistBanner,
  PlaylistEntries,
  VideoBanner,
  VideoPreviewTab,
} from './components/PreviewPanel'
import { QueueList } from './components/QueueList'
import { UrlBar } from './components/UrlBar'
import { LogConsole } from './components/LogConsole'
import { FirstRunModal } from './components/FirstRunModal'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { SearchScreen } from './components/SearchScreen'
import { LocalShareScreen } from './components/LocalShareScreen'
import { HelpScreen } from './components/HelpScreen'
import { PageHelpNote } from './components/PageHelpNote'
import {
  BookOpenIcon,
  DownloadIcon,
  FolderIcon,
  GearIcon,
  LinkIcon,
  QueueIcon,
  SearchIcon,
  ShareIcon,
  ShieldIcon,
  SlidersIcon,
  TerminalIcon,
} from './components/icons'
import {
  analyzing,
  analysis,
  applyAnalyzeStream,
  hydratedEntries,
  playlistHydration,
  resetAnalysis,
  triggerAnalyze,
  urlInput,
} from './signals/appState'
import {
  activeView,
  logDockOpen,
  setThemePref,
  toggleLogDock,
  type ViewId,
} from './signals/uiState'
import { appendLogEntry, setLogHistory } from './signals/logState'
import { lastSearchedQuery, searchError, searchResults, searching } from './signals/searchState'
import {
  activeJob,
  activeJobsById,
  applyJobEvent,
  beginJob,
  endJob,
  jobDone,
  jobEventsById,
  lastFailedConfig,
  lastJobEvent,
  launchError,
} from './signals/jobState'
import {
  patchQueueRow,
  queueRows,
  queueRunMode,
  queueRunning,
  resolveJob,
  stopRequested,
  waitForJob,
  type JobResult,
  type QueueRunMode,
} from './signals/queueState'
import type { DownloadStartResponse } from '../../shared/ipcContract'
import {
  getSearchPlatform,
  type FormatRow,
  type JobConfig,
  type SearchResultItem,
} from '../../shared/models'
import { estimateEntryBytes, estimatePresetBytes, type FormatPresetOption } from './utils/estimate'
import { fmtSize } from './utils/format'
import { POPULAR_SOURCES } from './utils/source'
import { useDialogFocus } from './utils/useDialogFocus'
import storeLogoUrl from '../../../build/store-logo.png'

type EngineInfo = { version: string | null; source: string | null }
type QueueEntry = { url: string; title: string; isLive?: boolean }

function isSearchItemReadyToDownload(item: SearchResultItem): boolean {
  return (
    getSearchPlatform(item.platform)?.discovery.kind !== 'public-web' ||
    item.metadataState === 'ready'
  )
}

function LogoMark() {
  return (
    <img
      src={storeLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      class="mf-logo-mark app-no-drag block size-8 rounded-[10px] border object-cover"
    />
  )
}

function FloatingDownloadBadge() {
  const activeDownloads = Object.values(activeJobsById.value)
  const isDownloadWorkspace = activeView.value === 'download' || activeView.value === 'queue'

  if (isDownloadWorkspace || activeDownloads.length === 0) return null

  const progressSamples = activeDownloads
    .map(({ jobId }) => jobEventsById.value[jobId]?.percent)
    .filter((percent): percent is number => typeof percent === 'number')
  const progress =
    progressSamples.length > 0
      ? Math.round(
          progressSamples.reduce((total, percent) => total + percent, 0) / progressSamples.length,
        )
      : null
  const latest = activeDownloads
    .map(({ jobId }) => jobEventsById.value[jobId])
    .find((event) => event !== undefined)
  const phaseLabel =
    latest?.phase === 'merging'
      ? 'Merging media'
      : latest?.phase === 'finalizing'
        ? 'Finalizing file'
        : latest?.phase === 'downloading-audio'
          ? 'Downloading audio'
          : latest?.phase === 'downloading-video'
            ? 'Downloading video'
            : 'Preparing download'
  const countLabel =
    activeDownloads.length === 1 ? '1 download' : `${activeDownloads.length} downloads`

  return (
    <button
      type="button"
      class="mf-download-float mf-focus-ring"
      aria-label={`Open queue: ${countLabel}, ${progress === null ? phaseLabel : `${progress}% complete`}`}
      onClick={() => {
        activeView.value = 'queue'
      }}
    >
      <span class="mf-download-float-icon" aria-hidden="true">
        <QueueIcon class="size-4" />
      </span>
      <span class="min-w-0 text-left">
        <span class="mf-download-float-title">
          {progress === null ? phaseLabel : `${progress}% complete`}
        </span>
        <span class="mf-download-float-detail">{countLabel} · Open queue</span>
      </span>
      <span class="mf-download-float-arrow" aria-hidden="true">
        →
      </span>
      <span class="mf-download-float-track" aria-hidden="true">
        <span
          class={`mf-download-float-fill ${progress === null ? 'mf-download-float-fill-pending' : ''}`}
          style={
            progress === null ? undefined : { width: `${Math.min(100, Math.max(0, progress))}%` }
          }
        />
      </span>
    </button>
  )
}

function EngineBadge({ label, info, role }: { label: string; info: EngineInfo; role: string }) {
  if (!info.version || !info.source) {
    return (
      <span class="mf-engine-badge flex items-center gap-1.5" title={`${label}: missing — ${role}`}>
        <span class="size-1.5 rounded-full bg-red-500" />
        <span class="mf-engine-label">{label}: missing</span>
      </span>
    )
  }
  return (
    <span
      class="mf-engine-badge flex min-w-0 items-center gap-1.5"
      title={`${label} ${info.version} (${info.source}) — ${role}`}
    >
      <span class="size-1.5 rounded-full bg-emerald-500" />
      <span class="mf-engine-label min-w-0 truncate">
        {label} <span class="mf-engine-version mf-num text-slate-400">{info.version}</span>
        <span class="mf-engine-source ml-1 rounded border border-line-strong px-1 text-[9px] uppercase">
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
    <span class="mf-engine-status flex min-w-0 items-center gap-4">
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
  { id: 'search', label: 'Search', Icon: SearchIcon },
  { id: 'queue', label: 'Queue', Icon: QueueIcon },
  { id: 'share', label: 'Local Share', Icon: ShareIcon },
  { id: 'help', label: 'Help', Icon: BookOpenIcon },
  { id: 'settings', label: 'Settings', Icon: GearIcon },
]

function NavRail({
  onShowNotice,
  onShowShortcuts,
}: {
  onShowNotice: () => void
  onShowShortcuts: () => void
}) {
  const view = activeView.value
  const queueCount = queueRows.value.length
  const queueCountLabel = queueCount > 99 ? '99+' : String(queueCount)
  return (
    <nav class="mf-nav-rail flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-recess py-3 sm:w-16">
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const isActive = view === id
        const queueAriaLabel =
          id === 'queue' && queueCount > 0
            ? `${label}, ${queueCount} ${queueCount === 1 ? 'video' : 'videos'} in queue`
            : label
        return (
          <button
            key={id}
            onClick={() => (activeView.value = id)}
            title={label}
            aria-label={queueAriaLabel}
            aria-current={isActive ? 'page' : undefined}
            class={`mf-focus-ring group relative flex size-10 items-center justify-center rounded-xl transition-[background-color,color,box-shadow,transform] duration-150 sm:size-11 ${
              isActive
                ? 'bg-gradient-to-br from-sky-500/25 to-indigo-500/20 text-sky-300 shadow-inner'
                : 'text-slate-500 hover:bg-wash-2 hover:text-slate-200'
            }`}
          >
            {isActive && (
              <span class="mf-nav-active-mark absolute -left-2.5 h-5 w-[3px] rounded-full bg-gradient-to-b from-sky-400 to-indigo-400" />
            )}
            {id === 'queue' && queueCount > 0 && (
              <span class={`mf-nav-queue-count ${isActive ? 'is-active' : ''}`}>
                {queueCountLabel}
              </span>
            )}
            <Icon class="size-5" />
            <span class="mf-digital-only mf-nav-label">{label}</span>
          </button>
        )
      })}
      <button
        onClick={onShowShortcuts}
        title="Keyboard shortcuts (?)"
        aria-label="Show keyboard shortcuts"
        class="mf-focus-ring mt-auto flex size-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-wash-2 hover:text-slate-300 sm:size-11"
      >
        <span class="text-sm font-bold">?</span>
      </button>
      <button
        onClick={onShowNotice}
        title="Compliance notice"
        aria-label="Show compliance notice"
        class="mf-focus-ring flex size-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-wash-2 hover:text-slate-300 sm:size-11"
      >
        <ShieldIcon class="size-5" />
      </button>
    </nav>
  )
}

function TitleBar() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.mf
      .getAppVersion()
      .then((r) => setVersion(r.version))
      .catch(() => undefined)
  }, [])

  return (
    <header class="app-drag mf-titlebar relative z-20 flex shrink-0 items-center">
      <div class="mf-titlebar-brand">
        <LogoMark />
        <div class="mf-titlebar-wordmark">
          <h1>MediaForge</h1>
          <span>Desktop media workspace</span>
        </div>
        <span class="mf-titlebar-version mf-num app-no-drag" title="MediaForge version">
          {version ? `v${version}` : '…'}
        </span>
      </div>
      <span class="mf-titlebar-status" aria-hidden="true">
        Local-first
      </span>
    </header>
  )
}

function DownloaderHelp() {
  return (
    <PageHelpNote
      title="How to use the Downloader"
      summary="Paste a direct media link, inspect it, then choose what MediaForge saves."
      steps={[
        'Paste a full http:// or https:// link and choose Analyze.',
        'Choose video, audio, or exact streams and confirm the destination folder.',
        'Start the download and keep MediaForge open until the job is done.',
      ]}
    />
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
    audioBoost: selection.audioBoost,
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

type StreamTab = 'preview' | 'entries' | 'streams' | 'details'

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
    <div class="mf-home-shell flex min-h-0 flex-1 items-center justify-center">
      <div class="mf-home-grid w-full max-w-xl text-center">
        <button
          type="button"
          onClick={focusUrl}
          class="mf-welcome mf-focus-ring group mx-auto flex w-full cursor-pointer flex-col items-center rounded-2xl border border-dashed border-slate-600/60 bg-[var(--surface-card-lo)] px-6 py-9 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-sky-400/70 hover:bg-[var(--step-active-bg)]"
        >
          <span class="mf-digital-only mf-home-eyebrow">YOUR NEXT OFFLINE FAVORITE</span>
          <span class="mf-digital-only mf-home-headline">
            Great media.
            <span>Yours to keep.</span>
          </span>
          <span class="mf-hairline mb-4 flex size-14 items-center justify-center rounded-3xl transition-transform duration-200 group-hover:scale-105">
            <span class="flex size-full items-center justify-center rounded-3xl bg-gradient-to-br from-go-500/25 to-indigo-500/20 shadow-inner">
              <LinkIcon class="size-6 text-sky-400" />
            </span>
          </span>
          <p class="mf-welcome-prompt text-base font-bold tracking-tight text-ink">
            Paste a link, or drop one anywhere.
          </p>
          <p class="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
            Single videos, audio rips and full playlists all flow through the same verified
            pipeline. Press <kbd class="mf-kbd">Ctrl</kbd> <kbd class="mf-kbd">K</kbd> to jump to
            the link bar.
          </p>
          <span class="mf-digital-only mf-welcome-action">
            Add your first link <span aria-hidden="true">↗</span>
          </span>
          <svg
            class="mf-digital-only mf-signal-art"
            viewBox="0 0 480 72"
            fill="none"
            aria-hidden="true"
          >
            <path d="M0 36H480" stroke="currentColor" strokeOpacity="0.12" />
            <path
              class="mf-signal-trace"
              d="M0 36H56L66 25L78 47L90 13L103 60L116 5L130 66L144 18L158 51L170 28L180 36H216L228 17L240 54L252 6L266 66L280 13L294 58L308 25L320 44L332 36H480"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              class="mf-signal-sweep"
              pathLength="100"
              d="M0 36H56L66 25L78 47L90 13L103 60L116 5L130 66L144 18L158 51L170 28L180 36H216L228 17L240 54L252 6L266 66L280 13L294 58L308 25L320 44L332 36H480"
              stroke="currentColor"
              strokeWidth="3"
            />
            <circle
              cx="392"
              cy="36"
              r="20"
              fill="white"
              stroke="currentColor"
              strokeOpacity="0.25"
            />
            <path d="M388 27L401 36L388 45V27Z" fill="currentColor" />
          </svg>
        </button>

        <div class="mf-workflow-grid mt-6 grid grid-cols-3 gap-3">
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
              class="mf-workflow-card mf-card mf-card-hover mf-rise p-3.5 text-left"
              style={`animation-delay: ${80 + i * 70}ms`}
            >
              <span class="mf-digital-only mf-step-number" aria-hidden="true">
                0{i + 1}
              </span>
              <span class="mf-workflow-icon flex size-8 items-center justify-center rounded-lg border border-line bg-wash-1 text-sky-300 shadow-inner">
                <Icon class="size-4" />
              </span>
              <p class="mt-2.5 text-xs font-semibold text-slate-200">{title}</p>
              <p class="mt-1 text-xs leading-relaxed text-slate-600">{text}</p>
            </div>
          ))}
        </div>
        <div class="mf-source-strip mt-5 flex flex-wrap items-center justify-center gap-1.5">
          <span class="mf-digital-only mf-source-label">ALL YOUR FAVORITES</span>
          {POPULAR_SOURCES.map((site) => (
            <span
              key={site}
              class="rounded-full border border-line bg-wash-1 px-2.5 py-0.5 text-xs font-medium text-slate-500"
            >
              {site}
            </span>
          ))}
        </div>
        <p class="mf-source-note mt-3 text-xs text-slate-600">
          Works with any media link the engine supports — hundreds of sites beyond these examples.
        </p>
      </div>
    </div>
  )
}

function QueueDraftModal({
  items,
  onCancel,
  onConfirm,
}: {
  items: SearchResultItem[]
  onCancel: () => void
  onConfirm: (selection: JobSelection) => void
}) {
  const [selection, setSelection] = useState<JobSelection | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useDialogFocus(dialogRef, true, { initialFocusRef: cancelRef, onEscape: onCancel })

  return (
    <div
      class="fixed inset-0 z-30 flex items-center justify-center bg-scrim/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        class="mf-card mf-rise w-full max-w-md p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mf-queue-draft-title"
        aria-describedby="mf-queue-draft-description"
        tabIndex={-1}
      >
        <h2 id="mf-queue-draft-title" class="text-sm font-bold tracking-tight text-ink">
          Queue {items.length} search result{items.length === 1 ? '' : 's'}
        </h2>
        <p id="mf-queue-draft-description" class="mt-1 text-xs leading-relaxed text-slate-500">
          Pick one quality preset applied to every selected result, same as queuing a playlist.
        </p>
        <div class="mt-3">
          <ModeSelector
            formats={[]}
            durationSec={null}
            onSelection={setSelection}
            disabled={false}
          />
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            class="mf-focus-ring rounded-xl border border-line-strong px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-rose-500/60 hover:text-rose-300"
          >
            Cancel
          </button>
          <button
            onClick={() => selection && onConfirm(selection)}
            disabled={!selection || !selection.destDir}
            class="mf-focus-ring rounded-xl bg-gradient-to-r from-go-500 to-go-400 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-go-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Queue {items.length}
          </button>
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
  const [streamTab, setStreamTab] = useState<StreamTab>('streams')
  const [showNotice, setShowNotice] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [playlistConcurrency, setPlaylistConcurrency] = useState(3)
  const [paused, setPaused] = useState<{ config: JobConfig; queue: PausedQueueRun | null } | null>(
    null,
  )
  const [queueDraft, setQueueDraft] = useState<SearchResultItem[] | null>(null)
  const pausedRef = useRef(paused)
  const runCtxRef = useRef<{
    entries: QueueEntry[]
    selection: JobSelection
    playlistTitle?: string
    runMode: QueueRunMode
  } | null>(null)
  const scrollRef = useRef<HTMLElement>(null)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        setPlaylistConcurrency(s.playlistConcurrency)
        if (s.queueSnapshot && s.queueSnapshot.rows.length > 0) {
          queueRows.value = s.queueSnapshot.rows.map((r) => ({
            ...r,
            status:
              r.status === 'downloading' ? 'pending' : r.status === 'paused' ? 'pending' : r.status,
            jobId: undefined,
          }))
          queueRunMode.value = s.queueSnapshot.runMode
          if (s.queueSnapshot.selectionJson) {
            try {
              const sel = JSON.parse(s.queueSnapshot.selectionJson) as JobSelection
              setSelection(sel)
              runCtxRef.current = {
                entries: s.queueSnapshot.rows.map((r) => ({ url: r.url, title: r.title })),
                selection: sel,
                playlistTitle: s.queueSnapshot.playlistTitle,
                runMode: s.queueSnapshot.runMode,
              }
            } catch {
              /* ignore corrupt selection */
            }
          }
        }
      })
      .catch(() => undefined)
    window.mf
      .ping()
      .then(() => setBridgeNote('ipc ready'))
      .catch(() => setBridgeNote('ipc error'))

    const offEvent = window.mf.onJobEvent((event) => {
      applyJobEvent(event)
    })
    const offDone = window.mf.onJobDone((done) => {
      endJob(done)
      const row = queueRows.value.find((r) => r.jobId === done.jobId)
      if (row) patchQueueRow(row.url, { partialDir: done.partialDir })
      resolveJob(done.jobId, {
        status: done.status,
        outputPath: done.outputPath,
        outputBytes: done.outputBytes,
        skipped: done.skipped,
      })
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
        return
      }
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !typing) {
        event.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }
      if (event.key === 'Escape') {
        setShowShortcuts(false)
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

  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      const rows = queueRows.value
      const ctx = runCtxRef.current
      void window.mf.setSettings({
        queueSnapshot:
          rows.length === 0
            ? null
            : {
                rows: rows.map(({ url, title, status }) => ({
                  url,
                  title,
                  status: status === 'downloading' ? 'pending' : status,
                })),
                runMode: queueRunMode.value,
                selectionJson: ctx ? JSON.stringify(ctx.selection) : undefined,
                playlistTitle: ctx?.playlistTitle,
              },
      })
    }, 400)
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [queueRows.value, queueRunMode.value])

  const result = analysis.value
  const busy =
    Object.keys(activeJobsById.value).length > 0 || activeJob.value !== null || queueRunning.value

  useEffect(() => {
    const r = analysis.value
    setAdvancedPick(null)
    playlistHydration.value = null
    if (r?.kind === 'playlist') {
      setSelectedEntries(new Set((r.playlistEntries ?? []).map((e) => e.url)))
      setStreamTab('entries')
      scrollRef.current?.scrollTo({ top: 0 })
    } else {
      setStreamTab('preview')
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

  async function runSingleJob(config: JobConfig): Promise<JobResult> {
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
      return { status: 'failed' }
    }
    beginJob(config, response.jobId)
    // Every foreground download now has a queue row. Bind it as soon as the job exists so
    // Queue can use its exact event stream, cancellation target, and completion payload.
    if (queueRows.value.some((row) => row.url === config.url && row.status === 'downloading')) {
      patchQueueRow(config.url, { jobId: response.jobId })
    }
    const result = await waitForJob(response.jobId)
    if (result.status === 'failed') lastFailedConfig.value = config
    return result
  }

  async function runQueue(
    entries: QueueEntry[],
    sel: JobSelection,
    playlistTitle: string | undefined,
    fromIndex: number,
  ): Promise<void> {
    stopRequested.value = false
    queueRunning.value = true
    queueRunMode.value = 'sequential'
    if (fromIndex === 0) {
      queueRows.value = entries.map((e) => ({ url: e.url, title: e.title, status: 'pending' }))
    }
    try {
      for (let i = fromIndex; i < entries.length; i += 1) {
        if (stopRequested.value) break
        const config = configFor(entries[i].url, sel, entries[i].isLive ?? false, playlistTitle)
        lastJobEvent.value = null
        patchQueueRow(entries[i].url, { status: 'downloading' })
        let result: JobResult
        try {
          result = await runSingleJob(config)
        } catch {
          lastFailedConfig.value = config
          result = { status: 'failed' }
        }
        const { status } = result
        if (status === 'cancelled' && pausedRef.current !== null) {
          patchQueueRow(entries[i].url, { status: 'paused', jobId: undefined })
          break
        }
        patchQueueRow(entries[i].url, {
          status: status === 'completed' ? 'done' : status,
          jobId: undefined,
          outputPath: result.outputPath,
          outputBytes: result.outputBytes,
          skipped: result.skipped,
        })
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

  async function runParallelQueue(
    entries: QueueEntry[],
    sel: JobSelection,
    playlistTitle: string | undefined,
  ): Promise<void> {
    stopRequested.value = false
    queueRunning.value = true
    queueRunMode.value = 'parallel'
    queueRows.value = entries.map((e) => ({ url: e.url, title: e.title, status: 'pending' }))

    const concurrency = Math.max(2, Math.min(5, playlistConcurrency))
    let nextIndex = 0
    let inFlight = 0

    const launchNext = async (): Promise<void> => {
      while (!stopRequested.value && nextIndex < entries.length && inFlight < concurrency) {
        const i = nextIndex
        nextIndex += 1
        const entry = entries[i]
        const config = configFor(entry.url, sel, entry.isLive ?? false, playlistTitle)
        inFlight += 1
        patchQueueRow(entry.url, { status: 'downloading' })

        void (async () => {
          try {
            launchError.value = null
            let response: DownloadStartResponse
            try {
              response = await window.mf.downloadStart(config)
            } catch {
              response = { kind: 'error', code: 'MF_UNKNOWN', message: 'Unexpected IPC failure.' }
            }
            if (response.kind !== 'ok') {
              lastFailedConfig.value = config
              patchQueueRow(entry.url, { status: 'failed', jobId: undefined })
            } else {
              beginJob(config, response.jobId)
              patchQueueRow(entry.url, { jobId: response.jobId })
              const result = await waitForJob(response.jobId)
              if (result.status === 'failed') lastFailedConfig.value = config
              patchQueueRow(entry.url, {
                status: result.status === 'completed' ? 'done' : result.status,
                jobId: undefined,
                outputPath: result.outputPath,
                outputBytes: result.outputBytes,
                skipped: result.skipped,
              })
            }
          } catch {
            lastFailedConfig.value = config
            patchQueueRow(entry.url, { status: 'failed', jobId: undefined })
          } finally {
            inFlight -= 1
            if (!stopRequested.value) await launchNext()
          }
        })()
      }
    }

    try {
      await launchNext()
      while (inFlight > 0) {
        await new Promise((r) => setTimeout(r, 100))
      }
      if (stopRequested.value) {
        queueRows.value = queueRows.value.map((row) =>
          row.status === 'pending' ? { ...row, status: 'cancelled' } : row,
        )
      }
    } finally {
      queueRunning.value = false
    }
  }

  function openSearchResultInDownloader(item: SearchResultItem) {
    activeView.value = 'download'
    void triggerAnalyze(item.url)
  }

  async function launchQueueFromSearch(items: SearchResultItem[], sel: JobSelection) {
    if (busy) return
    if (!items.every(isSearchItemReadyToDownload)) return
    const entries = items.map((item) => ({ url: item.url, title: item.title }))
    setPaused(null)
    setQueueDraft(null)
    runCtxRef.current = { entries, selection: sel, playlistTitle: undefined, runMode: 'sequential' }
    activeView.value = 'queue'
    await runQueue(entries, sel, undefined, 0)
  }

  async function handleQuickDownloadFromSearch(item: SearchResultItem, preset: FormatPresetOption) {
    if (busy) return
    if (!isSearchItemReadyToDownload(item)) return
    const defaultDir = (await window.mf.getDefaultDestDir().catch(() => '')) || ''
    const sel: JobSelection = {
      mode: preset.mode,
      tier: preset.tier ?? 1080,
      container: preset.container ?? 'mp4',
      audioFormat: preset.audioFormat ?? 'mp3',
      bitrate: preset.bitrate ?? null,
      videoFormatId: '',
      audioFormatId: '',
      destDir: defaultDir,
      estimatedBytes: estimatePresetBytes(preset, item.durationSec ?? null),
    }
    await launchQueueFromSearch([item], sel)
  }

  async function startDownload(mode: QueueRunMode = 'sequential') {
    const r = analysis.value
    if (!r || !selection || Object.keys(activeJobsById.value).length > 0 || queueRunning.value) {
      return
    }

    if (r.kind === 'playlist') {
      const entries = hydratedEntries(r.playlistEntries ?? []).filter((e) =>
        selectedEntries.has(e.url),
      )
      if (entries.length === 0) return
      setPaused(null)
      runCtxRef.current = {
        entries,
        selection,
        playlistTitle: r.metadata.title,
        runMode: mode,
      }
      activeView.value = 'queue'
      if (mode === 'parallel') {
        await runParallelQueue(entries, selection, r.metadata.title)
      } else {
        await runQueue(entries, selection, r.metadata.title, 0)
      }
      if (analysis.value === r && !queueRunning.value) activeView.value = 'download'
      return
    }

    setPaused(null)
    const entry: QueueEntry = {
      url: r.metadata.webpageUrl ?? '',
      title: r.metadata.title,
      isLive: r.metadata.isLive,
    }
    runCtxRef.current = {
      entries: [entry],
      selection,
      runMode: 'sequential',
    }
    await runQueue([entry], selection, undefined, 0)
  }

  async function retryLastFailed() {
    const config = lastFailedConfig.value
    if (!config || busy || pausedRef.current !== null) return
    lastFailedConfig.value = null
    await runSingleJob(config)
  }

  async function retryQueueRow(url: string) {
    const ctx = runCtxRef.current
    const row = queueRows.value.find((r) => r.url === url)
    if (!ctx || !row || row.status !== 'failed' || queueRunning.value) return
    const config = configFor(url, ctx.selection, false, ctx.playlistTitle)
    patchQueueRow(url, { status: 'downloading', partialDir: undefined })
    queueRunning.value = true
    try {
      const result = await runSingleJob(config)
      patchQueueRow(url, {
        status: result.status === 'completed' ? 'done' : result.status,
        jobId: undefined,
        outputPath: result.outputPath,
        outputBytes: result.outputBytes,
        skipped: result.skipped,
      })
    } finally {
      queueRunning.value = false
    }
  }

  function stopAfterCurrent() {
    stopRequested.value = true
  }

  function cancelActive() {
    stopRequested.value = true
    const jobs = Object.values(activeJobsById.value)
    if (jobs.length === 0) {
      const job = activeJob.value
      if (job) void window.mf.downloadCancel(job.jobId)
      return
    }
    for (const job of jobs) {
      void window.mf.downloadCancel(job.jobId)
    }
  }

  function cancelQueueRow(url: string) {
    const row = queueRows.value.find((r) => r.url === url)
    if (!row?.jobId) return
    void window.mf.downloadCancel(row.jobId)
  }

  function pauseActive() {
    const job = activeJob.value
    if (!job || queueRunMode.value === 'parallel') return
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
          runMode: 'sequential',
        }
      : null
    if (p.queue) {
      void runQueue(p.queue.entries, p.queue.selection, p.queue.playlistTitle, p.queue.index)
    } else {
      void runSingleJob(p.config)
    }
  }

  function downloadAnother() {
    urlInput.value = ''
    resetAnalysis()
    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('mf:focus-url')))
  }

  const isPlaylist = result?.kind === 'playlist'
  const completedSingleDownload =
    !!result &&
    !isPlaylist &&
    jobDone.value?.status === 'completed' &&
    !queueRunning.value &&
    runCtxRef.current?.entries.length === 1
  const completedPlaylistDownload =
    !!result &&
    isPlaylist &&
    !queueRunning.value &&
    runCtxRef.current?.playlistTitle === result.metadata.title &&
    queueRows.value.length > 0 &&
    queueRows.value.every(
      (row) => row.status === 'done' || row.status === 'failed' || row.status === 'cancelled',
    )
  const completedDownload = completedSingleDownload || completedPlaylistDownload
  const playlistTotal = isPlaylist ? (result?.playlistEntries ?? []).length : 0
  const playlistSelected = isPlaylist
    ? (result?.playlistEntries ?? []).filter((e) => selectedEntries.has(e.url)).length
    : 0

  const playlistSummary = (() => {
    if (!isPlaylist || result?.kind !== 'playlist' || !selection) return null
    const chosen = hydratedEntries(result.playlistEntries ?? []).filter((e) =>
      selectedEntries.has(e.url),
    )
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
  const isSearchDefault =
    activeView.value === 'search' &&
    lastSearchedQuery.value === null &&
    searchResults.value.length === 0 &&
    !searching.value &&
    searchError.value === null

  return (
    <div
      class={`flex h-full flex-col ${activeView.value === 'search' ? 'mf-search-active' : ''} ${
        isSearchDefault ? 'mf-search-default' : ''
      }`}
    >
      <TitleBar />

      <div class="flex min-h-0 min-w-0 flex-1">
        <NavRail
          onShowNotice={() => setShowNotice(true)}
          onShowShortcuts={() => setShowShortcuts(true)}
        />

        {activeView.value === 'settings' ? (
          <main class="mf-settings-workspace mf-rise min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-3 pt-3.5">
            <SettingsScreen />
          </main>
        ) : activeView.value === 'help' ? (
          <HelpScreen onShowShortcuts={() => setShowShortcuts(true)} />
        ) : activeView.value === 'search' ? (
          <main
            class={`mf-search-workspace mf-rise flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-4 pb-3 pt-3.5 ${
              isSearchDefault ? 'mf-search-default-workspace' : ''
            }`}
          >
            <SearchScreen
              onOpenInDownloader={openSearchResultInDownloader}
              onAddToQueue={(items) => setQueueDraft(items)}
              onQuickDownload={(item, preset) => void handleQuickDownloadFromSearch(item, preset)}
              busy={busy}
            />
          </main>
        ) : activeView.value === 'share' ? (
          <LocalShareScreen />
        ) : activeView.value === 'queue' ? (
          <main
            class={`mf-queue-workspace mf-rise flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-4 pb-3 pt-3.5 ${
              queueRows.value.length === 0 ? 'mf-queue-idle' : 'overflow-y-auto'
            }`}
          >
            <div class="mf-digital-only mf-workspace-heading">
              <div>
                <p class="mf-workspace-kicker">BATCH ORCHESTRATION</p>
                <h2>
                  {queueRows.value.length === 0 ? (
                    <>
                      Download Queue<span>.</span>
                    </>
                  ) : (
                    <>
                      Active Pipeline<span>.</span>
                    </>
                  )}
                </h2>
              </div>
              <div class="flex items-center gap-2">
                <span class="mf-workspace-hint">
                  {queueRows.value.length === 0
                    ? 'Sequential · Parallel Concurrency · Auto-Resume'
                    : queueRunning.value
                      ? queueRunMode.value === 'parallel'
                        ? 'Parallel Execution Active'
                        : 'Sequential Download In Progress'
                      : 'Queue Settled'}
                </span>
                <PageHelpNote
                  title="How to use the Queue"
                  summary="Build a batch in Downloader or Search, then track every item here."
                  steps={[
                    'Add a playlist from Downloader or select multiple Search results.',
                    'Choose sequential for one-at-a-time work or parallel for faster batches.',
                    'Use each row to follow progress or retry a failed item.',
                  ]}
                />
              </div>
            </div>
            <QueueList
              onStopAfterCurrent={
                queueRunMode.value === 'sequential' ? stopAfterCurrent : undefined
              }
              onCancelAll={cancelActive}
              onCancelRow={queueRunMode.value === 'parallel' ? cancelQueueRow : undefined}
              onRetryRow={retryQueueRow}
              onJumpToDownloader={() => {
                activeView.value = 'download'
                window.dispatchEvent(new CustomEvent('mf:focus-url'))
              }}
              onJumpToSearch={() => {
                activeView.value = 'search'
                window.dispatchEvent(new CustomEvent('mf:focus-search'))
              }}
            />
          </main>
        ) : (
          <main
            ref={scrollRef}
            class={`mf-download-workspace flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-4 pb-3 pt-3.5 ${!analyzing.value && !result ? 'mf-download-idle' : ''} ${analyzing.value || busy ? 'mf-workspace-processing' : ''}`}
          >
            {!completedDownload && !analyzing.value && !result && (
              <div class="mf-digital-only mf-workspace-heading">
                <div>
                  <p class="mf-workspace-kicker">DOWNLOADER</p>
                  <h2>
                    Your media workspace<span>.</span>
                  </h2>
                </div>
                <div class="flex items-center gap-2">
                  <span class="mf-workspace-hint">Video · Audio · Playlists</span>
                  <DownloaderHelp />
                </div>
              </div>
            )}
            {!completedDownload && <UrlBar />}

            {completedPlaylistDownload ? (
              <PlaylistDownloadSummary
                result={result!}
                rows={queueRows.value}
                modeLabel={playlistSummary?.modeLabel ?? 'Selected format'}
                onDownloadAnother={downloadAnother}
                onReviewQueue={() => {
                  activeView.value = 'queue'
                }}
              />
            ) : completedSingleDownload ? (
              <DownloadCompleteSummary
                result={result!}
                done={jobDone.value!}
                selection={selection}
                onDownloadAnother={downloadAnother}
              />
            ) : !analyzing.value && !result ? (
              <HeroState />
            ) : analyzing.value && !result ? (
              <div class="min-h-0 flex-1">
                <LoadingSkeleton />
              </div>
            ) : (
              <div class="mf-main-grid grid min-h-0 flex-1 items-stretch gap-3 overflow-hidden">
                <section class="flex min-h-0 flex-col gap-2.5">
                  {isPlaylist ? (
                    <PlaylistBanner result={result!} hydration={playlistHydration.value} />
                  ) : (
                    <VideoBanner
                      result={result!}
                      onOpenPreviewTab={() => setStreamTab('preview')}
                      isPreviewActive={streamTab === 'preview'}
                    />
                  )}

                  {(() => {
                    const tabs: Array<{ id: StreamTab; label: string }> = isPlaylist
                      ? [
                          { id: 'entries', label: `Entries (${playlistTotal})` },
                          { id: 'streams', label: `Streams (${result!.formats.length})` },
                          { id: 'details', label: 'Details' },
                        ]
                      : [
                          { id: 'preview', label: 'Preview' },
                          { id: 'streams', label: `Streams (${result!.formats.length})` },
                          { id: 'details', label: 'Details' },
                        ]
                    return (
                      <div
                        role="tablist"
                        aria-label="Analysis sections"
                        class="flex shrink-0 gap-1 rounded-xl border border-line bg-recess p-1"
                      >
                        {tabs.map(({ id, label }) => (
                          <button
                            key={id}
                            id={`analysis-tab-${id}`}
                            role="tab"
                            aria-selected={streamTab === id}
                            aria-controls="analysis-panel"
                            tabIndex={streamTab === id ? 0 : -1}
                            onClick={() => setStreamTab(id)}
                            onKeyDown={(event) => {
                              const currentIndex = tabs.findIndex((tab) => tab.id === id)
                              let nextIndex: number | null = null
                              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                                nextIndex = (currentIndex + 1) % tabs.length
                              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                                nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
                              } else if (event.key === 'Home') {
                                nextIndex = 0
                              } else if (event.key === 'End') {
                                nextIndex = tabs.length - 1
                              }
                              if (nextIndex === null) return
                              event.preventDefault()
                              const nextId = tabs[nextIndex].id
                              setStreamTab(nextId)
                              requestAnimationFrame(() =>
                                document.getElementById(`analysis-tab-${nextId}`)?.focus(),
                              )
                            }}
                            class={`mf-focus-ring flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 ${
                              streamTab === id
                                ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-go-500/25'
                                : 'text-slate-400 hover:bg-wash-2 hover:text-ink'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )
                  })()}

                  <div
                    id="analysis-panel"
                    class="mf-analysis-panel flex min-h-0 flex-1 flex-col"
                    role="tabpanel"
                    aria-labelledby={`analysis-tab-${streamTab}`}
                    tabIndex={0}
                  >
                    {streamTab === 'preview' && !isPlaylist && <VideoPreviewTab result={result!} />}
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
                          onClick={
                            isPlaylist && queueRunMode.value === 'sequential'
                              ? stopAfterCurrent
                              : cancelActive
                          }
                          class="mf-action-button mf-focus-ring mt-2 w-full shrink-0 rounded-xl bg-gradient-to-br from-rose-600 to-rose-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:brightness-110 active:scale-[0.98]"
                        >
                          {isPlaylist
                            ? queueRunMode.value === 'parallel'
                              ? 'Cancel All'
                              : 'Stop After Current'
                            : 'Cancel Download'}
                        </button>
                      ) : isPlaylist ? (
                        <div class="mt-2 flex w-full shrink-0 flex-col gap-2">
                          <button
                            onClick={() => void startDownload('sequential')}
                            disabled={!canStart}
                            className={`mf-focus-ring w-full rounded-xl border border-line-strong px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-sky-500/50 hover:text-ink active:scale-[0.98] ${
                              canStart ? '' : 'cursor-not-allowed opacity-40'
                            }`}
                          >
                            {playlistSelected === playlistTotal
                              ? `Download Sequentially · ${playlistTotal}`
                              : `Download Sequentially · ${playlistSelected}`}
                          </button>
                          <button
                            onClick={() => void startDownload('parallel')}
                            disabled={!canStart}
                            className={`mf-action-button mf-focus-ring w-full rounded-xl bg-gradient-to-r from-go-500 to-go-400 px-5 py-3 text-sm font-bold text-white shadow-xl shadow-go-500/30 transition-[background-color,box-shadow,filter,opacity,transform] duration-150 hover:brightness-110 hover:shadow-go-400/40 active:scale-[0.98] ${
                              canStart ? '' : 'cursor-not-allowed opacity-40 shadow-none'
                            }`}
                          >
                            {playlistSelected === playlistTotal
                              ? `Download in Parallel · ${playlistTotal}`
                              : `Download in Parallel · ${playlistSelected}`}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => void startDownload()}
                          disabled={!canStart}
                          className={`mf-action-button mf-focus-ring mt-2 w-full shrink-0 rounded-xl bg-gradient-to-r from-go-500 to-go-400 px-5 py-3 text-sm font-bold text-white shadow-xl shadow-go-500/30 transition-[background-color,box-shadow,filter,opacity,transform] duration-150 hover:brightness-110 hover:shadow-go-400/40 active:scale-[0.98] ${
                            canStart ? '' : 'cursor-not-allowed opacity-40 shadow-none'
                          }`}
                        >
                          Start Download
                        </button>
                      )}
                    </div>
                  )}
                </aside>
              </div>
            )}

            {!completedDownload && !isPlaylist && (
              <PipelineStatus
                onRetry={() => void retryLastFailed()}
                onCancel={cancelActive}
                onPause={pauseActive}
                paused={paused !== null}
                onResume={resumePaused}
              />
            )}
          </main>
        )}
      </div>

      {logDockOpen.value && (
        <section class="mf-log-dock flex shrink-0 flex-col">
          <LogConsole dock />
        </section>
      )}

      <FirstRunModal
        open={showNotice}
        onDismiss={() => {
          setShowNotice(false)
          void window.mf.markFirstRunSeen()
        }}
      />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {queueDraft && (
        <QueueDraftModal
          items={queueDraft}
          onCancel={() => setQueueDraft(null)}
          onConfirm={(sel) => void launchQueueFromSearch(queueDraft, sel)}
        />
      )}

      <FloatingDownloadBadge />

      <footer class="mf-app-footer flex shrink-0 items-center justify-between gap-4 border-t border-line bg-ink-950 px-3 py-1.5 text-xs text-slate-500 sm:px-4">
        <EnginesStatus />
        <span class="mf-footer-actions flex shrink-0 items-center gap-2">
          <span class="hidden text-slate-600 md:inline">Local-only processing</span>
          <span aria-hidden="true" class="hidden text-slate-700 md:inline">
            •
          </span>
          <button
            onClick={toggleLogDock}
            title="Toggle live console (Ctrl+`)"
            aria-pressed={logDockOpen.value}
            className={`mf-focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition ${
              logDockOpen.value
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'hover:bg-wash-2 hover:text-slate-200'
            }`}
          >
            <TerminalIcon class="size-3.5" />
            Console
          </button>
          <span
            class="mf-num rounded-full border border-line bg-wash-1 px-2 py-0.5 text-[11px] text-slate-500"
            role="status"
            title={bridgeNote}
          >
            {bridgeNote === 'ipc ready' ? 'System ready' : bridgeNote}
          </span>
        </span>
      </footer>
    </div>
  )
}
