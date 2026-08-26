/**
 * Source-display helpers for the renderer.
 *
 * The app delegates extraction to yt-dlp, so it can download from every site yt-dlp supports
 * (hundreds). We can't ship a live "supported sites" API (CSP forbids renderer network egress),
 * so we surface two things instead:
 *  - a friendly name for the platform behind a given link (derived from its host), and
 *  - a curated set of well-known examples shown in the empty state.
 */

const SOURCE_NAMES: Record<string, string> = {
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'vimeo.com': 'Vimeo',
  'twitch.tv': 'Twitch',
  'soundcloud.com': 'SoundCloud',
  'tiktok.com': 'TikTok',
  'facebook.com': 'Facebook',
  'fb.watch': 'Facebook',
  'instagram.com': 'Instagram',
  'x.com': 'X (Twitter)',
  'twitter.com': 'X (Twitter)',
  'reddit.com': 'Reddit',
  'dailymotion.com': 'Dailymotion',
  'bilibili.com': 'Bilibili',
  'bandcamp.com': 'Bandcamp',
  'archive.org': 'Internet Archive',
  'rumble.com': 'Rumble',
  'streamable.com': 'Streamable',
  'odysee.com': 'Odysee',
  'imgur.com': 'Imgur',
}

/** Friendly platform name for a webpage URL, or the bare host if not a known platform. */
export function sourceLabel(url: string | null | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  return SOURCE_NAMES[host] ?? host
}

/** Well-known, commonly-downloadable sources shown as examples in the empty state. */
export const POPULAR_SOURCES: readonly string[] = [
  'YouTube',
  'Facebook',
  'Instagram',
  'X (Twitter)',
  'Reddit',
  'Vimeo',
  'Twitch',
  'SoundCloud',
  'TikTok',
  'Dailymotion',
  'Bilibili',
  'Rumble',
]
