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
  'api.soundcloud.com': 'SoundCloud',
  'm.soundcloud.com': 'SoundCloud',
  'on.soundcloud.com': 'SoundCloud',
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

export interface EmbedInfo {
  type: 'iframe' | 'video'
  src: string
  platform: string
}

/**
 * Resolves an embeddable preview player URL for supported media sources.
 * Supports YouTube (watch, shorts, embed, bare ID), SoundCloud, Bilibili, Vimeo, and direct video files.
 */
export function getEmbedInfo(url: string | null | undefined): EmbedInfo | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null

  // Bare 11-char YouTube ID support
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return {
      type: 'iframe',
      src: `https://www.youtube-nocookie.com/embed/${trimmed}?autoplay=1&rel=0&playsinline=1&modestbranding=1`,
      platform: 'YouTube',
    }
  }

  // SoundCloud slug or URI support (sc:artist/track or soundcloud:tracks:12345)
  if (trimmed.startsWith('sc:')) {
    const path = trimmed.replace(/^sc:/, '')
    return {
      type: 'iframe',
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${path}`)}&auto_play=true&show_artwork=true&visual=true`,
      platform: 'SoundCloud',
    }
  }

  if (trimmed.startsWith('soundcloud:tracks:') || trimmed.startsWith('soundcloud%3Atracks%3A')) {
    const trackId = trimmed.replace(/^soundcloud(?::|%3A)tracks(?::|%3A)/i, '')
    return {
      type: 'iframe',
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://api.soundcloud.com/tracks/${trackId}`)}&auto_play=true&show_artwork=true&visual=true`,
      platform: 'SoundCloud',
    }
  }

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = parsed.pathname

    // 1. YouTube
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      let videoId: string | null = null
      if (host === 'youtu.be') {
        videoId = pathname.slice(1).split('/')[0] || null
      } else if (pathname.startsWith('/shorts/')) {
        videoId = pathname.replace('/shorts/', '').split('/')[0] || null
      } else if (pathname.startsWith('/embed/')) {
        videoId = pathname.replace('/embed/', '').split('/')[0] || null
      } else {
        videoId = parsed.searchParams.get('v')
      }

      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return {
          type: 'iframe',
          src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&modestbranding=1`,
          platform: 'YouTube',
        }
      }
    }

    // 2. SoundCloud (handles soundcloud.com, api.soundcloud.com, m.soundcloud.com, on.soundcloud.com)
    if (
      host === 'soundcloud.com' ||
      host.endsWith('.soundcloud.com') ||
      trimmed.includes('soundcloud.com')
    ) {
      let scTarget = trimmed
      // Clean up internal API format: https://api.soundcloud.com/tracks/soundcloud:tracks:12345 -> https://api.soundcloud.com/tracks/12345
      if (scTarget.includes('api.soundcloud.com/tracks/')) {
        scTarget = scTarget.replace(/(?:soundcloud(?::|%3A)tracks(?::|%3A))/gi, '')
      }
      return {
        type: 'iframe',
        src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(scTarget)}&auto_play=true&show_artwork=true&visual=true`,
        platform: 'SoundCloud',
      }
    }

    // 3. Bilibili
    if (host === 'bilibili.com') {
      const match = pathname.match(/\/(BV[a-zA-Z0-9]+|av\d+)/i)
      if (match) {
        return {
          type: 'iframe',
          src: `https://player.bilibili.com/player.html?bvid=${match[1]}&autoplay=1`,
          platform: 'Bilibili',
        }
      }
    }

    // 4. Vimeo
    if (host === 'vimeo.com') {
      const match = pathname.match(/\/(\d+)/)
      if (match) {
        return {
          type: 'iframe',
          src: `https://player.vimeo.com/video/${match[1]}?autoplay=1`,
          platform: 'Vimeo',
        }
      }
    }

    // 5. Direct HTML5 video file
    if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(pathname)) {
      return {
        type: 'video',
        src: trimmed,
        platform: 'Direct Video',
      }
    }

    return null
  } catch {
    return null
  }
}
