import * as fsp from 'node:fs/promises'
import { extname, join } from 'node:path'

const ILLEGAL_CHARS = /[\\/:*?"<>|]/g
const CONTROL_CHARS = /\p{Cc}/gu
const NON_BMP = /[\u{10000}-\u{10FFFF}]/gu
const TRAILING_DOTSPACE = /[. ]+$/u
const RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..+)?$/i

const MAX_FILENAME_CHARS = 200

export function sanitizeFileName(input: string): string {
  let name = input.replace(ILLEGAL_CHARS, '-').replace(CONTROL_CHARS, '')
  name = name.replace(NON_BMP, '-')

  if (RESERVED_DEVICE.test(name)) name = `_${name}`

  const ext = extname(name)
  const hasShortExt = ext.length > 1 && ext.length <= 10 && !ext.includes(' ')
  const codePoints = Array.from(name)
  if (codePoints.length > MAX_FILENAME_CHARS) {
    const keepStem = MAX_FILENAME_CHARS - (hasShortExt ? ext.length : 0)
    const stem = codePoints.slice(0, Math.max(keepStem, 1)).join('')
    name = hasShortExt ? stem + ext : stem
  }
  name = name.replace(TRAILING_DOTSPACE, '')

  return name.length > 0 ? name : 'untitled'
}

async function lowercasedEntries(dir: string): Promise<Set<string>> {
  try {
    return new Set((await fsp.readdir(dir)).map((entry) => entry.toLowerCase()))
  } catch {
    return new Set()
  }
}

export async function collisionFreeTarget(destDir: string, fileName: string): Promise<string> {
  const safeName = sanitizeFileName(fileName)
  const existing = await lowercasedEntries(destDir)

  if (!existing.has(safeName.toLowerCase())) return join(destDir, safeName)

  const ext = extname(safeName)
  const stem = ext.length > 0 ? safeName.slice(0, -ext.length) : safeName
  for (let n = 1; ; n += 1) {
    const candidate = `${stem}_${n}${ext}`
    if (!existing.has(candidate.toLowerCase())) return join(destDir, candidate)
  }
}
