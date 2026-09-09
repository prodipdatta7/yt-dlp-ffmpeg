import { useEffect, useState } from 'preact/hooks'
import { setThemePref, themePref, type ThemePref } from '../signals/uiState'
import { licenseState, setLicenseState } from '../signals/licenseState'
import {
  FREE_MAX_PLAYLIST_BATCH,
  FREE_MAX_RESOLUTION_TIER,
  PRO_PURCHASE_URL,
} from '../../../shared/entitlements'
import { DriverUpdateCard } from './DriverUpdateCard'
import {
  CheckIcon,
  CookieIcon,
  DocIcon,
  FolderIcon,
  InfoIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ShieldIcon,
  SparkleIcon,
  SunIcon,
} from './icons'
import { Pill } from './ui'

type CategoryId = 'general' | 'appearance' | 'privacy' | 'drivers' | 'diagnostics' | 'license'

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

function ThemeSwatch({ pref }: { pref: ThemePref }) {
  if (pref === 'light') {
    return (
      <span class="flex h-14 w-full flex-col gap-1 rounded-lg border border-black/10 bg-[#fdf8f0] p-2 shadow-inner">
        <span class="h-1.5 w-2/3 rounded-full bg-[#e2551f]/70" />
        <span class="h-1.5 w-1/2 rounded-full bg-[#d6cbb8]" />
        <span class="mt-auto h-1.5 w-full rounded-full bg-[#efe6d6]" />
      </span>
    )
  }
  if (pref === 'dark') {
    return (
      <span class="flex h-14 w-full flex-col gap-1 rounded-lg border border-white/10 bg-[#1c1611] p-2 shadow-inner">
        <span class="h-1.5 w-2/3 rounded-full bg-[#fb923c]/80" />
        <span class="h-1.5 w-1/2 rounded-full bg-[#463a2e]" />
        <span class="mt-auto h-1.5 w-full rounded-full bg-[#251d15]" />
      </span>
    )
  }
  return (
    <span class="flex h-14 w-full overflow-hidden rounded-lg border border-white/10 shadow-inner">
      <span class="flex h-full w-1/2 flex-col gap-1 bg-[#fdf8f0] p-2">
        <span class="h-1.5 w-full rounded-full bg-[#e2551f]/70" />
        <span class="mt-auto h-1.5 w-full rounded-full bg-[#efe6d6]" />
      </span>
      <span class="flex h-full w-1/2 flex-col gap-1 bg-[#1c1611] p-2">
        <span class="h-1.5 w-full rounded-full bg-[#fb923c]/80" />
        <span class="mt-auto h-1.5 w-full rounded-full bg-[#251d15]" />
      </span>
    </span>
  )
}

const THEME_OPTIONS: Array<{ pref: ThemePref; label: string; Icon: typeof SunIcon }> = [
  { pref: 'system', label: 'System', Icon: MonitorIcon },
  { pref: 'light', label: 'Light', Icon: SunIcon },
  { pref: 'dark', label: 'Dark', Icon: MoonIcon },
]

function ThemeOption({
  pref,
  label,
  Icon,
  active,
  onClick,
}: {
  pref: ThemePref
  label: string
  Icon: typeof SunIcon
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      class={`mf-focus-ring flex flex-col gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-150 ${
        active
          ? 'border-sky-400/60 bg-sky-500/[0.07] shadow-[0_0_0_1px_var(--mf-glow)]'
          : 'border-white/[0.08] bg-white/[0.02] hover:border-white/25'
      }`}
    >
      <ThemeSwatch pref={pref} />
      <span class="flex items-center justify-between px-0.5">
        <span
          class={`flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-sky-200' : 'text-slate-300'}`}
        >
          <Icon class="size-3.5" />
          {label}
        </span>
        {active && <CheckIcon class="size-3.5 text-sky-400" />}
      </span>
    </button>
  )
}

const CATEGORIES: Array<{ id: CategoryId; label: string; icon: preact.JSX.Element }> = [
  { id: 'general', label: 'General', icon: <FolderIcon class="size-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon class="size-4" /> },
  { id: 'privacy', label: 'Cookies & Privacy', icon: <CookieIcon class="size-4" /> },
  { id: 'drivers', label: 'Core Drivers', icon: <ShieldIcon class="size-4" /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <DocIcon class="size-4" /> },
  { id: 'license', label: 'License', icon: <SparkleIcon class="size-4" /> },
]

function CategoryButton({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean
  icon: preact.JSX.Element
  label: string
  badge?: preact.ComponentChildren
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      class={`mf-focus-ring group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-all duration-150 ${
        active
          ? 'bg-gradient-to-br from-sky-500/15 to-indigo-500/10 text-sky-300'
          : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
      }`}
    >
      {active && (
        <span class="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-sky-400 to-indigo-400" />
      )}
      <span
        class={`flex size-7 shrink-0 items-center justify-center ${active ? 'text-sky-300' : 'text-slate-500 group-hover:text-slate-300'}`}
      >
        {icon}
      </span>
      <span class="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </button>
  )
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<{
    lastOutputDir: string
    cookieFileSet: boolean
    theme: ThemePref
  } | null>(null)
  const [category, setCategory] = useState<CategoryId>('general')

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

  const [licenseKeyInput, setLicenseKeyInput] = useState('')
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [licenseBusy, setLicenseBusy] = useState(false)

  async function activate() {
    if (!licenseKeyInput.trim()) return
    setLicenseBusy(true)
    setLicenseError(null)
    try {
      const result = await window.mf.activateLicense(licenseKeyInput.trim())
      if (result.ok) {
        setLicenseState(result.state)
        setLicenseKeyInput('')
      } else {
        setLicenseError(result.error ?? 'That license key is not valid.')
      }
    } catch {
      setLicenseError('Could not reach the app to activate this key.')
    } finally {
      setLicenseBusy(false)
    }
  }

  async function deactivate() {
    setLicenseBusy(true)
    try {
      setLicenseState(await window.mf.deactivateLicense())
    } finally {
      setLicenseBusy(false)
    }
  }

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold tracking-tight text-white">Settings</h2>
          <p class="mt-0.5 text-xs text-slate-500">Configure MediaForge to match your workflow.</p>
        </div>
        <Pill tone="sky">MediaForge v0.1.1</Pill>
      </header>

      <div class="flex flex-1 items-start gap-5">
        <nav class="mf-card flex w-52 shrink-0 flex-col gap-1 p-2">
          {CATEGORIES.map(({ id, label, icon }) => (
            <CategoryButton
              key={id}
              active={category === id}
              icon={icon}
              label={label}
              onClick={() => setCategory(id)}
              badge={
                id === 'privacy' && settings?.cookieFileSet ? (
                  <span class="size-1.5 shrink-0 rounded-full bg-emerald-400" />
                ) : id === 'license' && licenseState.value.tier === 'pro' ? (
                  <span class="mf-num rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[9px] font-bold text-amber-300">
                    PRO
                  </span>
                ) : undefined
              }
            />
          ))}
        </nav>

        <div class="flex min-w-0 flex-1 flex-col gap-5">
          {category === 'general' && (
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
          )}

          {category === 'appearance' && (
            <Section
              icon={<PaletteIcon class="size-4.5" />}
              title="Appearance"
              description="Pick a theme — System follows your Windows color scheme."
            >
              <div class="grid grid-cols-3 gap-2.5">
                {THEME_OPTIONS.map(({ pref, label, Icon }) => (
                  <ThemeOption
                    key={pref}
                    pref={pref}
                    label={label}
                    Icon={Icon}
                    active={themePref.value === pref}
                    onClick={() => void chooseTheme(pref)}
                  />
                ))}
              </div>
            </Section>
          )}

          {category === 'privacy' && (
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
                      void window.mf
                        .importCookies()
                        .then(() => window.mf.getSettings().then(setSettings))
                    }
                    className={btnPrimary}
                  >
                    Import cookies.txt…
                  </button>
                )}
                {settings?.cookieFileSet && (
                  <button
                    onClick={() =>
                      void window.mf
                        .clearCookies()
                        .then(() => window.mf.getSettings().then(setSettings))
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
                  <span class="font-medium text-slate-400">Why:</span> a site blocks the download
                  until it recognises a signed-in account.{' '}
                  <span class="font-medium text-slate-400">How:</span> use a browser extension that
                  exports <span class="mf-num">cookies.txt</span> (Netscape format), then import it
                  here. The file is copied into your private user-data folder, read <em>locally</em>{' '}
                  by the engine, and never uploaded, logged, or shared — clear it anytime to remove
                  it.
                </span>
              </p>
            </Section>
          )}

          {category === 'drivers' && (
            <>
              <div class="flex items-center justify-between px-1">
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
            </>
          )}

          {category === 'diagnostics' && (
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
          )}

          {category === 'license' && (
            <Section
              icon={<SparkleIcon class="size-4.5" />}
              title="License"
              description={
                licenseState.value.tier === 'pro'
                  ? 'MediaForge Pro is active on this device.'
                  : 'Free forever for single downloads — Pro removes the limits below.'
              }
            >
              <div class="flex items-center justify-between gap-3">
                {licenseState.value.tier === 'pro' ? (
                  <>
                    <span class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-300">
                      <SparkleIcon class="size-3.5" />
                      Activated{licenseState.value.email ? ` for ${licenseState.value.email}` : ''}
                    </span>
                    <button
                      onClick={() => void deactivate()}
                      disabled={licenseBusy}
                      className={`${btn} border border-white/[0.1] text-slate-300 hover:border-rose-500/40 hover:text-rose-300`}
                    >
                      Deactivate
                    </button>
                  </>
                ) : (
                  <Pill tone="neutral">Free</Pill>
                )}
              </div>

              {licenseState.value.tier === 'free' && (
                <>
                  <ul class="mt-3 flex flex-col gap-1.5 text-xs text-slate-400">
                    <li class="flex items-center gap-2">
                      <SparkleIcon class="size-3 shrink-0 text-amber-400" />
                      Resolutions above {FREE_MAX_RESOLUTION_TIER}p (up to 8K)
                    </li>
                    <li class="flex items-center gap-2">
                      <SparkleIcon class="size-3 shrink-0 text-amber-400" />
                      Unlimited playlist batches (free plan: {FREE_MAX_PLAYLIST_BATCH} per run)
                    </li>
                    <li class="flex items-center gap-2">
                      <SparkleIcon class="size-3 shrink-0 text-amber-400" />
                      Supports ongoing development
                    </li>
                  </ul>

                  <div class="mt-3 flex items-center gap-2">
                    <input
                      value={licenseKeyInput}
                      onInput={(e) => setLicenseKeyInput((e.target as HTMLInputElement).value)}
                      placeholder="Paste your license key…"
                      spellcheck={false}
                      class="mf-num w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none transition focus:border-sky-500/60"
                    />
                    <button
                      onClick={() => void activate()}
                      disabled={licenseBusy || !licenseKeyInput.trim()}
                      className={btnPrimary}
                    >
                      Activate
                    </button>
                  </div>
                  {licenseError && <p class="mt-1.5 text-xs text-rose-300">{licenseError}</p>}

                  {PRO_PURCHASE_URL ? (
                    <a
                      href={PRO_PURCHASE_URL}
                      target="_blank"
                      rel="noreferrer"
                      class="mf-focus-ring mt-3 inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow shadow-amber-500/20 transition hover:brightness-110"
                    >
                      Buy MediaForge Pro
                    </a>
                  ) : (
                    <p class="mt-3 text-center text-[11px] text-slate-600">
                      Purchase link not configured yet.
                    </p>
                  )}
                </>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
