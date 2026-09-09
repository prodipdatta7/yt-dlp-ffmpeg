import { useEffect, useRef, useState } from 'preact/hooks'
import { SEARCH_PLATFORMS, SEARCH_RESULT_LIMITS } from '../../../shared/models'
import {
  filterMaxDurationSec,
  filterMinDurationSec,
  filterMinViews,
  searchLimit,
  searchPlatform,
  searchQuery,
  searchSort,
  searching,
} from '../signals/searchState'
import { Segmented } from './ui'
import { AlertIcon, CheckIcon, CloseIcon, SearchIcon, SlidersIcon, Spinner } from './icons'

const PLATFORM_ACCENTS: Record<string, string> = {
  youtube: 'bg-rose-500',
  soundcloud: 'bg-orange-500',
  bilibili: 'bg-sky-400',
}

function useDismiss(open: boolean, ref: { current: HTMLElement | null }, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
}

export function SearchBar({ onSubmit }: { onSubmit: () => void }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [platformOpen, setPlatformOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const platformRef = useRef<HTMLDivElement>(null)
  const platform =
    SEARCH_PLATFORMS.find((p) => p.id === searchPlatform.value) ?? SEARCH_PLATFORMS[0]
  const query = searchQuery.value
  const busy = searching.value

  function submit() {
    if (query.trim().length === 0 || busy) return
    onSubmit()
  }

  function selectPlatform(id: string) {
    searchPlatform.value = id
    if (searchSort.value === 'newest') {
      const next = SEARCH_PLATFORMS.find((p) => p.id === id)
      if (!next?.dateSortPrefix) searchSort.value = 'relevance'
    }
    setPlatformOpen(false)
  }

  const activeFilterCount =
    (filterMinDurationSec.value !== null ? 1 : 0) +
    (filterMaxDurationSec.value !== null ? 1 : 0) +
    (filterMinViews.value !== null ? 1 : 0)

  useDismiss(filtersOpen, filtersRef, () => setFiltersOpen(false))
  useDismiss(platformOpen, platformRef, () => setPlatformOpen(false))

  return (
    <div class="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        class="app-no-drag flex items-stretch overflow-visible rounded-2xl border border-line-strong bg-[var(--surface-input)] transition-all duration-200 focus-within:border-sky-400/60 focus-within:shadow-[0_0_0_3px_var(--mf-glow)]"
      >
        {/* left: platform picker (dropdown) */}
        <div ref={platformRef} class="relative flex shrink-0 items-center border-r border-line">
          <button
            type="button"
            disabled={busy}
            aria-haspopup="listbox"
            aria-expanded={platformOpen}
            aria-label="Search platform"
            onClick={() => {
              setFiltersOpen(false)
              setPlatformOpen((v) => !v)
            }}
            class="mf-focus-ring flex cursor-pointer items-center gap-2 rounded-l-2xl bg-transparent py-3 pl-4 pr-3 text-sm font-semibold text-slate-200 outline-none transition hover:bg-wash-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              class={`size-1.5 shrink-0 rounded-full ${PLATFORM_ACCENTS[platform.id] ?? 'bg-slate-500'}`}
              aria-hidden="true"
            />
            {platform.label}
            <svg
              viewBox="0 0 24 24"
              class={`size-3.5 shrink-0 text-slate-500 transition-transform duration-150 ${
                platformOpen ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {platformOpen && (
            <div class="absolute left-0 top-full z-20 mt-2 w-48">
              <div
                role="listbox"
                aria-label="Search platform"
                class="mf-card mf-rise flex flex-col gap-0.5 p-1.5 shadow-2xl"
              >
                {SEARCH_PLATFORMS.map((p) => {
                  const active = p.id === platform.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => selectPlatform(p.id)}
                      className={`mf-focus-ring flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                        active
                          ? 'bg-sky-500/15 text-sky-200'
                          : 'text-slate-300 hover:bg-wash-2 hover:text-ink'
                      }`}
                    >
                      <span
                        class={`size-1.5 shrink-0 rounded-full ${
                          PLATFORM_ACCENTS[p.id] ?? 'bg-slate-500'
                        }`}
                        aria-hidden="true"
                      />
                      <span class="flex-1 truncate">{p.label}</span>
                      {active && <CheckIcon class="size-3 shrink-0 text-sky-300" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* middle: query input */}
        <input
          ref={inputRef}
          type="text"
          spellcheck={false}
          placeholder={`Search ${platform.label}…`}
          value={query}
          onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
          disabled={busy}
          aria-label="Search query"
          class="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 disabled:opacity-60"
        />

        {query.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => {
              searchQuery.value = ''
              inputRef.current?.focus()
            }}
            title="Clear"
            aria-label="Clear query"
            class="mf-focus-ring my-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-wash-2 hover:text-slate-200"
          >
            <CloseIcon class="size-3.5" />
          </button>
        )}

        {/* right: run search */}
        {busy ? (
          <button
            type="button"
            onClick={() => void window.mf.searchCancel()}
            class="mf-focus-ring m-1.5 inline-flex shrink-0 items-center gap-2 rounded-xl border border-line-strong px-4 text-xs font-semibold text-slate-200 transition hover:border-rose-500/60 hover:text-rose-300 active:scale-[0.98]"
          >
            <Spinner class="size-3.5" />
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={query.trim().length === 0}
            className={`mf-focus-ring m-1.5 inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 px-5 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${
              query.trim().length === 0 ? 'cursor-not-allowed opacity-35 shadow-none' : ''
            }`}
            title="Search (Enter)"
          >
            <SearchIcon class="size-4" />
            Search
          </button>
        )}

        {/* far right: advanced filters popover */}
        <div ref={filtersRef} class="relative my-1.5 mr-1.5 ml-0.5 flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              setPlatformOpen(false)
              setFiltersOpen((v) => !v)
            }}
            aria-expanded={filtersOpen}
            aria-haspopup="true"
            title="Advanced filters"
            className={`mf-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              filtersOpen || activeFilterCount > 0
                ? 'border-sky-400/50 bg-sky-500/10 text-sky-300'
                : 'border-line-strong text-slate-300 hover:border-sky-400/40 hover:text-ink'
            }`}
          >
            <SlidersIcon class="size-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span class="mf-num flex size-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {filtersOpen && <AdvancedFilters dateSortSupported={!!platform.dateSortPrefix} />}
        </div>
      </form>

      <p class="flex items-center gap-1.5 px-1 text-[10.5px] text-slate-600">
        <AlertIcon class="size-3 shrink-0" />
        In-app search only works for platforms yt-dlp can query directly (YouTube, SoundCloud,
        Bilibili). Every other supported site still works by pasting a link in the Downloader tab.
      </p>
    </div>
  )
}

function AdvancedFilters({ dateSortSupported }: { dateSortSupported: boolean }) {
  const minMinutes = filterMinDurationSec.value !== null ? filterMinDurationSec.value / 60 : ''
  const maxMinutes = filterMaxDurationSec.value !== null ? filterMaxDurationSec.value / 60 : ''
  const minViews = filterMinViews.value ?? ''

  return (
    <div class="absolute right-0 top-full z-20 mt-2 w-80">
      <div
        role="dialog"
        aria-label="Advanced search filters"
        class="mf-card mf-rise flex flex-col gap-3.5 p-3.5 shadow-2xl"
      >
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Sort
          </span>
          <Segmented
            options={
              dateSortSupported
                ? [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'newest', label: 'Newest' },
                  ]
                : [{ value: 'relevance', label: 'Relevance' }]
            }
            value={searchSort.value}
            onChange={(v) => (searchSort.value = v)}
          />
          {!dateSortSupported && (
            <span class="text-[10px] text-slate-600">
              This platform has no date-sort extractor.
            </span>
          )}
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Results
          </span>
          <Segmented
            options={SEARCH_RESULT_LIMITS.map((n) => ({ value: n, label: String(n) }))}
            value={searchLimit.value}
            onChange={(v) => (searchLimit.value = v)}
          />
        </label>

        <div class="flex items-end gap-3">
          <label class="flex flex-1 flex-col gap-1">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Min duration (min)
            </span>
            <input
              type="number"
              min={0}
              value={minMinutes}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                filterMinDurationSec.value = v === '' ? null : Math.max(0, Number(v)) * 60
              }}
              class="w-full rounded-lg border border-line-strong bg-recess px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-400/60"
            />
          </label>

          <label class="flex flex-1 flex-col gap-1">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Max duration (min)
            </span>
            <input
              type="number"
              min={0}
              value={maxMinutes}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                filterMaxDurationSec.value = v === '' ? null : Math.max(0, Number(v)) * 60
              }}
              class="w-full rounded-lg border border-line-strong bg-recess px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-400/60"
            />
          </label>
        </div>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Min views
          </span>
          <input
            type="number"
            min={0}
            value={minViews}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value
              filterMinViews.value = v === '' ? null : Math.max(0, Number(v))
            }}
            class="w-full rounded-lg border border-line-strong bg-recess px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-400/60"
          />
        </label>

        {(filterMinDurationSec.value !== null ||
          filterMaxDurationSec.value !== null ||
          filterMinViews.value !== null) && (
          <button
            type="button"
            onClick={() => {
              filterMinDurationSec.value = null
              filterMaxDurationSec.value = null
              filterMinViews.value = null
            }}
            class="mf-focus-ring self-start rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
          >
            Clear filters
          </button>
        )}

        <p class="text-[10px] leading-relaxed text-slate-600">
          Duration and views filters apply instantly to the results already fetched — they don't
          re-run the search. "Newest" changes the query itself and re-fetches when supported.
        </p>
      </div>
    </div>
  )
}
