import { describe, expect, it } from 'vitest'
import { LogBus } from '../../src/main/logs/logBus'

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
    const seen: string[] = []
    const off = bus.subscribe((entry) => seen.push(entry.text))
    bus.push('yt-dlp', 'out', 'first')
    off()
    bus.push('yt-dlp', 'err', 'second')
    expect(seen).toEqual(['first'])
  })

  it('clear wipes history but keeps the subscription alive', () => {
    const bus = new LogBus()
    bus.push('yt-dlp', 'out', 'old')
    const seen: string[] = []
    bus.subscribe((entry) => seen.push(entry.text))
    bus.clear()
    expect(bus.tail()).toHaveLength(0)
    bus.push('yt-dlp', 'out', 'new')
    expect(seen).toEqual(['new'])
  })
})
