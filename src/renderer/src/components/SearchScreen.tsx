import { SEARCH_PLATFORMS, type SearchResultItem } from '../../../shared/models'
import { SearchBar } from './SearchBar'
import { clearPreviewCaches } from './searchPreviewShared'
import { SearchResults } from './SearchResults'
import { AlertIcon, CookieIcon, RefreshIcon, SearchIcon } from './icons'
import {
  filterQuality,
  filterRailDuration,
  filterType,
  getActiveSearchFilters,
  lastSearchedQuery,
  searchError,
  searchLimit,
  searchPlatform,
  searchQuery,
  searchResults,
  searchSort,
  searching,
  selectedResultUrls,
} from '../signals/searchState'
import { openSettings } from '../signals/uiState'

function SearchEmptyState() {
  const lastPlatform = lastSearchedQuery.value
    ? SEARCH_PLATFORMS.find((platform) => platform.id === lastSearchedQuery.value?.platform)
    : undefined
  const emptyFederatedSearch = lastPlatform?.discovery.kind === 'public-web'
  const isInitialSearch = lastSearchedQuery.value === null && searchError.value === null

  function focusSearch(query?: string, platformId?: string): void {
    if (query !== undefined) searchQuery.value = query
    if (platformId !== undefined) searchPlatform.value = platformId
    window.dispatchEvent(new CustomEvent('mf:focus-search'))
  }

  if (isInitialSearch) {
    const starterSearches = [
      { label: 'Music mixes', query: 'late night jazz mix', accent: 'coral' },
      { label: 'Creative tutorials', query: 'motion design tutorial', accent: 'blue' },
      { label: 'Live sessions', query: 'live studio performance', accent: 'teal' },
    ] as const

    return (
      <section class="mf-search-launchpad" aria-label="Start a search">
        <div class="mf-search-launchpad-copy">
          <p class="mf-search-launchpad-kicker">DISCOVERY ENGINE</p>
          <h2>
            Find the next thing
            <span> worth keeping.</span>
          </h2>
          <p>
            Search supported platforms, inspect the details, then send what matters straight to your
            download queue.
          </p>

          <div class="mf-search-starters" aria-label="Starter searches">
            <span>START WITH A SIGNAL</span>
            <div>
              {starterSearches.map(({ label, query, accent }) => (
                <button
                  key={query}
                  type="button"
                  onClick={() => focusSearch(query)}
                  class={`mf-focus-ring mf-search-starter mf-search-starter-${accent}`}
                >
                  {label}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div class="mf-search-orbit" aria-hidden="true">
          <span class="mf-search-orbit-ring mf-search-orbit-ring-one" />
          <span class="mf-search-orbit-ring mf-search-orbit-ring-two" />
          <span class="mf-search-orbit-ring mf-search-orbit-ring-three" />
          <span class="mf-search-orbit-node mf-search-orbit-node-coral" />
          <span class="mf-search-orbit-node mf-search-orbit-node-teal" />
          <span class="mf-search-orbit-core">
            <SearchIcon class="size-8" />
          </span>
          <span class="mf-search-orbit-caption">SCAN / DISCOVER</span>
        </div>

        <div class="mf-search-platform-rail">
          <span>CHOOSE A SOURCE</span>
          <div>
            {SEARCH_PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                type="button"
                onClick={() => focusSearch(undefined, platform.id)}
                class="mf-focus-ring"
              >
                {platform.label}
              </button>
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <div class="w-full max-w-md text-center">
        <span class="mf-hairline mx-auto mb-4 flex size-14 items-center justify-center rounded-3xl">
          <span class="flex size-full items-center justify-center rounded-3xl bg-gradient-to-br from-go-500/25 to-indigo-500/20 shadow-inner">
            <SearchIcon class="size-6 text-sky-400" />
          </span>
        </span>
        <p class="text-base font-bold tracking-tight text-ink">
          {emptyFederatedSearch
            ? 'No public video results found.'
            : 'Search a platform without leaving the app.'}
        </p>
        <p class="mt-1.5 text-xs leading-relaxed text-slate-500">
          {emptyFederatedSearch
            ? 'Public-web discovery did not return a downloadable post for this query. Try broader keywords or paste a direct link in Downloader.'
            : 'Pick a platform on the left of the bar above, type a query, and press Search. Select results below to open one in the Downloader tab or queue several at once.'}
        </p>
        <div class="mt-5 flex flex-wrap items-center justify-center gap-1.5">
          {SEARCH_PLATFORMS.map((p) => (
            <span
              key={p.id}
              class="rounded-full border border-line bg-wash-1 px-2.5 py-0.5 text-[11px] font-medium text-slate-500"
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SearchSkeleton() {
  return (
    <div class="mf-card grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} class="flex items-center gap-2.5 rounded-lg p-1.5">
          <div class="mf-skeleton h-9 w-16 shrink-0 rounded-md" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <div class="mf-skeleton h-3.5 w-full" />
            <div class="mf-skeleton h-2.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

import type { FormatPresetOption } from '../utils/estimate'

export function SearchScreen({
  onOpenInDownloader,
  onAddToQueue,
  onQuickDownload,
  busy,
}: {
  onOpenInDownloader: (item: SearchResultItem) => void
  onAddToQueue: (items: SearchResultItem[], preset?: FormatPresetOption) => void
  onQuickDownload?: (item: SearchResultItem, preset: FormatPresetOption) => void
  busy: boolean
}) {
  const isInitialSearch = lastSearchedQuery.value === null && searchError.value === null

  async function runSearch() {
    const platform = searchPlatform.value
    const query = searchQuery.value.trim()
    if (!query) return
    if (searching.value) {
      try {
        await window.mf.searchCancel()
      } catch {
        /* best effort */
      }
    }
    searching.value = true
    searchError.value = null
    searchResults.value = []
    // The previous results' cards are gone; their cached preview content is dead weight (P-06).
    clearPreviewCaches()
    filterRailDuration.value = 'all'
    filterType.value = 'all'
    filterQuality.value = 'any'
    try {
      const response = await window.mf.searchStart({
        platform,
        query,
        limit: searchLimit.value,
        sort: searchSort.value,
        filters: getActiveSearchFilters(),
      })
      if (response.kind === 'ok') {
        searchResults.value = response.results
        selectedResultUrls.value = new Set()
        lastSearchedQuery.value = { platform, query }
      } else {
        searchError.value = { code: response.code, message: response.message }
      }
    } catch {
      searchError.value = { code: 'MF_UNKNOWN', message: 'Unexpected IPC failure.' }
    } finally {
      searching.value = false
    }
  }

  return (
    <div class="mf-search-content flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {isInitialSearch && (
        <div class="mf-digital-only mf-search-default-heading mf-workspace-heading">
          <div>
            <p class="mf-workspace-kicker">DISCOVER</p>
            <h2>
              Find your next favorite<span>.</span>
            </h2>
          </div>
          <span class="mf-workspace-hint">Search · Preview · Queue</span>
        </div>
      )}
      <SearchBar onSubmit={() => void runSearch()} />

      {searchError.value && (
        <div
          class="flex items-start justify-between gap-4 rounded-xl border border-rose-500/25 bg-rose-950/40 px-3.5 py-2.5"
          role="alert"
          aria-live="assertive"
        >
          <div class="flex min-w-0 items-start gap-2.5">
            <AlertIcon class="mt-0.5 size-3.5 shrink-0 text-rose-400" />
            <p class="mf-select-text text-xs leading-relaxed text-rose-200">
              {searchError.value.message}
            </p>
          </div>
          <span class="flex shrink-0 gap-2">
            {(searchError.value.code === 'MF_AGE_RESTRICTED' ||
              searchError.value.code === 'MF_BOT_CHECK') && (
              <button
                onClick={() => void window.mf.importCookies()}
                class="mf-focus-ring inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
              >
                <CookieIcon class="size-3" />
                Import cookies.txt…
              </button>
            )}
            {searchError.value.code === 'MF_EXTRACTOR_STALE' && (
              <button
                onClick={openSettings}
                class="mf-focus-ring inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
              >
                <RefreshIcon class="size-3" />
                Update Core Drivers…
              </button>
            )}
          </span>
        </div>
      )}

      {searching.value && searchResults.value.length === 0 ? (
        <SearchSkeleton />
      ) : searchResults.value.length === 0 ? (
        <SearchEmptyState />
      ) : (
        <SearchResults
          onOpenInDownloader={onOpenInDownloader}
          onAddToQueue={onAddToQueue}
          onQuickDownload={onQuickDownload}
          busy={busy}
        />
      )}
    </div>
  )
}
