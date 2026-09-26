import {
  CookieIcon,
  DocIcon,
  DownloadIcon,
  FolderIcon,
  HardDriveIcon,
  InfoIcon,
  PaletteIcon,
  RefreshIcon,
} from '../icons'

export interface SettingsSectionItem {
  id: string
  label: string
  Icon: preact.ComponentType<{ class?: string }>
}

export interface SettingsGroup {
  label: string
  items: readonly SettingsSectionItem[]
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'appearance', label: 'Appearance', Icon: PaletteIcon },
      { id: 'destination', label: 'Destination', Icon: FolderIcon },
      { id: 'downloads', label: 'Downloads', Icon: DownloadIcon },
    ],
  },
  {
    label: 'Engines & Storage',
    items: [
      { id: 'drivers', label: 'Drivers', Icon: RefreshIcon },
      { id: 'storage', label: 'Storage', Icon: HardDriveIcon },
      { id: 'cookies', label: 'Cookies', Icon: CookieIcon },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'diagnostics', label: 'Diagnostics', Icon: DocIcon },
      { id: 'about', label: 'About', Icon: InfoIcon },
    ],
  },
] as const

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.items)

export const settingsTabId = (id: string): string => `settings-tab-${id}`
export const settingsPanelId = (id: string): string => `settings-panel-${id}`

export function SideNav({
  active,
  onSelect,
  leftoverCount,
  cookieConfigured,
}: {
  active: string
  onSelect: (id: string) => void
  leftoverCount: number
  cookieConfigured: boolean
}) {
  function moveFocus(event: preact.JSX.TargetedKeyboardEvent<HTMLButtonElement>, id: string) {
    const currentIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === id)
    let nextIndex: number | null = null

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % SETTINGS_SECTIONS.length
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = SETTINGS_SECTIONS.length - 1
    }

    if (nextIndex === null) return
    event.preventDefault()
    const next = SETTINGS_SECTIONS[nextIndex]
    onSelect(next.id)
    requestAnimationFrame(() => document.getElementById(settingsTabId(next.id))?.focus())
  }

  return (
    <nav
      role="tablist"
      aria-label="Settings sections"
      aria-orientation="vertical"
      class="sticky top-0 flex w-48 shrink-0 flex-col gap-3.5 self-start"
    >
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} class="flex flex-col gap-0.5">
          <span class="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {group.label}
          </span>
          {group.items.map((s) => {
            const isActive = active === s.id
            return (
              <button
                key={s.id}
                id={settingsTabId(s.id)}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={settingsPanelId(s.id)}
                aria-label={
                  s.id === 'cookies' && cookieConfigured ? 'Cookies, configured' : undefined
                }
                tabIndex={isActive ? 0 : -1}
                onClick={() => onSelect(s.id)}
                onKeyDown={(event) => moveFocus(event, s.id)}
                class={`mf-focus-ring group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ${
                  isActive
                    ? 'mf-nav-active-card font-semibold'
                    : 'text-slate-500 hover:bg-wash-2 hover:text-slate-200'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    class="mf-nav-active-mark absolute -left-2 h-4 w-[3px] rounded-full bg-gradient-to-b from-sky-400 to-indigo-400"
                  />
                )}
                <s.Icon class="size-4 shrink-0" />
                <span class="flex-1 truncate">{s.label}</span>
                {s.id === 'storage' && leftoverCount > 0 && (
                  <span class="mf-num flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-500">
                    {leftoverCount > 9 ? '9+' : leftoverCount}
                  </span>
                )}
                {s.id === 'cookies' && cookieConfigured && (
                  <span
                    aria-hidden="true"
                    class="size-1.5 shrink-0 rounded-full bg-emerald-400"
                    title="Cookies imported"
                  />
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
