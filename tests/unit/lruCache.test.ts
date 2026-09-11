import { describe, expect, it } from 'vitest'
import { estimateBytes, LruCache } from '../../src/renderer/src/utils/lruCache'

describe('LruCache (T11 / P-06)', () => {
  it('stores and returns values', () => {
    const cache = new LruCache<string>(10, 1_000_000)
    cache.set('a', 'alpha')
    expect(cache.get('a')).toBe('alpha')
    expect(cache.has('a')).toBe(true)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts the least recently used entry past the count cap', () => {
    const cache = new LruCache<string>(3, 1_000_000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    cache.set('d', '4')

    expect(cache.size).toBe(3)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('d')).toBe(true)
  })

  it('treats a read as a use, so the re-read entry survives', () => {
    const cache = new LruCache<string>(3, 1_000_000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')

    expect(cache.get('a')).toBe('1') // 'a' is now the newest, 'b' the oldest
    cache.set('d', '4')

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('evicts by byte budget as well as by count', () => {
    const big = 'x'.repeat(1000)
    const cache = new LruCache<string>(100, 6000) // ~2 bytes per char plus JSON quotes

    cache.set('a', big)
    cache.set('b', big)
    cache.set('c', big)

    expect(cache.bytes).toBeLessThanOrEqual(6000)
    expect(cache.size).toBeLessThan(3)
    expect(cache.has('c')).toBe(true)
  })

  it('keeps a single oversized entry rather than emptying itself', () => {
    const cache = new LruCache<string>(10, 10)
    cache.set('only', 'x'.repeat(500))

    expect(cache.size).toBe(1)
    expect(cache.get('only')).toHaveLength(500)
  })

  it('replaces a value in place without double-counting its bytes', () => {
    const cache = new LruCache<string>(10, 1_000_000)
    cache.set('a', 'x'.repeat(100))
    const afterFirst = cache.bytes

    cache.set('a', 'x'.repeat(100))
    expect(cache.size).toBe(1)
    expect(cache.bytes).toBe(afterFirst)
  })

  it('deletes and clears, keeping the byte total honest', () => {
    const cache = new LruCache<string>(10, 1_000_000)
    cache.set('a', 'alpha')
    cache.set('b', 'beta')

    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    expect(cache.size).toBe(1)

    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })

  it('survives values JSON cannot size', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(estimateBytes(circular)).toBe(0)

    const cache = new LruCache<unknown>(2, 1000)
    expect(() => cache.set('c', circular)).not.toThrow()
    expect(cache.get('c')).toBe(circular)
  })
})
