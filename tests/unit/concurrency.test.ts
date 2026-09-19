import { describe, expect, it } from 'vitest'
import { BATTERY_MAX_CONCURRENT, effectiveMaxConcurrent } from '../../src/main/jobs/orchestrator'

describe('effectiveMaxConcurrent (P6 battery clamp)', () => {
  it('passes the configured value through on AC power', () => {
    expect(effectiveMaxConcurrent(3, false)).toBe(3)
    expect(effectiveMaxConcurrent(5, false)).toBe(5)
    expect(effectiveMaxConcurrent(1, false)).toBe(1)
  })

  it('clamps to BATTERY_MAX_CONCURRENT while on battery', () => {
    expect(effectiveMaxConcurrent(5, true)).toBe(BATTERY_MAX_CONCURRENT)
    expect(effectiveMaxConcurrent(3, true)).toBe(BATTERY_MAX_CONCURRENT)
  })

  it('never raises concurrency on battery when already below the ceiling', () => {
    expect(effectiveMaxConcurrent(2, true)).toBe(2)
    expect(effectiveMaxConcurrent(1, true)).toBe(1)
  })

  it('never drops below 1', () => {
    expect(effectiveMaxConcurrent(0, true)).toBe(1)
  })
})
