const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ['Ctrl', 'K'], action: 'Focus the link bar' },
  { keys: ['Ctrl', 'L'], action: 'Paste clipboard URL and analyze' },
  { keys: ['Ctrl', '`'], action: 'Toggle the live console dock' },
  { keys: ['?'], action: 'Show or hide this shortcuts list' },
  { keys: ['Esc'], action: 'Close overlays / clear focus' },
]

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim)]/55 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        class="mf-card mf-rise w-full max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-bold tracking-tight text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            class="mf-focus-ring rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-wash-2 hover:text-ink"
          >
            Esc
          </button>
        </div>
        <ul class="space-y-2.5">
          {SHORTCUTS.map(({ keys, action }) => (
            <li key={action} class="flex items-center justify-between gap-4 text-sm">
              <span class="text-slate-400">{action}</span>
              <span class="flex shrink-0 items-center gap-1">
                {keys.map((k) => (
                  <kbd key={k} class="mf-kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
