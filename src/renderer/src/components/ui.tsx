import type { ComponentChildren } from 'preact'

export function SectionLabel({
  icon,
  title,
  hint,
}: {
  icon?: ComponentChildren
  title: string
  hint?: string
}) {
  return (
    <div class="flex items-baseline justify-between gap-3">
      <span class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {icon}
        {title}
      </span>
      {hint && <span class="text-[11px] text-slate-600">{hint}</span>}
    </div>
  )
}

export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
  sublabel?: string
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
  class: cls = '',
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  class?: string
}) {
  return (
    <div
      role="radiogroup"
      class={`inline-flex gap-1 rounded-xl border border-white/[0.07] bg-black/30 p-1 ${cls}`}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            class={`mf-focus-ring rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
              active
                ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/25'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: ComponentChildren
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      class={`mf-focus-ring mf-num rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
        active
          ? 'border-sky-400/60 bg-sky-500/15 text-sky-200 shadow-[0_0_12px_-4px_rgb(56_189_248/0.5)]'
          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

export function StatTile({
  icon,
  label,
  value,
}: {
  icon?: ComponentChildren
  label: string
  value: string
}) {
  return (
    <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5">
      <p class="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </p>
      <p class="mf-num mt-0.5 truncate text-[13px] font-medium text-slate-200" title={value}>
        {value}
      </p>
    </div>
  )
}

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'sky' | 'emerald' | 'rose' | 'amber' | 'violet'
  children: ComponentChildren
}) {
  const tones: Record<string, string> = {
    neutral: 'border-white/10 bg-white/[0.04] text-slate-400',
    sky: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  }
  return (
    <span
      class={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
