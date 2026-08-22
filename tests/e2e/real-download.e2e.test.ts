import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BinariesService } from '../../src/main/binaries/service'
import { platformDir, type BinaryCandidate } from '../../src/main/binaries/locator'
import { DownloadOrchestrator } from '../../src/main/jobs/orchestrator'
import type { JobDonePayload } from '../../src/shared/ipcContract'

const enabled = process.env.MF_E2E_REAL === '1'
const d = it

describe.skipIf(!enabled)('real-network e2e (MF_E2E_REAL=1)', () => {
  d(
    'orchestrator downloads a small public clip through the REAL argv path and lands it in dest',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'mf-e2e-'))
      const dirName = platformDir(process.platform, process.arch)
      const candidates: BinaryCandidate[] = [
        { dir: join(root, 'no-user'), source: 'userData' },
        { dir: join(process.cwd(), 'binaries', dirName), source: 'bundled' },
      ]
      const binaries = new BinariesService({ platform: process.platform, candidates })
      const orch = new DownloadOrchestrator({
        resolveYtDlp: () => binaries.locate('yt-dlp'),
        resolveFfmpeg: () => binaries.locate('ffmpeg'),
        tempRoot: join(root, 'tmp'),
      })

      const box: { value: JobDonePayload | null } = { value: null }
      const jobId = await orch.launch(
        {
          url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
          mode: 'video-audio',
          tier: 360,
          container: 'mp4',
          destDir: join(root, 'dest'),
        },
        () => undefined,
        (done) => {
          box.value = done
        },
      )
      void jobId

      for (let i = 0; i < 1200 && box.value === null; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
      }
      expect(box.value).not.toBeNull()
      const done = box.value!
      expect(done.status).toBe('completed')
      expect(done.outputPath).toBeTruthy()
      expect(existsSync(done.outputPath!)).toBe(true)
    },
    600_000,
  )
})
