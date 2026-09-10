const DUCKDUCKGO_HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/'
const BRAVE_SEARCH_URL = 'https://search.brave.com/search'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export class PublicWebSearchError extends Error {
  constructor(public readonly kind: 'network' | 'rate-limited' | 'cancelled') {
    super(kind)
    this.name = 'PublicWebSearchError'
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
}

/** Builds the cookie-free, public-web discovery request for a federated search. */
export function buildPublicWebSearchUrl(queryScope: string, query: string): string {
  const url = new URL(DUCKDUCKGO_HTML_SEARCH_URL)
  url.searchParams.set('q', `${queryScope} ${query}`)
  url.searchParams.set('kl', 'us-en')
  return url.toString()
}

/** Builds the backup public-web discovery request used only when DuckDuckGo yields no candidates. */
export function buildBravePublicWebSearchUrl(queryScope: string, query: string): string {
  const url = new URL(BRAVE_SEARCH_URL)
  url.searchParams.set('q', `${queryScope} ${query}`)
  url.searchParams.set('source', 'web')
  return url.toString()
}

/**
 * Extracts result target URLs from DuckDuckGo's stable HTML endpoint. The endpoint wraps result
 * destinations in /l/?uddg=..., so only that explicit destination parameter is accepted.
 */
export function extractPublicWebResultUrls(html: string): string[] {
  const urls: string[] = []
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0]
    if (!/\bresult__a\b/i.test(tag)) continue
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]
    if (!href) continue

    try {
      const wrapper = new URL(decodeHtml(href), DUCKDUCKGO_HTML_SEARCH_URL)
      if (!/(^|\.)duckduckgo\.com$/i.test(wrapper.hostname) || wrapper.pathname !== '/l/') continue
      const target = wrapper.searchParams.get('uddg')
      if (target) urls.push(target)
    } catch {
      // A malformed search-result link is simply not a discovery candidate.
    }
  }
  return urls
}

/**
 * Brave exposes direct absolute destination links in its result cards. The caller still applies
 * the platform-specific media URL policy, so incidental links cannot become visible results.
 */
export function extractBravePublicWebResultUrls(html: string): string[] {
  const urls: string[] = []
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = match[0].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]
    if (!href) continue
    const decoded = decodeHtml(href)
    if (/^https?:\/\//i.test(decoded)) urls.push(decoded)
  }
  return urls
}

/** DuckDuckGo returns HTTP 200 for challenge pages, so status codes alone cannot detect a block. */
export function isPublicWebChallenge(html: string): boolean {
  return /(?:anomaly|captcha|unusual traffic|robot check|human verification)/i.test(html)
}

/** Fetches public result markup without cookies, credentials, or a renderer network request. */
export async function fetchPublicWebSearch(url: string, signal: AbortSignal): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
    })
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new PublicWebSearchError('cancelled')
    }
    throw new PublicWebSearchError('network')
  }

  if (response.status === 429) throw new PublicWebSearchError('rate-limited')
  if (!response.ok) throw new PublicWebSearchError('network')

  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new PublicWebSearchError('network')
  }

  const body = await response.text()
  if (body.length > MAX_RESPONSE_BYTES) throw new PublicWebSearchError('network')
  return body
}
