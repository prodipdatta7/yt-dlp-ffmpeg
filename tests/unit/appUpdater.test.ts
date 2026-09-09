import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appReleasesUrl,
  checkAppUpdate,
  downloadAndInstallAppUpdate,
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

function installRoutes(latestVersion: string, exeBytes = EXE_BYTES): Record<string, FetchRoute> {
  const fileName = installerAssetName(latestVersion)
  const exeUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${encodeURIComponent(fileName)}`
  const sumsUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/SHA256SUMS`
  return {
    ...routesForTag(`v${latestVersion}`),
    [exeUrl]: { body: exeBytes },
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
    const exeUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${encodeURIComponent(
      installerAssetName('0.3.0'),
    )}`
    routes[exeUrl] = { body: Buffer.from('TAMPERED-PAYLOAD', 'utf8') }
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
