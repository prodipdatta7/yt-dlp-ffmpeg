import type { ComponentChildren } from 'preact'

export function SettingsCard({
  id,
  icon,
  title,
  description,
  footer,
  children,
  class: cls = '',
}: {
  id?: string
  icon?: ComponentChildren
  title: string
  description?: string
  footer?: ComponentChildren
  children?: ComponentChildren
  class?: string
}) {
  return (
    <section id={id} class={`mf-card overflow-hidden ${cls}`}>
      <div class="flex items-start gap-2.5 px-5 pb-3 pt-4">
        {icon && (
          <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center text-slate-500">
            {icon}
          </span>
        )}
        <div class="min-w-0 flex-1">
          <h3 class="text-[13.5px] font-semibold text-ink">{title}</h3>
          {description && (
            <p class="mt-1 text-[12.5px] leading-relaxed text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {children && <div class="px-5 pb-4">{children}</div>}
      {footer && (
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-wash-1 px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  )
}

/** A single label/control row — stack several inside a `divide-y` wrapper for grouped rows. */
export function SettingsRow({
  label,
  description,
  control,
}: {
  label: string
  description?: string
  control: ComponentChildren
}) {
  return (
    <div class="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div class="min-w-0">
        <p class="text-[13px] font-medium text-slate-200">{label}</p>
        {description && (
          <p class="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{description}</p>
        )}
      </div>
      <div class="shrink-0">{control}</div>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      class={`mf-focus-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 ${
        checked
          ? 'border-transparent bg-gradient-to-br from-sky-500 to-indigo-500'
          : 'border-line-strong bg-wash-2'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        class={`inline-block size-3.5 rounded-full bg-white shadow transition-transform duration-150 ${
          checked ? 'translate-x-[18px]' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
