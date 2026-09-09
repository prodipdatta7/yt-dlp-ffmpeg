import { useEffect, useState } from 'preact/hooks'
import type { AppUpdateCheckResult, AppUpdateInstallResult } from '../../../../shared/ipcContract'
import type { AppUpdatePhase } from '../../../../shared/models'
import { RefreshIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btn, btnGhost, btnPrimary } from './buttonStyles'

const btnGo = `${btn} bg-gradient-to-br from-emerald-500 to-teal-400 text-slate-950 font-semibold shadow shadow-emerald-500/25 hover:brightness-110`

const INSTALL_PHASE_LABELS: Record<AppUpdatePhase, string> = {
  checking: 'Checking the release feed…',
  downloading: 'Downloading the installer…',
  verifying: 'Verifying SHA-256 checksum…',
  'launching-installer': 'Launching installer…',
}

export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  const [check, setCheck] = useState<AppUpdateCheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installPhase, setInstallPhase] = useState<AppUpdatePhase | null>(null)
  const [installResult, setInstallResult] = useState<AppUpdateInstallResult | null>(null)

  useEffect(() => {
    void window.mf
      .getAppVersion()
      .then((r) => setVersion(r.version))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const off = window.mf.onAppUpdatePhase((event) => setInstallPhase(event.phase))
    return () => off()
  }, [])

  async function runCheck() {
    setBusy(true)
    setCheck(null)
    setInstallResult(null)
    const result = await window.mf.checkAppUpdate()
    setCheck(result)
    setBusy(false)
  }

  async function runInstall() {
    setInstalling(true)
    setInstallResult(null)
    setInstallPhase(null)
    const result = await window.mf.downloadAndInstallAppUpdate()
    setInstallResult(result)
    setInstalling(false)
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">About</h3>
        <span class="text-[11px] text-slate-600">GitHub releases</span>
      </div>

      <SettingsCard
        title="MediaForge Desktop"
        description="This is the app itself — its UI and features. Checks GitHub for a newer app release; Download & Install fetches the installer, verifies its SHA-256 checksum, then launches it and closes the app so it can proceed. The yt-dlp/FFmpeg engines bundled inside update separately and much more often — see Settings → Drivers."
        footer={
          <>
            <span class="mf-num rounded-full border border-line bg-wash-1 px-2.5 py-0.5 text-[11px] font-medium text-slate-400">
              {version ? `v${version}` : 'probing…'}
            </span>
            <span class="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void runCheck()}
                disabled={busy || installing}
                className={btnPrimary}
              >
                Check for Updates
              </button>
              {check?.updateAvailable && (
                <>
                  <button
                    onClick={() => void window.mf.openAppReleasePage()}
                    disabled={installing}
                    className={btnGhost}
                  >
                    View Release
                  </button>
                  <button onClick={() => void runInstall()} disabled={installing} className={btnGo}>
                    Download & Install v{check.latestVersion}
                  </button>
                </>
              )}
            </span>
          </>
        }
      >
        {(busy || check || installing || installResult) && (
          <div class="space-y-1.5 rounded-xl border border-line bg-recess p-3.5 text-sm">
            {busy && (
              <p class="flex items-center gap-2 text-sky-300">
                <RefreshIcon class="size-3.5 animate-spin" />
                Checking the release feed…
              </p>
            )}
            {check && !check.error && !check.updateAvailable && (
              <p class="text-slate-400">You&rsquo;re on the latest version.</p>
            )}
            {check && !check.error && check.updateAvailable && !installing && !installResult && (
              <p class="text-slate-400">
                Installed <span class="mf-num text-slate-200">{check.currentVersion}</span> · Latest{' '}
                <span class="mf-num text-slate-200">{check.latestVersion}</span>
              </p>
            )}
            {check?.error && <p class="text-amber-300">{check.error}</p>}
            {installing && (
              <p class="flex items-center gap-2 text-sky-300">
                <RefreshIcon class="size-3.5 animate-spin" />
                {installPhase ? INSTALL_PHASE_LABELS[installPhase] : 'Starting…'}
              </p>
            )}
            {installResult?.ok && (
              <p class="font-medium text-emerald-400">
                Installer launched — MediaForge will now close so it can run.
              </p>
            )}
            {installResult && !installResult.ok && (
              <p class="text-rose-300">{installResult.error}</p>
            )}
          </div>
        )}
      </SettingsCard>
    </div>
  )
}
