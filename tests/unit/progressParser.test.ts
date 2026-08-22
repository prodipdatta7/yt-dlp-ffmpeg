import { describe, expect, it } from 'vitest'
import {
  computeSegmentPercent,
  extractFinalPathLine,
  isPostprocessorLine,
  parseDownloadLine,
  parsePostprocessLine,
  type ParsedDownloadProgress,
} from '../../src/main/jobs/progressParser'

describe('parseDownloadLine (synthetic MF| stream)', () => {
  it('parses a full downloading record', () => {
    expect(parseDownloadLine('MF|downloading|500|1000||1048576|30')).toEqual({
      status: 'downloading',
      downloadedBytes: 500,
      totalBytes: 1000,
      speedBps: 1048576,
      etaSec: 30,
    })
  })

  it('falls back to total_bytes_estimate when exact total is NA', () => {
    const p = parseDownloadLine('MF|downloading|500|NA|2000|NA|NA')
    expect(p?.totalBytes).toBe(2000)
    expect(p?.speedBps).toBeNull()
    expect(p?.etaSec).toBeNull()
  })

  it('marks finished records', () => {
    const p = parseDownloadLine('MF|finished|1000|1000||0|0')
    expect(p?.status).toBe('finished')
  })

  it('returns null for non-MF lines', () => {
    expect(parseDownloadLine('[download] Destination: x.mp4')).toBeNull()
    expect(parseDownloadLine('MFPOST| 42.0%')).toBeNull()
  })

  it('tolerates unknown status tokens', () => {
    expect(parseDownloadLine('MF|weird|1|2||3|4')?.status).toBe('unknown')
  })
})

describe('parsePostprocessLine', () => {
  it('reads MFPOST percentages with spacing', () => {
    expect(parsePostprocessLine('MFPOST| 87.3%')).toBe(87.3)
    expect(parsePostprocessLine('MFPOST|0.0%')).toBe(0)
  })

  it('ignores other lines', () => {
    expect(parsePostprocessLine('MF|downloading|1|2||3|4')).toBeNull()
  })
})

describe('isPostprocessorLine defensive flips', () => {
  it('detects merger/extract-audio banners', () => {
    expect(isPostprocessorLine('[Merger] Merging formats into "x.mp4"')).toBe(true)
    expect(isPostprocessorLine('[ExtractAudio] Destination: x.m4a')).toBe(true)
    expect(isPostprocessorLine('[download] Got error')).toBe(false)
  })
})

describe('computeSegmentPercent', () => {
  const base: ParsedDownloadProgress = {
    status: 'downloading',
    downloadedBytes: 250,
    totalBytes: 1000,
    speedBps: null,
    etaSec: null,
  }

  it('computes from bytes', () => {
    expect(computeSegmentPercent(base)).toBe(25)
  })

  it('clamps to 100 and handles finished without totals', () => {
    expect(computeSegmentPercent({ ...base, downloadedBytes: 1500 })!.toFixed(0)).toBe('100')
    expect(
      computeSegmentPercent({
        ...base,
        downloadedBytes: null,
        totalBytes: null,
        status: 'finished',
      }),
    ).toBe(100)
  })
})

describe('extractFinalPathLine (after_move:filepath capture)', () => {
  const exists = (p: string) => p.endsWith('.mp4') && p.includes('dest')

  it('picks the last existing bare path, skipping protocol/banner lines', () => {
    const lines = [
      '[download] Destination: C:/tmp/vid.f137.mp4',
      'MF|downloading|1|2||3|4',
      'MFPOST| 50%',
      '[Merger] Merging into "C:/tmp/vid.mp4"',
      'C:/dest/My Video [abc123].mp4'.replace('.mp4', '.tmp'),
      'C:/dest/My Video [abc123].mp4',
    ]
    expect(extractFinalPathLine(lines, exists)).toBe('C:/dest/My Video [abc123].mp4')
  })

  it('returns null when no candidate exists', () => {
    expect(extractFinalPathLine(['[download] x'], exists)).toBeNull()
  })
})
