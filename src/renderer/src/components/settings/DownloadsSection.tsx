import { DownloadIcon } from '../icons'
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
    <SettingsCard
      icon={<DownloadIcon class="size-4" />}
      title="Downloads"
      description="Parallel playlist concurrency and desktop notifications."
    >
      <div class="divide-y divide-line">
        <SettingsRow
          label="Parallel downloads"
          description="How many playlist entries run at once (2–5)."
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
              <span class="mf-num min-w-8 text-center text-sm font-semibold text-ink">
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
        <SettingsRow
          label="Notify when finished"
          description="OS notification if the window is unfocused or minimized."
          control={
            <Switch
              checked={notifyOnComplete}
              onChange={onNotifyChange}
              label="Notify when finished"
            />
          }
        />
      </div>
    </SettingsCard>
  )
}
