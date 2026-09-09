import { computed, signal } from '@preact/signals'
import {
  DEFAULT_SEARCH_LIMIT,
  SEARCH_PLATFORMS,
  type SearchResultItem,
  type SearchSort,
} from '../../../shared/models'

export const searchPlatform = signal<string>(SEARCH_PLATFORMS[0].id)
export const searchQuery = signal('')
export const searchLimit = signal<number>(DEFAULT_SEARCH_LIMIT)
export const searchSort = signal<SearchSort>('relevance')

/** Advanced filters — applied client-side over whatever the last query returned, no re-query. */
export const filterMinDurationSec = signal<number | null>(null)
export const filterMaxDurationSec = signal<number | null>(null)
export const filterMinViews = signal<number | null>(null)

export const searching = signal(false)
export const searchResults = signal<SearchResultItem[]>([])
export const searchError = signal<{ code: string; message: string } | null>(null)
export const lastSearchedQuery = signal<{ platform: string; query: string } | null>(null)
export const selectedResultUrls = signal<ReadonlySet<string>>(new Set())

export const filteredResults = computed(() => {
  const min = filterMinDurationSec.value
  const max = filterMaxDurationSec.value
  const minViews = filterMinViews.value
  return searchResults.value.filter((r) => {
    if (min !== null && (r.durationSec == null || r.durationSec < min)) return false
    if (max !== null && (r.durationSec == null || r.durationSec > max)) return false
    if (minViews !== null && (r.viewCount == null || r.viewCount < minViews)) return false
    return true
  })
})

export function resetSearchResults(): void {
  searchResults.value = []
  searchError.value = null
  selectedResultUrls.value = new Set()
  lastSearchedQuery.value = null
}

export function toggleResultSelection(url: string): void {
  const next = new Set(selectedResultUrls.value)
  if (next.has(url)) next.delete(url)
  else next.add(url)
  selectedResultUrls.value = next
}

export function setAllResultsSelected(select: boolean): void {
  selectedResultUrls.value = select ? new Set(filteredResults.value.map((r) => r.url)) : new Set()
}
