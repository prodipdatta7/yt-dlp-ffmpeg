import { useEffect, useState } from 'preact/hooks'
import { Pill } from './ui'
import { AboutSection } from './settings/AboutSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { CookiesSection } from './settings/CookiesSection'
import { DestinationSection } from './settings/DestinationSection'
import { DiagnosticsSection } from './settings/DiagnosticsSection'
import { DownloadsSection } from './settings/DownloadsSection'
import { DriversSection } from './settings/DriversSection'
import { SETTINGS_SECTIONS, settingsPanelId, settingsTabId, SideNav } from './settings/SideNav'
import { StorageSection } from './settings/StorageSection'

interface SharedSettings {
  lastOutputDir: string
  cookieFileSet: boolean
  playlistConcurrency: number
  notifyOnComplete: boolean
}

function mapSettings(s: {
  lastOutputDir: string
  cookieFileSet: boolean
  playlistConcurrency: number
  notifyOnComplete: boolean
}): SharedSettings {
  return {
    lastOutputDir: s.lastOutputDir,
    cookieFileSet: s.cookieFileSet,
    playlistConcurrency: s.playlistConcurrency,
    notifyOnComplete: s.notifyOnComplete,
  }
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<SharedSettings | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [leftoverCount, setLeftoverCount] = useState(0)
  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id)

  function refreshSettings() {
    void window.mf
      .getSettings()
      .then((s) => setSettings(mapSettings(s)))
      .catch(() => undefined)
  }

  useEffect(() => {
    refreshSettings()
    // A lightweight standalone peek so the sidebar badge is right even before
    // the Storage view (which owns the full fetch/clear logic) is opened.
    void window.mf
      .listPartials()
      .then((res) => setLeftoverCount(res.items.length))
      .catch(() => undefined)
    void window.mf
      .getAppVersion()
      .then((r) => setAppVersion(r.version))
      .catch(() => undefined)
  }, [])

  async function setConcurrency(next: number) {
    const clamped = Math.min(5, Math.max(2, next))
    setSettings((prev) => (prev ? { ...prev, playlistConcurrency: clamped } : prev))
    try {
      const saved = await window.mf.setSettings({ playlistConcurrency: clamped })
      setSettings((prev) =>
        prev ? { ...prev, playlistConcurrency: saved.playlistConcurrency } : prev,
      )
    } catch {
      return
    }
  }

  async function setNotify(on: boolean) {
    setSettings((prev) => (prev ? { ...prev, notifyOnComplete: on } : prev))
    try {
      const saved = await window.mf.setSettings({ notifyOnComplete: on })
      setSettings((prev) => (prev ? { ...prev, notifyOnComplete: saved.notifyOnComplete } : prev))
    } catch {
      return
    }
  }

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div class="mf-digital-only mf-workspace-heading">
        <div>
          <p class="mf-workspace-kicker">SYSTEM & ENGINES</p>
          <h2>
            Settings & Control<span>.</span>
          </h2>
        </div>
        <div class="flex items-center gap-3">
          <span class="mf-workspace-hint hidden sm:inline">Engine Config & Diagnostics</span>
          <Pill tone="sky">MediaForge{appVersion ? ` v${appVersion}` : ''}</Pill>
        </div>
      </div>

      <div class="flex items-start gap-6">
        <SideNav
          active={activeSection}
          onSelect={setActiveSection}
          leftoverCount={leftoverCount}
          cookieConfigured={settings?.cookieFileSet ?? false}
        />

        <div
          id={settingsPanelId(activeSection)}
          class="min-w-0 flex-1"
          role="tabpanel"
          aria-labelledby={settingsTabId(activeSection)}
        >
          {activeSection === 'appearance' && <AppearanceSection />}

          {activeSection === 'destination' && (
            <DestinationSection
              lastOutputDir={settings?.lastOutputDir ?? ''}
              onChange={(dir) =>
                setSettings((prev) => (prev ? { ...prev, lastOutputDir: dir } : prev))
              }
            />
          )}

          {activeSection === 'downloads' && (
            <DownloadsSection
              playlistConcurrency={settings?.playlistConcurrency ?? 3}
              notifyOnComplete={settings?.notifyOnComplete !== false}
              onConcurrencyChange={(next) => void setConcurrency(next)}
              onNotifyChange={(next) => void setNotify(next)}
            />
          )}

          {activeSection === 'storage' && <StorageSection onCountChange={setLeftoverCount} />}

          {activeSection === 'cookies' && (
            <CookiesSection
              cookieFileSet={settings?.cookieFileSet ?? false}
              onRefresh={refreshSettings}
            />
          )}

          {activeSection === 'drivers' && <DriversSection />}

          {activeSection === 'diagnostics' && <DiagnosticsSection />}

          {activeSection === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  )
}
