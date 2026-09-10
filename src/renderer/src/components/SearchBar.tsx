import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import {
  SEARCH_PLATFORMS,
  SEARCH_RESULT_LIMITS,
  type SearchContentType,
  type SearchSort,
  type UploadRecency,
} from '../../../shared/models'
import {
  activeFilterCount,
  filterContentType,
  filterHas4K,
  filterHasSubtitles,
  filterMaxDurationSec,
  filterMinDurationSec,
  filterMinFps,
  filterMinViews,
  filterQuality,
  filterRailDuration,
  filterType,
  filterUploadRecency,
  filterVerifiedOnly,
  lastSearchedQuery,
  parseViewCountInput,
  resetSearch,
  saveDefaultSearchFilters,
  searchError,
  searchLimit,
  searchPlatform,
  searchQuery,
  searchResults,
  searchSort,
  searching,
} from '../signals/searchState'
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  InfoIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersIcon,
  Spinner,
} from './icons'

const PLATFORM_ACCENTS: Record<string, string> = {
  youtube: 'bg-rose-500',
  soundcloud: 'bg-orange-500',
  bilibili: 'bg-sky-400',
}

type DurationPreset = 'all' | 'short' | 'medium' | 'long'

const DURATION_PRESETS: Array<{ id: DurationPreset; label: string }> = [
  { id: 'all', label: 'All durations' },
  { id: 'short', label: '< 4 min (Shorts)' },
  { id: 'medium', label: '4–20 min' },
  { id: 'long', label: '> 20 min (Longform)' },
]

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
  const [infoOpen, setInfoOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const platformRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)
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

  const totalActiveFilters = activeFilterCount.value

  const hasStateToReset =
    query.length > 0 ||
    searchResults.value.length > 0 ||
    lastSearchedQuery.value !== null ||
    searchError.value !== null ||
    totalActiveFilters > 0

  useDismiss(filtersOpen, filtersRef, () => setFiltersOpen(false))
  useDismiss(platformOpen, platformRef, () => setPlatformOpen(false))
  useDismiss(infoOpen, infoRef, () => setInfoOpen(false))

  return (
    <div class="mf-search-panel flex flex-col gap-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        class="mf-search-form app-no-drag flex items-stretch overflow-visible border border-line-strong bg-[var(--surface-input)] transition-all duration-200 focus-within:border-sky-400/60 focus-within:shadow-[0_0_0_3px_var(--mf-glow)]"
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
            class="mf-focus-ring flex cursor-pointer items-center gap-2 rounded-l-md bg-transparent py-2 pl-3 pr-2.5 text-[11px] font-semibold text-slate-200 outline-none transition hover:bg-wash-2 disabled:cursor-not-allowed disabled:opacity-50"
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
          class="min-w-0 flex-1 bg-transparent px-3 py-2 text-[11px] text-slate-100 outline-none transition placeholder:text-slate-600 disabled:opacity-60"
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
            class="mf-focus-ring my-auto flex size-6 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-wash-2 hover:text-slate-200"
          >
            <CloseIcon class="size-3.5" />
          </button>
        )}

        {/* right: run search and reset */}
        {busy ? (
          <button
            type="button"
            onClick={() => void window.mf.searchCancel()}
            class="mf-focus-ring m-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[11px] font-semibold text-slate-200 transition hover:border-rose-500/60 hover:text-rose-300 active:scale-[0.98]"
          >
            <Spinner class="size-3.5" />
            Cancel
          </button>
        ) : (
          <div class="flex shrink-0 items-center gap-2 p-1">
            {hasStateToReset && (
              <button
                type="button"
                onClick={() => {
                  resetSearch()
                  inputRef.current?.focus()
                }}
                title="Reset search, filters and clear results"
                aria-label="Reset search"
                class="mf-focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 transition hover:border-neutral-400 hover:text-ink active:scale-[0.98] dark:text-slate-300 dark:hover:border-slate-500"
              >
                <RotateCcwIcon class="size-3.5" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="submit"
              disabled={query.trim().length === 0}
              className={`mf-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sky-500 px-4 py-1.5 text-[11px] font-bold text-white shadow-sm shadow-sky-500/30 transition-all duration-150 hover:bg-sky-600 active:scale-[0.98] ${
                query.trim().length === 0 ? 'cursor-not-allowed opacity-35 shadow-none' : ''
              }`}
              title="Search (Enter)"
            >
              <SearchIcon class="size-4" />
              Search
            </button>
          </div>
        )}

        {/* far right: advanced filters popover */}
        <div ref={filtersRef} class="relative my-1 mr-0.5 ml-0 flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              setPlatformOpen(false)
              setInfoOpen(false)
              setFiltersOpen((v) => !v)
            }}
            aria-expanded={filtersOpen}
            aria-haspopup="true"
            title="Advanced filters & criteria"
            className={`mf-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition ${
              filtersOpen || totalActiveFilters > 0
                ? 'border-orange-500/60 bg-orange-500/10 text-orange-500 dark:text-orange-400'
                : 'border-line-strong text-slate-300 hover:border-orange-500/40 hover:text-ink'
            }`}
          >
            <SlidersIcon class="size-3.5" />
            Filters
            {totalActiveFilters > 0 && (
              <span class="mf-num flex size-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">
                {totalActiveFilters}
              </span>
            )}
          </button>

          {filtersOpen && (
            <AdvancedFilters
              dateSortSupported={platform.id === 'youtube' || !!platform.dateSortPrefix}
              onClose={() => setFiltersOpen(false)}
              onApply={() => {
                const q = searchQuery.value.trim()
                if (q.length > 0) {
                  onSubmit()
                }
              }}
            />
          )}
        </div>

        {/* info popover right after Filters */}
        <div ref={infoRef} class="relative my-1 mr-1 ml-0.5 flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              setPlatformOpen(false)
              setFiltersOpen(false)
              setInfoOpen((v) => !v)
            }}
            aria-expanded={infoOpen}
            aria-haspopup="dialog"
            title="Platform search info"
            aria-label="Platform search info"
            className={`mf-focus-ring inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition ${
              infoOpen
                ? 'border-sky-500/60 bg-sky-500/10 text-sky-400'
                : 'border-line-strong text-slate-400 hover:border-line hover:text-ink dark:hover:border-slate-500 dark:hover:text-slate-200'
            }`}
          >
            <InfoIcon class="size-3.5" />
          </button>

          {infoOpen && (
            <div class="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)]">
              <div
                role="dialog"
                aria-label="Supported Search Platforms Info"
                class="mf-card mf-rise flex flex-col gap-2 rounded-xl border border-neutral-200/90 bg-white p-3.5 shadow-2xl text-neutral-800 dark:border-line-strong dark:bg-[#131722] dark:text-slate-100"
              >
                <div class="flex items-start justify-between gap-2 border-b border-neutral-100 pb-2 dark:border-line">
                  <div class="flex items-center gap-1.5">
                    <span class="flex size-5 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                      <AlertIcon class="size-3" />
                    </span>
                    <span class="text-xs font-bold text-neutral-900 dark:text-slate-100">
                      Search Platform Support
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInfoOpen(false)}
                    class="rounded-md p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-slate-400 dark:hover:bg-wash-2 dark:hover:text-slate-200 transition"
                    aria-label="Close"
                  >
                    <CloseIcon class="size-3.5" />
                  </button>
                </div>
                <div class="space-y-1.5 text-xs text-neutral-600 dark:text-slate-300 leading-relaxed">
                  <p>
                    In-app search only works for platforms yt-dlp can query directly (YouTube,
                    SoundCloud, Bilibili).
                  </p>
                  <p class="text-[11px] text-neutral-500 dark:text-slate-400 border-t border-neutral-100 dark:border-line pt-2">
                    Every other supported site still works by pasting a link in the Downloader tab.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </form>

      {searchResults.value.length > 0 && (
        <div class="mf-search-filter-rail app-no-drag mt-2 flex items-center overflow-x-auto bg-recess px-2 py-1.5">
          <FilterGroup label="Duration">
            {DURATION_PRESETS.map((preset) => (
              <FilterChip
                key={preset.id}
                active={filterRailDuration.value === preset.id}
                onClick={() => (filterRailDuration.value = preset.id)}
              >
                {preset.label}
              </FilterChip>
            ))}
          </FilterGroup>

          <span class="h-5 w-px shrink-0 bg-line" aria-hidden="true" />

          <FilterGroup label="Type">
            <FilterChip
              active={filterType.value === 'all'}
              onClick={() => (filterType.value = 'all')}
            >
              All types
            </FilterChip>
            <FilterChip
              active={filterType.value === 'video'}
              onClick={() => (filterType.value = 'video')}
            >
              Video (MP4/MKV)
            </FilterChip>
            <FilterChip
              active={filterType.value === 'audio'}
              onClick={() => (filterType.value = 'audio')}
            >
              Audio / Mixes
            </FilterChip>
            <FilterChip
              active={filterType.value === 'subtitled'}
              onClick={() => (filterType.value = 'subtitled')}
            >
              Subtitled
            </FilterChip>
          </FilterGroup>

          <span class="h-5 w-px shrink-0 bg-line" aria-hidden="true" />

          <FilterGroup label="Quality">
            <FilterChip
              active={filterQuality.value === 'any'}
              onClick={() => (filterQuality.value = 'any')}
            >
              Any quality
            </FilterChip>
            <FilterChip
              active={filterQuality.value === '1080p'}
              onClick={() => (filterQuality.value = '1080p')}
            >
              1080p FHD+
            </FilterChip>
            <FilterChip
              active={filterQuality.value === '720p'}
              onClick={() => (filterQuality.value = '720p')}
            >
              720p HD
            </FilterChip>
            <FilterChip
              active={filterQuality.value === 'audio'}
              onClick={() => (filterQuality.value = 'audio')}
            >
              Audio only
            </FilterChip>
          </FilterGroup>
        </div>
      )}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="mf-search-filter-group flex shrink-0 items-center">
      <span class="mf-search-filter-label">{label}</span>
      <div class="mf-search-filter-options flex items-center">{children}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ComponentChildren
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      class={`mf-search-filter-chip mf-focus-ring ${active ? 'is-active' : ''}`}
    >
      {children}
    </button>
  )
}

function AdvancedFilters({
  dateSortSupported,
  onClose,
  onApply,
}: {
  dateSortSupported: boolean
  onClose: () => void
  onApply: () => void
}) {
  const [draftContentType, setDraftContentType] = useState<SearchContentType>(
    filterContentType.value,
  )
  const [draftSort, setDraftSort] = useState<SearchSort>(searchSort.value)
  const [draftLimit, setDraftLimit] = useState<number>(searchLimit.value)
  const [draftRecency, setDraftRecency] = useState<UploadRecency>(filterUploadRecency.value)
  const [draftMinMins, setDraftMinMins] = useState<string>(
    filterMinDurationSec.value !== null ? String(Math.round(filterMinDurationSec.value / 60)) : '0',
  )
  const [draftMaxMins, setDraftMaxMins] = useState<string>(
    filterMaxDurationSec.value !== null ? String(Math.round(filterMaxDurationSec.value / 60)) : '',
  )
  const [sliderVal, setSliderVal] = useState<number>(
    filterMaxDurationSec.value !== null
      ? Math.min(120, Math.round(filterMaxDurationSec.value / 60))
      : 120,
  )
  const [draftMinViews, setDraftMinViews] = useState<string>(
    filterMinViews.value !== null ? String(filterMinViews.value) : '',
  )
  const [draftFps, setDraftFps] = useState<number | null>(filterMinFps.value)
  const [draftSubtitles, setDraftSubtitles] = useState<boolean>(filterHasSubtitles.value)
  const [draft4K, setDraft4K] = useState<boolean>(filterHas4K.value)
  const [draftVerified, setDraftVerified] = useState<boolean>(filterVerifiedOnly.value)
  const [savedFeedback, setSavedFeedback] = useState(false)

  // Calculate active filter count for the draft
  let draftActiveCount = 0
  if (draftContentType !== 'all') draftActiveCount++
  if (draftSort !== 'relevance') draftActiveCount++
  if (draftLimit !== 20) draftActiveCount++
  if (draftRecency !== 'all') draftActiveCount++
  if (draftMinMins !== '0' && draftMinMins !== '') draftActiveCount++
  if (draftMaxMins !== '') draftActiveCount++
  if (draftMinViews !== '') draftActiveCount++
  if (draftFps !== null) draftActiveCount++
  if (draftSubtitles) draftActiveCount++
  if (draft4K) draftActiveCount++
  if (draftVerified) draftActiveCount++

  function handleResetAll() {
    setDraftContentType('all')
    setDraftSort('relevance')
    setDraftLimit(20)
    setDraftRecency('all')
    setDraftMinMins('0')
    setDraftMaxMins('')
    setSliderVal(120)
    setDraftMinViews('')
    setDraftFps(null)
    setDraftSubtitles(false)
    setDraft4K(false)
    setDraftVerified(false)
  }

  function commitDraftState() {
    filterContentType.value = draftContentType
    searchSort.value = draftSort
    searchLimit.value = draftLimit
    filterUploadRecency.value = draftRecency
    filterMinDurationSec.value =
      draftMinMins === '0' || draftMinMins === '' ? null : Math.max(0, Number(draftMinMins)) * 60
    filterMaxDurationSec.value = draftMaxMins === '' ? null : Math.max(0, Number(draftMaxMins)) * 60
    filterMinViews.value = parseViewCountInput(draftMinViews)
    filterMinFps.value = draftFps
    filterHasSubtitles.value = draftSubtitles
    filterHas4K.value = draft4K
    filterVerifiedOnly.value = draftVerified
  }

  function handleSaveAsDefault() {
    commitDraftState()
    saveDefaultSearchFilters()
    setSavedFeedback(true)
    setTimeout(() => setSavedFeedback(false), 2000)
  }

  function handleApply() {
    commitDraftState()
    onClose()
    onApply()
  }

  return (
    <div class="absolute right-0 top-full z-40 mt-2 w-[660px] max-w-[calc(100vw-2rem)]">
      <div
        role="dialog"
        aria-label="Search Filters & Criteria"
        class="mf-card mf-rise flex flex-col rounded-2xl border border-neutral-200/90 dark:border-line-strong bg-white dark:bg-[#131722] p-4 shadow-2xl text-neutral-800 dark:text-slate-100 max-h-[min(85vh,540px)] overflow-y-auto"
      >
        {/* Header */}
        <div class="flex items-start justify-between gap-2 pb-3 border-b border-neutral-200/70 dark:border-line">
          <div class="flex items-center gap-2.5">
            <div class="flex size-8.5 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
              <svg
                class="size-4.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </div>
            <div>
              <h3 class="text-[13px] font-bold text-neutral-900 dark:text-slate-100 leading-tight">
                Search Filters & Criteria
              </h3>
              <p class="text-[10px] text-neutral-500 dark:text-slate-400 mt-0.5">
                Tune server queries & client filter rules
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={handleResetAll}
              class="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition"
            >
              Reset All
            </button>
            <button
              type="button"
              onClick={onClose}
              class="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-wash-2 hover:text-neutral-700 dark:text-slate-400 dark:hover:text-slate-200 transition"
              aria-label="Close"
            >
              <CloseIcon class="size-4" />
            </button>
          </div>
        </div>

        {/* 2-Column Body Layout */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 py-3 border-b border-neutral-200/70 dark:border-line">
          {/* Column 1: Server-Side Query & Recency */}
          <div class="flex flex-col gap-3 md:border-r md:border-neutral-200/70 dark:md:border-line md:pr-4">
            {/* Section 1: SERVER-SIDE QUERY */}
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  <span>➔</span> SERVER-SIDE QUERY
                </span>
                <span class="rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-600 dark:text-sky-400">
                  Re-fetches
                </span>
              </div>

              {/* Content Type Selector */}
              <div class="flex flex-col gap-1 mb-2">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-semibold text-neutral-800 dark:text-slate-200">
                    Content Type
                  </span>
                  <span class="text-[9.5px] text-neutral-400 dark:text-slate-500">
                    Music, Playlists & Shorts
                  </span>
                </div>
                <div class="grid grid-cols-2 gap-1 bg-neutral-100 dark:bg-recess p-0.5 rounded-xl border border-neutral-200/60 dark:border-line">
                  <button
                    type="button"
                    onClick={() => setDraftContentType('all')}
                    class={`col-span-2 rounded-lg py-1 px-2 text-[11px] transition text-center ${
                      draftContentType === 'all'
                        ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    All Media
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftContentType('video')}
                    class={`rounded-lg py-1 px-2 text-[11px] transition text-center ${
                      draftContentType === 'video'
                        ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Videos Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftContentType('music')}
                    class={`rounded-lg py-1 px-2 text-[11px] transition text-center ${
                      draftContentType === 'music'
                        ? 'bg-purple-600 text-white font-bold shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Music Videos
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftContentType('playlist')}
                    class={`rounded-lg py-1 px-2 text-[11px] transition text-center ${
                      draftContentType === 'playlist'
                        ? 'bg-amber-500 text-white font-bold shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Playlists Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftContentType('reel')}
                    class={`rounded-lg py-1 px-2 text-[11px] transition text-center ${
                      draftContentType === 'reel'
                        ? 'bg-red-500 text-white font-bold shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Reels & Shorts
                  </button>
                </div>
              </div>

              {/* Sort Algorithm */}
              <div class="flex flex-col gap-1 mb-2">
                <span class="text-[11px] font-semibold text-neutral-800 dark:text-slate-200">
                  Sort Algorithm
                </span>
                <div class="flex rounded-xl bg-neutral-100 dark:bg-recess p-0.5 gap-0.5 border border-neutral-200/60 dark:border-line">
                  <button
                    type="button"
                    onClick={() => setDraftSort('relevance')}
                    class={`flex-1 rounded-lg py-1 text-[11px] transition ${
                      draftSort === 'relevance'
                        ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Relevance
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftSort('newest')}
                    disabled={!dateSortSupported}
                    title={dateSortSupported ? '' : 'Platform has no date-sort extractor'}
                    class={`flex-1 rounded-lg py-1 text-[11px] transition ${
                      draftSort === 'newest'
                        ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200 disabled:opacity-40'
                    }`}
                  >
                    Upload Date
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftSort('views')}
                    class={`flex-1 rounded-lg py-1 text-[11px] transition ${
                      draftSort === 'views'
                        ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                        : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                    }`}
                  >
                    View Count
                  </button>
                </div>
              </div>

              {/* Results Limit */}
              <div>
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[11px] font-semibold text-neutral-800 dark:text-slate-200">
                    Results Limit
                  </span>
                  <span class="text-[9.5px] text-neutral-400 dark:text-slate-500">
                    yt-dlp limit cap
                  </span>
                </div>
                <div class="grid grid-cols-4 gap-1.5">
                  {SEARCH_RESULT_LIMITS.map((lim) => (
                    <button
                      key={lim}
                      type="button"
                      onClick={() => setDraftLimit(lim)}
                      class={`rounded-xl py-1 text-xs text-center transition ${
                        draftLimit === lim
                          ? 'border-2 border-orange-500 text-orange-600 dark:text-orange-400 font-bold bg-orange-500/5'
                          : 'border border-neutral-200 dark:border-line bg-neutral-50/50 dark:bg-recess text-neutral-700 dark:text-slate-300 hover:border-neutral-300 dark:hover:border-line-strong'
                      }`}
                    >
                      {lim}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Section 2: UPLOAD RECENCY */}
            <div class="pt-2 border-t border-neutral-200/60 dark:border-line">
              <span class="text-[9.5px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400 block mb-1.5">
                Upload Recency (Hydrated)
              </span>
              <div class="flex flex-wrap gap-1.5">
                {[
                  { id: 'all', label: 'Any time' },
                  { id: '24h', label: 'Last 24 hours' },
                  { id: 'week', label: 'This week' },
                  { id: 'month', label: 'This month' },
                  { id: 'year', label: 'This year' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDraftRecency(item.id as UploadRecency)}
                    class={`rounded-xl px-2.5 py-1 text-[11px] transition ${
                      draftRecency === item.id
                        ? 'border-2 border-orange-500 text-orange-600 dark:text-orange-400 font-bold bg-orange-500/5'
                        : 'border border-neutral-200 dark:border-line bg-neutral-50/50 dark:bg-recess text-neutral-700 dark:text-slate-300 hover:border-neutral-300 dark:hover:border-line-strong'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Column 2: Duration, Metrics & Content Filters */}
          <div class="flex flex-col gap-3">
            {/* Section 3: DURATION & METRICS */}
            <div>
              <span class="text-[9.5px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400 block mb-1.5">
                Duration & Metrics
              </span>

              <div class="flex items-center gap-2 mb-1.5">
                <label class="flex-1 flex flex-col gap-0.5">
                  <span class="text-[9.5px] font-semibold text-neutral-600 dark:text-slate-400">
                    Min Duration (mins)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={draftMinMins}
                    onInput={(e) => setDraftMinMins((e.target as HTMLInputElement).value)}
                    class="w-full rounded-xl border border-neutral-200 dark:border-line bg-neutral-50/50 dark:bg-recess px-2.5 py-1 text-xs text-neutral-900 dark:text-slate-100 outline-none focus:border-orange-500"
                  />
                </label>
                <label class="flex-1 flex flex-col gap-0.5">
                  <span class="text-[9.5px] font-semibold text-neutral-600 dark:text-slate-400">
                    Max Duration (mins)
                  </span>
                  <input
                    type="text"
                    placeholder="Unlimited"
                    value={draftMaxMins}
                    onInput={(e) => {
                      const val = (e.target as HTMLInputElement).value
                      setDraftMaxMins(val)
                      if (val === '' || Number.isNaN(Number(val))) {
                        setSliderVal(120)
                      } else {
                        setSliderVal(Math.min(120, Math.max(0, Number(val))))
                      }
                    }}
                    class="w-full rounded-xl border border-neutral-200 dark:border-line bg-neutral-50/50 dark:bg-recess px-2.5 py-1 text-xs text-neutral-900 dark:text-slate-100 outline-none focus:border-orange-500"
                  />
                </label>
              </div>

              <div class="my-2 px-0.5">
                <input
                  type="range"
                  min="0"
                  max="120"
                  step="1"
                  value={sliderVal}
                  onInput={(e) => {
                    const val = Number((e.target as HTMLInputElement).value)
                    setSliderVal(val)
                    if (val >= 120) {
                      setDraftMaxMins('')
                    } else {
                      setDraftMaxMins(String(val))
                    }
                  }}
                  class="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-neutral-200 dark:bg-neutral-700 accent-orange-500"
                />
              </div>

              <div class="flex items-end gap-2">
                <label class="flex-1 flex flex-col gap-0.5">
                  <span class="text-[9.5px] font-semibold text-neutral-600 dark:text-slate-400">
                    Min Views Threshold
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 10,000+"
                    value={draftMinViews}
                    onInput={(e) => setDraftMinViews((e.target as HTMLInputElement).value)}
                    class="w-full rounded-xl border border-neutral-200 dark:border-line bg-neutral-50/50 dark:bg-recess px-2.5 py-1 text-xs text-neutral-900 dark:text-slate-100 outline-none focus:border-orange-500"
                  />
                </label>
                <div class="flex-1 flex flex-col gap-0.5">
                  <span class="text-[9.5px] font-semibold text-neutral-600 dark:text-slate-400">
                    Min Framerate
                  </span>
                  <div class="flex rounded-xl bg-neutral-100 dark:bg-recess p-0.5 gap-0.5 border border-neutral-200/60 dark:border-line">
                    <button
                      type="button"
                      onClick={() => setDraftFps(null)}
                      class={`flex-1 rounded-lg py-1 text-[11px] transition ${
                        draftFps === null
                          ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                          : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Any
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftFps(60)}
                      class={`flex-1 rounded-lg py-1 text-[11px] transition ${
                        draftFps === 60
                          ? 'bg-white dark:bg-[#1e2330] font-bold text-neutral-900 dark:text-slate-100 shadow-xs'
                          : 'font-medium text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
                      }`}
                    >
                      60 FPS
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4: CONTENT & STREAMS */}
            <div class="pt-2 border-t border-neutral-200/60 dark:border-line">
              <span class="text-[9.5px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400 block mb-2">
                Content & Streams
              </span>
              <div class="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setDraftSubtitles((v) => !v)}
                  class="flex items-center gap-2 text-left text-[11px] font-medium text-neutral-800 dark:text-slate-200 hover:text-ink transition cursor-pointer"
                >
                  <span
                    class={`flex size-4 shrink-0 items-center justify-center rounded transition ${
                      draftSubtitles
                        ? 'bg-orange-500 text-white'
                        : 'border border-neutral-300 dark:border-line-strong bg-white dark:bg-[#1a202c]'
                    }`}
                  >
                    {draftSubtitles && <CheckIcon class="size-3 stroke-[3]" />}
                  </span>
                  <span>Has Subtitles / Closed Captions</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDraft4K((v) => !v)}
                  class="flex items-center gap-2 text-left text-[11px] font-medium text-neutral-800 dark:text-slate-200 hover:text-ink transition cursor-pointer"
                >
                  <span
                    class={`flex size-4 shrink-0 items-center justify-center rounded transition ${
                      draft4K
                        ? 'bg-orange-500 text-white'
                        : 'border border-neutral-300 dark:border-line-strong bg-white dark:bg-[#1a202c]'
                    }`}
                  >
                    {draft4K && <CheckIcon class="size-3 stroke-[3]" />}
                  </span>
                  <span>Has 4K / Ultra-HD stream (2160p)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDraftVerified((v) => !v)}
                  class="flex items-center gap-2 text-left text-[11px] font-medium text-neutral-800 dark:text-slate-200 hover:text-ink transition cursor-pointer"
                >
                  <span
                    class={`flex size-4 shrink-0 items-center justify-center rounded transition ${
                      draftVerified
                        ? 'bg-orange-500 text-white'
                        : 'border border-neutral-300 dark:border-line-strong bg-white dark:bg-[#1a202c]'
                    }`}
                  >
                    {draftVerified && <CheckIcon class="size-3 stroke-[3]" />}
                  </span>
                  <span>Verified Channels Only</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div class="flex items-center justify-between pt-2.5">
          <button
            type="button"
            onClick={handleSaveAsDefault}
            class="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-slate-100 transition"
          >
            {savedFeedback ? 'Saved as default ✓' : 'Save as Default'}
          </button>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              class="rounded-xl border border-neutral-300 dark:border-line-strong px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-wash-2 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              class="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm shadow-orange-500/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              <span>Apply Filters</span>
              {draftActiveCount > 0 && (
                <span class="rounded bg-black/25 px-1.5 py-0.5 text-[9.5px] font-bold text-white">
                  {draftActiveCount} active
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
