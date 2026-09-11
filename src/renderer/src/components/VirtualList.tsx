import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { VNode } from 'preact'

export interface VirtualListProps<T> {
  items: readonly T[]
  /** Fixed row height in px. Rows whose height varies with content are not candidates. */
  rowHeight: number
  /** Rows rendered beyond each edge of the viewport, to cover fast scrolls. */
  overscan?: number
  /** Scroll container height. */
  height: number | string
  renderRow: (item: T, index: number) => VNode
  keyFor: (item: T, index: number) => string | number
  /** Fires once per crossing into the last `nearEndPx` of the list, not per scroll event. */
  onNearEnd?: () => void
  nearEndPx?: number
  class?: string
  /** Scrolls this row into view when it changes. Use instead of `scrollIntoView` — the
   *  target node may not be mounted (P-05). */
  scrollToIndex?: number
  scrollBehavior?: ScrollBehavior
}

/** Visible slice for a scroll position. Exported for tests; pure arithmetic. */
export function visibleRange(
  itemCount: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan: number,
): { start: number; end: number } {
  if (itemCount === 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const first = Math.floor(scrollTop / rowHeight)
  const visible = Math.ceil(viewportHeight / rowHeight)
  // `start` is clamped to the item count as well as to zero: filtering the list while it is
  // scrolled near the bottom leaves scrollTop past the new end until the browser corrects it.
  const start = Math.min(itemCount, Math.max(0, first - overscan))
  const end = Math.min(itemCount, first + visible + overscan)
  return { start, end: Math.max(start, end) }
}

/**
 * Fixed-row-height windowing, hand-written because AM-12 forbids a virtualization
 * dependency. Only the visible slice plus overscan is in the DOM; a spacer gives the
 * scrollbar its full range and the slice is offset with `translateY`.
 *
 * Written for the transcript: 5,000 cues × ~6 nodes each was ~30,000 nodes, diffed on every
 * active-cue change. The app's other long lists (playlist entries, queue rows) are not
 * candidates — their rows grow a progress bar while downloading, so their height varies with
 * state; they use `.mf-skip-offscreen-row` instead.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  overscan = 6,
  height,
  renderRow,
  keyFor,
  onNearEnd,
  nearEndPx = 600,
  class: className = '',
  scrollToIndex,
  scrollBehavior = 'smooth',
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(typeof height === 'number' ? height : 400)
  const frameRef = useRef<number | null>(null)
  /** True while the scroll position is inside the near-end zone, so we fire once per entry. */
  const nearEndRef = useRef(false)

  const totalHeight = items.length * rowHeight

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    setViewportHeight(el.clientHeight)

    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    const inZone = remaining <= nearEndPx
    if (inZone && !nearEndRef.current) onNearEnd?.()
    nearEndRef.current = inZone
  }, [nearEndPx, onNearEnd])

  const handleScroll = useCallback(() => {
    // One measurement per frame; a scroll gesture fires far more events than that.
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  useEffect(() => {
    measure()
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [measure, items.length])

  useEffect(() => {
    if (scrollToIndex === undefined || scrollToIndex < 0) return
    const el = containerRef.current
    if (!el) return
    const target = scrollToIndex * rowHeight
    // Only scroll when the row is actually outside the viewport, so manual scrolling is
    // not fought over on every tick.
    if (target >= el.scrollTop && target + rowHeight <= el.scrollTop + el.clientHeight) return
    el.scrollTo({ top: Math.max(0, target - el.clientHeight / 2), behavior: scrollBehavior })
  }, [scrollToIndex, rowHeight, scrollBehavior])

  const { start, end } = useMemo(
    () => visibleRange(items.length, rowHeight, viewportHeight, scrollTop, overscan),
    [items.length, rowHeight, viewportHeight, scrollTop, overscan],
  )

  const slice: VNode[] = []
  for (let i = start; i < end; i += 1) {
    const item = items[i]
    if (item === undefined) continue
    slice.push(
      <div key={keyFor(item, i)} style={{ height: `${rowHeight}px` }}>
        {renderRow(item, i)}
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      class={`overflow-y-auto ${className}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * rowHeight}px)` }}>{slice}</div>
      </div>
    </div>
  )
}
