export function buildAnalyzeArgs(url: string, cookiesPath?: string | null): string[] {
  const args: string[] = ['-J', '--no-warnings', '--flat-playlist']
  if (cookiesPath) args.push('--cookies', cookiesPath)
  args.push(url)
  return args
}
