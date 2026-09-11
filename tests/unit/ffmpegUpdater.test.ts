import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractFirstSha256,
  FfmpegUpdater,
  type FfmpegUpdaterDeps,
} from '../../src/main/binaries/ffmpegUpdater'
import { releaseDownloadUrl } from '../../src/main/binaries/updater'

const TAG = 'autobuild-2026-08-19-00-00'
const TAG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest'
const ZIP_URL = releaseDownloadUrl('BtbN', 'FFmpeg-Builds', 'ffmpeg-master-latest-win64-lgpl.zip')
const SHA_URL = releaseDownloadUrl(
  'BtbN',
  'FFmpeg-Builds',
  'ffmpeg-master-latest-win64-lgpl.zip.sha256',
)
const ZIP_BYTES = Buffer.alloc(1_100_000, 0x5a) // 'Z' — over MIN_ZIP_BYTES
const EXE_CONTENT = 'FAKE-FFMPEG-BINARY-CONTENT'

function shaSidecar(data: Buffer): Buffer {
  return Buffer.from(
    `${createHash('sha256').update(data).digest('hex')}  ffmpeg-master-latest-win64-lgpl.zip\n`,
    'utf8',
  )
}

interface FetchRoute {
  body?: Buffer
  status?: number
  headers?: Record<string, string>
}

function fakeFetch(routes: Record<string, FetchRoute>) {
  return async (url: string | URL | Request): Promise<Response> => {
    const key = String(url)
    const route = routes[key]
    if (!route) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(route.body ?? Buffer.alloc(0)), {
      status: route.status ?? 200,
      headers: route.headers,
    })
  }
}

function routes(): Record<string, FetchRoute> {
  return {
    [TAG_URL]: {
      status: 302,
      headers: { location: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${TAG}` },
    },
    [ZIP_URL]: { body: ZIP_BYTES },
    [SHA_URL]: { body: shaSidecar(ZIP_BYTES) },
  }
}

function makeUpdater(
  dir: string,
  routeMap: Record<string, FetchRoute>,
  opts: Partial<FfmpegUpdaterDeps> = {},
): FfmpegUpdater {
  return new FfmpegUpdater({
    overrideDir: dir,
    getCurrentVersion: async () => 'n7.1-3-g000',
    fetchFn: fakeFetch(routeMap) as typeof fetch,
    ...opts,
  })
}

async function fakeExtract(_zipPath: string, destDir: string): Promise<void> {
  mkdirSync(join(destDir, 'bin'), { recursive: true })
  writeFileSync(join(destDir, 'bin', 'ffmpeg.exe'), EXE_CONTENT, 'utf8')
  writeFileSync(join(destDir, 'bin', 'ffprobe.exe'), 'FAKE-FFPROBE', 'utf8')
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mf-ffmpeg-'))
}

describe('extractFirstSha256', () => {
  it('takes the first 64-hex token and lowercases it', () => {
    expect(extractFirstSha256(`${'A'.repeat(64)}  some-file.zip\n`)).toBe('a'.repeat(64))
    expect(extractFirstSha256('garbage')).toBeNull()
  })
})

describe('ffmpeg updater flow against mocked github.com (no network, no REST API)', () => {
  it('reports an update when nothing has been installed yet', async () => {
    const updater = makeUpdater(freshDir(), routes())
    const result = await updater.check()
    expect(result.updateAvailable).toBe(true)
    expect(result.current).toBe('n7.1-3-g000')
    expect(result.latest).toBe(TAG)
  })

  it('downloads, verifies, extracts and installs the override with progressive phases', async () => {
    const dir = freshDir()
    const phases: string[] = []
    const updater = makeUpdater(dir, routes(), {
      extract: fakeExtract,
      verifyInstalled: async () => 'n7.1-4-g999',
      onPhase: (p: string) => phases.push(p),
    })

    const result = await updater.apply()

    expect(result.ok).toBe(true)
    expect(result.newVersion).toBe('n7.1-4-g999')
    expect(readFileSync(join(dir, 'ffmpeg.exe'), 'utf8')).toContain('FAKE-FFMPEG')
    expect(existsSync(join(dir, 'ffprobe.exe'))).toBe(true)
    expect(existsSync(join(dir, '.ffmpeg-update.json'))).toBe(true)
    expect(phases).toEqual([
      'checking',
      'downloading',
      'verifying',
      'swapping',
      'verifying-install',
    ])
  })

  it('reports up to date after an update is installed', async () => {
    const dir = freshDir()
    const installer = makeUpdater(dir, routes(), {
      extract: fakeExtract,
      verifyInstalled: async () => 'n7.1-4-g999',
    })
    await installer.apply()

    const checker = makeUpdater(dir, routes(), {})
    const result = await checker.check()
    expect(result.updateAvailable).toBe(false)
  })

  it('rejects a tampered archive on checksum mismatch and installs nothing', async () => {
    const dir = freshDir()
    const tampered = routes()
    tampered[ZIP_URL] = { body: Buffer.alloc(1_100_000, 0x00) }
    const updater = makeUpdater(dir, tampered, { extract: fakeExtract })

    const result = await updater.apply()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum mismatch/i)
    expect(existsSync(join(dir, 'ffmpeg.exe'))).toBe(false)
  })

  it('keeps the previous binary when the new build fails to run', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'ffmpeg.exe'), 'OLD-OVERRIDE-CONTENT', 'utf8')
    const updater = makeUpdater(dir, routes(), {
      extract: fakeExtract,
      verifyInstalled: async () => null,
    })

    const result = await updater.apply()

    expect(result.ok).toBe(false)
    expect(readFileSync(join(dir, 'ffmpeg.exe'), 'utf8')).toBe('OLD-OVERRIDE-CONTENT')
  })

  it('surfaces resolution errors without throwing', async () => {
    const dir = freshDir()
    const failing = makeUpdater(dir, {
      [SHA_URL]: { status: 404 },
    })
    const result = await failing.check()
    expect(result.updateAvailable).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

/**
 * P-03 regression guard. The updater used to hold the whole zip in main-process memory
 * while hashing, writing, extracting and reading executables back in. It now streams the
 * archive to disk and hashes it on the way past, so a quarter-gigabyte build has to stay
 * bounded in `arrayBuffers` from download through swap.
 */
describe('ffmpeg updater memory ceiling (T6)', () => {
  const MIB = 1024 * 1024
  // 64 KiB chunks, as a real fetch body delivers them — 250 MB in total.
  const CHUNK = Buffer.alloc(64 * 1024, 0x5a)
  const CHUNKS = (250 * MIB) / CHUNK.length

  function bigBodyResponse(onChunk: () => void): Response {
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= CHUNKS) {
          controller.close()
          return
        }
        sent += 1
        onChunk()
        controller.enqueue(new Uint8Array(CHUNK))
      },
    })
    return new Response(body, { status: 200 })
  }

  function bigBodySha(): string {
    const hash = createHash('sha256')
    for (let i = 0; i < CHUNKS; i += 1) hash.update(CHUNK)
    return hash.digest('hex')
  }

  it('keeps arrayBuffers bounded while applying a 250 MB build', async () => {
    const dir = freshDir()
    const sidecar = Buffer.from(`${bigBodySha()}  ffmpeg-master-latest-win64-lgpl.zip\n`, 'utf8')

    globalThis.gc?.()
    const baseline = process.memoryUsage().arrayBuffers
    let peak = 0
    let pulls = 0
    const sample = (): void => {
      // Collect first: arrayBuffers counts garbage that has not been reclaimed yet, and
      // this test is about what is *retained*, not about GC timing.
      globalThis.gc?.()
      peak = Math.max(peak, process.memoryUsage().arrayBuffers - baseline)
    }
    // Sampling every chunk would make the GC dominate the run; every 256 is ~16 MB apart.
    const onChunk = (): void => {
      if (pulls++ % 256 === 0) sample()
    }

    const fetchFn = (async (url: string | URL | Request): Promise<Response> => {
      const key = String(url)
      if (key === TAG_URL) {
        return new Response(null, {
          status: 302,
          headers: { location: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${TAG}` },
        })
      }
      if (key === SHA_URL) return new Response(new Uint8Array(sidecar))
      if (key === ZIP_URL) return bigBodyResponse(onChunk)
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const updater = new FfmpegUpdater({
      overrideDir: dir,
      getCurrentVersion: async () => 'n7.1-3-g000',
      fetchFn,
      extract: fakeExtract,
      verifyInstalled: async () => 'n7.2-1-gabc',
    })

    const result = await updater.apply()
    sample()

    expect(result.ok).toBe(true)
    expect(readFileSync(join(dir, 'ffmpeg.exe'), 'utf8')).toBe(EXE_CONTENT)
    // The bound is generous because `arrayBuffers` also counts stream buffers in flight and
    // pool slack: observed peaks here are ~20-36 MB and vary run to run. What it catches is
    // the defect it was written for — the pre-fix path materialized the whole asset via
    // `arrayBuffer()`, so its peak was >= the full 250 MB.
    expect(peak).toBeLessThan(64 * MIB)
  }, 120_000)
})
