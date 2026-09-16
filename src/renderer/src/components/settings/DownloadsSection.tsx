import { DownloadIcon, GaugeIcon, InfoIcon } from '../icons'
import { SettingsCard, SettingsRow, Switch } from '../SettingsCard'
import { btnGhost } from './buttonStyles'

export function DownloadsSection({
  playlistConcurrency,
  notifyOnComplete,
  onConcurrencyChange,
  onNotifyChange,
}: {
  playlistConcurrency: number
  notifyOnComplete: boolean
  onConcurrencyChange: (next: number) => void
  onNotifyChange: (next: boolean) => void
}) {
  return (
    <div class="flex flex-col gap-5">
      {/* Concurrency Settings & Visualizer */}
      <SettingsCard
        icon={<DownloadIcon class="size-4" />}
        title="Parallel Concurrency Engine"
        description="Configure simultaneous download workers for playlists and multi-selected search batches."
      >
        <div class="flex flex-col gap-4">
          <SettingsRow
            label="Worker Concurrency Limit"
            description="Number of simultaneous active download child processes (2–5)."
            control={
              <div class="inline-flex items-center gap-1 rounded-xl border border-line bg-recess p-1">
                <button
                  type="button"
                  aria-label="Decrease concurrency"
                  disabled={playlistConcurrency <= 2}
                  onClick={() => onConcurrencyChange(playlistConcurrency - 1)}
                  class={`${btnGhost} !border-0 !px-2.5 !py-1`}
                >
                  −
                </button>
                <span class="mf-num min-w-8 text-center text-sm font-bold text-ink">
                  {playlistConcurrency}
                </span>
                <button
                  type="button"
                  aria-label="Increase concurrency"
                  disabled={playlistConcurrency >= 5}
                  onClick={() => onConcurrencyChange(playlistConcurrency + 1)}
                  class={`${btnGhost} !border-0 !px-2.5 !py-1`}
                >
                  +
                </button>
              </div>
            }
          />

          {/* Visual Thread Lane Visualizer */}
          <div class="rounded-xl border border-line bg-wash-1 p-3.5">
            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Active Stream Lanes ({playlistConcurrency} of 5 Enabled)
            </span>
            <div class="mt-2.5 grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((lane) => {
                const isActive = lane <= playlistConcurrency
                return (
                  <div
                    key={lane}
                    class={`flex flex-col items-center justify-center rounded-lg border py-2.5 transition-[background-color,border-color,color,box-shadow] ${
                      isActive
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-sm'
                        : 'border-dashed border-line bg-wash-1 text-slate-600 opacity-50'
                    }`}
                  >
                    <span class="text-[11px] font-mono font-bold">LANE 0{lane}</span>
                    <span class="mt-0.5 text-[10px] font-semibold uppercase">
                      {isActive ? 'Ready' : 'Reserved'}
                    </span>
                  </div>
                )
              })}
            </div>
            <p class="mt-2.5 text-xs leading-relaxed text-slate-500">
              Each active lane spawns an independent child process with pre-flight disk reservation
              to prevent network saturation and storage starvation.
            </p>
          </div>
        </div>
      </SettingsCard>

      {/* Network Fault-Tolerance & Notification */}
      <SettingsCard
        icon={<GaugeIcon class="size-4" />}
        title="Fault-Tolerance & Notifications"
        description="Automated retry ladders and desktop notification policies."
      >
        <div class="divide-y divide-line">
          <SettingsRow
            label="OS Completion Alert"
            description="Display a native Windows notification if the window is minimized or inactive."
            control={
              <Switch
                checked={notifyOnComplete}
                onChange={onNotifyChange}
                label="Notify when finished"
              />
            }
          />
        </div>

        {/* Retry ladder spec */}
        <div class="mt-4 rounded-xl border border-line bg-wash-1 p-3.5">
          <div class="flex items-center gap-2">
            <InfoIcon class="size-4 text-sky-400" />
            <span class="text-xs font-bold text-ink">Network Auto-Recovery Ladder (AM-05)</span>
          </div>
          <p class="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            Transient network disconnections trigger automated retry intervals before prompting:
          </p>
          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            <span class="rounded-lg border border-line bg-recess px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-300">
              1st: 5s Backoff
            </span>
            <span class="text-slate-600">→</span>
            <span class="rounded-lg border border-line bg-recess px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-300">
              2nd: 15s Backoff
            </span>
            <span class="text-slate-600">→</span>
            <span class="rounded-lg border border-line bg-recess px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-300">
              3rd: 30s Backoff
            </span>
            <span class="text-slate-600">→</span>
            <span class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono font-semibold text-emerald-400">
              Manual Resume UI
            </span>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
