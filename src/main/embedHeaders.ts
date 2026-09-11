/**
 * Request header manipulation for media iframe embeds.
 *
 * In production builds, Electron packages and loads the UI via `file://.../index.html`.
 * Chromium strips or omits the HTTP `Referer` header for third-party embeds originating
 * from `file://` to prevent leaking local file paths.
 *
 * Embedded players (specifically YouTube, SoundCloud, Vimeo, Bilibili) require a valid
 * web HTTP/S `Referer` header to authorize playback, otherwise YouTube fails with:
 * "Video player configuration error (Error 153)".
 */

export const EMBED_REQUEST_FILTER = {
  urls: [
    '*://*.youtube.com/*',
    '*://*.youtube-nocookie.com/*',
    '*://*.googlevideo.com/*',
    '*://*.soundcloud.com/*',
    '*://*.vimeo.com/*',
    '*://*.bilibili.com/*',
  ],
}

export const FALLBACK_EMBED_REFERER = 'https://localhost/'

/**
 * Patches outgoing requestHeaders for embedded media players to supply a valid
 * web Referer when the application is loaded from local file:// schemes.
 */
export function patchEmbedHeaders(
  requestHeaders: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const referer = requestHeaders['Referer']
  const refererStr =
    typeof referer === 'string' ? referer : Array.isArray(referer) ? referer[0] : ''
  if (!refererStr || refererStr.startsWith('file:')) {
    return {
      ...requestHeaders,
      Referer: FALLBACK_EMBED_REFERER,
    }
  }
  return requestHeaders
}
