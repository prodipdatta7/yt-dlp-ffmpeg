import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { storeAssetSizes, verifyStoreAssets } from '../../scripts/verify-store-assets.mjs'

describe('Store tile assets (certification 10.1.1.11)', () => {
  it.skipIf(process.platform !== 'win32')(
    'keeps every Windows icon frame in sync with the header artwork',
    () => {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../../scripts/make-icon.mjs', import.meta.url)), '--check'],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      )
      expect(result.error).toBeUndefined()
      expect(result.status, result.stdout + result.stderr).toBe(0)
    },
    20000,
  )

  it('supplies all required tiles and logos at their manifest dimensions', () => {
    expect(() => verifyStoreAssets()).not.toThrow()
  })

  it('fails rather than letting electron-builder substitute default artwork', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mf-store-assets-'))
    const url = pathToFileURL(`${directory}/`)
    try {
      expect(() => verifyStoreAssets(url)).toThrow()
      for (const name of Object.keys(storeAssetSizes)) {
        const png = readFileSync(new URL(`../../build/appx/${name}`, import.meta.url))
        writeFileSync(new URL(name, url), png)
      }
      expect(() => verifyStoreAssets(url)).not.toThrow()
      const logo = new URL('StoreLogo.png', url)
      const png = readFileSync(logo)
      png.writeUInt32BE(1, 16)
      writeFileSync(logo, png)
      expect(() => verifyStoreAssets(url)).toThrow(/StoreLogo.png/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
