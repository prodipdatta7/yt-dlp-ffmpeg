import type { SearchFilterCriteria, SearchPlatform } from '../../shared/models'

export function buildAnalyzeArgs(
  url: string,
  cookiesPath?: string | null,
  extraFlags?: readonly string[],
): string[] {
  const args: string[] = ['-J', '--no-warnings', '--flat-playlist']
  if (cookiesPath) args.push('--cookies', cookiesPath)
  if (extraFlags && extraFlags.length > 0) args.push(...extraFlags)
  args.push(url)
  return args
}

export function buildFilterFlags(filters?: SearchFilterCriteria): string[] {
  if (!filters || filters.contentType === 'playlist') return []
  const flags: string[] = []

  if (filters.uploadRecency && filters.uploadRecency !== 'all') {
    const recencyMap: Record<string, string> = {
      '24h': 'today-1day',
      week: 'today-7days',
      month: 'today-1month',
      year: 'today-1year',
    }
    const val = recencyMap[filters.uploadRecency]
    if (val) flags.push('--dateafter', val)
  }

  const matchConditions: string[] = []

  if (filters.minDurationSec != null && filters.maxDurationSec != null) {
    matchConditions.push(
      `duration >= ${filters.minDurationSec} & duration <= ${filters.maxDurationSec}`,
    )
  } else if (filters.minDurationSec != null) {
    matchConditions.push(`duration >= ${filters.minDurationSec}`)
  } else if (filters.maxDurationSec != null) {
    matchConditions.push(`duration <= ${filters.maxDurationSec}`)
  }

  if (filters.minViews != null && filters.minViews > 0) {
    matchConditions.push(`view_count >= ${filters.minViews}`)
  }

  if (filters.verifiedOnly) {
    matchConditions.push('channel_is_verified')
  }

  if (filters.minFps != null && filters.minFps > 0) {
    matchConditions.push(`fps >= ${filters.minFps}`)
  }

  for (const cond of matchConditions) {
    flags.push('--match-filters', cond)
  }

  return flags
}

export function buildEntryInfoArgs(url: string, cookiesPath?: string | null): string[] {
  const args: string[] = ['-J', '--no-warnings']
  if (cookiesPath) args.push('--cookies', cookiesPath)
  args.push(url)
  return args
}

const SEARCH_LIMIT_MIN = 1
const SEARCH_LIMIT_MAX = 50
const SEARCH_LIMIT_DEFAULT = 20

/**
 * Builds the yt-dlp search pseudo-URL (e.g. "ytsearch20:cats") passed as the single
 * positional arg to `buildAnalyzeArgs`. This is the only place that composes it — the
 * whole string is one argv element (spawn(args[]), never a shell), so the query text
 * needs no escaping.
 */
export function buildSearchQuery(prefix: string, query: string, limit: number): string {
  const n = Number.isFinite(limit) ? Math.trunc(limit) : SEARCH_LIMIT_DEFAULT
  const safeLimit = Math.min(SEARCH_LIMIT_MAX, Math.max(SEARCH_LIMIT_MIN, n))
  return `${prefix}${safeLimit}:${query}`
}

export function getIsoDateDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

export interface ResolvedSearchTarget {
  urlOrQuery: string
  extraFlags: string[]
  candidateLimit: number
}

/**
 * Builds the fixed, allowlisted query text for federated public-web discovery. It deliberately
 * returns no yt-dlp flags: this lookup is performed by the main process without cookies, then
 * each admitted URL is validated and hydrated through yt-dlp separately.
 */
export function buildFederatedDiscoveryQuery(
  platform: SearchPlatform,
  query: string,
  limit: number,
): ResolvedSearchTarget {
  if (platform.discovery.kind !== 'public-web') {
    throw new Error('Federated discovery requires a public-web platform')
  }
  const safeLimit = Number.isFinite(limit) ? Math.trunc(limit) : SEARCH_LIMIT_DEFAULT
  const userLimit = Math.min(SEARCH_LIMIT_MAX, Math.max(SEARCH_LIMIT_MIN, safeLimit))
  return {
    urlOrQuery: `${platform.discovery.queryScope} ${query}`,
    extraFlags: [],
    candidateLimit: Math.min(SEARCH_LIMIT_MAX, Math.max(userLimit * 3, userLimit)),
  }
}

/**
 * Resolves the primary URL/pseudo-URL and CLI flags for a search operation.
 * For YouTube:
 * - Native search operator `after:YYYY-MM-DD` is injected directly into the query for upload recency
 *   and date sorting because YouTube deprecated `sp=CAI=` and does not expose dates in flat-playlist JSON.
 * - `sp=CAM%3D` is used for view-count sorting.
 * - `sp=EgIQAw%253D%253D` is used for playlists-only search.
 * - `#shorts` and `duration <= 60` are used for Reels & Shorts search.
 * Over-fetches candidate entries when filters/sorts are active so that yt-dlp's
 * match-filters and sorting retain a full page of results up to the requested limit.
 */
export function buildSearchTarget(
  platform: SearchPlatform,
  query: string,
  limit: number,
  sort: string,
  filters?: SearchFilterCriteria,
): ResolvedSearchTarget {
  const safeLimit = Number.isFinite(limit) ? Math.trunc(limit) : SEARCH_LIMIT_DEFAULT
  const userLimit = Math.min(SEARCH_LIMIT_MAX, Math.max(SEARCH_LIMIT_MIN, safeLimit))

  if (platform.discovery.kind === 'public-web') {
    return buildFederatedDiscoveryQuery(platform, query, userLimit)
  }

  const platformId = platform.id
  const prefix = platform.discovery.prefix
  const hasCriteria =
    sort !== 'relevance' ||
    Boolean(
      filters &&
      ((filters.uploadRecency && filters.uploadRecency !== 'all') ||
        (filters.contentType && filters.contentType !== 'all') ||
        filters.minDurationSec != null ||
        filters.maxDurationSec != null ||
        filters.minViews != null ||
        filters.verifiedOnly ||
        filters.minFps != null ||
        filters.has4K ||
        filters.hasSubtitles),
    )

  const candidateLimit = hasCriteria ? Math.min(100, Math.max(userLimit * 3, 50)) : userLimit

  const extraFlags = buildFilterFlags(filters)

  if (platformId === 'youtube') {
    let effectiveQuery = query
    const recencyDaysMap: Record<string, number> = {
      '24h': 1,
      week: 7,
      month: 30,
      year: 365,
    }

    if (filters?.uploadRecency && filters.uploadRecency !== 'all') {
      const days = recencyDaysMap[filters.uploadRecency]
      if (days && !/\bafter:\d{4}-\d{2}-\d{2}\b/i.test(effectiveQuery)) {
        effectiveQuery = `${effectiveQuery} after:${getIsoDateDaysAgo(days)}`
      }
    } else if (sort === 'newest') {
      // Scope to recent uploads (last 90 days) so YouTube returns genuine recent videos
      if (!/\bafter:\d{4}-\d{2}-\d{2}\b/i.test(effectiveQuery)) {
        effectiveQuery = `${effectiveQuery} after:${getIsoDateDaysAgo(90)}`
      }
    }

    // 1. Playlists Only Search
    if (filters?.contentType === 'playlist') {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%253D%253D`
      return {
        urlOrQuery: url,
        extraFlags: ['--playlist-items', `1-${candidateLimit}`],
        candidateLimit,
      }
    }

    // 2. Reels & Shorts Search
    if (filters?.contentType === 'reel') {
      let reelQuery = effectiveQuery
      if (!/\b#shorts\b/i.test(reelQuery)) {
        reelQuery = `${reelQuery} #shorts`
      }
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(reelQuery)}&sp=${sort === 'views' ? 'CAMSAhAB' : 'EgQQARgB'}`
      return {
        urlOrQuery: url,
        extraFlags: ['--playlist-items', `1-${candidateLimit}`, ...extraFlags],
        candidateLimit,
      }
    }

    // 3. Music Videos Only Search
    if (filters?.contentType === 'music') {
      let musicQuery = effectiveQuery
      if (!/\b(music video|official video|official music video|mv|m\/v)\b/i.test(musicQuery)) {
        musicQuery = `${musicQuery} official music video`
      }
      if (sort === 'views') {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(musicQuery)}&sp=CAM%3D`
        return {
          urlOrQuery: url,
          extraFlags: ['--playlist-items', `1-${candidateLimit}`, ...extraFlags],
          candidateLimit,
        }
      }
      const pseudoUrl = buildSearchQuery(prefix, musicQuery, candidateLimit)
      return {
        urlOrQuery: pseudoUrl,
        extraFlags,
        candidateLimit,
      }
    }

    // 4. Sort by View Count
    if (sort === 'views') {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(effectiveQuery)}&sp=CAM%3D`
      return {
        urlOrQuery: url,
        extraFlags: ['--playlist-items', `1-${candidateLimit}`, ...extraFlags],
        candidateLimit,
      }
    }

    // 5. Sort by Upload Date or Recency Filter via pseudo-url
    const pseudoUrl = buildSearchQuery(prefix, effectiveQuery, candidateLimit)
    return {
      urlOrQuery: pseudoUrl,
      extraFlags,
      candidateLimit,
    }
  }

  // Default native prefix extractor query (SoundCloud, Bilibili)
  let fallbackQuery = query
  if (platformId === 'bilibili' && filters?.contentType === 'music') {
    if (!/\b(mv|music video|音乐)\b/i.test(fallbackQuery)) {
      fallbackQuery = `${fallbackQuery} MV`
    }
  }
  const pseudoUrl = buildSearchQuery(prefix, fallbackQuery, candidateLimit)
  return {
    urlOrQuery: pseudoUrl,
    extraFlags,
    candidateLimit,
  }
}
