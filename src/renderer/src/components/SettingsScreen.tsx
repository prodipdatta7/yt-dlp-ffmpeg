import { useEffect, useState } from 'preact/hooks'
import { setThemePref, themePref, type ThemePref } from '../signals/uiState'
import { fmtSize } from '../utils/format'
import { DriverUpdateCard } from './DriverUpdateCard'
import {
  CookieIcon,
  DocIcon,
  DownloadIcon,
  FolderIcon,
  HardDriveIcon,
  InfoIcon,
  PaletteIcon,
  ShieldIcon,
} from './icons'
import { Pill } from './ui'
import type { PartialDirInfo } from '../../../shared/ipcContract'

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: preact.JSX.Element
  title: string
  description?: string
  children: preact.ComponentChildren
}) {
  return (
    <section class="mf-card mf-card-hover p-5">
      <div class="mb-4 flex items-start gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-wash-1 text-sky-300 shadow-inner">
          {icon}
        </span>
        <div>
          <h3 class="text-sm font-semibold text-ink">{title}</h3>
          {description && (
            <p class="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

const btn =
  'mf-focus-ring rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnPrimary = `${btn} bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/20 hover:brightness-110`
const btnGhost = `${btn} border border-line-strong text-slate-300 hover:border-sky-500/60 hover:text-ink`

export function SettingsScreen() {
  const [settings, setSettings] = useState<{
    lastOutputDir: string
    cookieFileSet: boolean
    theme: ThemePref
    playlistConcurrency: number
    notifyOnComplete: boolean
  } | null>(null)

  const [partials, setPartials] = useState<PartialDirInfo[] | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingPath, setClearingPath] = useState<string | null>(null)

  function refreshPartials() {
    window.mf
      .listPartials()
      .then((res) => setPartials(res.items))
      .catch(() => setPartials([]))
  }

  useEffect(() => {
    window.mf
      .getSettings()
      .then((s) =>
        setSettings({
          lastOutputDir: s.lastOutputDir,
          cookieFileSet: s.cookieFileSet,
          theme: s.theme,
          playlistConcurrency: s.playlistConcurrency,
          notifyOnComplete: s.notifyOnComplete,
        }),
      )
      .catch(() => undefined)
    refreshPartials()
  }, [])

  async function clearOnePartial(path: string) {
    setClearingPath(path)
    try {
      await window.mf.clearPartials(path)
      refreshPartials()
    } finally {
      setClearingPath(null)
    }
  }

  async function clearAllPartials() {
    setClearingAll(true)
    try {
      await window.mf.clearPartials()
      refreshPartials()
    } finally {
      setClearingAll(false)
    }
  }

  async function chooseTheme(pref: ThemePref) {
    setThemePref(pref)
    setSettings((prev) => (prev ? { ...prev, theme: pref } : prev))
    try {
      const saved = await window.mf.setSettings({ theme: pref })
      setSettings({
        lastOutputDir: saved.lastOutputDir,
        cookieFileSet: saved.cookieFileSet,
        theme: saved.theme,
        playlistConcurrency: saved.playlistConcurrency,
        notifyOnComplete: saved.notifyOnComplete,
      })
    } catch {
      return
    }
  }

  async function browse() {
    const dir = await window.mf.chooseDestDir()
    if (dir) setSettings((prev) => (prev ? { ...prev, lastOutputDir: dir } : prev))
  }

  async function setConcurrency(next: number) {
    const clamped = Math.min(5, Math.max(2, next))
    setSettings((prev) => (prev ? { ...prev, playlistConcurrency: clamped } : prev))
    try {
      const saved = await window.mf.setSettings({ playlistConcurrency: clamped })
      setSettings((prev) =>
        prev ? { ...prev, playlistConcurrency: saved.playlistConcurrency } : prev,
      )
    } catch {
      return
    }
  }

  async function setNotify(on: boolean) {
    setSettings((prev) => (prev ? { ...prev, notifyOnComplete: on } : prev))
    try {
      const saved = await window.mf.setSettings({ notifyOnComplete: on })
      setSettings((prev) => (prev ? { ...prev, notifyOnComplete: saved.notifyOnComplete } : prev))
    } catch {
      return
    }
  }

  return (
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight text-ink">Settings</h2>
        <Pill tone="sky">MediaForge v0.1.1</Pill>
      </header>

      <Section
        icon={<PaletteIcon class="size-4.5" />}
        title="Appearance"
        description="Pick a theme — System follows your Windows color scheme."
      >
        <div class="inline-flex rounded-xl border border-line bg-recess p-1">
          {(
            [
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ] as Array<[ThemePref, string]>
          ).map(([pref, label]) => (
            <button
              key={pref}
              onClick={() => void chooseTheme(pref)}
              aria-pressed={themePref.value === pref}
              className={`mf-focus-ring rounded-lg px-4 py-1.5 text-xs font-semibold transition-all duration-150 ${
                themePref.value === pref
                  ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/25'
                  : 'text-slate-400 hover:bg-wash-2 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section
        icon={<FolderIcon class="size-4.5" />}
        title="Output destination"
        description="Where completed downloads are saved by default."
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <FolderIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
            <input
              readOnly
              value={settings?.lastOutputDir || 'OS Downloads folder'}
              class="w-full rounded-lg border border-line bg-recess py-2 pl-9 pr-3 text-sm text-slate-300"
            />
          </div>
          <button onClick={() => void browse()} className={btnGhost}>
            Browse…
          </button>
        </div>
      </Section>

      <Section
        icon={<DownloadIcon class="size-4.5" />}
        title="Downloads"
        description="Parallel playlist concurrency and desktop notifications when a job finishes in the background."
      >
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-slate-200">Parallel downloads</p>
              <p class="mt-0.5 text-xs text-slate-500">
                How many playlist entries run at once (2–5).
              </p>
            </div>
            <div class="inline-flex items-center gap-1 rounded-xl border border-line bg-recess p-1">
              <button
                type="button"
                aria-label="Decrease concurrency"
                disabled={(settings?.playlistConcurrency ?? 3) <= 2}
                onClick={() => void setConcurrency((settings?.playlistConcurrency ?? 3) - 1)}
                class={`${btnGhost} !px-2.5 !py-1`}
              >
                −
              </button>
              <span class="mf-num min-w-8 text-center text-sm font-semibold text-ink">
                {settings?.playlistConcurrency ?? 3}
              </span>
              <button
                type="button"
                aria-label="Increase concurrency"
                disabled={(settings?.playlistConcurrency ?? 3) >= 5}
                onClick={() => void setConcurrency((settings?.playlistConcurrency ?? 3) + 1)}
                class={`${btnGhost} !px-2.5 !py-1`}
              >
                +
              </button>
            </div>
          </div>
          <label class="flex cursor-pointer items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-slate-200">Notify when finished</p>
              <p class="mt-0.5 text-xs text-slate-500">
                OS notification if the window is unfocused or minimized.
              </p>
            </div>
            <input
              type="checkbox"
              class="size-4 accent-sky-500"
              checked={settings?.notifyOnComplete !== false}
              onChange={(e) => void setNotify((e.target as HTMLInputElement).checked)}
            />
          </label>
        </div>
      </Section>

      <Section
        icon={<HardDriveIcon class="size-4.5" />}
        title="Storage"
        description="Partially downloaded files left behind by cancelled or failed jobs. They aren't deleted automatically."
      >
        {partials === null ? (
          <p class="text-sm text-slate-500">Checking for leftover files…</p>
        ) : partials.length === 0 ? (
          <p class="text-sm text-slate-500">No partial downloads left on disk.</p>
        ) : (
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-slate-500">
                {partials.length} left-over {partials.length === 1 ? 'folder' : 'folders'} ·{' '}
                {fmtSize(partials.reduce((sum, p) => sum + p.bytes, 0))}
              </p>
              <button
                type="button"
                disabled={clearingAll}
                onClick={() => void clearAllPartials()}
                className={`${btn} border border-rose-500/40 text-rose-300 hover:bg-rose-500/10`}
              >
                {clearingAll ? 'Clearing…' : 'Clear all'}
              </button>
            </div>
            <ul class="flex flex-col gap-2">
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
                      {fmtSize(item.bytes)} · {item.fileCount}{' '}
                      {item.fileCount === 1 ? 'file' : 'files'} ·{' '}
                      {new Date(item.mtimeMs).toLocaleString()}
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
                      onClick={() => void clearOnePartial(item.path)}
                      class="mf-focus-ring rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                    >
                      {clearingPath === item.path ? 'clearing…' : 'clear'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        icon={<CookieIcon class="size-4.5" />}
        title="Cookies"
        description="Some sites only let you in when you're logged in. This is optional for normal public videos — you only need it for age-gated, region-locked, members-only, age-confirmed, or bot-checked content."
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-slate-300">
            {settings?.cookieFileSet ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                cookies.txt imported
              </span>
            ) : (
              <span className="text-slate-500">not configured</span>
            )}
          </span>
          {!settings?.cookieFileSet && (
            <button
              onClick={() =>
                void window.mf.importCookies().then(() => window.mf.getSettings().then(setSettings))
              }
              className={btnPrimary}
            >
              Import cookies.txt…
            </button>
          )}
          {settings?.cookieFileSet && (
            <button
              onClick={() =>
                void window.mf.clearCookies().then(() => window.mf.getSettings().then(setSettings))
              }
              className={`${btn} border border-rose-500/40 text-rose-300 hover:bg-rose-500/10`}
            >
              Clear stored cookies
            </button>
          )}
        </div>
        <p class="mt-3 flex items-start gap-2 rounded-lg border border-line bg-recess p-3 text-xs leading-relaxed text-slate-500">
          <InfoIcon class="mt-0.5 size-3.5 shrink-0 text-slate-600" />
          <span>
            <span class="font-medium text-slate-400">Why:</span> a site blocks the download until it
            recognises a signed-in account. <span class="font-medium text-slate-400">How:</span> use
            a browser extension that exports <span class="mf-num">cookies.txt</span> (Netscape
            format), then import it here. The file is copied into your private user-data folder,
            read <em>locally</em> by the engine, and never uploaded, logged, or shared — clear it
            anytime to remove it.
          </span>
        </p>
      </Section>

      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">Core drivers</h3>
        <span class="text-[11px] text-slate-600">
          checksum-verified · atomic swap · auto rollback
        </span>
      </div>

      <DriverUpdateCard
        kind="yt-dlp"
        title="yt-dlp"
        description="Extracts media info and downloads streams. Platforms change constantly, so this can go stale. Updates come from official yt-dlp releases and are SHA-256 verified before an atomic swap; failed swaps roll back automatically."
        sourceLabel="official yt-dlp GitHub releases"
      />

      <DriverUpdateCard
        kind="ffmpeg"
        title="FFmpeg"
        description="Muxes and transcodes the downloaded streams. Updates come from BtbN's LGPL Windows builds, verified the same way. The archive is tens of MB, so this can take a moment."
        sourceLabel="BtbN FFmpeg-Builds (LGPL)"
      />

      <Section
        icon={<DocIcon class="size-4.5" />}
        title="Diagnostics"
        description="Structured logs live in your user-data folder; they redact URLs and cookies automatically."
      >
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => void window.mf.openLogsFolder()} className={btnGhost}>
            Open logs folder
          </button>
          <span class="flex items-center gap-1.5 text-xs text-slate-600">
            <ShieldIcon class="size-3.5" />
            no telemetry · no analytics
          </span>
        </div>
      </Section>
    </div>
  )
}
