import { FolderIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btnGhost } from './buttonStyles'

export function DestinationSection({
  lastOutputDir,
  onChange,
}: {
  lastOutputDir: string
  onChange: (dir: string) => void
}) {
  async function browse() {
    const dir = await window.mf.chooseDestDir()
    if (dir) onChange(dir)
  }

  return (
    <SettingsCard
      icon={<FolderIcon class="size-4" />}
      title="Output destination"
      description="Where completed downloads are saved by default."
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <FolderIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
          <input
            readOnly
            value={lastOutputDir || 'OS Downloads folder'}
            class="w-full rounded-lg border border-line bg-recess py-2 pl-9 pr-3 text-sm text-slate-300"
          />
        </div>
        <button onClick={() => void browse()} className={btnGhost}>
          Browse…
        </button>
      </div>
    </SettingsCard>
  )
}
