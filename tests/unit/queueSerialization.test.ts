import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DownloadOrchestrator } from '../../src/main/jobs/orchestrator'
import type { JobDonePayload, JobEvent } from '../../src/shared/ipcContract'

const NODE = process.execPath

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mf-queue-'))
}

describe('AM-07 queue serialization (default maxConcurrent=1)', () => {
  it('rejects a second launch while the first is still running', async () => {
    const root = tempRoot()
    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => ({ kind: 'yt-dlp', path: NODE, source: 'bundled' }),
      resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: NODE, source: 'bundled' }),
      tempRoot: root,
      spawnArgPrefix: ['tests/fixtures/fake-bin/slow-download.mjs'],
    })

    const config = {
      url: 'https://x.test/v',
      mode: 'video-audio' as const,
      destDir: join(root, 'dest'),
    }

    const doneBox: { value: JobDonePayload | null } = { value: null }
    const events: JobEvent[] = []
    await orch.launch(
      config,
      (e) => events.push(e),
      (d) => {
        doneBox.value = d
      },
    )

    expect(orch.isBusy()).toBe(true)
    await expect(
      orch.launch(
        config,
        (e) => events.push(e),
        (d) => {
          doneBox.value = d
        },
      ),
    ).rejects.toThrow(/concurrency limit/i)

    orch.cancel()
    for (let i = 0; i < 100 && doneBox.value === null; i += 1) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(doneBox.value?.status).toBe('cancelled')
    expect(orch.isBusy()).toBe(false)
  }, 20_000)
})
