import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// electron-builder silently substitutes its own artwork if a required asset is absent.
// Fail before packaging instead (Store certification policy 10.1.1.11).
export const storeAssetSizes = {
  'StoreLogo.png': [50, 50],
  'Square44x44Logo.png': [44, 44],
  'Square150x150Logo.png': [150, 150],
  'Wide310x150Logo.png': [310, 150],
  'SmallTile.png': [71, 71],
  'LargeTile.png': [310, 310],
}

export function verifyStoreAssets(directory = new URL('../build/appx/', import.meta.url)) {
  for (const [name, [width, height]] of Object.entries(storeAssetSizes)) {
    const png = readFileSync(new URL(name, directory))
    if (
      png.length < 24 ||
      png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.toString('ascii', 12, 16) !== 'IHDR' ||
      png.readUInt32BE(16) !== width ||
      png.readUInt32BE(20) !== height
    ) {
      throw new Error(`Invalid Store asset ${name}: expected a ${width}x${height} PNG`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyStoreAssets()
  console.info('MediaForge Store tile assets verified.')
}
