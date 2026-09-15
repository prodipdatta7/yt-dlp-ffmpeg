import { useState } from 'preact/hooks'
import { CheckIcon, FolderIcon, HardDriveIcon, InfoIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btnGhost, btnPrimary } from './buttonStyles'

export function DestinationSection({
  lastOutputDir,
  onChange,
}: {
  lastOutputDir: string
  onChange: (dir: string) => void
}) {
  const [opening, setOpening] = useState(false)

  async function browse() {
    const dir = await window.mf.chooseDestDir()
    if (dir) onChange(dir)
  }

  async function openFolder() {
    if (!lastOutputDir) return
    setOpening(true)
    try {
      await window.mf.revealPath(lastOutputDir)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div class="flex flex-col gap-5">
      <SettingsCard
        icon={<FolderIcon class="size-4" />}
        title="Default Output Destination"
        description="Completed media files are verified and atomically moved here."
      >
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <FolderIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                readOnly
                value={lastOutputDir || 'Default OS Downloads folder'}
                class="w-full rounded-xl border border-line bg-recess py-2.5 pl-9 pr-3 text-xs font-mono text-ink shadow-inner"
              />
            </div>
            <button onClick={() => void browse()} class={btnPrimary}>
              Browse Folder…
            </button>
            {lastOutputDir && (
              <button
                type="button"
                disabled={opening}
                onClick={() => void openFolder()}
                class={btnGhost}
              >
                Open in Explorer
              </button>
            )}
          </div>

          <div class="flex items-center gap-2 text-[11px] text-slate-500">
            <HardDriveIcon class="size-3.5 shrink-0 text-emerald-500" />
            <span>
              Pre-flight disk headroom: MediaForge validates free disk space before beginning any
              job.
            </span>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<InfoIcon class="size-4" />}
        title="Filename Safety & Token Structure"
        description="Automatic Windows filename sanitization and template structure."
      >
        <div class="flex flex-col gap-3.5">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Active Output Template
            </span>
            <div class="mt-1.5 flex items-center justify-between rounded-xl border border-line bg-recess p-3">
              <code class="text-xs font-mono font-semibold text-sky-400">
                %(title).200B [%(id)s].%(ext)s
              </code>
              <span class="rounded-full border border-line bg-wash-1 px-2 py-0.5 text-[9px] font-mono text-slate-400">
                yt-dlp native
              </span>
            </div>
          </div>

          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Live Preview
            </span>
            <p class="mt-1 text-xs font-medium text-ink">
              Lofi Hip Hop Radio - Beats to Relax [jfKfPfyJRdk].mp4
            </p>
          </div>

          <div class="grid grid-cols-1 gap-2 text-[11.5px] leading-relaxed text-slate-500 sm:grid-cols-2">
            <div class="flex items-start gap-2">
              <CheckIcon class="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              <span>Strips illegal characters: \ / : * ? " &lt; &gt; |</span>
            </div>
            <div class="flex items-start gap-2">
              <CheckIcon class="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              <span>Truncates titles at 200 bytes to preserve MAX_PATH</span>
            </div>
            <div class="flex items-start gap-2">
              <CheckIcon class="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              <span>Guards Windows reserved device names (CON, PRN, AUX)</span>
            </div>
            <div class="flex items-start gap-2">
              <CheckIcon class="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              <span>Resolves collisions automatically with _1, _2 suffixes</span>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
