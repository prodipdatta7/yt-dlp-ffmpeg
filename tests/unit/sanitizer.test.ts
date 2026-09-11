import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collisionFreeTarget, sanitizeFileName } from '../../src/main/fsops/sanitizer'

describe('sanitizeFileName (PRD §3.4 / AGENTS.md §7.4)', () => {
  const cases: Array<[string, string]> = [
    ['AC/DC: Best?*Track<1>', 'AC-DC- Best--Track-1-'],
    ['normal-name_123.mp4', 'normal-name_123.mp4'],
    ['trailing dots...', 'trailing dots'],
    ['trailing spaces   ', 'trailing spaces'],
    ['emoji \u{1F600} mix', 'emoji - mix'],
  ]

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(sanitizeFileName(input)).toBe(expected)
    })
  }

  it('strips control characters 0x00–0x1F', () => {
    expect(sanitizeFileName('bad\x00\x1Bname\ttest')).toBe('badnametest')
  })

  it('reserves device names with or without extension', () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('con.txt')).toBe('_con.txt')
    expect(sanitizeFileName('COM1')).toBe('_COM1')
    expect(sanitizeFileName('lpt9.wav')).toBe('_lpt9.wav')
    expect(sanitizeFileName('PRN')).toBe('_PRN')
  })

  it('caps length at 200 chars', () => {
    const long = `${'a'.repeat(500)}.mp4`
    const result = sanitizeFileName(long)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result.endsWith('.mp4')).toBe(true)
  })

  it('falls back to untitled when everything is stripped', () => {
    expect(sanitizeFileName('***')).toBe('---')
    expect(sanitizeFileName('\x00\x01')).toBe('untitled')
    expect(sanitizeFileName('')).toBe('untitled')
  })
})

describe('collisionFreeTarget (PRD §3.4 auto-rename)', () => {
  it('returns the plain path when free', async () => {
    const dir = freshDir()
    expect(await collisionFreeTarget(dir, 'Video.mp4')).toBe(join(dir, 'Video.mp4'))
  })

  it('appends _1 then _2 (case-insensitive compare)', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'Video.mp4'), 'x')
    expect(await collisionFreeTarget(dir, 'Video.mp4')).toBe(join(dir, 'Video_1.mp4'))
    writeFileSync(join(dir, 'video_1.mp4'), 'x')
    expect(await collisionFreeTarget(dir, 'VIDEO.MP4')).toBe(join(dir, 'VIDEO_2.MP4'))
  })

  it('sanitizes the requested name before collision check', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'a-b-c.mp4'), 'x')
    expect(await collisionFreeTarget(dir, 'a<b>c.mp4')).toBe(join(dir, 'a-b-c_1.mp4'))
  })
})

function freshDir(): string {
  const dir = join(tmpdir(), `mf-san-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}
