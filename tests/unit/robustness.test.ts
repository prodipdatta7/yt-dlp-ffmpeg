import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DownloadOrchestrator } from '../../src/main/jobs/orchestrator'
import { sweepOrphanedTempDirs, ORPHAN_TEMP_MAX_AGE_MS } from '../../src/main/fsops/tempSweep'
import type { JobDonePayload, JobEvent } from '../../src/shared/ipcContract'

const NODE = process.execPath

interface DoneBox {
  value: JobDonePayload | null
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mf-p6-'))
}

function makeOrch(root: string, script: string, extra: Record<string, unknown> = {}) {
  return new DownloadOrchestrator({
    resolveYtDlp: async () => ({ kind: 'yt-dlp', path: NODE, source: 'bundled' }),
    resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: NODE, source: 'bundled' }),
    tempRoot: root,
    spawnArgPrefix: [script],
    ...extra,
  })
}

async function waitForDone(box: DoneBox): Promise<JobDonePayload> {
  for (let i = 0; i < 300 && box.value === null; i += 1) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (box.value === null) throw new Error('job never finished')
  return box.value
}

function jobDirName(url: string): string {
  return `job-${createHash('sha1').update(url).digest('hex').slice(0, 16)}`
}

describe('AM-05 retry ladder on network failures', () => {
  it('retries flaky job and completes after transient failures with visible messages', async () => {
    const root = tempRoot()
    const url = 'https://x.test/watch?v=flaky-1'
    const events: JobEvent[] = []
    const box: DoneBox = { value: null }

    const orch = makeOrch(root, 'tests/fixtures/fake-bin/flaky-network.mjs', {
      retryDelaysMs: [10, 10],
      spawnArgPrefix: ['tests/fixtures/fake-bin/flaky-network.mjs', join(root, 'state.json')],
    })
    const jobId = await orch.launch(
      { url, mode: 'video-audio', destDir: join(root, 'dest') },
      (e) => events.push(e),
      (d) => {
        box.value = d
      },
    )

    const done = await waitForDone(box)
    expect(done.status).toBe('completed')
    expect(readFileSync(done.outputPath!, 'utf8')).toContain('RETRY-SUCCESS')

    expect(events.filter((e) => e.message?.includes('retrying')).length).toBe(2)

    const attemptsState = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))
    expect(attemptsState.attempts).toBe(3)
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/)
  }, 30_000)

  it('does not retry non-network failures', async () => {
    const root = tempRoot()
    const box: DoneBox = { value: null }

    const orch = makeOrch(root, 'tests/fixtures/fake-bin/fake-ytdlp-fail.mjs', {
      retryDelaysMs: [10, 10],
    })
    await orch.launch(
      { url: 'https://x.test/watch?v=rate', mode: 'video-audio', destDir: join(root, 'dest') },
      () => undefined,
      (d) => {
        box.value = d
      },
    )

    const done = await waitForDone(box)
    expect(done.status).toBe('failed')
    expect(done.errorCode).toBe('MF_RATE_LIMITED')
  }, 30_000)
})

describe('resume reuses deterministic temp dir (partials preserved across launches)', () => {
  it('failed attempt leaves job dir intact for the same URL', async () => {
    const root = tempRoot()
    const url = 'https://x.test/watch?v=resume-1'

    const failing = makeOrch(root, 'tests/fixtures/fake-bin/fake-ytdlp-fail.mjs', {
      retryDelaysMs: [],
    })
    const box: DoneBox = { value: null }
    await failing.launch(
      { url, mode: 'video-audio', destDir: join(root, 'dest') },
      () => undefined,
      (d) => {
        box.value = d
      },
    )
    await waitForDone(box)

    expect(existsSync(join(root, jobDirName(url)))).toBe(true)
  }, 30_000)
})

describe('EC-06 live recording stop-to-save', () => {
  it('stop converts cancelled live job into a saved file', async () => {
    const root = tempRoot()
    const url = 'https://x.test/live/now'
    const box: DoneBox = { value: null }

    const orch = makeOrch(root, 'tests/fixtures/fake-bin/live-record.mjs')
    const jobId = await orch.launch(
      { url, mode: 'video-audio', destDir: join(root, 'dest'), isLive: true },
      () => undefined,
      (d) => {
        box.value = d
      },
    )

    for (let i = 0; i < 50 && !orch.cancel(jobId); i += 1) {
      await new Promise((r) => setTimeout(r, 100))
    }

    const done = await waitForDone(box)
    expect(done.status).toBe('completed')
    expect(done.outputPath!.endsWith('.mp4')).toBe(true)
    expect(readFileSync(done.outputPath!, 'utf8')).toContain('LIVE-RECORDING-DATA')
    expect(existsSync(join(root, jobDirName(url)))).toBe(false)
  }, 30_000)
})

describe('orphaned temp sweep (AM-06)', () => {
  it('removes only stale job dirs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-sweep-'))
    const { mkdirSync, utimesSync } = await import('node:fs')

    mkdirSync(join(root, 'job-stale'), { recursive: true })
    mkdirSync(join(root, 'job-fresh'), { recursive: true })
    const staleTime = new Date(Date.now() - ORPHAN_TEMP_MAX_AGE_MS - 60_000)
    utimesSync(join(root, 'job-stale'), staleTime, staleTime)

    const removed = sweepOrphanedTempDirs(root)

    expect(removed).toBe(1)
    expect(existsSync(join(root, 'job-stale'))).toBe(false)
    expect(existsSync(join(root, 'job-fresh'))).toBe(true)
  })

  it('is a no-op when temp root does not exist', () => {
    expect(sweepOrphanedTempDirs(join(tmpdir(), 'mf-missing-xyz-999'))).toBe(0)
  })
})
