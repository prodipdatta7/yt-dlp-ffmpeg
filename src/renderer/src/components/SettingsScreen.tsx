import { useEffect, useState } from 'preact/hooks'
import type { UpdaterApplyResult, UpdaterCheckResult } from '../../../shared/ipcContract'

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  )
}

const btn =
  'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const btnPrimary = `${btn} bg-sky-600 text-white hover:bg-sky-500`
const btnGhost = `${btn} border border-slate-600 text-slate-300 hover:border-sky-500 hover:text-white`

type PhaseText = string | null

export function SettingsScreen() {
  const [settings, setSettings] = useState<{
    lastOutputDir: string
    cookieFileSet: boolean
  } | null>(null)
  const [check, setCheck] = useState<UpdaterCheckResult | null>(null)
  const [apply, setApply] = useState<UpdaterApplyResult | null>(null)
  const [phase, setPhase] = useState<PhaseText>(null)
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
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Section title="Destination">
        <div class="flex items-center gap-2">
          <input
            readOnly
            value={settings?.lastOutputDir || 'OS Downloads folder'}
            class="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
          />
          <button onClick={() => void browse()} class={btnGhost}>
            Browse…
          </button>
        </div>
      </Section>

      <Section title="Cookies">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-slate-300">
            Status:{' '}
            {settings?.cookieFileSet ? (
              <span class="text-emerald-400">cookies.txt imported</span>
            ) : (
              <span class="text-slate-500">not set</span>
            )}
          </span>
          <span class="flex gap-2">
            {!settings?.cookieFileSet && (
              <button
                onClick={() =>
                  void window.mf
                    .importCookies()
                    .then(() => window.mf.getSettings().then(setSettings))
                }
                class={btnPrimary}
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
                class={`${btn} bg-red-700 text-white hover:bg-red-600`}
              >
                Clear stored cookies
              </button>
            )}
          </span>
        </div>
      </Section>

      <Section title="Core drivers (yt-dlp)">
        <p class="mb-3 text-xs leading-relaxed text-slate-500">
          Media platforms change constantly; the bundled extractor can go stale. Updates are
          downloaded from official yt-dlp releases and SHA-256 verified before an atomic swap. A
          failed swap is rolled back automatically.
        </p>
        <div class="flex items-center gap-2">
          <button onClick={() => void runCheck()} disabled={busy} class={btnPrimary}>
            Check for updates
          </button>
          {check?.updateAvailable && (
            <button
              onClick={() => void runApply()}
              disabled={busy}
              class={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
            >
              Update Core Drivers → v{check.latest}
            </button>
          )}
        </div>
        {(phase || check || apply) && (
          <div class="mt-3 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
            {phase && <p class="text-sky-300">{phase}</p>}
            {check && (
              <p class="text-slate-400">
                Installed: <span class="text-slate-200">{check.current ?? 'unknown'}</span> · Latest
                release: <span class="text-slate-200">{check.latest ?? check.error ?? '?'}</span>
              </p>
            )}
            {check && !check.updateAvailable && !check.error && (
              <p class="text-emerald-400">You are up to date.</p>
            )}
            {apply?.ok && (
              <p class="text-emerald-400">Updated to v{apply.newVersion} — engines reloaded.</p>
            )}
            {apply && !apply.ok && (
              <p class={apply.rolledBack ? 'text-amber-300' : 'text-red-300'}>
                {apply.rolledBack ? 'Rolled back safely. ' : ''}
                {apply.error}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title="Diagnostics & versions">
        <div class="flex items-center gap-2">
          <button onClick={() => void window.mf.openLogsFolder()} class={btnGhost}>
            Open logs folder
          </button>
          <span class="text-xs text-slate-500">MediaForge v0.1.0</span>
        </div>
      </Section>
    </div>
  )
}
