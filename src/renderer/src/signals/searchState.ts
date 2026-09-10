import { computed, signal } from '@preact/signals'
import { applySearchHydration } from '../../../shared/searchHydration'
import {
  DEFAULT_SEARCH_LIMIT,
  SEARCH_PLATFORMS,
  type SearchContentType,
  type SearchFilterCriteria,
  type SearchResultItem,
  type SearchSort,
  type UploadRecency,
} from '../../../shared/models'
import { hasExplicitSubtitles, isAudioOrMusicTrack, matchesQualityTier } from '../utils/estimate'

export const searchPlatform = signal<string>(SEARCH_PLATFORMS[0].id)
export const searchQuery = signal('')
export const searchLimit = signal<number>(DEFAULT_SEARCH_LIMIT)
export const searchSort = signal<SearchSort>('relevance')

/** Content type server-side & client-side filter */
export const filterContentType = signal<SearchContentType>('all')

/** Option-1 filter rail signals */
export const filterRailDuration = signal<'all' | 'short' | 'medium' | 'long'>('all')
export const filterType = signal<'all' | 'video' | 'audio' | 'subtitled'>('all')
export const filterQuality = signal<'any' | '1080p' | '720p' | 'audio'>('any')

/** Option-2 rich criteria signals */
export const filterUploadRecency = signal<UploadRecency>('all')
export const filterMinDurationSec = signal<number | null>(null)
export const filterMaxDurationSec = signal<number | null>(null)
export const filterMinViews = signal<number | null>(null)
export const filterMinFps = signal<number | null>(null)
export const filterHasSubtitles = signal<boolean>(false)
export const filterHas4K = signal<boolean>(false)
export const filterVerifiedOnly = signal<boolean>(false)

export const searching = signal(false)
export const searchResults = signal<SearchResultItem[]>([])
export const searchError = signal<{ code: string; message: string } | null>(null)
export const lastSearchedQuery = signal<{ platform: string; query: string } | null>(null)
export const selectedResultUrls = signal<ReadonlySet<string>>(new Set())
export const activePreviewUrl = signal<string | null>(null)

export function closePreview(): void {
  activePreviewUrl.value = null
}

export const activeFilterCount = computed(() => {
  let count = 0
  if (filterContentType.value !== 'all') count++
  if (filterMinDurationSec.value !== null) count++
  if (filterMaxDurationSec.value !== null) count++
  if (filterMinViews.value !== null) count++
  if (filterUploadRecency.value !== 'all') count++
  if (filterMinFps.value !== null) count++
  if (filterHasSubtitles.value) count++
  if (filterHas4K.value) count++
  if (filterVerifiedOnly.value) count++
  if (filterRailDuration.value !== 'all') count++
  if (filterType.value !== 'all') count++
  if (filterQuality.value !== 'any') count++
  if (searchSort.value !== 'relevance') count++
  return count
})

export function getActiveSearchFilters(): SearchFilterCriteria {
  return {
    contentType: filterContentType.value,
    sort: searchSort.value,
    limit: searchLimit.value,
    uploadRecency: filterUploadRecency.value,
    minDurationSec: filterMinDurationSec.value,
    maxDurationSec: filterMaxDurationSec.value,
    minViews: filterMinViews.value,
    minFps: filterMinFps.value,
    hasSubtitles: filterHasSubtitles.value,
    has4K: filterHas4K.value,
    verifiedOnly: filterVerifiedOnly.value,
  }
}

export { parseViewCountInput } from '../utils/estimate'

const SEARCH_DEFAULTS_STORAGE_KEY = 'mediaforge:search-filters-default'

export function saveDefaultSearchFilters(): void {
  if (typeof window === 'undefined') return
  try {
    const defaults = {
      contentType: filterContentType.value,
      sort: searchSort.value,
      limit: searchLimit.value,
      uploadRecency: filterUploadRecency.value,
      minDurationSec: filterMinDurationSec.value,
      maxDurationSec: filterMaxDurationSec.value,
      minViews: filterMinViews.value,
      minFps: filterMinFps.value,
      hasSubtitles: filterHasSubtitles.value,
      has4K: filterHas4K.value,
      verifiedOnly: filterVerifiedOnly.value,
    }
    localStorage.setItem(SEARCH_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults))
  } catch {
    // Ignore storage quota or access errors
  }
}

export function loadDefaultSearchFilters(): void {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(SEARCH_DEFAULTS_STORAGE_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as Partial<SearchFilterCriteria>
    if (d.contentType) filterContentType.value = d.contentType
    if (d.sort) searchSort.value = d.sort
    if (d.limit) searchLimit.value = d.limit
    if (d.uploadRecency) filterUploadRecency.value = d.uploadRecency
    if (d.minDurationSec !== undefined) filterMinDurationSec.value = d.minDurationSec
    if (d.maxDurationSec !== undefined) filterMaxDurationSec.value = d.maxDurationSec
    if (d.minViews !== undefined) filterMinViews.value = d.minViews
    if (d.minFps !== undefined) filterMinFps.value = d.minFps
    if (d.hasSubtitles !== undefined) filterHasSubtitles.value = Boolean(d.hasSubtitles)
    if (d.has4K !== undefined) filterHas4K.value = Boolean(d.has4K)
    if (d.verifiedOnly !== undefined) filterVerifiedOnly.value = Boolean(d.verifiedOnly)
  } catch {
    // Ignore parse or storage errors
  }
}

if (typeof window !== 'undefined') {
  loadDefaultSearchFilters()
}

export const filteredResults = computed(() => {
  const contentType = filterContentType.value
  const type = filterType.value
  const quality = filterQuality.value
  const railDuration = filterRailDuration.value
  const sort = searchSort.value
  const recency = filterUploadRecency.value

  let items = searchResults.value

  // Content type filter (server-side & client-side defense in depth)
  if (contentType === 'playlist') {
    items = items.filter((r) => r.isPlaylist || r.url.includes('/playlist?list='))
  } else if (contentType === 'reel') {
    items = items.filter(
      (r) =>
        !r.isPlaylist &&
        !r.url.includes('/playlist?list=') &&
        (r.isReel ||
          r.url.includes('/shorts/') ||
          /#shorts\b/i.test(r.title) ||
          r.durationSec == null ||
          r.durationSec <= 180),
    )
  } else if (contentType === 'music') {
    items = items.filter(
      (r) =>
        !r.isPlaylist &&
        !r.isReel &&
        (r.isMusicVideo ||
          /\b(official (music )?video|official mv|music video|lyric video|official audio|visualizer)\b/i.test(
            r.title,
          ) ||
          /(?:\(|\[)(?:official video|official music video|music video|mv|m\/v)(?:\)|\])/i.test(
            r.title,
          ) ||
          (r.uploader != null &&
            (/\bvevo\b/i.test(r.uploader) || r.uploader.endsWith(' - Topic')))),
    )
  } else if (contentType === 'video') {
    items = items.filter((r) => !r.isPlaylist && !r.url.includes('/playlist?list='))
  }

  // 1. Duration / Type / Quality quick rail filters (do not apply to playlist searches)
  if (
    contentType !== 'playlist' &&
    (type !== 'all' || quality !== 'any' || railDuration !== 'all')
  ) {
    const hasAnyExplicitHighRes = items.some((item) =>
      /\b(1080p?|fhd|full hd|1440p?|2k|2160p?|4k|uhd|ultra hd|8k|60fps|hdr)\b/i.test(item.title),
    )

    items = items.filter((r) => {
      // 1. Duration preset
      if (railDuration === 'short' && (r.durationSec == null || r.durationSec > 240)) {
        return false
      }
      if (
        railDuration === 'medium' &&
        (r.durationSec == null || r.durationSec <= 240 || r.durationSec > 1200)
      ) {
        return false
      }
      if (railDuration === 'long' && (r.durationSec == null || r.durationSec <= 1200)) {
        return false
      }

      // 2. Type filter
      if (type === 'video') {
        if (r.platform === 'soundcloud') return false
      } else if (type === 'audio') {
        if (!isAudioOrMusicTrack(r.title, r.uploader, r.platform, r.durationSec)) {
          return false
        }
      } else if (type === 'subtitled') {
        if (!hasExplicitSubtitles(r.title, r.uploader)) {
          return false
        }
      }

      // 3. Quality filter
      if (
        !matchesQualityTier(
          quality,
          r.title,
          r.uploader,
          r.platform,
          r.durationSec,
          hasAnyExplicitHighRes,
        )
      ) {
        return false
      }

      return true
    })
  }

  // 2. Client-side defense-in-depth recency check for hydrated entries
  if (recency !== 'all') {
    const now = Date.now()
    const msMap: Record<string, number> = {
      '24h': 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 31 * 24 * 60 * 60 * 1000,
      year: 366 * 24 * 60 * 60 * 1000,
    }
    const maxAge = msMap[recency]
    if (maxAge) {
      items = items.filter((r) => {
        const t = r.timestamp ?? (r.uploadDate ? new Date(r.uploadDate).getTime() : null)
        if (t == null) return true // Retain until hydrated
        return now - t <= maxAge
      })
    }
  }

  // 3. Sorting (re-orders reactively as items hydrate or sort changes)
  if (sort === 'newest') {
    return [...items].sort((a, b) => {
      const aTime = a.timestamp ?? (a.uploadDate ? new Date(a.uploadDate).getTime() : 0)
      const bTime = b.timestamp ?? (b.uploadDate ? new Date(b.uploadDate).getTime() : 0)
      return bTime - aTime
    })
  } else if (sort === 'views') {
    return [...items].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
  }

  return items
})

export function resetSearchResults(): void {
  searchResults.value = []
  searchError.value = null
  selectedResultUrls.value = new Set()
  lastSearchedQuery.value = null
  activePreviewUrl.value = null
}

export function resetFilters(): void {
  filterContentType.value = 'all'
  filterMinDurationSec.value = null
  filterMaxDurationSec.value = null
  filterMinViews.value = null
  filterUploadRecency.value = 'all'
  filterMinFps.value = null
  filterHasSubtitles.value = false
  filterHas4K.value = false
  filterVerifiedOnly.value = false
  filterRailDuration.value = 'all'
  filterType.value = 'all'
  filterQuality.value = 'any'
  searchSort.value = 'relevance'
}

export function resetSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchError.value = null
  selectedResultUrls.value = new Set()
  lastSearchedQuery.value = null
  activePreviewUrl.value = null
  resetFilters()
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

if (typeof window !== 'undefined' && window.mf?.onSearchEntry) {
  window.mf.onSearchEntry((item) => {
    searchResults.value = applySearchHydration(searchResults.value, item)
  })
}
