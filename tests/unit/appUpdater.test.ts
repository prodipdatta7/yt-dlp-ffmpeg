import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appReleasesUrl,
  checkAppUpdate,
  downloadAndInstallAppUpdate,
  githubAssetUrlName,
  installerAssetName,
} from '../../src/main/app/appUpdater'

const OWNER = 'prodipdatta7'
const REPO = 'yt-dlp-ffmpeg'
const TAG_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`
const EXE_BYTES = Buffer.from('FAKE-MEDIAFORGE-INSTALLER-CONTENT'.repeat(64), 'utf8')

function sumsText(fileName: string, data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex')
  return `${hash}  ${fileName}\n`
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

function routesForTag(tag: string): Record<string, FetchRoute> {
  return {
    [TAG_URL]: {
      status: 302,
      headers: { location: `${TAG_URL.replace('/latest', '')}/tag/${tag}` },
    },
  }
}

/** The GitHub-rewritten (space → period) asset URL — see `githubAssetUrlName`. */
function exeUrlFor(latestVersion: string): string {
  const rewritten = githubAssetUrlName(installerAssetName(latestVersion))
  return `https://github.com/${OWNER}/${REPO}/releases/latest/download/${encodeURIComponent(rewritten)}`
}

function installRoutes(latestVersion: string, exeBytes = EXE_BYTES): Record<string, FetchRoute> {
  const fileName = installerAssetName(latestVersion)
  const sumsUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/SHA256SUMS`
  return {
    ...routesForTag(`v${latestVersion}`),
    [exeUrlFor(latestVersion)]: { body: exeBytes },
    // SHA256SUMS content still uses the original (un-rewritten) filename — see AGENTS.md AM-15.
    [sumsUrl]: { body: Buffer.from(sumsText(fileName, EXE_BYTES), 'utf8') },
  }
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mf-app-updater-'))
}

describe('appReleasesUrl', () => {
  it('points at this repo’s releases/latest redirect', () => {
    expect(appReleasesUrl()).toBe(TAG_URL)
  })
})

describe('checkAppUpdate', () => {
  it('reports an update when the release tag is newer than the installed version', async () => {
    const result = await checkAppUpdate('0.2.0', fakeFetch(routesForTag('v0.3.0')) as typeof fetch)
    expect(result).toEqual({
      currentVersion: '0.2.0',
      latestVersion: '0.3.0',
      updateAvailable: true,
    })
  })

  it('reports no update when already on the latest tag', async () => {
    const result = await checkAppUpdate('0.2.0', fakeFetch(routesForTag('v0.2.0')) as typeof fetch)
    expect(result.updateAvailable).toBe(false)
    expect(result.latestVersion).toBe('0.2.0')
  })

  it('reports no update when the installed version is newer than the release feed', async () => {
    const result = await checkAppUpdate('0.3.0', fakeFetch(routesForTag('v0.2.0')) as typeof fetch)
    expect(result.updateAvailable).toBe(false)
  })

  it('surfaces resolution errors without throwing', async () => {
    const result = await checkAppUpdate('0.2.0', fakeFetch({}) as typeof fetch)
    expect(result.updateAvailable).toBe(false)
    expect(result.latestVersion).toBeNull()
    expect(result.error).toBeTruthy()
  })
})

describe('installerAssetName', () => {
  it('matches the electron-builder.yml nsis.artifactName template', () => {
    expect(installerAssetName('0.3.0')).toBe('MediaForge Desktop-Setup-0.3.0.exe')
  })
})

describe('githubAssetUrlName', () => {
  it('rewrites spaces to periods, matching GitHub’s actual asset-name behavior', () => {
    expect(githubAssetUrlName('MediaForge Desktop-Setup-0.3.0.exe')).toBe(
      'MediaForge.Desktop-Setup-0.3.0.exe',
    )
  })
})

describe('downloadAndInstallAppUpdate', () => {
  it('downloads, checksum-verifies, writes and launches the installer', async () => {
    const dir = freshDir()
    const phases: string[] = []
    const launched: string[] = []

    const result = await downloadAndInstallAppUpdate({
      currentVersion: '0.2.0',
      updatesDir: dir,
      fetchFn: fakeFetch(installRoutes('0.3.0')) as typeof fetch,
      onPhase: (p) => phases.push(p),
      launchInstaller: (path) => launched.push(path),
    })

    expect(result).toEqual({ ok: true })
    expect(phases).toEqual(['checking', 'downloading', 'verifying', 'launching-installer'])
    const expectedPath = join(dir, 'MediaForge Desktop-Setup-0.3.0.exe')
    expect(launched).toEqual([expectedPath])
    expect(readFileSync(expectedPath, 'utf8')).toContain('FAKE-MEDIAFORGE-INSTALLER')
  })

  it('rejects a tampered download and never launches anything', async () => {
    const dir = freshDir()
    const routes = installRoutes('0.3.0')
    routes[exeUrlFor('0.3.0')] = { body: Buffer.from('TAMPERED-PAYLOAD', 'utf8') }
    const launched: string[] = []

    const result = await downloadAndInstallAppUpdate({
      currentVersion: '0.2.0',
      updatesDir: dir,
      fetchFn: fakeFetch(routes) as typeof fetch,
      launchInstaller: (path) => launched.push(path),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum mismatch/)
    expect(launched).toEqual([])
    expect(existsSync(join(dir, 'MediaForge Desktop-Setup-0.3.0.exe'))).toBe(false)
  })

  it('refuses to download when already at the latest version', async () => {
    const dir = freshDir()
    const launched: string[] = []

    const result = await downloadAndInstallAppUpdate({
      currentVersion: '0.3.0',
      updatesDir: dir,
      fetchFn: fakeFetch(installRoutes('0.3.0')) as typeof fetch,
      launchInstaller: (path) => launched.push(path),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/up to date/i)
    expect(launched).toEqual([])
  })

  it('surfaces resolution errors without throwing', async () => {
    const dir = freshDir()
    const result = await downloadAndInstallAppUpdate({
      currentVersion: '0.2.0',
      updatesDir: dir,
      fetchFn: fakeFetch({}) as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

/**
 * P-03 regression guard. The NSIS installer is ~150 MB and used to be held whole in
 * main-process memory while it was hashed and written. It now streams to
 * `updatesDir` and is hashed on the way past.
 */
describe('app installer memory ceiling (T6)', () => {
  const MIB = 1024 * 1024
  const CHUNK = Buffer.alloc(64 * 1024, 0xcd)
  const CHUNKS = (250 * MIB) / CHUNK.length
  const VERSION = '9.9.9'

  it('keeps arrayBuffers bounded while downloading a 250 MB installer', async () => {
    const dir = freshDir()
    const fileName = installerAssetName(VERSION)
    const sumsUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/SHA256SUMS`

    const hash = createHash('sha256')
    for (let i = 0; i < CHUNKS; i += 1) hash.update(CHUNK)
    const sums = Buffer.from(`${hash.digest('hex')}  ${fileName}\n`, 'utf8')

    globalThis.gc?.()
    const baseline = process.memoryUsage().arrayBuffers
    let peak = 0
    let pulls = 0
    const sample = (): void => {
      globalThis.gc?.()
      peak = Math.max(peak, process.memoryUsage().arrayBuffers - baseline)
    }

    const fetchFn = (async (url: string | URL | Request): Promise<Response> => {
      const key = String(url)
      if (key === TAG_URL) {
        return new Response(null, {
          status: 302,
          headers: { location: `${TAG_URL.replace('/latest', '')}/tag/v${VERSION}` },
        })
      }
      if (key === sumsUrl) return new Response(new Uint8Array(sums))
      if (key === exeUrlFor(VERSION)) {
        let sent = 0
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (sent >= CHUNKS) {
                controller.close()
                return
              }
              sent += 1
              if (pulls++ % 256 === 0) sample()
              controller.enqueue(new Uint8Array(CHUNK))
            },
          }),
          { status: 200 },
        )
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    let launched: string | null = null
    const result = await downloadAndInstallAppUpdate({
      currentVersion: '0.1.0',
      updatesDir: dir,
      fetchFn,
      launchInstaller: (p) => {
        launched = p
      },
    })
    sample()

    expect(result.ok).toBe(true)
    expect(launched).toBe(join(dir, fileName))
    // The bound is generous because `arrayBuffers` also counts stream buffers in flight and
    // pool slack: observed peaks here are ~20-36 MB and vary run to run. What it catches is
    // the defect it was written for — the pre-fix path materialized the whole asset via
    // `arrayBuffer()`, so its peak was >= the full 250 MB.
    expect(peak).toBeLessThan(64 * MIB)
  }, 120_000)
})
