import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DownloadOrchestrator } from '../../src/main/jobs/orchestrator'
import { sanitizeFileName } from '../../src/main/fsops/sanitizer'
import type { JobDonePayload, JobEvent } from '../../src/shared/ipcContract'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mf-orch-'))
}

const NODE = process.execPath

interface DoneBox {
  value: JobDonePayload | null
}

function makeOrch(root: string, script: string) {
  return new DownloadOrchestrator({
    resolveYtDlp: async () => ({ kind: 'yt-dlp', path: NODE, source: 'bundled' }),
    resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: NODE, source: 'bundled' }),
    tempRoot: root,
    spawnArgPrefix: [script],
  })
}

async function waitForDone(box: DoneBox): Promise<JobDonePayload> {
  for (let i = 0; i < 200 && box.value === null; i += 1) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (box.value === null) throw new Error('job never finished')
  return box.value
}

const CONFIG = (root: string) => ({
  url: 'https://x.test/watch?v=abc',
  mode: 'video-audio' as const,
  tier: 720,
  container: 'mp4' as const,
  destDir: join(root, 'dest'),
})

describe('DownloadOrchestrator', () => {
  it('refuses to launch when engines are missing', async () => {
    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => null,
      resolveFfmpeg: async () => null,
      tempRoot: tempRoot(),
    })
    await expect(
      orch.launch(
        CONFIG(tempRoot()),
        () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow(/not installed/)
  })

  it('runs a canned two-stream job end-to-end with correct phases and cleanup-on-verify (AM-06)', async () => {
    const root = tempRoot()
    const events: JobEvent[] = []
    const box: DoneBox = { value: null }

    const orch = makeOrch(root, 'tests/fixtures/fake-bin/fake-ytdlp-download.mjs')
    const jobId = await orch.launch(
      CONFIG(root),
      (e) => events.push(e),
      (d) => {
        box.value = d
      },
    )

    expect(jobId).toMatch(/^[0-9a-f-]{36}$/)

    const finished = await waitForDone(box)

    expect(finished.status).toBe('completed')
    expect(finished.outputPath).toBeDefined()
    expect(finished.outputPath?.startsWith(destOf(root))).toBe(true)

    const phases = events.map((e) => e.phase)
    for (const expected of [
      'queued',
      'downloading-video',
      'downloading-audio',
      'merging',
      'finalizing',
    ]) {
      expect(phases).toContain(expected)
    }

    const audioEvents = events.filter((e) => e.phase === 'downloading-audio')
    expect(audioEvents.some((e) => e.speedBps === 524288)).toBe(true)

    expect(readFileSync(finished.outputPath!, 'utf8')).toContain('FAKE-MP4-CONTENT')
    expect(existsSync(join(root, `job-${jobId}`))).toBe(false)
  }, 30_000)

  it('retains temp partials on failure and classifies the error', async () => {
    const root = tempRoot()
    const box: DoneBox = { value: null }

    const orch = makeOrch(root, 'tests/fixtures/fake-bin/fake-ytdlp-fail.mjs')
    await orch.launch(
      CONFIG(root),
      () => undefined,
      (d) => {
        box.value = d
      },
    )

    const finished = await waitForDone(box)
    expect(finished.status).toBe('failed')
    expect(finished.errorCode).toBe('MF_RATE_LIMITED')

    const jobDirs = readdirSafe(root).filter((n) => n.startsWith('job-'))
    expect(jobDirs.length).toBeGreaterThan(0)
    expect(existsSync(join(root, jobDirs[0]))).toBe(true)
  }, 30_000)

  it('nests playlist downloads into a sanitized subfolder named after the playlist', async () => {
    const root = tempRoot()
    const box: DoneBox = { value: null }

    const orch = makeOrch(root, 'tests/fixtures/fake-bin/fake-ytdlp-download.mjs')
    await orch.launch(
      {
        url: 'https://x.test/playlist/1',
        mode: 'video-audio' as const,
        tier: 360,
        container: 'mp4' as const,
        destDir: join(root, 'dest'),
        playlistTitle: 'AC/DC: Best?*Mix <2026>',
      },
      () => undefined,
      (d) => {
        box.value = d
      },
    )

    const done = await waitForDone(box)
    expect(done.status).toBe('completed')
    const expectedFolder = join(root, 'dest', sanitizeFileName('AC/DC: Best?*Mix <2026>'))
    expect(done.outputPath!.startsWith(expectedFolder)).toBe(true)
  }, 30_000)

  it('cancel with no active job returns false safely', () => {
    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => null,
      resolveFfmpeg: async () => null,
      tempRoot: tempRoot(),
    })
    expect(orch.cancel()).toBe(false)
    expect(orch.isBusy()).toBe(false)
  })

  it('allows bounded parallel launches and rejects over the concurrency cap (D2a)', async () => {
    const root = tempRoot()
    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => ({ kind: 'yt-dlp', path: NODE, source: 'bundled' }),
      resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: NODE, source: 'bundled' }),
      tempRoot: root,
      spawnArgPrefix: ['tests/fixtures/fake-bin/fake-ytdlp-hang.mjs'],
      getMaxConcurrent: () => 2,
    })

    const boxes: DoneBox[] = [{ value: null }, { value: null }]
    const id1 = await orch.launch(
      { ...CONFIG(root), url: 'https://x.test/a' },
      () => undefined,
      (d) => {
        boxes[0].value = d
      },
    )
    const id2 = await orch.launch(
      { ...CONFIG(root), url: 'https://x.test/b' },
      () => undefined,
      (d) => {
        boxes[1].value = d
      },
    )
    expect(id1).not.toBe(id2)
    expect(orch.activeCount()).toBe(2)

    await expect(
      orch.launch(
        { ...CONFIG(root), url: 'https://x.test/c' },
        () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow(/concurrency/i)

    expect(orch.cancel(id1)).toBe(true)
    expect(orch.cancel(id2)).toBe(true)
    await waitForDone(boxes[0])
    await waitForDone(boxes[1])
  }, 30_000)

  it('disk preflight sums reserved estimates across in-flight jobs (D2a)', async () => {
    const root = tempRoot()
    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => ({ kind: 'yt-dlp', path: NODE, source: 'bundled' }),
      resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: NODE, source: 'bundled' }),
      tempRoot: root,
      spawnArgPrefix: ['tests/fixtures/fake-bin/fake-ytdlp-hang.mjs'],
      getMaxConcurrent: () => 3,
      getFreeDiskBytes: async () => 200 * 1024 * 1024,
    })

    const box: DoneBox = { value: null }
    const id = await orch.launch(
      { ...CONFIG(root), url: 'https://x.test/big1', estimatedBytes: 80 * 1024 * 1024 },
      () => undefined,
      (d) => {
        box.value = d
      },
    )
    // 80 + 80 + 50MB margin = 210MB > 200MB free → reject
    await expect(
      orch.launch(
        { ...CONFIG(root), url: 'https://x.test/big2', estimatedBytes: 80 * 1024 * 1024 },
        () => undefined,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'MF_DISK_FULL' })
    orch.cancel(id)
    await waitForDone(box)
  }, 30_000)
})

function destOf(root: string): string {
  return join(root, 'dest')
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
