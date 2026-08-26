import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BinaryKind, BinarySource } from '../../shared/ipcContract'

export interface BinaryCandidate {
  dir: string
  source: BinarySource
}

export interface LocatedBinary {
  kind: BinaryKind
  path: string
  source: BinarySource
}

export function platformDir(platform: string, arch = 'x64'): string {
  if (platform === 'win32') return 'win32'
  if (platform === 'darwin') return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  if (platform === 'linux') return arch === 'arm64' ? 'linux-aarch64' : 'linux-x64'
  throw new Error(`Unsupported platform: ${platform}`)
}

export function binaryFileName(kind: BinaryKind, platform: string): string {
  return platform === 'win32' ? `${kind}.exe` : kind
}

export function locateBinary(
  kind: BinaryKind,
  platform: string,
  candidates: readonly BinaryCandidate[],
  exists: (path: string) => boolean = existsSync
): LocatedBinary | null {
  for (const candidate of candidates) {
    const path = join(candidate.dir, binaryFileName(kind, platform))
    if (exists(path)) return { kind, path, source: candidate.source }
  }
  return null
}
