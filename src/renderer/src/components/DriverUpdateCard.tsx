import { useEffect, useState } from 'preact/hooks'
import type {
  UpdaterApplyResult,
  UpdaterCheckResult,
  UpdaterPhaseEvent,
} from '../../../shared/ipcContract'
import type { UpdaterDriverKind, UpdaterPhase } from '../../../shared/models'
import { RefreshIcon } from './icons'
import { SettingsCard } from './SettingsCard'

const PHASE_LABELS: Record<UpdaterPhase, string> = {
  checking: 'Checking the release feed…',
  downloading: 'Downloading…',
  verifying: 'Verifying SHA-256 checksum…',
  swapping: 'Installing the update…',
  'verifying-install': 'Verifying the binary runs…',
}

function phaseLabel(event: UpdaterPhaseEvent): string {
  if (event.phase === 'downloading' && event.detail) return `Downloading v${event.detail}…`
  return PHASE_LABELS[event.phase]
}

const btn =
  'mf-focus-ring rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnPrimary = `${btn} bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/20 hover:brightness-110`
const btnGo = `${btn} bg-gradient-to-br from-emerald-500 to-teal-400 text-slate-950 font-semibold shadow shadow-emerald-500/25 hover:brightness-110`

export function DriverUpdateCard({
  kind,
  title,
  description,
  sourceLabel,
}: {
  kind: UpdaterDriverKind
  title: string
  description: string
  sourceLabel: string
}) {
  const [check, setCheck] = useState<UpdaterCheckResult | null>(null)
  const [apply, setApply] = useState<UpdaterApplyResult | null>(null)
  const [phaseMsg, setPhaseMsg] = useState<UpdaterPhaseEvent | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refreshVersion() {
    try {
      const info = await window.mf.getBinariesInfo()
      const bin = kind === 'ffmpeg' ? info.ffmpeg : info.ytdlp
      setVersion(bin.version)
      setSource(bin.source)
    } catch {
      /* engine status unavailable */
    }
  }

  useEffect(() => {
    void refreshVersion()
  }, [kind, apply])

  useEffect(() => {
    const offPhase = window.mf.onUpdaterPhase((event) => {
      if (event.kind === kind) setPhaseMsg(event)
    })
    return () => offPhase()
  }, [kind])

  async function runCheck() {
    setBusy(true)
    setApply(null)
    setCheck(null)
    setPhaseMsg({ kind, phase: 'checking' })
    const result = await window.mf.updaterCheck(kind)
    setCheck(result)
    setPhaseMsg(null)
    setBusy(false)
  }

  async function runApply() {
    setBusy(true)
    setPhaseMsg({ kind, phase: 'downloading' })
    const result = await window.mf.updaterApply(kind)
    setApply(result)
    setPhaseMsg(null)
    setBusy(false)
  }

  return (
    <SettingsCard
      title={title}
      description={description}
      footer={
        <>
          <span class="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <RefreshIcon class="size-3" />
            {sourceLabel}
          </span>
          <span class="flex flex-wrap items-center gap-2">
            <button onClick={() => void runCheck()} disabled={busy} className={btnPrimary}>
              Check for updates
            </button>
            {check && (
              <button
                onClick={() => void runApply()}
                disabled={busy || !check.updateAvailable}
                title={
                  check.updateAvailable
                    ? `Install the latest ${title}`
                    : 'You are already on the latest version'
                }
                className={
                  check.updateAvailable
                    ? btnGo
                    : `${btn} cursor-not-allowed border border-line-strong text-slate-500`
                }
              >
                {check.updateAvailable ? `Update → v${check.latest}` : 'Up to date'}
              </button>
            )}
          </span>
        </>
      }
    >
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-recess py-1.5 pl-2.5 pr-3 text-[11px] text-slate-500">
        <span class="inline-flex items-center gap-1.5">
          <span class={`size-1.5 rounded-full ${version ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          {version ? `installed (${source ?? 'bundled'})` : 'not detected'}
        </span>
        <span class="mf-num rounded-full border border-line bg-wash-1 px-2.5 py-0.5 font-medium text-slate-400">
          {version ? `v${version}` : 'probing…'}
        </span>
      </div>

      {(phaseMsg || check || apply) && (
        <div class="mt-3 space-y-1.5 rounded-xl border border-line bg-recess p-3.5 text-sm">
          {phaseMsg && (
            <p class="flex items-center gap-2 text-sky-300">
              <RefreshIcon class="size-3.5 animate-spin" />
              {phaseLabel(phaseMsg)}
            </p>
          )}
          {check && !check.error && (
            <p class="text-slate-400">
              Installed <span class="mf-num text-slate-200">{check.current ?? 'unknown'}</span> ·
              Latest <span class="mf-num text-slate-200">{check.latest ?? '?'}</span>
            </p>
          )}
          {check && check.error && <p class="text-amber-300">{check.error}</p>}
          {apply?.ok && (
            <p class="font-medium text-emerald-400">
              Updated to v{apply.newVersion} — engines reloaded.
            </p>
          )}
          {apply && !apply.ok && (
            <p class={apply.rolledBack ? 'text-amber-300' : 'text-rose-300'}>
              {apply.rolledBack ? 'Rolled back safely. ' : ''}
              {apply.error}
            </p>
          )}
        </div>
      )}
    </SettingsCard>
  )
}
