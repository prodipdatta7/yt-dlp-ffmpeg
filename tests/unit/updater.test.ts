import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  downloadBuffer,
  downloadToFile,
  MAX_SIDECAR_BYTES,
  extractExpectedChecksum,
  isNewerVersion,
  releaseDownloadUrl,
  resolveLatestTag,
  sha256Hex,
  YtDlpUpdater,
  type UpdaterDeps,
} from '../../src/main/binaries/updater'

const TAG = '2026.09.01'
const EXE_BYTES = Buffer.from('FAKE-YT-DLP-BINARY-CONTENT'.repeat(64), 'utf8')
const TAG_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest'
const EXE_URL = releaseDownloadUrl('yt-dlp', 'yt-dlp', 'yt-dlp.exe')
const SUMS_URL = releaseDownloadUrl('yt-dlp', 'yt-dlp', 'SHA2-256SUMS')

function sumsText(data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex')
  return `${hash}  yt-dlp.exe\n${'a'.repeat(64)}  other-file\n`
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
      headers: { location: `https://github.com/yt-dlp/yt-dlp/releases/tag/${TAG}` },
    },
    [EXE_URL]: { body: EXE_BYTES },
    [SUMS_URL]: { body: Buffer.from(sumsText(EXE_BYTES), 'utf8') },
  }
}

function makeUpdater(
  dir: string,
  routeMap: Record<string, FetchRoute>,
  opts: Partial<UpdaterDeps> = {},
): YtDlpUpdater {
  return new YtDlpUpdater({
    overrideDir: dir,
    getCurrentVersion: async () => '2025.01.01',
    fetchFn: fakeFetch(routeMap) as typeof fetch,
    ...opts,
  })
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mf-updater-'))
}

describe('version comparison', () => {
  it('orders date-based tags numerically per segment', () => {
    expect(isNewerVersion('2025.12.31', '2026.08.19')).toBe(true)
    expect(isNewerVersion('2026.08.19', '2026.08.19')).toBe(false)
    expect(isNewerVersion('2026.08.19', '2026.07.99')).toBe(false)
    expect(compareVersions('2026.08.19', '2026.08.19.1')).toBeLessThan(0)
  })
})

describe('resolveLatestTag', () => {
  it('reads the tag from the releases/latest redirect location', async () => {
    const tag = await resolveLatestTag('yt-dlp', 'yt-dlp', fakeFetch(routes()) as typeof fetch)
    expect(tag).toBe(TAG)
  })
})

describe('checksum helpers', () => {
  it('parses the SHA2-256SUMS line including binary-marker format', () => {
    const text = `  ${'f'.repeat(64)}   *other.bin\n  ${'e'.repeat(64)} *yt-dlp.exe\n`
    expect(extractExpectedChecksum(text, 'yt-dlp.exe')).toBe('e'.repeat(64))
    expect(extractExpectedChecksum('garbage', 'yt-dlp.exe')).toBeNull()
  })

  it('computes a known sha256 vector', () => {
    expect(sha256Hex(Buffer.from('abc', 'utf8'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('updater flow against mocked github.com (no network, no REST API)', () => {
  it('reports availability between current and latest tag', async () => {
    const updater = makeUpdater(freshDir(), routes())
    const result = await updater.check()
    expect(result.updateAvailable).toBe(true)
    expect(result.latest).toBe(TAG)
    expect(result.current).toBe('2025.01.01')
  })

  it('downloads, checksum-verifies and atomically installs the override', async () => {
    const dir = freshDir()
    const phases: string[] = []
    const updater = makeUpdater(dir, routes(), {
      onPhase: (p: string) => phases.push(p),
      verifyInstalled: async () => TAG,
    })

    const result = await updater.apply()

    expect(result.ok).toBe(true)
    expect(result.newVersion).toBe(TAG)
    const installed = join(dir, 'yt-dlp.exe')
    expect(readFileSync(installed, 'utf8')).toContain('FAKE-YT-DLP-BINARY')
    expect(existsSync(`${installed}.bak`)).toBe(false)
    expect(phases).toEqual([
      'checking',
      'downloading',
      'verifying',
      'swapping',
      'verifying-install',
    ])
  })

  it('rejects a tampered download and leaves nothing behind', async () => {
    const dir = freshDir()
    const tamperedRoutes = routes()
    tamperedRoutes[EXE_URL] = { body: Buffer.from('TAMPERED-PAYLOAD', 'utf8') }
    const updater = makeUpdater(dir, tamperedRoutes)

    const result = await updater.apply()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum mismatch/)
    expect(existsSync(join(dir, 'yt-dlp.exe'))).toBe(false)
  })

  it('rolls back to the previous binary when the swap fails verification', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'yt-dlp.exe'), 'OLD-OVERRIDE-CONTENT', 'utf8')
    const updater = makeUpdater(dir, routes(), { verifyInstalled: async () => null })

    const result = await updater.apply()

    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(true)
    expect(readFileSync(join(dir, 'yt-dlp.exe'), 'utf8')).toBe('OLD-OVERRIDE-CONTENT')
  })

  it('refuses to apply and installs nothing when already at the latest version', async () => {
    const dir = freshDir()
    const updater = makeUpdater(dir, routes(), { getCurrentVersion: async () => TAG })
    const result = await updater.apply()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/up to date/i)
    expect(existsSync(join(dir, 'yt-dlp.exe'))).toBe(false)
  })

  it('surfaces resolution errors without throwing', async () => {
    const dir = freshDir()
    const failing = makeUpdater(dir, { [TAG_URL]: { status: 404 } })
    const result = await failing.check()
    expect(result.updateAvailable).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('downloadToFile (T6 / P-03)', () => {
  function streamResponse(
    chunks: readonly Buffer[],
    headers: Record<string, string> = {},
  ): Response {
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array(chunks[i++]))
      },
    })
    return new Response(body, { status: 200, headers })
  }

  function dest(): string {
    return join(mkdtempSync(join(tmpdir(), 'mf-dl-')), 'asset.bin')
  }

  it('writes the exact bytes and returns their digest', async () => {
    const path = dest()
    const chunks = [Buffer.from('hello '), Buffer.from('streamed '), Buffer.from('world')]
    const whole = Buffer.concat(chunks)

    const result = await downloadToFile(
      'https://x.test/a',
      path,
      (async () => streamResponse(chunks)) as unknown as typeof fetch,
      1024,
    )

    expect(result.bytes).toBe(whole.length)
    expect(result.sha256).toBe(sha256Hex(whole))
    expect(readFileSync(path)).toEqual(whole)
  })

  it('rejects past maxBytes and leaves no partial file behind', async () => {
    const path = dest()
    const chunks = [Buffer.alloc(64, 1), Buffer.alloc(64, 2), Buffer.alloc(64, 3)]

    await expect(
      downloadToFile(
        'https://x.test/a',
        path,
        (async () => streamResponse(chunks)) as unknown as typeof fetch,
        100,
      ),
    ).rejects.toThrow(/exceeded 100 bytes/)
    expect(existsSync(path)).toBe(false)
  })

  it('rejects when Content-Length disagrees with the bytes received', async () => {
    const path = dest()
    const chunks = [Buffer.alloc(32, 7)]

    await expect(
      downloadToFile(
        'https://x.test/a',
        path,
        (async () =>
          streamResponse(chunks, { 'content-length': '999' })) as unknown as typeof fetch,
        1024,
      ),
    ).rejects.toThrow(/truncated: expected 999 bytes, received 32/)
    expect(existsSync(path)).toBe(false)
  })

  it('accepts a Content-Length that matches', async () => {
    const path = dest()
    const chunks = [Buffer.alloc(32, 7)]
    const result = await downloadToFile(
      'https://x.test/a',
      path,
      (async () => streamResponse(chunks, { 'content-length': '32' })) as unknown as typeof fetch,
      1024,
    )
    expect(result.bytes).toBe(32)
  })

  it('rejects a non-OK response without creating a file', async () => {
    const path = dest()
    await expect(
      downloadToFile(
        'https://x.test/a',
        path,
        (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
        1024,
      ),
    ).rejects.toThrow(/HTTP 404/)
    expect(existsSync(path)).toBe(false)
  })
})

describe('downloadBuffer sidecar cap (T6)', () => {
  it('rejects a body larger than the sidecar ceiling', async () => {
    const big = Buffer.alloc(MAX_SIDECAR_BYTES + 1, 0)
    await expect(
      downloadBuffer(
        'https://x.test/sums',
        (async () => new Response(new Uint8Array(big))) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/expected a small sidecar/)
  })

  it('still returns a normal-sized sidecar', async () => {
    const text = Buffer.from('abc  yt-dlp.exe\n')
    const out = await downloadBuffer(
      'https://x.test/sums',
      (async () => new Response(new Uint8Array(text))) as unknown as typeof fetch,
    )
    expect(out.toString('utf8')).toBe(text.toString('utf8'))
  })
})
