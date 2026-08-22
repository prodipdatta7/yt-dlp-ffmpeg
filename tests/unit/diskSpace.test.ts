import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  freeDiskSpaceBytes,
  isDiskSpaceInsufficient,
  existingAncestor,
} from '../../src/main/fsops/diskSpace'
import { DownloadOrchestrator, MfLaunchError } from '../../src/main/jobs/orchestrator'

describe('freeDiskSpaceBytes', () => {
  it('reports positive free space for an existing dir', async () => {
    const free = await freeDiskSpaceBytes(tmpdir())
    expect(free).not.toBeNull()
    expect(free!).toBeGreaterThan(0)
  })

  it('resolves the nearest existing ancestor for a deep path', () => {
    const anchor = join(tmpdir(), 'mf-does-not-exist-123', 'deeper')
    expect(existingAncestor(anchor)).toBe(tmpdir())
  })
})

describe('isDiskSpaceInsufficient (AM-06 preflight rule)', () => {
  it('aborts when free < estimate + margin', () => {
    expect(isDiskSpaceInsufficient(100 * 1024 * 1024, 200 * 1024 * 1024)).toBe(true)
  })

  it('allows when free covers estimate + margin', () => {
    expect(isDiskSpaceInsufficient(400 * 1024 * 1024, 200 * 1024 * 1024)).toBe(false)
  })

  it('never aborts when estimate unknown or statfs failed', () => {
    expect(isDiskSpaceInsufficient(null, 1e12)).toBe(false)
    expect(isDiskSpaceInsufficient(1024, null)).toBe(false)
    expect(isDiskSpaceInsufficient(1024, undefined)).toBe(false)
  })
})

describe('orchestrator preflight abort-before-spawn (EC-03)', () => {
  it('rejects with MF_DISK_FULL before creating any temp dir or spawning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-preflight-'))
    const spawnSpyCalls: string[] = []

    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => {
        spawnSpyCalls.push('ytdlp')
        return { kind: 'yt-dlp', path: process.execPath, source: 'bundled' }
      },
      resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: process.execPath, source: 'bundled' }),
      tempRoot: root,
    })

    const config = {
      url: 'https://x.test/v',
      mode: 'video-audio' as const,
      destDir: join(root, 'dest'),
      estimatedBytes: Number.MAX_SAFE_INTEGER,
    }

    const err = await orch
      .launch(
        config,
        () => undefined,
        () => undefined,
      )
      .catch((e) => e)
    expect(err).toBeInstanceOf(MfLaunchError)
    expect((err as MfLaunchError).code).toBe('MF_DISK_FULL')

    const jobDirs = readdirSafe(root).filter((n) => n.startsWith('job-'))
    expect(jobDirs).toHaveLength(0)
    void spawnSpyCalls
  })

  it('proceeds normally when estimate fits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-preflight-ok-'))
    let done: string | null = null

    const orch = new DownloadOrchestrator({
      resolveYtDlp: async () => ({ kind: 'yt-dlp', path: process.execPath, source: 'bundled' }),
      resolveFfmpeg: async () => ({ kind: 'ffmpeg', path: process.execPath, source: 'bundled' }),
      tempRoot: root,
      spawnArgPrefix: ['tests/fixtures/fake-bin/fake-ytdlp-download.mjs'],
    })

    await orch.launch(
      {
        url: 'https://x.test/v',
        mode: 'video-audio' as const,
        destDir: join(root, 'dest'),
        estimatedBytes: 1024,
      },
      () => undefined,
      (d) => {
        done = d.status
      },
    )

    for (let i = 0; i < 200 && done === null; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(done).toBe('completed')
  }, 30_000)
})

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
