import type { RefObject } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogFocusOptions {
  initialFocusRef?: RefObject<HTMLElement>
  onEscape?: () => void
}

/**
 * Keeps keyboard focus inside a mounted modal and restores it to the invoking control.
 * The dialog element should also carry `role="dialog"`, `aria-modal="true"`, and `tabIndex={-1}`.
 */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement>,
  open: boolean,
  options: DialogFocusOptions = {},
): void {
  const escapeRef = useRef(options.onEscape)
  escapeRef.current = options.onEscape

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const activeDialog: HTMLElement = dialog

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = (): HTMLElement[] =>
      Array.from(activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
      )

    const focusFrame = requestAnimationFrame(() => {
      const target = options.initialFocusRef?.current ?? focusable()[0] ?? activeDialog
      target.focus({ preventScroll: true })
    })

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && escapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        escapeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const candidates = focusable()
      if (candidates.length === 0) {
        event.preventDefault()
        activeDialog.focus({ preventScroll: true })
        return
      }

      const first = candidates[0]
      const last = candidates[candidates.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !activeDialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown, true)
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [dialogRef, open, options.initialFocusRef])
}
