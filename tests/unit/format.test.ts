import { describe, expect, it } from 'vitest'
import { fmtSize } from '../../src/renderer/src/utils/format'

describe('fmtSize', () => {
  it('uses MB below one GiB and GB at or above one GiB', () => {
    expect(fmtSize(512 * 1024 * 1024)).toBe('512.0 MB')
    expect(fmtSize(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(fmtSize(2282 * 1024 * 1024)).toBe('2.23 GB')
  })
})
