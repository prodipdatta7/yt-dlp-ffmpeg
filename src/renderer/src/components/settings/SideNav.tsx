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

export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance', Icon: PaletteIcon },
  { id: 'destination', label: 'Destination', Icon: FolderIcon },
  { id: 'downloads', label: 'Downloads', Icon: DownloadIcon },
  { id: 'storage', label: 'Storage', Icon: HardDriveIcon },
  { id: 'cookies', label: 'Cookies', Icon: CookieIcon },
  { id: 'drivers', label: 'Drivers', Icon: RefreshIcon },
  { id: 'diagnostics', label: 'Diagnostics', Icon: DocIcon },
  { id: 'about', label: 'About', Icon: InfoIcon },
] as const

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
      class="sticky top-0 flex w-44 shrink-0 flex-col gap-0.5 self-start"
    >
      {SETTINGS_SECTIONS.map((s) => {
        const isActive = active === s.id
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(s.id)}
            class={`mf-focus-ring group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-all duration-150 ${
              isActive
                ? 'bg-gradient-to-br from-sky-500/15 to-indigo-500/10 text-sky-300'
                : 'text-slate-500 hover:bg-wash-2 hover:text-slate-200'
            }`}
          >
            {isActive && (
              <span class="absolute -left-2.5 h-4 w-[3px] rounded-full bg-gradient-to-b from-sky-400 to-indigo-400" />
            )}
            <s.Icon class="size-4 shrink-0" />
            <span class="flex-1 truncate">{s.label}</span>
            {s.id === 'storage' && leftoverCount > 0 && (
              <span class="mf-num flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-300">
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
    </nav>
  )
}
