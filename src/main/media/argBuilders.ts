export function buildAnalyzeArgs(url: string): string[] {
  return ['-J', '--no-warnings', '--flat-playlist', url]
}
