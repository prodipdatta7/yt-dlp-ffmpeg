/**
 * Index of the last item whose key is <= `t`, or 0 when every key is greater. Items must be
 * ascending by key. Returns -1 only for an empty array.
 *
 * Replaces the backward linear scans that ran on every playback tick (P-06). Note the linear
 * version's worst case was *early* in playback, when `t` is small and the scan walks the whole
 * array — the opposite of the intuition that long videos degrade over time.
 */
export function findActiveIndex<T>(
  items: readonly T[],
  t: number,
  key: (item: T) => number,
): number {
  if (items.length === 0) return -1
  let lo = 0
  let hi = items.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(items[mid]) <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
