import { useEffect, useState } from 'preact/hooks'
import { CONTAINERS, RESOLUTION_TIERS, type Container } from '../../../shared/models'

export interface DownloadSelection {
  tier: number
  container: Container
  destDir: string
}

export function ModeSelector({
  onSelection,
  disabled,
}: {
  onSelection: (selection: DownloadSelection) => void
  disabled: boolean
}) {
  const [tier, setTier] = useState<number>(1080)
  const [container, setContainer] = useState<Container>('mp4')
  const [destDir, setDestDir] = useState('')

  useEffect(() => {
    window.mf
      .getDefaultDestDir()
      .then((dir) => setDestDir((prev) => prev || dir))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (destDir) onSelection({ tier, container, destDir })
  }, [tier, container, destDir])

  return (
    <div class="grid w-full max-w-5xl grid-cols-1 gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 sm:grid-cols-3">
      <label class="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        Resolution
        <select
          value={tier}
          onChange={(e) => setTier(Number((e.target as HTMLSelectElement).value))}
          disabled={disabled}
          class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-slate-200 focus:border-sky-500"
        >
          {RESOLUTION_TIERS.map((t) => (
            <option key={t} value={t}>
              {t === 4320 ? '8K' : t === 2160 ? '4K' : `${t}p`}
            </option>
          ))}
        </select>
      </label>

      <label class="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        Container
        <select
          value={container}
          onChange={(e) => setContainer((e.target as HTMLSelectElement).value as Container)}
          disabled={disabled}
          class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-slate-200 focus:border-sky-500"
        >
          {CONTAINERS.map((c) => (
            <option key={c} value={c}>
              {c.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <label class="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        Destination folder
        <input
          type="text"
          value={destDir}
          onInput={(e) => setDestDir((e.target as HTMLInputElement).value)}
          disabled={disabled}
          placeholder="C:\Users\…\Downloads"
          class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-slate-200 focus:border-sky-500"
        />
      </label>
    </div>
  )
}
