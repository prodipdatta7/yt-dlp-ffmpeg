import { useMemo } from 'preact/hooks'
import type { FormatRow } from '../../../shared/models'
import { fmtSize } from '../utils/format'

function codecLabel(c: string | null): string {
  if (!c) return '—'
  const dot = c.indexOf('.')
  return dot > 0 ? c.slice(0, dot) : c
}

export function FormatMatrix({ formats }: { formats: FormatRow[] }) {
  const sorted = useMemo(
    () =>
      [...formats].sort((a, b) => {
        const h = (b.height ?? -1) - (a.height ?? -1)
        if (h !== 0) return h
        return (b.tbrKbps ?? b.abrKbps ?? 0) - (a.tbrKbps ?? a.abrKbps ?? 0)
      }),
    [formats],
  )

  if (sorted.length === 0) return null

  return (
    <div class="w-full max-w-5xl min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
      <div class="border-b border-slate-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Available streams ({sorted.length})
      </div>
      <div class="max-h-64 overflow-auto">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead class="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-2 font-medium">ID</th>
              <th class="px-4 py-2 font-medium">Ext</th>
              <th class="px-4 py-2 font-medium">Video</th>
              <th class="px-4 py-2 font-medium">Audio</th>
              <th class="px-4 py-2 font-medium">Res</th>
              <th class="px-4 py-2 font-medium">FPS</th>
              <th class="px-4 py-2 font-medium">Bitrate</th>
              <th class="px-4 py-2 font-medium">~Size</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/70 text-slate-300">
            {sorted.map((f) => (
              <tr key={f.formatId} class="hover:bg-slate-800/50">
                <td class="px-4 py-1.5 font-mono text-xs text-sky-300">{f.formatId}</td>
                <td class="px-4 py-1.5">{f.ext}</td>
                <td class="px-4 py-1.5">{codecLabel(f.vcodec)}</td>
                <td class="px-4 py-1.5">{codecLabel(f.acodec)}</td>
                <td class="px-4 py-1.5">{f.height ? `${f.height}p` : 'audio'}</td>
                <td class="px-4 py-1.5">{f.fps ?? '—'}</td>
                <td class="px-4 py-1.5">
                  {f.abrKbps
                    ? `${Math.round(f.abrKbps)}k`
                    : f.tbrKbps
                      ? `${Math.round(f.tbrKbps)}k`
                      : '—'}
                </td>
                <td class="px-4 py-1.5 text-slate-400">{fmtSize(f.filesizeBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
