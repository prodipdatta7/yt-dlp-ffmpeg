import { useEffect, useState } from 'preact/hooks'
import {
  ambientGridEnabled,
  animationsEnabled,
  setAmbientGrid,
  setAnimationsEnabled,
  setThemePref,
  setUiDensity,
  themePref,
  uiDensity,
  type ThemePref,
  type UiDensity,
} from '../../signals/uiState'
import { CheckIcon, GaugeIcon, PaletteIcon, SlidersIcon, TerminalIcon } from '../icons'
import { SettingsCard, SettingsRow, Switch } from '../SettingsCard'
import { Segmented } from '../ui'

async function chooseTheme(pref: ThemePref): Promise<void> {
  setThemePref(pref)
  try {
    await window.mf.setSettings({ theme: pref })
  } catch {
    /* the local choice still applies even if persisting it failed */
  }
}

function ThemePreviewMini({ theme }: { theme: 'light' | 'dark' | 'system' }) {
  if (theme === 'light') {
    return (
      <div class="h-20 w-full overflow-hidden rounded-xl border border-[#cbd9ec] bg-[#f2f6fd] p-2 shadow-inner">
        <div class="flex h-3 items-center gap-1 border-b border-[#d5e0f2] bg-white px-1">
          <span class="size-1.5 rounded-full bg-rose-400" />
          <span class="size-1.5 rounded-full bg-amber-400" />
          <span class="size-1.5 rounded-full bg-emerald-400" />
          <span class="ml-auto h-1.5 w-8 rounded bg-[#dce6f5]" />
        </div>
        <div class="mt-1 flex gap-1.5">
          <div class="h-11 w-3 rounded bg-[#e4eeff]" />
          <div class="flex-1 space-y-1">
            <div class="h-3 w-full rounded border border-[#245cda]/30 bg-white" />
            <div class="grid grid-cols-2 gap-1">
              <div class="h-6 rounded border border-[#dce6f5] bg-white p-1">
                <div class="h-1 w-4 rounded bg-[#f46a50]" />
              </div>
              <div class="h-6 rounded border border-[#dce6f5] bg-white p-1">
                <div class="h-1 w-4 rounded bg-[#245cda]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (theme === 'dark') {
    return (
      <div class="h-20 w-full overflow-hidden rounded-xl border border-[#263653] bg-[#08111f] p-2 shadow-inner">
        <div class="flex h-3 items-center gap-1 border-b border-[#263653] bg-[#0d1728] px-1">
          <span class="size-1.5 rounded-full bg-rose-500" />
          <span class="size-1.5 rounded-full bg-amber-500" />
          <span class="size-1.5 rounded-full bg-emerald-500" />
          <span class="ml-auto h-1.5 w-8 rounded bg-slate-800" />
        </div>
        <div class="mt-1 flex gap-1.5">
          <div class="h-11 w-3 rounded bg-[#17243a]" />
          <div class="flex-1 space-y-1">
            <div class="h-3 w-full rounded border border-[#4f89ff]/40 bg-[#111d31]" />
            <div class="grid grid-cols-2 gap-1">
              <div class="h-6 rounded border border-line bg-slate-900/80 p-1">
                <div class="h-1 w-4 rounded bg-[#ff7c66]" />
              </div>
              <div class="h-6 rounded border border-line bg-slate-900/80 p-1">
                <div class="h-1 w-4 rounded bg-[#4f89ff]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // System dual split
  return (
    <div class="relative h-20 w-full overflow-hidden rounded-xl border border-line shadow-inner">
      <div class="absolute inset-0 grid grid-cols-2">
        <div class="border-r border-[#dce6f5] bg-[#f2f6fd] p-2">
          <div class="mb-1 h-2 w-full rounded bg-white" />
          <div class="mb-1 h-3 w-full rounded border border-[#245cda]/30 bg-white" />
          <div class="h-5 w-full rounded border border-[#dce6f5] bg-white" />
        </div>
        <div class="bg-[#08111f] p-2">
          <div class="mb-1 h-2 w-full rounded bg-[#0d1728]" />
          <div class="mb-1 h-3 w-full rounded border border-[#4f89ff]/30 bg-[#111d31]" />
          <div class="h-5 w-full rounded border border-[#263653] bg-[#17243a]" />
        </div>
      </div>
    </div>
  )
}

export function AppearanceSection() {
  const [metrics, setMetrics] = useState({
    viewport: `${window.innerWidth} × ${window.innerHeight} px`,
    dpr: `${window.devicePixelRatio || 1}x`,
    dpi: `${Math.round((window.devicePixelRatio || 1) * 96)} DPI`,
    colorDepth: `${window.screen.colorDepth || 24}-bit`,
    gamut: window.matchMedia?.('(color-gamut: p3)')?.matches ? 'Display P3' : 'sRGB',
  })

  useEffect(() => {
    function onResize() {
      setMetrics({
        viewport: `${window.innerWidth} × ${window.innerHeight} px`,
        dpr: `${window.devicePixelRatio || 1}x`,
        dpi: `${Math.round((window.devicePixelRatio || 1) * 96)} DPI`,
        colorDepth: `${window.screen.colorDepth || 24}-bit`,
        gamut: window.matchMedia?.('(color-gamut: p3)')?.matches ? 'Display P3' : 'sRGB',
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const themes: Array<{
    id: ThemePref
    title: string
    subtitle: string
    badges: string[]
  }> = [
    {
      id: 'light',
      title: 'Digital Daylight',
      subtitle: 'Airy white surfaces with cobalt, signal teal, and coral accents.',
      badges: ['#F2F6FD', '#245CDA', '#25B7A7'],
    },
    {
      id: 'dark',
      title: 'Digital Night',
      subtitle: 'The same energetic workspace on deep navy, with brighter shared signals.',
      badges: ['#08111F', '#4F89FF', '#3AD1BD'],
    },
    {
      id: 'system',
      title: 'System Sync',
      subtitle: 'Syncs continuously with your Windows desktop light/dark preferences.',
      badges: ['MatchMedia', 'Auto Sync'],
    },
  ]

  return (
    <div class="flex flex-col gap-5">
      {/* 1. Theme Selection Studio */}
      <SettingsCard
        icon={<PaletteIcon class="size-4" />}
        title="Color Palette & Theme Studio"
        description="Select an active aesthetic or allow MediaForge to match your operating system."
      >
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label="Theme">
          {themes.map((t) => {
            const isSelected = themePref.value === t.id
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => void chooseTheme(t.id)}
                class={`mf-focus-ring flex flex-col items-start rounded-2xl border p-3.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ${
                  isSelected
                    ? 'border-sky-500 bg-sky-500/5 shadow-md shadow-sky-500/10'
                    : 'border-line bg-wash-1 hover:border-line-strong hover:bg-wash-2'
                }`}
              >
                <div class="relative mb-3 w-full">
                  <ThemePreviewMini theme={t.id} />
                  {isSelected && (
                    <span class="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-sky-500 text-white shadow">
                      <CheckIcon class="size-3" />
                    </span>
                  )}
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[13px] font-bold tracking-tight text-ink">{t.title}</span>
                  {isSelected && (
                    <span class="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-600 dark:bg-sky-500/15 dark:text-sky-300">
                      Active
                    </span>
                  )}
                </div>
                <p class="mt-1 text-xs leading-relaxed text-slate-500">{t.subtitle}</p>
                <div class="mt-3 flex flex-wrap items-center gap-1">
                  {t.badges.map((b) => (
                    <span
                      key={b}
                      class="rounded border border-line bg-wash-2 px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-400"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      {/* 2. Interface Density & Scale */}
      <SettingsCard
        icon={<SlidersIcon class="size-4" />}
        title="Interface Density"
        description="Adjust layout padding, vertical rhythm, and tap targets across all tabs."
      >
        <div class="divide-y divide-line">
          <SettingsRow
            label="Workspace Density"
            description="Comfortable provides spacious padding; Compact tightens margins for large queues."
            control={
              <Segmented<UiDensity>
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
                value={uiDensity.value}
                onChange={(v) => setUiDensity(v)}
              />
            }
          />
        </div>
      </SettingsCard>

      {/* 3. Ambience & Visual Effects */}
      <SettingsCard
        icon={<TerminalIcon class="size-4" />}
        title="Ambience & Motion"
        description="Fine-tune visual effects, blueprint overlays, and motion accessibility."
      >
        <div class="divide-y divide-line">
          <SettingsRow
            label="Blueprint Ambience Grid"
            description="Display subtle architectural coordinate grids on launchpads and hero states."
            control={
              <Switch
                checked={ambientGridEnabled.value}
                onChange={(on) => setAmbientGrid(on)}
                label="Blueprint Grid"
              />
            }
          />
          <SettingsRow
            label="Fluid Micro-Transitions"
            description="Smooth CSS transforms and hover interpolations. Disable to minimize motion."
            control={
              <Switch
                checked={animationsEnabled.value}
                onChange={(on) => setAnimationsEnabled(on)}
                label="Fluid Transitions"
              />
            }
          />
        </div>
      </SettingsCard>

      {/* 4. Display & Hardware Telemetry Grid */}
      <SettingsCard
        icon={<GaugeIcon class="size-4" />}
        title="Display & Compositor Telemetry"
        description="Live hardware graphics and typography metrics reported by the Chromium runtime."
      >
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Viewport Resolution
            </span>
            <p class="mf-num mt-1 text-xs font-bold text-ink">{metrics.viewport}</p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Pixel Ratio & DPI
            </span>
            <p class="mf-num mt-1 text-xs font-bold text-ink">
              {metrics.dpr} · {metrics.dpi}
            </p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Color Space & Depth
            </span>
            <p class="mf-num mt-1 text-xs font-bold text-ink">
              {metrics.colorDepth} · {metrics.gamut}
            </p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              GPU Compositor
            </span>
            <p class="mt-1 text-xs font-bold text-emerald-500">Direct3D 11 Active</p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              UI Typography
            </span>
            <p class="mt-1 truncate text-xs font-bold text-ink">Segoe UI Variable Display</p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Monospace Engine
            </span>
            <p class="mt-1 truncate text-xs font-mono font-bold text-ink">Cascadia Code</p>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
