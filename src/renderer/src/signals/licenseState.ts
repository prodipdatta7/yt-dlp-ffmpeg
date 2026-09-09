import { signal } from '@preact/signals'
import type { LicenseState } from '../../../shared/ipcContract'

export const licenseState = signal<LicenseState>({ tier: 'free', email: null })

export function setLicenseState(next: LicenseState): void {
  licenseState.value = next
}

export function refreshLicenseState(): void {
  window.mf
    .getLicense()
    .then(setLicenseState)
    .catch(() => undefined)
}
