/** Suspend decorative CSS animations while the window is hidden or minimized. */
export function observeMotionVisibility(doc: Document = document): () => void {
  const sync = (): void => {
    doc.documentElement.classList.toggle('mf-motion-suspended', doc.hidden)
  }
  sync()
  doc.addEventListener('visibilitychange', sync)
  return () => {
    doc.removeEventListener('visibilitychange', sync)
    doc.documentElement.classList.remove('mf-motion-suspended')
  }
}
