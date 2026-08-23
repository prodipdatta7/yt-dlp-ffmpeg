import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAnalyzeArgs, buildEntryInfoArgs } from '../../src/main/media/argBuilders'
import { mapRawInfo, type RawInfo } from '../../src/main/media/metadata'

function loadFixture(name: string): RawInfo {
  return JSON.parse(readFileSync(resolve('tests/fixtures/ytdlp-json', name), 'utf8')) as RawInfo
}

describe('buildAnalyzeArgs (AGENTS.md §7.1)', () => {
  it('uses machine-parseable -J with flat-playlist', () => {
    expect(buildAnalyzeArgs('https://x.test/v')).toEqual([
      '-J',
      '--no-warnings',
      '--flat-playlist',
      'https://x.test/v',
    ])
  })

  it('buildEntryInfoArgs omits flat-playlist for per-entry hydration', () => {
    expect(buildEntryInfoArgs('https://x.test/v', 'C:\\cookies.txt')).toEqual([
      '-J',
      '--no-warnings',
      '--cookies',
      'C:\\cookies.txt',
      'https://x.test/v',
    ])
  })
})

describe('mapRawInfo vs youtube-single fixture', () => {
  const result = mapRawInfo(
    loadFixture('youtube-single.json'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  )

  it('maps core metadata', () => {
    expect(result.kind).toBe('video')
    expect(result.metadata.title).toBe('Deep Dive into Distributed Systems')
    expect(result.metadata.uploader).toBe('TechEdu Labs')
    expect(result.metadata.durationSec).toBe(5055)
    expect(result.metadata.viewCount).toBe(1234567)
    expect(result.metadata.uploadDate).toBe('2024-06-15')
    expect(result.metadata.thumbnailUrl).toContain('maxresdefault.jpg')
    expect(result.metadata.isLive).toBe(false)
  })

  it('filters storyboard rows and keeps real formats', () => {
    const ids = result.formats.map((f) => f.formatId)
    expect(ids).not.toContain('sb2')
    expect(ids).toContain('137')
    expect(ids).toContain('140')
  })

  it('normalizes codecs and prefers exact filesize over estimate', () => {
    const f140 = result.formats.find((f) => f.formatId === '140')
    expect(f140?.vcodec).toBeNull()
    expect(f140?.acodec).toBe('mp4a.40.2')
    expect(f140?.abrKbps).toBeCloseTo(129.54)
    expect(f140?.filesizeBytes).toBe(81920000)

    const f251 = result.formats.find((f) => f.formatId === '251')
    expect(f251?.filesizeBytes).toBe(101200000)

    const f299 = result.formats.find((f) => f.formatId === '299')
    expect(f299?.height).toBe(1080)
    expect(f299?.fps).toBe(60)
    expect(f299?.acodec).toBeNull()
  })
})

describe('mapRawInfo vs playlist fixture (AM-07)', () => {
  const result = mapRawInfo(
    loadFixture('playlist.json'),
    'https://www.youtube.com/playlist?list=PLTechEduDistributed01',
  )

  it('detects playlist and previews entries sequentially with urls', () => {
    expect(result.kind).toBe('playlist')
    expect(result.playlistCount).toBe(4)
    expect(result.playlistEntries?.[0]).toMatchObject({
      index: 1,
      title: 'Episode 1 — Introduction & Consistency Models',
      url: 'https://www.youtube.com/watch?v=ep0001intro',
    })
    expect(result.playlistEntries?.every((e) => e.url.length > 0)).toBe(true)
    expect(result.playlistEntries?.at(-1)?.title).toContain('Paxos')
    expect(result.formats).toHaveLength(0)
    expect(result.metadata.title).toBe('Distributed Systems Course')
  })

  it('keeps detail fields provided by flat entries for hydration parity', () => {
    const raw: RawInfo = {
      _type: 'playlist',
      id: 'PL1',
      title: 'Mixed',
      entries: [
        {
          id: 'a',
          title: 'Full entry',
          url: 'https://x.test/a',
          duration: 61,
          view_count: 42,
          uploader: 'Chan',
        },
        { id: 'b', title: 'Bare entry', url: 'https://x.test/b' },
      ],
    }
    const res = mapRawInfo(raw, 'https://x.test/pl')
    expect(res.playlistEntries?.[0]).toMatchObject({
      durationSec: 61,
      viewCount: 42,
      uploader: 'Chan',
    })
    expect(res.playlistEntries?.[1]).toMatchObject({
      durationSec: null,
      viewCount: null,
      uploader: null,
      thumbnailUrl: null,
    })
  })
})

describe('mapRawInfo vs live fixture (EC-06 detection)', () => {
  const result = mapRawInfo(
    loadFixture('live.json'),
    'https://www.youtube.com/watch?v=liveStream01',
  )

  it('flags live streams', () => {
    expect(result.metadata.isLive).toBe(true)
    expect(result.metadata.durationSec).toBeNull()
    expect(result.metadata.viewCount).toBe(4211)
  })
})
