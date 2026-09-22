import { useRef } from 'preact/hooks'
import { useDialogFocus } from '../utils/useDialogFocus'

const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ['Ctrl', 'K'], action: 'Focus the link bar' },
  { keys: ['Ctrl', 'L'], action: 'Focus the link bar' },
  { keys: ['Ctrl', 'V'], action: 'Paste into the focused link bar' },
  { keys: ['Ctrl', '`'], action: 'Toggle the live console dock' },
  { keys: ['?'], action: 'Show or hide this shortcuts list' },
  { keys: ['Esc'], action: 'Close overlays / clear focus' },
]

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogFocus(dialogRef, open, { initialFocusRef: closeRef, onEscape: onClose })

  if (!open) return null
  return (
    <div
      class="fixed inset-x-0 bottom-0 top-[58px] z-50 flex items-center justify-center bg-[var(--color-scrim)]/55 p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        class="mf-card mf-rise w-full max-w-md p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mf-shortcuts-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="mf-shortcuts-title" class="text-sm font-bold tracking-tight text-ink">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            class="mf-focus-ring rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-wash-2 hover:text-ink"
          >
            Esc
          </button>
        </div>
        <ul class="space-y-2.5">
          {SHORTCUTS.map(({ keys, action }) => (
            <li
              key={`${keys.join('+')}-${action}`}
              class="flex items-center justify-between gap-4 text-sm"
            >
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
