import type { AppUpdateCheckResult } from '../../shared/ipcContract'

/**
 * Windows Store / MSIX packaging awareness (AM-22).
 *
 * `process.windowsStore` is Electron's documented signal that the app is running from inside an
 * MSIX/AppX package. Electron's own Windows Store guidance is to use it to "disable or adapt
 * features that are not allowed or that behave differently in the store (e.g. auto-updater)",
 * and two behaviours genuinely differ here:
 *
 * 1. **Self-update is not permitted.** The Store owns updates for Store-installed apps, and
 *    AM-15's flow (download the NSIS installer, launch it, quit so it can replace the app) cannot
 *    work by construction: a packaged app cannot replace its own install directory, and an MSIX
 *    install is not an NSIS install to be replaced in the first place.
 * 2. **The package directory is read-only and virtualized.** AM-03 already forbids writing into
 *    the install directory, so binary overrides, the runtime override and temp staging all keep
 *    working — but anything that assumed a writable folder next to the executable would break.
 *
 * Deliberately a pure function over an explicit environment: no Electron import, so it is
 * unit-testable under §12 and callable from the IPC layer without threading `process` around.
 */
export type AppDistribution = 'store' | 'standalone'

export interface PackagingEnvironment {
  /** Mirrors Electron's `process.windowsStore` — true inside an MSIX/AppX package. */
  windowsStore?: boolean
}

export function appDistribution(env: PackagingEnvironment = {}): AppDistribution {
  return env.windowsStore === true ? 'store' : 'standalone'
}

/**
 * True when the app may fetch and launch its own installer (AM-15). False under a Store package,
 * where the Microsoft Store delivers updates.
 */
export function allowsSelfUpdate(env: PackagingEnvironment = {}): boolean {
  return appDistribution(env) === 'standalone'
}

/** Shown instead of the installer flow in a Store-installed build. */
export const STORE_MANAGED_UPDATE_NOTICE =
  'Updates are delivered by the Microsoft Store for this installation.'

/**
 * The update-check result a Store-managed install reports, with no network call.
 *
 * Exists as a named function rather than an inline literal so the invariant that matters —
 * a Store install never advertises a downloadable update, and always says who owns updates —
 * is unit-tested instead of being re-derived at the call site.
 */
export function storeManagedUpdateCheck(currentVersion: string): AppUpdateCheckResult {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    managedByStore: true,
  }
}
