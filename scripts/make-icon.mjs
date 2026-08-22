import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'build', 'icon.ico')
mkdirSync(dirname(outPath), { recursive: true })

const SIZES = [16, 32, 48, 64, 128, 256]

const BG = [11, 18, 32]
const FG = [56, 189, 248]
const EDGE = [2, 132, 199]

function inBolt(u, v) {
  const poly = [
    [0.58, 0.02],
    [0.22, 0.54],
    [0.46, 0.54],
    [0.34, 0.98],
    [0.78, 0.42],
    [0.52, 0.42],
  ]
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const intersect = yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function nearEdge(u, v) {
  const eps = 0.06
  for (let du = -eps; du <= eps; du += eps / 2) {
    for (let dv = -eps; dv <= eps; dv += eps / 2) {
      if (inBolt(Math.min(Math.max(u + du, 0), 1), Math.min(Math.max(v + dv, 0), 1))) return true
    }
  }
  return false
}

function renderDib(size) {
  const xorRowBytes = size * 4
  const xorSize = xorRowBytes * size
  const andRowBytes = Math.ceil(size / 32) * 4
  const andSize = andRowBytes * size
  const buf = Buffer.alloc(40 + xorSize + andSize)

  buf.writeUInt32LE(40, 0)
  buf.writeInt32LE(size, 4)
  buf.writeInt32LE(size * 2, 8)
  buf.writeUInt16LE(1, 12)
  buf.writeUInt16LE(32, 14)
  buf.writeUInt32LE(0, 16)
  buf.writeUInt32LE(xorSize + andSize, 20)

  for (let row = 0; row < size; row += 1) {
    const y = row
    const v = 1 - y / (size - 1)
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1)
      let px = BG
      if (inBolt(u, v)) px = FG
      else if (nearEdge(u, v)) px = EDGE
      const offset = 40 + y * xorRowBytes + x * 4
      buf[offset] = px[2]
      buf[offset + 1] = px[1]
      buf[offset + 2] = px[0]
      buf[offset + 3] = 255
    }
  }
  return buf
}

const images = SIZES.map((size) => ({ size, data: renderDib(size) }))
const headerSize = 6 + images.length * 16
let offset = headerSize
const entries = []
for (const img of images) {
  entries.push({ size: img.size, len: img.data.length, offset })
  offset += img.data.length
}

const ico = Buffer.alloc(offset)
ico.writeUInt16LE(0, 0)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(images.length, 4)

entries.forEach((entry, i) => {
  const base = 6 + i * 16
  ico[base] = entry.size === 256 ? 0 : entry.size
  ico[base + 1] = entry.size === 256 ? 0 : entry.size
  ico.writeUInt16LE(1, base + 2)
  ico.writeUInt16LE(32, base + 4)
  ico.writeUInt32LE(entry.len, base + 8)
  ico.writeUInt32LE(entry.offset, base + 12)
})

images.forEach((img, i) => {
  img.data.copy(ico, entries[i].offset)
})

writeFileSync(outPath, ico)
console.info(`icon written: ${outPath} (${ico.length} bytes)`)
