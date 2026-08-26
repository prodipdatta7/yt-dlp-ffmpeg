import { useEffect, useState } from 'preact/hooks'
import { setThemePref, themePref, type ThemePref } from '../signals/uiState'
import { DriverUpdateCard } from './DriverUpdateCard'
import { CookieIcon, DocIcon, FolderIcon, InfoIcon, PaletteIcon, ShieldIcon } from './icons'
import { Pill } from './ui'

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
        <span class="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-sky-300 shadow-inner">
          {icon}
        </span>
        <div>
          <h3 class="text-sm font-semibold text-white">{title}</h3>
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
const btnGhost = `${btn} border border-white/[0.1] text-slate-300 hover:border-sky-500/60 hover:text-white`

export function SettingsScreen() {
  const [settings, setSettings] = useState<{
    lastOutputDir: string
    cookieFileSet: boolean
    theme: ThemePref
  } | null>(null)

  useEffect(() => {
    window.mf
      .getSettings()
      .then(setSettings)
      .catch(() => undefined)
  }, [])

  async function chooseTheme(pref: ThemePref) {
    setThemePref(pref)
    setSettings((prev) => (prev ? { ...prev, theme: pref } : prev))
    try {
      const saved = await window.mf.setSettings({ theme: pref })
      setSettings(saved)
    } catch {
      return
    }
  }

  async function browse() {
    const dir = await window.mf.chooseDestDir()
    if (dir) setSettings((prev) => (prev ? { ...prev, lastOutputDir: dir } : prev))
  }

  return (
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight text-white">Settings</h2>
        <Pill tone="sky">MediaForge v0.1.1</Pill>
      </header>

      <Section
        icon={<PaletteIcon class="size-4.5" />}
        title="Appearance"
        description="Pick a theme — System follows your Windows color scheme."
      >
        <div class="inline-flex rounded-xl border border-white/[0.08] bg-black/20 p-1">
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
                  : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
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
              class="w-full rounded-lg border border-white/[0.08] bg-black/30 py-2 pl-9 pr-3 text-sm text-slate-300"
            />
          </div>
          <button onClick={() => void browse()} className={btnGhost}>
            Browse…
          </button>
        </div>
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
        <p class="mt-3 flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs leading-relaxed text-slate-500">
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
        <h3 class="text-sm font-semibold text-white">Core drivers</h3>
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
