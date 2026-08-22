import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  extractExpectedChecksum,
  isNewerVersion,
  pickAssets,
  sha256Hex,
  YtDlpUpdater,
  type GithubRelease,
} from '../../src/main/binaries/updater'

const TAG = '2026.09.01'
const EXE_BYTES = Buffer.from('FAKE-YT-DLP-BINARY-CONTENT'.repeat(64), 'utf8')

function releaseJson(): GithubRelease {
  return {
    tag_name: TAG,
    assets: [
      { name: 'yt-dlp.exe', browser_download_url: 'https://fake.test/yt-dlp.exe' },
      { name: 'SHA2-256SUMS', browser_download_url: 'https://fake.test/SHA2-256SUMS' },
      { name: 'yt-dlp_linux', browser_download_url: 'https://fake.test/yt-dlp_linux' },
    ],
  }
}

function sumsText(data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex')
  return `${hash}  yt-dlp.exe\n${'a'.repeat(64)}  other-file\n`
}

interface FetchRoute {
  json?: unknown
  body?: Buffer
}

function fakeFetch(routes: Record<string, FetchRoute>) {
  return async (url: string | URL | Request): Promise<Response> => {
    const key = String(url)
    const route = routes[key]
    if (!route) return new Response('not found', { status: 404 })
    if (route.json !== undefined) {
      return new Response(JSON.stringify(route.json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(new Uint8Array(route.body ?? Buffer.alloc(0)), { status: 200 })
  }
}

function makeUpdater(
  dir: string,
  routes: Record<string, FetchRoute>,
  opts: Record<string, unknown> = {},
) {
  return new YtDlpUpdater({
    overrideDir: dir,
    getCurrentVersion: async () => '2025.01.01',
    fetchFn: fakeFetch(routes) as typeof fetch,
    ...opts,
  })
}

describe('version comparison', () => {
  it('orders date-based tags numerically per segment', () => {
    expect(isNewerVersion('2025.12.31', '2026.08.19')).toBe(true)
    expect(isNewerVersion('2026.08.19', '2026.08.19')).toBe(false)
    expect(isNewerVersion('2026.08.19', '2026.07.99')).toBe(false)
    expect(compareVersions('2026.08.19', '2026.08.19.1')).toBeLessThan(0)
  })
})

describe('pickAssets', () => {
  it('finds the win32 exe and official checksums asset', () => {
    const picked = pickAssets(releaseJson())
    expect(picked?.tag).toBe(TAG)
    expect(picked?.exeUrl).toBe('https://fake.test/yt-dlp.exe')
    expect(picked?.sumsUrl).toBe('https://fake.test/SHA2-256SUMS')
  })

  it('returns null when assets are missing', () => {
    expect(pickAssets({ tag_name: TAG, assets: [] })).toBeNull()
    expect(pickAssets({ assets: releaseJson().assets })).toBeNull()
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

describe('updater flow against mocked GitHub API (no network)', () => {
  function routes(): Record<string, FetchRoute> {
    return {
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest': { json: releaseJson() },
      'https://fake.test/yt-dlp.exe': { body: EXE_BYTES },
      'https://fake.test/SHA2-256SUMS': { body: Buffer.from(sumsText(EXE_BYTES), 'utf8') },
    }
  }

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
    expect(phases).toEqual(
      expect.arrayContaining([
        'checking',
        'downloading',
        'verifying',
        'swapping',
        'verifying-install',
      ]),
    )
    expect(readdirSafe(dir).some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('rejects a tampered download and leaves nothing behind', async () => {
    const dir = freshDir()
    const tamperedRoutes = routes()
    tamperedRoutes['https://fake.test/yt-dlp.exe'] = {
      body: Buffer.from('TAMPERED-PAYLOAD', 'utf8'),
    }
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

  it('surfaces API errors without throwing', async () => {
    const dir = freshDir()
    const failing = makeUpdater(dir, {
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest': {},
    })
    const result = await failing.check()
    expect(result.updateAvailable).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mf-updater-'))
}

import { readdirSync } from 'node:fs'

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
