import type { MfErrorCode } from '../../shared/models'

const RULES: ReadonlyArray<readonly [MfErrorCode, RegExp]> = [
  ['MF_OFFLINE_OR_PRIVATE', /video unavailable|has been removed|private video|members[- ]only/i],
  [
    'MF_AGE_RESTRICTED',
    /sign in to confirm your age|age[- ]restricted|confirm you'?re old enough/i,
  ],
  ['MF_BOT_CHECK', /sign in to confirm you'?re not a bot|not a bot/i],
  ['MF_RATE_LIMITED', /http error 429|http error 403|too many requests/i],
  // A valid-looking URL that yt-dlp has no extractor/recognition for, or a non-video post —
  // distinct from a supported site whose extractor broke (that's MF_EXTRACTOR_STALE → "Update Core Drivers").
  [
    'MF_UNSUPPORTED_SOURCE',
    /unsupported url|no video in this post|unable to download json metadata.*(?:404|not found)/i,
  ],
  ['MF_EXTRACTOR_STALE', /unable to extract|no video formats found|did not get any formats/i],
  ['MF_DISK_FULL', /enospc|no space left on device|disk full/i],
  [
    'MF_NETWORK',
    /getaddrinfo|enotfound|econnreset|connection reset|timed? ?out|etimedout|econnaborted|unable to download webpage|temporary failure in name resolution|network is unreachable/i,
  ],
]

export function classifyStderr(lines: readonly string[]): MfErrorCode {
  for (const [code, pattern] of RULES) {
    if (lines.some((line) => pattern.test(line))) return code
  }
  return 'MF_UNKNOWN'
}
