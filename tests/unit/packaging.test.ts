import { describe, expect, it } from 'vitest'
import {
  allowsSelfUpdate,
  appDistribution,
  STORE_MANAGED_UPDATE_NOTICE,
  storeManagedUpdateCheck,
} from '../../src/main/app/packaging'

describe('appDistribution (AM-22: process.windowsStore is the packaged-app signal)', () => {
  it('treats an MSIX/AppX package as a store distribution', () => {
    expect(appDistribution({ windowsStore: true })).toBe('store')
  })

  it('treats a plain NSIS/portable install as standalone', () => {
    expect(appDistribution({ windowsStore: false })).toBe('standalone')
    expect(appDistribution({})).toBe('standalone')
    expect(appDistribution()).toBe('standalone')
  })

  it('never treats a missing flag as a store install', () => {
    // Electron leaves windowsStore undefined outside a package; defaulting to "store" would
    // silently disable the updater for every normal install.
    expect(appDistribution({ windowsStore: undefined })).toBe('standalone')
  })
})

describe('allowsSelfUpdate', () => {
  it('permits self-update only outside the Store', () => {
    expect(allowsSelfUpdate({ windowsStore: false })).toBe(true)
    expect(allowsSelfUpdate({ windowsStore: true })).toBe(false)
  })
})

describe('storeManagedUpdateCheck', () => {
  const result = storeManagedUpdateCheck('0.4.0')

  it('never advertises a downloadable update for a Store install', () => {
    // Store policy: the Store owns updates. Offering a self-install here would also be
    // non-functional, since a packaged app cannot replace its own install directory.
    expect(result.updateAvailable).toBe(false)
    expect(result.latestVersion).toBeNull()
  })

  it('tells the UI who owns updates', () => {
    expect(result.managedByStore).toBe(true)
    expect(result.currentVersion).toBe('0.4.0')
    expect(result.error).toBeUndefined()
  })

  it('ships user-facing copy that names the Store', () => {
    expect(STORE_MANAGED_UPDATE_NOTICE).toMatch(/Microsoft Store/)
  })
})
