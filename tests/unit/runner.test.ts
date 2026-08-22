import { describe, expect, it } from 'vitest'
import { killTree, runCapture } from '../../src/main/binaries/runner'
import { parseFfmpegVersion, parseYtDlpVersion } from '../../src/main/binaries/versions'

describe('runCapture', () => {
  it('executes node as a fixture binary and emits parsed stdout lines', async () => {
    const res = await runCapture(process.execPath, [
      '-e',
      'console.log("MF|downloading|1|2"); console.log("second")',
    ])
    expect(res.code).toBe(0)
    expect(res.stdoutLines).toEqual(['MF|downloading|1|2', 'second'])
  })

  it('captures stderr lines separately (AM-02: no shell involved)', async () => {
    const res = await runCapture(process.execPath, ['-e', 'console.error("boom")'])
    expect(res.code).toBe(0)
    expect(res.stderrLines).toEqual(['boom'])
    expect(res.stdoutLines).toEqual([])
  })

  it('reports non-zero exit codes', async () => {
    const res = await runCapture(process.execPath, ['-e', 'process.exitCode = 3'])
    expect(res.code).toBe(3)
  })

  it('kills the tree on timeout and flags it', async () => {
    const res = await runCapture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeoutMs: 500,
    })
    expect(res.timedOut).toBe(true)
  }, 15_000)

  it('streams lines via callback while running', async () => {
    const seen: string[] = []
    await runCapture(process.execPath, ['-e', 'console.log("one\\n".repeat(3))'], {
      onStdoutLine: (l) => seen.push(l),
    })
    expect(seen).toHaveLength(3)
  })
})

describe('killTree (AM-09)', () => {
  it('terminates the spawned process and its child', async () => {
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, ['tests/fixtures/fake-bin/tree-parent.mjs'], {})
    let payload = ''
    child.stdout?.on('data', (d: Buffer) => (payload += d.toString()))

    const grandchildPid = await new Promise<number>((resolve) => {
      child.stdout?.on('data', () => {
        try {
          resolve(JSON.parse(payload).child)
        } catch {
          return
        }
      })
    })

    const alive = async (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }

    await new Promise((r) => setTimeout(r, 300))
    expect(await alive(child.pid!)).toBe(true)
    expect(await alive(grandchildPid)).toBe(true)

    await killTree(child.pid!)

    const deadline = Date.now() + 10_000
    while ((await alive(grandchildPid)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(await alive(child.pid!)).toBe(false)
    expect(await alive(grandchildPid)).toBe(false)
  }, 20_000)
})

describe('version parsers', () => {
  it('parses yt-dlp --version output', () => {
    expect(parseYtDlpVersion(['2026.08.11'])).toBe('2026.08.11')
    expect(parseYtDlpVersion(['yt-dlp 2025.12.31'])).toBe('2025.12.31')
    expect(parseYtDlpVersion(['no version here'])).toBeNull()
  })

  it('parses ffmpeg -version banner', () => {
    const lines = [
      'ffmpeg version 7.1-lgpl Copyright (c) 2000-2024 the FFmpeg developers',
      'built with gcc 13.2.0',
    ]
    expect(parseFfmpegVersion(lines)).toBe('7.1-lgpl')
    expect(parseFfmpegVersion(['garbage'])).toBeNull()
  })
})
