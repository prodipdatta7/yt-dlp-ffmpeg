import { useEffect, useState } from 'preact/hooks'
import type { UpdaterApplyResult, UpdaterCheckResult } from '../../../shared/ipcContract'
import { CookieIcon, DocIcon, FolderIcon, RefreshIcon, ShieldIcon } from './icons'
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
const btnGo = `${btn} bg-gradient-to-br from-emerald-500 to-teal-400 text-slate-950 font-semibold shadow shadow-emerald-500/25 hover:brightness-110`

export function SettingsScreen() {
  const [settings, setSettings] = useState<{
    lastOutputDir: string
    cookieFileSet: boolean
  } | null>(null)
  const [check, setCheck] = useState<UpdaterCheckResult | null>(null)
  const [apply, setApply] = useState<UpdaterApplyResult | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.mf
      .getSettings()
      .then(setSettings)
      .catch(() => undefined)
  }, [])

  async function browse() {
    const dir = await window.mf.chooseDestDir()
    if (dir) setSettings((prev) => (prev ? { ...prev, lastOutputDir: dir } : prev))
  }

  async function runCheck() {
    setBusy(true)
    setApply(null)
    setPhase('Checking GitHub releases…')
    const result = await window.mf.updaterCheck()
    setCheck(result)
    setPhase(null)
    setBusy(false)
  }

  async function runApply() {
    setBusy(true)
    setPhase('Downloading yt-dlp.exe + SHA2-256SUMS…')
    const result = await window.mf.updaterApply()
    setApply(result)
    setPhase(null)
    setBusy(false)
    if (result.ok) window.mf.getBinariesInfo().catch(() => undefined)
  }

  return (
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight text-white">Settings</h2>
        <Pill tone="sky">MediaForge v0.1.1</Pill>
      </header>

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
        description="Needed for age-restricted or bot-checked content. Stored locally, never logged or transmitted anywhere else."
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
      </Section>

      <Section
        icon={<RefreshIcon class="size-4.5" />}
        title="Core drivers · yt-dlp"
        description="Media platforms change constantly and the bundled extractor can go stale. Updates come from official yt-dlp releases and are SHA-256 verified before an atomic swap; failed swaps roll back automatically."
      >
        <div className="flex items-center gap-2">
          <button onClick={() => void runCheck()} disabled={busy} className={btnPrimary}>
            Check for updates
          </button>
          {check?.updateAvailable && (
            <button onClick={() => void runApply()} disabled={busy} className={btnGo}>
              Update → v{check.latest}
            </button>
          )}
        </div>
        {(phase || check || apply) && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-white/[0.06] bg-black/25 p-3.5 text-sm">
            {phase && (
              <p class="flex items-center gap-2 text-sky-300">
                <RefreshIcon class="size-3.5 animate-spin" />
                {phase}
              </p>
            )}
            {check && (
              <p className="text-slate-400">
                Installed{' '}
                <span className="mf-num text-slate-200">{check.current ?? 'unknown'}</span> · Latest
                release{' '}
                <span className="mf-num text-slate-200">{check.latest ?? check.error ?? '?'}</span>
              </p>
            )}
            {check && !check.updateAvailable && !check.error && (
              <p className="font-medium text-emerald-400">You are up to date.</p>
            )}
            {apply?.ok && (
              <p className="font-medium text-emerald-400">
                Updated to v{apply.newVersion} — engines reloaded.
              </p>
            )}
            {apply && !apply.ok && (
              <p className={apply.rolledBack ? 'text-amber-300' : 'text-rose-300'}>
                {apply.rolledBack ? 'Rolled back safely. ' : ''}
                {apply.error}
              </p>
            )}
          </div>
        )}
      </Section>

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
