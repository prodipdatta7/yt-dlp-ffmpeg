import { describe, expect, it } from 'vitest'
import { isProtocolLine, LogBus } from '../../src/main/logs/logBus'

describe('LogBus', () => {
  it('stores redacted entries with timestamp, source and stream', () => {
    const bus = new LogBus()
    bus.push('yt-dlp', 'err', 'ERROR: unable to fetch https://x.test/watch?v=abc&t=9s')
    const lines = bus.tail()
    expect(lines).toHaveLength(1)
    const entry = lines[0]
    expect(entry.source).toBe('yt-dlp')
    expect(entry.stream).toBe('err')
    expect(entry.text).not.toContain('?v=')
    expect(entry.text).toContain('https://x.test/watch')
    expect(entry.ts).toBeGreaterThan(0)
  })

  it('drops empty lines', () => {
    const bus = new LogBus()
    bus.push('yt-dlp', 'out', '   ')
    expect(bus.tail()).toHaveLength(0)
  })

  it('caps the buffer at 2000 entries keeping the newest tail', () => {
    const bus = new LogBus()
    for (let i = 0; i < 2050; i += 1) bus.push('app', 'out', `line-${i}`)
    const lines = bus.tail(2000)
    expect(lines[0].text).toBe('line-50')
    expect(lines.at(-1)?.text).toBe('line-2049')
  })

  it('broadcasts live entries to subscribers and supports unsubscribe', () => {
    const bus = new LogBus()
    bus.setBroadcast(true)
    const seen: string[] = []
    const off = bus.subscribe((entry) => seen.push(entry.text))
    bus.push('yt-dlp', 'out', 'first')
    off()
    bus.push('yt-dlp', 'err', 'second')
    expect(seen).toEqual(['first'])
  })

  it('clear wipes history but keeps the subscription alive', () => {
    const bus = new LogBus()
    bus.setBroadcast(true)
    bus.push('yt-dlp', 'out', 'old')
    const seen: string[] = []
    bus.subscribe((entry) => seen.push(entry.text))
    bus.clear()
    expect(bus.tail()).toHaveLength(0)
    bus.push('yt-dlp', 'out', 'new')
    expect(seen).toEqual(['new'])
  })

  describe('broadcast gating (P-04)', () => {
    it('stores but does not broadcast while the console is closed', () => {
      const bus = new LogBus()
      const seen: string[] = []
      bus.subscribe((entry) => seen.push(entry.text))

      bus.push('yt-dlp', 'out', '[download] Destination: a.mp4')
      expect(seen).toEqual([])
      expect(bus.tail().map((e) => e.text)).toEqual(['[download] Destination: a.mp4'])
    })

    it('retains protocol lines in tail() but withholds them from subscribers', () => {
      const bus = new LogBus()
      bus.setBroadcast(true)
      const seen: string[] = []
      bus.subscribe((entry) => seen.push(entry.text))

      bus.push('yt-dlp', 'out', 'MF|downloading|1|2||3|4')
      bus.push('yt-dlp', 'out', 'MFPOST| 50%')
      bus.push('yt-dlp', 'out', '[Merger] Merging formats')

      expect(seen).toEqual(['[Merger] Merging formats'])
      expect(bus.tail()).toHaveLength(3)
    })

    it('delivers protocol lines once the console asks for them', () => {
      const bus = new LogBus()
      bus.setBroadcast(true, true)
      const seen: string[] = []
      bus.subscribe((entry) => seen.push(entry.text))

      bus.push('yt-dlp', 'out', 'MF|downloading|1|2||3|4')
      expect(seen).toEqual(['MF|downloading|1|2||3|4'])
    })

    it('stops broadcasting again when the console closes', () => {
      const bus = new LogBus()
      bus.setBroadcast(true)
      const seen: string[] = []
      bus.subscribe((entry) => seen.push(entry.text))

      bus.push('yt-dlp', 'out', 'while open')
      bus.setBroadcast(false)
      bus.push('yt-dlp', 'out', 'while closed')

      expect(seen).toEqual(['while open'])
      expect(bus.tail()).toHaveLength(2)
    })
  })

  describe('isProtocolLine', () => {
    it('matches only the AM-01 machine templates', () => {
      expect(isProtocolLine('MF|downloading|1|2||3|4')).toBe(true)
      expect(isProtocolLine('MFPOST| 50%')).toBe(true)
      expect(isProtocolLine('[download] 50%')).toBe(false)
      expect(isProtocolLine('MFX|not ours')).toBe(false)
      expect(isProtocolLine('')).toBe(false)
    })
  })
})
