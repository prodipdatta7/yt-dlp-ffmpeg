import { describe, expect, it } from 'vitest'
import { visibleRange } from '../../src/renderer/src/components/VirtualList'

const ROW = 32
const VIEWPORT = 400
const OVERSCAN = 6
const COUNT = 10_000

/** ceil(400/32) = 13 visible rows, plus 6 overscan on each side. */
const MAX_RENDERED = Math.ceil(VIEWPORT / ROW) + OVERSCAN * 2

describe('VirtualList windowing (T13 / P-05)', () => {
  it('renders a bounded slice regardless of item count', () => {
    for (const scrollTop of [0, 1000, 50_000, 160_000]) {
      const { start, end } = visibleRange(COUNT, ROW, VIEWPORT, scrollTop, OVERSCAN)
      expect(end - start).toBeLessThanOrEqual(MAX_RENDERED)
    }
  })

  it('renders from the top with no leading overscan at scroll 0', () => {
    const { start, end } = visibleRange(COUNT, ROW, VIEWPORT, 0, OVERSCAN)
    expect(start).toBe(0)
    expect(end).toBe(Math.ceil(VIEWPORT / ROW) + OVERSCAN)
  })

  it('covers the viewport in the middle of the list', () => {
    const scrollTop = 5000
    const { start, end } = visibleRange(COUNT, ROW, VIEWPORT, scrollTop, OVERSCAN)
    const firstVisible = Math.floor(scrollTop / ROW)
    const lastVisible = Math.floor((scrollTop + VIEWPORT) / ROW)

    expect(start).toBe(firstVisible - OVERSCAN)
    expect(start).toBeLessThanOrEqual(firstVisible)
    expect(end).toBeGreaterThan(lastVisible)
    expect(end - start).toBeLessThanOrEqual(MAX_RENDERED)
  })

  it('clamps at the bottom of the list', () => {
    const scrollTop = COUNT * ROW - VIEWPORT
    const { start, end } = visibleRange(COUNT, ROW, VIEWPORT, scrollTop, OVERSCAN)

    expect(end).toBe(COUNT)
    expect(start).toBeGreaterThan(0)
    expect(end - start).toBeLessThanOrEqual(MAX_RENDERED)
  })

  it('handles an empty list and a short list', () => {
    expect(visibleRange(0, ROW, VIEWPORT, 0, OVERSCAN)).toEqual({ start: 0, end: 0 })

    const { start, end } = visibleRange(3, ROW, VIEWPORT, 0, OVERSCAN)
    expect(start).toBe(0)
    expect(end).toBe(3)
  })

  it('never returns an inverted range', () => {
    for (const scrollTop of [0, 100, 9_999_999]) {
      const { start, end } = visibleRange(50, ROW, VIEWPORT, scrollTop, OVERSCAN)
      expect(end).toBeGreaterThanOrEqual(start)
      expect(end).toBeLessThanOrEqual(50)
    }
  })

  it('degrades safely on a zero row height', () => {
    expect(visibleRange(100, 0, VIEWPORT, 0, OVERSCAN)).toEqual({ start: 0, end: 0 })
  })

  it('covers every index across a full scroll sweep', () => {
    const seen = new Set<number>()
    for (let scrollTop = 0; scrollTop <= COUNT * ROW - VIEWPORT; scrollTop += VIEWPORT) {
      const { start, end } = visibleRange(COUNT, ROW, VIEWPORT, scrollTop, OVERSCAN)
      for (let i = start; i < end; i += 1) seen.add(i)
    }
    expect(seen.size).toBe(COUNT)
  })
})
