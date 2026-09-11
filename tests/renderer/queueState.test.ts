import { beforeEach, describe, expect, it } from 'vitest'
import {
  earlyResultCount,
  queueRunning,
  resetQueueForNewAnalysis,
  resolveJob,
  waitForJob,
  type JobResult,
} from '../../src/renderer/src/signals/queueState'

const COMPLETED: JobResult = { status: 'completed', outputPath: 'C:/out/a.mp4' }

describe('early job completions (T9 / P-08)', () => {
  beforeEach(() => {
    queueRunning.value = false
    resetQueueForNewAnalysis()
  })

  it('still resolves when the completion lands before the waiter registers', async () => {
    resolveJob('j1', COMPLETED)
    expect(earlyResultCount()).toBe(1)

    await expect(waitForJob('j1')).resolves.toEqual(COMPLETED)
    // Consumed, not left to accumulate.
    expect(earlyResultCount()).toBe(0)
  })

  it('resolves normally when the waiter registers first', async () => {
    const pending = waitForJob('j1')
    resolveJob('j1', COMPLETED)

    await expect(pending).resolves.toEqual(COMPLETED)
    expect(earlyResultCount()).toBe(0)
  })

  it('keeps completions apart by job id', async () => {
    resolveJob('a', { status: 'completed', outputPath: 'a.mp4' })
    resolveJob('b', { status: 'failed' })

    await expect(waitForJob('b')).resolves.toEqual({ status: 'failed' })
    await expect(waitForJob('a')).resolves.toEqual({
      status: 'completed',
      outputPath: 'a.mp4',
    })
  })

  it('evicts the oldest completion past the cap rather than growing without bound', async () => {
    for (let i = 0; i < 40; i += 1) resolveJob(`j${i}`, { status: 'completed' })

    expect(earlyResultCount()).toBe(32)

    // j0..j7 were evicted; their waiters fall back to waiting for a fresh event.
    let settled = false
    void waitForJob('j0').then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    // The newest 32 are still buffered.
    await expect(waitForJob('j39')).resolves.toEqual({ status: 'completed' })
  })

  it('clears buffered completions when a new analysis resets the queue', async () => {
    resolveJob('reset-1', COMPLETED)
    expect(earlyResultCount()).toBe(1)

    resetQueueForNewAnalysis()
    expect(earlyResultCount()).toBe(0)

    let settled = false
    void waitForJob('reset-1').then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
  })

  it('leaves buffered completions alone while a queue run owns the rows', () => {
    resolveJob('running-1', COMPLETED)
    queueRunning.value = true
    resetQueueForNewAnalysis()

    expect(earlyResultCount()).toBe(1)
    queueRunning.value = false
  })
})
