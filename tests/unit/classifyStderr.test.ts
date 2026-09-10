import { describe, expect, it } from 'vitest'
import { classifyStderr } from '../../src/main/media/classifyStderr'

describe('classifyStderr per error catalog (AGENTS.md §10)', () => {
  const cases: Array<{ code: string; lines: string[] }> = [
    { code: 'MF_OFFLINE_OR_PRIVATE', lines: ['ERROR: [youtube] abc: Video unavailable'] },
    {
      code: 'MF_OFFLINE_OR_PRIVATE',
      lines: ['ERROR: This video has been removed by the uploader'],
    },
    {
      code: 'MF_OFFLINE_OR_PRIVATE',
      lines: ['ERROR: Private video. Sign in if you have been granted access'],
    },
    {
      code: 'MF_OFFLINE_OR_PRIVATE',
      lines: ['ERROR: Join this channel to get members-only content'],
    },
    {
      code: 'MF_AGE_RESTRICTED',
      lines: ['ERROR: Sign in to confirm your age. This video may be inappropriate'],
    },
    { code: 'MF_AGE_RESTRICTED', lines: ['ERROR: age-restricted content requires login'] },
    { code: 'MF_BOT_CHECK', lines: ["ERROR: Sign in to confirm you're not a bot"] },
    { code: 'MF_RATE_LIMITED', lines: ['ERROR: HTTP Error 429: Too Many Requests'] },
    { code: 'MF_RATE_LIMITED', lines: ['WARNING: [youtube] HTTP Error 403: Forbidden'] },
    { code: 'MF_EXTRACTOR_STALE', lines: ['ERROR: [youtube] abc: Unable to extract uploader id'] },
    {
      code: 'MF_EXTRACTOR_STALE',
      lines: ['ERROR: [TikTok] abc: Unable to extract universal data for rehydration'],
    },
    {
      code: 'MF_UNSUPPORTED_SOURCE',
      lines: ['ERROR: Unsupported URL: https://x.test/v'],
    },
    {
      code: 'MF_UNSUPPORTED_SOURCE',
      lines: [
        'ERROR: [Reddit] 16v8w8q: Unable to download JSON metadata: HTTP Error 404: Not Found',
      ],
    },
    {
      code: 'MF_UNSUPPORTED_SOURCE',
      lines: ["ERROR: There's no video in this post."],
    },
    { code: 'MF_DISK_FULL', lines: ['ERROR: unable to write data: No space left on device'] },
    { code: 'MF_DISK_FULL', lines: ['write failed: ENOSPC'] },
    {
      code: 'MF_NETWORK',
      lines: ['ERROR: Unable to download webpage: getaddrinfo ENOTFOUND x.test'],
    },
    { code: 'MF_NETWORK', lines: ['Connection reset by peer'] },
    {
      code: 'MF_NETWORK',
      lines: ['ERROR: unable to download video data: HTTP Error 500: none; timed out'],
    },
    { code: 'MF_UNKNOWN', lines: ['some totally unexpected failure text'] },
  ]

  for (const c of cases) {
    it(`maps ${JSON.stringify(c.lines[0].slice(0, 60))} → ${c.code}`, () => {
      expect(classifyStderr(c.lines)).toBe(c.code)
    })
  }

  it('prioritizes catalog order when multiple patterns match', () => {
    const mixed = ['Connection reset by peer', 'Video unavailable']
    expect(classifyStderr(mixed)).toBe('MF_OFFLINE_OR_PRIVATE')
  })

  it('is case-insensitive', () => {
    expect(classifyStderr(['VIDEO UNAVAILABLE'])).toBe('MF_OFFLINE_OR_PRIVATE')
  })
})
