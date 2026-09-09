import { DocIcon, ShieldIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btnGhost } from './buttonStyles'

export function DiagnosticsSection() {
  return (
    <SettingsCard
      icon={<DocIcon class="size-4" />}
      title="Diagnostics"
      description="Structured logs live in your user-data folder; they redact URLs and cookies automatically."
      footer={
        <>
          <span class="flex items-center gap-1.5 text-xs text-slate-600">
            <ShieldIcon class="size-3.5" />
            no telemetry · no analytics
          </span>
          <button onClick={() => void window.mf.openLogsFolder()} className={btnGhost}>
            Open logs folder
          </button>
        </>
      }
    />
  )
}
