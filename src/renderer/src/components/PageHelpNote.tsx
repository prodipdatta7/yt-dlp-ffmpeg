import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { openHelp } from '../signals/uiState'
import { BookOpenIcon, CloseIcon, InfoIcon } from './icons'

const POPOVER_GAP = 9
const VIEWPORT_MARGIN = 12

type PopoverPosition = {
  top: number
  left: number
  placement: 'above' | 'below'
  ready: boolean
}

const INITIAL_POSITION: PopoverPosition = {
  top: 0,
  left: 0,
  placement: 'below',
  ready: false,
}

export function PageHelpNote({
  title,
  summary,
  steps,
}: {
  title: string
  summary: string
  steps: readonly string[]
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition>(INITIAL_POSITION)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (!open) return

    function placePopover(): void {
      const trigger = triggerRef.current
      const popover = popoverRef.current
      if (!trigger || !popover) return

      const triggerRect = trigger.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      const left = Math.min(
        window.innerWidth - popoverRect.width - VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, triggerRect.right - popoverRect.width),
      )
      const belowTop = triggerRect.bottom + POPOVER_GAP
      const fitsBelow = belowTop + popoverRect.height <= window.innerHeight - VIEWPORT_MARGIN
      const placement = fitsBelow ? 'below' : 'above'
      const top = fitsBelow
        ? belowTop
        : Math.max(VIEWPORT_MARGIN, triggerRect.top - POPOVER_GAP - popoverRect.height)

      setPosition({ top, left, placement, ready: true })
    }

    placePopover()
    window.addEventListener('resize', placePopover)
    window.addEventListener('scroll', placePopover, true)
    return () => {
      window.removeEventListener('resize', placePopover)
      window.removeEventListener('scroll', placePopover, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }

    function closeOnOutsideClick(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      triggerRef.current?.focus()
    }
  }, [open])

  function showHelp(): void {
    setPosition(INITIAL_POSITION)
    setOpen(true)
  }

  function openFullGuide(): void {
    setOpen(false)
    openHelp()
  }

  return (
    <div class="mf-page-help-launcher shrink-0">
      <button
        ref={triggerRef}
        type="button"
        class="mf-focus-ring mf-page-help-icon"
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={showHelp}
      >
        <InfoIcon class="size-4" />
      </button>

      {open &&
        createPortal(
          <div
            class={`mf-page-help-popover-root ${position.placement === 'above' ? 'is-above' : ''}`}
            style={{
              top: position.top,
              left: position.left,
              visibility: position.ready ? 'visible' : 'hidden',
            }}
          >
            <section
              ref={popoverRef}
              class="mf-page-help-dialog mf-rise"
              role="dialog"
              aria-labelledby="mf-page-help-title"
              aria-describedby="mf-page-help-summary"
            >
              <header>
                <span aria-hidden="true">
                  <BookOpenIcon class="size-5" />
                </span>
                <div>
                  <p>QUICK GUIDE</p>
                  <h2 id="mf-page-help-title">{title}</h2>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  class="mf-focus-ring mf-page-help-close"
                  aria-label="Close help"
                  onClick={() => setOpen(false)}
                >
                  <CloseIcon class="size-4" />
                </button>
              </header>

              <p id="mf-page-help-summary" class="mf-page-help-summary">
                {summary}
              </p>

              <ol>
                {steps.map((step, index) => (
                  <li key={step}>
                    <span>0{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>

              <footer>
                <button type="button" class="mf-focus-ring" onClick={openFullGuide}>
                  Open full Help guide
                </button>
                <button
                  type="button"
                  class="mf-focus-ring is-primary"
                  onClick={() => setOpen(false)}
                >
                  Got it
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </div>
  )
}
