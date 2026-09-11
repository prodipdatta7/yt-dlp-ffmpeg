import { describe, expect, it } from 'vitest'
import { findActiveIndex } from '../../src/renderer/src/utils/activeIndex'

interface Cue {
  startSec: number
}

/** The backward linear scan findActiveIndex replaces, kept as the oracle. */
function linearReference(items: readonly Cue[], t: number): number {
  if (items.length === 0) return -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (t >= items[i].startSec) return i
  }
  return 0
}

const key = (c: Cue): number => c.startSec

describe('findActiveIndex (T11 / P-06)', () => {
  it('returns -1 for an empty array', () => {
    expect(findActiveIndex([], 5, key)).toBe(-1)
  })

  it('returns 0 for a single item whether or not it has started', () => {
    const one = [{ startSec: 10 }]
    expect(findActiveIndex(one, 0, key)).toBe(0)
    expect(findActiveIndex(one, 10, key)).toBe(0)
    expect(findActiveIndex(one, 99, key)).toBe(0)
  })

  it('returns 0 when playback is before the first item', () => {
    const cues = [{ startSec: 5 }, { startSec: 10 }, { startSec: 15 }]
    expect(findActiveIndex(cues, 0, key)).toBe(0)
    expect(findActiveIndex(cues, 4.99, key)).toBe(0)
  })

  it('is inclusive at an exact boundary', () => {
    const cues = [{ startSec: 0 }, { startSec: 10 }, { startSec: 20 }]
    expect(findActiveIndex(cues, 10, key)).toBe(1)
    expect(findActiveIndex(cues, 9.99, key)).toBe(0)
    expect(findActiveIndex(cues, 20, key)).toBe(2)
  })

  it('returns the last item once playback passes every key', () => {
    const cues = [{ startSec: 0 }, { startSec: 10 }, { startSec: 20 }]
    expect(findActiveIndex(cues, 1000, key)).toBe(2)
  })

  it('handles duplicate keys by returning the last match', () => {
    const cues = [{ startSec: 0 }, { startSec: 10 }, { startSec: 10 }, { startSec: 20 }]
    expect(findActiveIndex(cues, 10, key)).toBe(2)
  })

  it('matches the linear reference over randomized ascending arrays', () => {
    let seed = 12345
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let trial = 0; trial < 200; trial += 1) {
      const n = Math.floor(rand() * 60)
      const cues: Cue[] = []
      let t = 0
      for (let i = 0; i < n; i += 1) {
        t += Math.floor(rand() * 5)
        cues.push({ startSec: t })
      }
      const maxKey = cues.length > 0 ? cues[cues.length - 1].startSec : 0
      for (let probe = 0; probe < 12; probe += 1) {
        const at = rand() * (maxKey + 10) - 2
        expect(findActiveIndex(cues, at, key)).toBe(linearReference(cues, at))
      }
    }
  })
})
