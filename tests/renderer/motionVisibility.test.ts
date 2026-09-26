import { describe, expect, it, vi } from 'vitest'
import { observeMotionVisibility } from '../../src/renderer/src/utils/motionVisibility'

describe('motion visibility', () => {
  it('suspends hidden windows, resumes visible windows, and releases its listener', () => {
    const classes = new Set<string>()
    const events = new EventTarget()
    const remove = vi.spyOn(events, 'removeEventListener')
    const doc = {
      hidden: true,
      documentElement: {
        classList: {
          toggle: (name: string, enabled: boolean) =>
            enabled ? classes.add(name) : classes.delete(name),
          remove: (name: string) => classes.delete(name),
        },
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    }
    const dispose = observeMotionVisibility(doc as unknown as Document)
    expect(classes.has('mf-motion-suspended')).toBe(true)

    doc.hidden = false
    events.dispatchEvent(new Event('visibilitychange'))
    expect(classes.has('mf-motion-suspended')).toBe(false)

    doc.hidden = true
    events.dispatchEvent(new Event('visibilitychange'))
    expect(classes.has('mf-motion-suspended')).toBe(true)

    dispose()
    expect(classes.has('mf-motion-suspended')).toBe(false)
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    events.dispatchEvent(new Event('visibilitychange'))
    expect(classes.has('mf-motion-suspended')).toBe(false)
  })
})
