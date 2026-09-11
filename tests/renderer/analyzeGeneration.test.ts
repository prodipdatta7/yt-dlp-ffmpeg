import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnalyzeResponse } from '../../src/shared/ipcContract'
import type { AnalyzeResult } from '../../src/shared/models'
import {
  analysis,
  analyzeError,
  analyzing,
  currentAnalyzeGeneration,
  resetAnalysis,
  triggerAnalyze,
} from '../../src/renderer/src/signals/appState'

function videoResult(title: string): AnalyzeResult {
  return {
    kind: 'video',
    metadata: {
      id: title,
      title,
      uploader: null,
      durationSec: null,
      viewCount: null,
      uploadDate: null,
      thumbnailUrl: null,
      isLive: false,
      webpageUrl: null,
    },
    formats: [],
  }
}

interface Deferred {
  promise: Promise<AnalyzeResponse>
  resolve: (value: AnalyzeResponse) => void
}

function deferred(): Deferred {
  let resolve!: (value: AnalyzeResponse) => void
  const promise = new Promise<AnalyzeResponse>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

interface Stub {
  pending: Deferred[]
  cancelCalls: number
}

function installMfStub(): Stub {
  const stub: Stub = { pending: [], cancelCalls: 0 }
  ;(globalThis as { window?: unknown }).window = {
    mf: {
      analyzeStart: () => {
        const d = deferred()
        stub.pending.push(d)
        return d.promise
      },
      analyzeCancel: async () => {
        stub.cancelCalls += 1
        return { ok: true }
      },
      analyzeHydrateRange: async () => ({ ok: true }),
    },
  }
  return stub
}

describe('analyze generation token (T8 / P-08)', () => {
  let stub: Stub

  beforeEach(() => {
    stub = installMfStub()
    resetAnalysis()
    analyzing.value = false
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('bumps the generation on every reset, invalidating anything in flight', () => {
    const before = currentAnalyzeGeneration()
    resetAnalysis()
    expect(currentAnalyzeGeneration()).toBeGreaterThan(before)
  })

  it('keeps the second result when a slow first analysis resolves afterwards', async () => {
    const first = triggerAnalyze('https://x.test/one')
    await Promise.resolve()
    expect(analyzing.value).toBe(true)

    const second = triggerAnalyze('https://x.test/two')
    await Promise.resolve()
    expect(stub.cancelCalls).toBe(1)
    expect(stub.pending).toHaveLength(2)

    stub.pending[1].resolve({ kind: 'ok', result: videoResult('second') })
    await second

    expect(analysis.value?.metadata.title).toBe('second')
    expect(analyzing.value).toBe(false)

    // The superseded request now lands. It must change nothing.
    stub.pending[0].resolve({ kind: 'ok', result: videoResult('first') })
    await first

    expect(analysis.value?.metadata.title).toBe('second')
    expect(analyzing.value).toBe(false)
  })

  it('does not let a superseded request clear analyzing under the new one', async () => {
    const first = triggerAnalyze('https://x.test/one')
    await Promise.resolve()

    const second = triggerAnalyze('https://x.test/two')
    await Promise.resolve()

    // First resolves while the second is still in flight.
    stub.pending[0].resolve({ kind: 'ok', result: videoResult('first') })
    await first

    expect(analyzing.value).toBe(true)
    expect(analysis.value).toBeNull()

    stub.pending[1].resolve({ kind: 'ok', result: videoResult('second') })
    await second
    expect(analyzing.value).toBe(false)
  })

  it('drops a superseded error so it cannot surface under the new request', async () => {
    const first = triggerAnalyze('https://x.test/one')
    await Promise.resolve()
    const second = triggerAnalyze('https://x.test/two')
    await Promise.resolve()

    stub.pending[0].resolve({
      kind: 'error',
      code: 'MF_BOT_CHECK',
      message: 'stale failure',
    })
    await first
    expect(analyzeError.value).toBeNull()

    stub.pending[1].resolve({ kind: 'ok', result: videoResult('second') })
    await second
    expect(analyzeError.value).toBeNull()
    expect(analysis.value?.metadata.title).toBe('second')
  })

  it('cancels the in-flight analysis before starting a new one (AM-09)', async () => {
    const first = triggerAnalyze('https://x.test/one')
    await Promise.resolve()
    expect(stub.cancelCalls).toBe(0)

    const second = triggerAnalyze('https://x.test/two')
    await Promise.resolve()
    expect(stub.cancelCalls).toBe(1)

    stub.pending[0].resolve({ kind: 'ok', result: videoResult('first') })
    stub.pending[1].resolve({ kind: 'ok', result: videoResult('second') })
    await Promise.all([first, second])
  })

  it('survives a storm of cancel/restart cycles with consistent final state', async () => {
    const runs: Promise<void>[] = []
    for (let i = 0; i < 100; i += 1) {
      runs.push(triggerAnalyze(`https://x.test/${i}`))
      await Promise.resolve()
    }

    // Resolve every request, oldest first — only the newest may be applied.
    stub.pending.forEach((d, i) => d.resolve({ kind: 'ok', result: videoResult(`r${i}`) }))
    await Promise.all(runs)

    expect(analysis.value?.metadata.title).toBe(`r${stub.pending.length - 1}`)
    expect(analyzing.value).toBe(false)
  })
})
