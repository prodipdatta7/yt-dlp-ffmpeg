/**
 * A byte-aware LRU, hand-written because AM-12 forbids adding a dependency for it.
 *
 * `Map` iteration order is insertion order, which gives recency for free: `get` re-inserts
 * the key it touched, so the oldest live entry is always `keys().next()`.
 *
 * Sizing uses a cheap `JSON.stringify` estimate. Exactness is not the point — the caches this
 * backs (chapters, transcripts) previously had no entry, byte or age limit at all and
 * retained their content for the whole session (P-06).
 */
export class LruCache<V> {
  private readonly entries = new Map<string, { value: V; bytes: number }>()
  private totalBytes = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.totalBytes
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key)
    if (hit === undefined) return undefined
    // Re-insert so this key becomes the most recently used.
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit.value
  }

  set(key: string, value: V): void {
    const existing = this.entries.get(key)
    if (existing) {
      this.totalBytes -= existing.bytes
      this.entries.delete(key)
    }

    const bytes = estimateBytes(value)
    this.entries.set(key, { value, bytes })
    this.totalBytes += bytes
    this.evict()
  }

  delete(key: string): boolean {
    const existing = this.entries.get(key)
    if (!existing) return false
    this.totalBytes -= existing.bytes
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.totalBytes = 0
  }

  private evict(): void {
    while (
      this.entries.size > 0 &&
      (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes)
    ) {
      const oldest = this.entries.keys().next()
      if (oldest.done) return
      // A single entry over budget still stays — evicting it would leave the cache empty
      // and re-fetching would just put it back.
      if (this.entries.size === 1) return
      this.delete(oldest.value)
    }
  }
}

/** Rough retained size of a value: UTF-16 code units, so ~2 bytes per JSON character. */
export function estimateBytes(value: unknown): number {
  try {
    return (JSON.stringify(value)?.length ?? 0) * 2
  } catch {
    return 0
  }
}
