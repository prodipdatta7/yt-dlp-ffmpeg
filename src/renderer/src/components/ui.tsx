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
      <span class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {icon}
        {title}
      </span>
      {hint && <span class="text-xs text-slate-600">{hint}</span>}
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
      class={`inline-flex gap-1 rounded-xl border border-line bg-recess p-1 ${cls}`}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            class={`mf-focus-ring rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 ${
              active
                ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/25'
                : 'text-slate-400 hover:bg-wash-2 hover:text-ink'
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
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  children: ComponentChildren
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      class={`mf-chip mf-focus-ring mf-num rounded-lg border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 ${
        active
          ? 'border-[var(--mf-detail-border)] bg-[var(--mf-detail-active)] text-[var(--mf-detail-accent)] shadow-[0_0_12px_-4px_var(--mf-glow)]'
          : 'border-line bg-wash-1 text-slate-400 hover:border-line-strong hover:text-ink'
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
    <div class="rounded-lg border border-line bg-wash-1 px-2.5 py-1.5">
      <p class="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
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
    neutral: 'border-line-strong bg-wash-1 text-slate-400',
    sky: 'border-[var(--mf-detail-border)] bg-[var(--mf-detail-active)] text-[#1d4ed8] dark:text-[var(--mf-detail-bright)]',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  }
  return (
    <span
      class={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
