import { setThemePref, themePref, type ThemePref } from '../../signals/uiState'
import { PaletteIcon } from '../icons'
import { Segmented } from '../ui'
import { SettingsCard } from '../SettingsCard'

async function chooseTheme(pref: ThemePref): Promise<void> {
  setThemePref(pref)
  try {
    await window.mf.setSettings({ theme: pref })
  } catch {
    /* the local choice still applies even if persisting it failed */
  }
}

export function AppearanceSection() {
  return (
    <SettingsCard
      icon={<PaletteIcon class="size-4" />}
      title="Appearance"
      description="Pick a theme — System follows your Windows color scheme."
    >
      <Segmented<ThemePref>
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={themePref.value}
        onChange={(v) => void chooseTheme(v)}
      />
    </SettingsCard>
  )
}
