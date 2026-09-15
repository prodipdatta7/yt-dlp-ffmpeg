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
  return (
    <nav
      role="tablist"
      aria-label="Settings sections"
      aria-orientation="vertical"
      class="sticky top-0 flex w-48 shrink-0 flex-col gap-3.5 self-start"
    >
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} class="flex flex-col gap-0.5">
          <span class="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {group.label}
          </span>
          {group.items.map((s) => {
            const isActive = active === s.id
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(s.id)}
                class={`mf-focus-ring group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ${
                  isActive
                    ? 'mf-nav-active-card font-semibold'
                    : 'text-slate-500 hover:bg-wash-2 hover:text-slate-200'
                }`}
              >
                {isActive && (
                  <span class="absolute -left-2 h-4 w-[3px] rounded-full bg-gradient-to-b from-sky-400 to-indigo-400" />
                )}
                <s.Icon class="size-4 shrink-0" />
                <span class="flex-1 truncate">{s.label}</span>
                {s.id === 'storage' && leftoverCount > 0 && (
                  <span class="mf-num flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-500">
                    {leftoverCount > 9 ? '9+' : leftoverCount}
                  </span>
                )}
                {s.id === 'cookies' && cookieConfigured && (
                  <span
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
