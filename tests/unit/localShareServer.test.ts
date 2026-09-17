import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalShareServer,
  findPrivateIpv4Address,
  selectPrivateIpv4Address,
  type LocalShareServerOptions,
} from '../../src/main/sharing/localShareServer'
import type { LocalShareActivity } from '../../src/shared/ipcContract'

const servers: LocalShareServer[] = []
const dirs: string[] = []

function makeServer(options: LocalShareServerOptions = {}): LocalShareServer {
  const server = new LocalShareServer({ getHost: () => '127.0.0.1', ttlMs: 60_000, ...options })
  servers.push(server)
  return server
}

function makeFile(contents = 'MediaForge direct local transfer', name = 'clip.mp4'): string {
  const dir = mkdtempSync(join(tmpdir(), 'mf-local-share-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, contents, 'utf8')
  return path
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('LocalShareServer', () => {
  it('presents a trustworthy receiver page and streams through an opaque local link', async () => {
    const server = makeServer()
    const result = await server.start(makeFile())
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return

    expect(result.share.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/share\//)
    expect(result.share.url).not.toContain('clip.mp4')
    expect(result.share.fileSize).toBe(32)

    const landing = await fetch(result.share.url)
    expect(landing.status).toBe(200)
    expect(landing.headers.get('content-type')).toContain('text/html')
    expect(landing.headers.get('content-security-policy')).toContain("connect-src 'self'")
    expect(landing.headers.get('content-security-policy')).toContain("script-src 'nonce-")
    const html = await landing.text()
    expect(html).toContain('One tap. Original quality.')
    expect(html).toContain('Get MediaForge for Windows')
    expect(html).toContain(`/share/${result.share.url.split('/').at(-1)}/download`)
    expect(html).toContain('Starting private transfer…')
    expect(html).toContain('Download complete')

    await expect(
      fetch(`${result.share.url}/status`).then((response) => response.json()),
    ).resolves.toMatchObject({ status: 'waiting', bytesSent: 0, totalBytes: 32 })

    const response = await fetch(`${result.share.url}/download`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('clip.mp4')
    await expect(response.text()).resolves.toBe('MediaForge direct local transfer')

    await expect(
      fetch(`${result.share.url}/status`).then((statusResponse) => statusResponse.json()),
    ).resolves.toMatchObject({ status: 'downloading', bytesSent: 32, totalBytes: 32 })
    await new Promise<void>((resolve) => setTimeout(resolve, 1_700))
    await expect(
      fetch(`${result.share.url}/status`).then((statusResponse) => statusResponse.json()),
    ).resolves.toMatchObject({ status: 'completed', bytesSent: 32, totalBytes: 32 })
  })

  it('supports byte ranges and rejects invalid capabilities', async () => {
    const server = makeServer()
    const result = await server.start(makeFile('0123456789'))
    if (result.kind !== 'ok') throw new Error(result.message)

    const partial = await fetch(`${result.share.url}/download`, {
      headers: { Range: 'bytes=2-5' },
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
    await expect(partial.text()).resolves.toBe('2345')

    const invalid = await fetch(`${result.share.url}not-the-token`)
    expect(invalid.status).toBe(404)
    const trailingPath = await fetch(`${result.share.url}/download/unexpected`)
    expect(trailingPath.status).toBe(404)
  })

  it('serves a Unicode filename without putting invalid characters in HTTP headers', async () => {
    const server = makeServer()
    const result = await server.start(makeFile('unicode file', 'সঙ্গীত.mp4'))
    if (result.kind !== 'ok') throw new Error(result.message)

    const response = await fetch(`${result.share.url}/download`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''%E0%A6")
    await expect(response.text()).resolves.toBe('unicode file')
  })

  it('emits a separate anonymous progress record for every download stream', async () => {
    const activity: LocalShareActivity[] = []
    const server = makeServer({ onActivity: (snapshot) => activity.push(snapshot) })
    const result = await server.start(makeFile('a'.repeat(64 * 1024)))
    if (result.kind !== 'ok') throw new Error(result.message)

    await (await fetch(result.share.url)).text()
    await (await fetch(`${result.share.url}/download`)).arrayBuffer()
    await new Promise<void>((resolve) => setTimeout(resolve, 1_700))

    const completed = activity.find((snapshot) => snapshot.completedDownloads === 1)
    expect(completed).toMatchObject({
      linksOpened: 1,
      activeConnections: 0,
      downloadsStarted: 1,
    })
    expect(completed?.transfers[0]).toMatchObject({
      id: 'transfer-01',
      receiverLabel: 'Nearby device 01',
      status: 'completed',
      bytesSent: 64 * 1024,
      totalBytes: 64 * 1024,
    })
    expect(JSON.stringify(activity)).not.toContain('127.0.0.1')
  })

  it('combines range requests from one receiver into one logical download', async () => {
    const activity: LocalShareActivity[] = []
    const server = makeServer({ onActivity: (snapshot) => activity.push(snapshot) })
    const result = await server.start(makeFile('0123456789'))
    if (result.kind !== 'ok') throw new Error(result.message)

    await (
      await fetch(`${result.share.url}/download`, { headers: { Range: 'bytes=0-4' } })
    ).arrayBuffer()
    await (
      await fetch(`${result.share.url}/download`, { headers: { Range: 'bytes=5-9' } })
    ).arrayBuffer()
    await new Promise<void>((resolve) => setTimeout(resolve, 1_700))

    const completed = activity.find((snapshot) => snapshot.completedDownloads === 1)
    expect(completed).toMatchObject({ downloadsStarted: 1, completedDownloads: 1 })
    expect(completed?.transfers).toHaveLength(1)
    expect(completed?.transfers[0]).toMatchObject({ bytesSent: 10, totalBytes: 10 })
  })

  it('does not start when a private network address is unavailable', async () => {
    const server = makeServer({ getHost: () => null })
    await expect(server.start(makeFile())).resolves.toEqual({
      kind: 'error',
      message: 'No private Wi-Fi or LAN connection was found. Connect to a local network first.',
    })
  })

  it('restores activity and renews the same private link without selecting the file again', async () => {
    const server = makeServer({ ttlMs: 5_000 })
    const result = await server.start(makeFile())
    if (result.kind !== 'ok') throw new Error(result.message)
    const firstExpiry = result.share.expiresAt

    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    const renewed = server.renew()
    expect(renewed.kind).toBe('ok')
    if (renewed.kind !== 'ok') return

    expect(renewed.share.url).toBe(result.share.url)
    expect(renewed.share.expiresAt).toBeGreaterThan(firstExpiry)
    expect(server.getSnapshot()).toMatchObject({
      share: { fileName: 'clip.mp4', fileSize: 32 },
      activity: { linksOpened: 0, downloadsStarted: 0, completedDownloads: 0 },
    })
  })

  it('escapes filenames rendered in the receiver page', async () => {
    const server = makeServer()
    const result = await server.start(makeFile('safe', 'rock & roll.mp4'))
    if (result.kind !== 'ok') throw new Error(result.message)

    const html = await (await fetch(result.share.url)).text()
    expect(html).toContain('rock &amp; roll.mp4')
    expect(html).not.toContain('<strong>rock & roll.mp4</strong>')
  })
})

describe('findPrivateIpv4Address', () => {
  it('returns a private IPv4 address or null', () => {
    const address = findPrivateIpv4Address()
    expect(address === null || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)).toBe(
      true,
    )
  })

  it('prefers Wi-Fi over virtual and VPN adapters', () => {
    const interfaces = {
      'vEthernet (Default Switch)': [
        {
          address: '172.24.208.1',
          netmask: '255.255.240.0',
          family: 'IPv4' as const,
          mac: '00:15:5d:00:00:00',
          internal: false,
          cidr: '172.24.208.1/20',
        },
      ],
      'Pritunl 1': [
        {
          address: '192.168.236.139',
          netmask: '255.255.252.0',
          family: 'IPv4' as const,
          mac: '00:ff:00:00:00:00',
          internal: false,
          cidr: '192.168.236.139/22',
        },
      ],
      WiFi: [
        {
          address: '192.168.0.194',
          netmask: '255.255.255.0',
          family: 'IPv4' as const,
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: '192.168.0.194/24',
        },
      ],
    }
    expect(selectPrivateIpv4Address(interfaces)).toBe('192.168.0.194')
  })
})
