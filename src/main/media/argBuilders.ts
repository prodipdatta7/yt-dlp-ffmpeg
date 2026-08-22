export function buildAnalyzeArgs(url: string): string[] {
  return ['-J', '--no-warnings', '--flat-playlist', url]
}

export function buildPlaylistEntryArgs(entryUrl: string): string[] {
  return buildAnalyzeArgs(entryUrl)
}
