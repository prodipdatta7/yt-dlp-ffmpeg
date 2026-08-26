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
