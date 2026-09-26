import { useEffect, useRef, useState } from 'preact/hooks'

function minimizeMotion(): boolean {
  return (
    document.hidden ||
    document.documentElement.classList.contains('mf-reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Keep the modal mounted through its exit; mount media only after the entrance settles. */
export function usePreviewMotion(onClose: () => void) {
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>(() =>
    minimizeMotion() ? 'open' : 'opening',
  )
  const closing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeCallback = useRef(onClose)
  closeCallback.current = onClose

  useEffect(() => {
    if (!closing.current && phase === 'opening') {
      timer.current = setTimeout(() => setPhase('open'), 280)
    }
    return () => clearTimeout(timer.current)
  }, [])

  function requestClose(afterClose?: () => void): void {
    if (closing.current) return
    closing.current = true
    clearTimeout(timer.current)
    setPhase('closing')
    const finish = (): void => {
      closeCallback.current()
      afterClose?.()
    }
    if (minimizeMotion()) finish()
    else timer.current = setTimeout(finish, 180)
  }

  return { phase, requestClose, mediaReady: phase === 'open' }
}
