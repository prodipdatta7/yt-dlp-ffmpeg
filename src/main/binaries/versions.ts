import type { BinaryKind } from '../../shared/ipcContract'
import { runCapture, type RunResult } from './runner'

export function parseYtDlpVersion(stdoutLines: readonly string[]): string | null {
  for (const line of stdoutLines) {
    const m = /^(?:yt-dlp\s+)?(\d{4}\.\d{2}\.\d{2}(?:\.\d+)*)\b/.exec(line.trim())
    if (m) return m[1]
  }
  return null
}

export function parseFfmpegVersion(stdoutLines: readonly string[]): string | null {
  for (const line of stdoutLines) {
    const m = /^ffmpeg version (\S+)/i.exec(line.trim())
    if (m) return m[1]
  }
  return null
}

export interface BinaryInfoInternal {
  kind: BinaryKind
  path: string | null
  version: string | null
}

async function probe(kind: BinaryKind, path: string): Promise<string | null> {
  const res: RunResult = await runCapture(path, [kind === 'yt-dlp' ? '--version' : '-version'], {
    timeoutMs: 15_000
  })
  return kind === 'yt-dlp' ? parseYtDlpVersion(res.stdoutLines) : parseFfmpegVersion(res.stdoutLines)
}

export class VersionProber {
  private cache = new Map<BinaryKind, string | null>()

  async probe(kind: BinaryKind, path: string): Promise<string | null> {
    if (this.cache.has(kind)) return this.cache.get(kind) ?? null
    const version = await probe(kind, path).catch(() => null)
    this.cache.set(kind, version)
    return version
  }

  invalidate(kind?: BinaryKind): void {
    if (kind) this.cache.delete(kind)
    else this.cache.clear()
  }
}
