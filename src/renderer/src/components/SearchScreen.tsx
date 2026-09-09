import { SEARCH_PLATFORMS, type SearchResultItem } from '../../../shared/models'
import { SearchBar } from './SearchBar'
import { SearchResults } from './SearchResults'
import { AlertIcon, CookieIcon, RefreshIcon, SearchIcon } from './icons'
import {
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
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <div class="w-full max-w-md text-center">
        <span class="mf-hairline mx-auto mb-4 flex size-14 items-center justify-center rounded-3xl">
          <span class="flex size-full items-center justify-center rounded-3xl bg-gradient-to-br from-go-500/25 to-indigo-500/20 shadow-inner">
            <SearchIcon class="size-6 text-sky-400" />
          </span>
        </span>
        <p class="text-base font-bold tracking-tight text-ink">
          Search a platform without leaving the app.
        </p>
        <p class="mt-1.5 text-xs leading-relaxed text-slate-500">
          Pick a platform on the left of the bar above, type a query, and press Search. Select
          results below to open one in the Downloader tab or queue several at once.
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

export function SearchScreen({
  onOpenInDownloader,
  onAddToQueue,
  busy,
}: {
  onOpenInDownloader: (item: SearchResultItem) => void
  onAddToQueue: (items: SearchResultItem[]) => void
  busy: boolean
}) {
  async function runSearch() {
    const platform = searchPlatform.value
    const query = searchQuery.value.trim()
    if (!query || searching.value) return
    searching.value = true
    searchError.value = null
    try {
      const response = await window.mf.searchStart({
        platform,
        query,
        limit: searchLimit.value,
        sort: searchSort.value,
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
    <div class="flex min-h-0 flex-1 flex-col gap-3">
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
          busy={busy}
        />
      )}
    </div>
  )
}
