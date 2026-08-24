type IconProps = {
  class?: string
}

function Svg({
  class: cls = 'size-4',
  children,
  filled = false,
}: IconProps & { children: preact.ComponentChildren; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      class={cls}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function LogoBolt({ class: cls }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" class={cls} fill="none" aria-hidden="true">
      <path
        d="M4.5 4.5h15l-2.6 6.2h1L9.2 19.5l2.2-6.6H7L10 8.2 4.5 4.5Z"
        fill="url(#mf-bolt)"
        stroke="rgb(255 255 255 / 0.55)"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <defs>
        <linearGradient id="mf-bolt" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stop-color="#f97316" />
          <stop offset="1" stop-color="#fbbf24" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function LinkIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  )
}

export function ArrowRightIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  )
}

export function DownloadIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  )
}

export function FilmIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="m10 9 5 3-5 3Z" />
    </Svg>
  )
}

export function MusicIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </Svg>
  )
}

export function SlidersIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </Svg>
  )
}

export function QueueIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M3 6h13" />
      <path d="M3 12h13" />
      <path d="M3 18h9" />
      <path d="M19 9v9" />
      <path d="m16.5 15.5 2.5 2.5 2.5-2.5" transform="translate(0 -1.5)" />
    </Svg>
  )
}

export function GearIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.97Z" />
    </Svg>
  )
}

export function FolderIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-7.6L9.7 5.1A2 2 0 0 0 8.2 4.5H5a2 2 0 0 0-2 2Z" />
    </Svg>
  )
}

export function SearchIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4-4" />
    </Svg>
  )
}

export function CheckIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="m5 13 4 4L19 7" />
    </Svg>
  )
}

export function CloseIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

export function AlertIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="m10.3 3.9-8.2 14a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

export function InfoIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Svg>
  )
}

export function CookieIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Z" />
      <path d="M8.5 8.5h.01" />
      <path d="M15.5 15.5h.01" />
      <path d="M9.5 14.5h.01" />
      <path d="M14 10.5h.01" />
    </Svg>
  )
}

export function DocIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </Svg>
  )
}

export function RefreshIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Svg>
  )
}

export function ShieldIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z" />
      <path d="m8.8 11.8 2.2 2.2 4.2-4.2" />
    </Svg>
  )
}

export function PlayIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls} filled>
      <path d="M8 5.8a1 1 0 0 1 1.53-.85l9.6 6.2a1 1 0 0 1 0 1.7l-9.6 6.2A1 1 0 0 1 8 18.2Z" />
    </Svg>
  )
}

export function ClockIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  )
}

export function EyeIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function CalendarIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 2.5V6M16 2.5V6" />
    </Svg>
  )
}

export function LayersIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="m12 3 9 5-9 5-9-5Z" />
      <path d="m3.5 12.5 8.5 4.7 8.5-4.7" />
      <path d="m3.5 16.8 8.5 4.7 8.5-4.7" />
    </Svg>
  )
}

export function GaugeIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M5 19a9 9 0 1 1 14 0" />
      <path d="m12 13 4-4" />
      <circle cx="12" cy="13" r="1.4" />
    </Svg>
  )
}

export function TerminalIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </Svg>
  )
}

export function ClipboardIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <rect x="8" y="2.5" width="8" height="4" rx="1" />
      <path d="M16 4.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2" />
      <path d="M9.5 13l2 2 3.5-3.5" />
    </Svg>
  )
}

export function PaletteIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <path d="M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3.5-4 3.5h-1.6a2 2 0 0 0-1.4 3.4c.4.5.5 1.2 0 1.6-.5.4-1.2.5-2 .5Z" />
      <circle cx="7.8" cy="12.2" r="1.15" />
      <circle cx="10" cy="7.8" r="1.15" />
      <circle cx="14.6" cy="7.6" r="1.15" />
    </Svg>
  )
}

export function HardDriveIcon({ class: cls }: IconProps) {
  return (
    <Svg class={cls}>
      <rect x="2.5" y="7" width="19" height="10" rx="2.5" />
      <path d="M6.5 12h.01M10 12h.01" />
      <path d="M14 12h4" />
    </Svg>
  )
}

export function Spinner({ class: cls = 'size-4' }: { class?: string }) {
  return (
    <svg class={`animate-spin ${cls}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3.5" />
      <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  )
}
