export function buildAnalyzeArgs(url: string, cookiesPath?: string | null): string[] {
  const args: string[] = ['-J', '--no-warnings', '--flat-playlist']
  if (cookiesPath) args.push('--cookies', cookiesPath)
  args.push(url)
  return args
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
