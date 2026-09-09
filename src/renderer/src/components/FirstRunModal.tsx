import { ShieldIcon } from './icons'

export function FirstRunModal({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  if (!open) return null
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim)]/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-first-run-title"
    >
      <div class="mf-card mf-rise w-full max-w-lg p-6 shadow-2xl">
        <div class="mb-4 flex size-12 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
          <ShieldIcon class="size-6" />
        </div>
        <h2 id="mf-first-run-title" class="text-lg font-bold tracking-tight text-ink">
          Before you download
        </h2>
        <p class="mf-select-text mt-2 text-sm leading-relaxed text-slate-400">
          MediaForge is a passive client around yt-dlp and FFmpeg. You are responsible for complying
          with the terms of service and copyright of the sites you download from.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          class="mf-focus-ring mt-5 w-full rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 px-5 py-2.5 text-sm font-bold text-white shadow shadow-sky-500/25 transition hover:brightness-110 active:scale-[0.98]"
        >
          Understood
        </button>
      </div>
    </div>
  )
}
