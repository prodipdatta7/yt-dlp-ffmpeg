import { describe, expect, it, vi } from 'vitest'
import {
  JS_RUNTIME_PREFERENCE,
  jsRuntimeArgs,
  jsRuntimeDescriptor,
  jsRuntimeFileNames,
  locateJsRuntime,
  meetsMinimumVersion,
  parseDenoVersion,
  parseQuickJsVersion,
} from '../../src/main/binaries/jsRuntime'
import {
  isBelowOptimizedFloor,
  isRuntimeUsable,
  JsRuntimeService,
  NO_JS_RUNTIME,
} from '../../src/main/binaries/jsRuntimeService'
import { buildBaseDownloadArgs } from '../../src/main/jobs/argBuilders'
import { buildAnalyzeArgs, buildEntryInfoArgs } from '../../src/main/media/argBuilders'

/** Builds an `exists` predicate over an explicit set of present files. */
function existsIn(paths: readonly string[]): (path: string) => boolean {
  const normalized = new Set(paths.map((p) => p.replace(/\\/g, '/')))
  return (path) => normalized.has(path.replace(/\\/g, '/'))
}

describe('locateJsRuntime (AM-21)', () => {
  const candidates = [
    { dir: 'C:/override', source: 'override' as const },
    { dir: 'C:/userData', source: 'userData' as const },
    { dir: 'C:/bundled', source: 'bundled' as const },
  ]

  it('prefers deno over the bundled quickjs, even when quickjs sits in a higher-priority dir', () => {
    // The whole point of the design: a user who drops deno.exe in wins over our bundled default.
    const found = locateJsRuntime(
      'win32',
      candidates,
      existsIn(['C:/bundled/qjs.exe', 'C:/userData/deno.exe']),
    )
    expect(found?.name).toBe('deno')
    expect(found?.source).toBe('userData')
  })

  it('keeps AM-03 precedence within one runtime (override -> userData -> bundled)', () => {
    const found = locateJsRuntime(
      'win32',
      candidates,
      existsIn(['C:/bundled/qjs.exe', 'C:/userData/qjs.exe', 'C:/override/qjs.exe']),
    )
    expect(found?.name).toBe('quickjs')
    expect(found?.source).toBe('override')
  })

  it('accepts an alternate quickjs file name', () => {
    const found = locateJsRuntime('win32', candidates, existsIn(['C:/bundled/quickjs.exe']))
    expect(found?.path.replace(/\\/g, '/')).toBe('C:/bundled/quickjs.exe')
  })

  it('returns null when no runtime is present', () => {
    expect(locateJsRuntime('win32', candidates, () => false)).toBeNull()
  })

  it('omits the .exe suffix off Windows', () => {
    const found = locateJsRuntime('linux', candidates, existsIn(['C:/bundled/qjs']))
    expect(found?.path.replace(/\\/g, '/')).toBe('C:/bundled/qjs')
  })

  it('lists every accepted file name per platform', () => {
    const quickjs = JS_RUNTIME_PREFERENCE.find((r) => r.name === 'quickjs')!
    expect(jsRuntimeFileNames(quickjs, 'win32')).toEqual(['qjs.exe', 'quickjs.exe'])
    expect(jsRuntimeFileNames(quickjs, 'linux')).toEqual(['qjs', 'quickjs'])
  })
})

describe('jsRuntimeArgs', () => {
  const runtime = {
    name: 'quickjs' as const,
    path: 'C:/bundled/qjs.exe',
    source: 'bundled' as const,
  }

  it('emits nothing when no runtime resolved, so default argv is unchanged', () => {
    expect(jsRuntimeArgs(null, 'C:/bundled/yt-dlp.exe', 'win32')).toEqual([])
  })

  it('uses the bare form when the runtime sits beside yt-dlp.exe', () => {
    // yt-dlp discovers a runtime in its own folder, so no Windows path enters RUNTIME[:PATH].
    expect(jsRuntimeArgs(runtime, 'C:/bundled/yt-dlp.exe', 'win32')).toEqual([
      '--js-runtimes',
      'quickjs',
    ])
  })

  it('carries an explicit path when the two live in different directories', () => {
    expect(jsRuntimeArgs(runtime, 'C:/userData/yt-dlp.exe', 'win32')).toEqual([
      '--js-runtimes',
      'quickjs:C:/bundled/qjs.exe',
    ])
  })

  it('carries an explicit path when yt-dlp is missing entirely', () => {
    expect(jsRuntimeArgs(runtime, null, 'win32')).toEqual([
      '--js-runtimes',
      'quickjs:C:/bundled/qjs.exe',
    ])
  })

  it('carries an explicit path for a non-canonical file name beside yt-dlp.exe', () => {
    const alternate = {
      name: 'quickjs' as const,
      path: 'C:/bundled/quickjs.exe',
      source: 'override' as const,
    }
    expect(jsRuntimeArgs(alternate, 'C:/bundled/yt-dlp.exe', 'win32')).toEqual([
      '--js-runtimes',
      'quickjs:C:/bundled/quickjs.exe',
    ])
  })

  it('is emitted as one argv pair, never a shell string', () => {
    const args = jsRuntimeArgs(runtime, 'C:/bundled/yt-dlp.exe', 'win32')
    expect(args).toHaveLength(2)
    expect(args[0]).toBe('--js-runtimes')
  })
})

describe('version parsing and the minimum-version gate', () => {
  it('parses the deno banner', () => {
    expect(parseDenoVersion(['deno 2.9.7 (stable, release, x86_64-pc-windows-msvc)'])).toBe('2.9.7')
    expect(parseDenoVersion(['nonsense'])).toBeNull()
  })

  it('parses the REAL QuickJS-NG output, which is a bare version with no banner', () => {
    // Regression test for the bug this file previously asserted past: the bundled
    // binaries/win32/qjs.exe prints exactly `0.17.0` on stdout and nothing else. The old parser
    // required the line to mention quickjs/qjs, so it skipped the only useful line, returned
    // null, and the runtime was reported as "version unknown — below the minimum yt-dlp
    // supports" while yt-dlp was using it successfully.
    //
    // Captured verbatim from `binaries/win32/qjs.exe --version`; do not "tidy" this fixture.
    expect(parseQuickJsVersion(['0.17.0'])).toBe('0.17.0')
    // Bare form with real-world noise around it still resolves.
    expect(parseQuickJsVersion(['', '0.17.0', ''])).toBe('0.17.0')
  })

  it('still parses the banner spellings other builds and forks emit', () => {
    expect(parseQuickJsVersion(['QuickJS-ng version 0.17.0'])).toBe('0.17.0')
    expect(parseQuickJsVersion(['qjs 0.12.1'])).toBe('0.12.1')
  })

  it('never invents a version from unrelated output', () => {
    expect(parseQuickJsVersion(['unrelated output'])).toBeNull()
    expect(parseQuickJsVersion(['v1.2'])).toBeNull()
    expect(parseQuickJsVersion([])).toBeNull()
    // A date-style bellard QuickJS version is not a semver and must not be mistaken for one.
    expect(parseQuickJsVersion(['QuickJS version 2025-04-26'])).toBeNull()
  })

  it('gates on the version yt-dlp documents as the minimum', () => {
    // EJS wiki: deno minimum is 2.0.0. The QuickJS floor is a *speed* threshold, not a support
    // threshold (all QuickJS-NG versions are supported), so it lives in optimizedMinVersion.
    expect(meetsMinimumVersion('2.9.7', '2.0.0')).toBe(true)
    expect(meetsMinimumVersion('2.0.0', '2.0.0')).toBe(true)
    expect(meetsMinimumVersion('1.9.0', '2.0.0')).toBe(false)
    expect(meetsMinimumVersion(null, '2.0.0')).toBe(false)
  })
})

describe('usability vs the optimization floor (the two are not the same thing)', () => {
  const quickjs = jsRuntimeDescriptor('quickjs')
  const deno = jsRuntimeDescriptor('deno')

  it('treats every QuickJS-NG version as usable, per the EJS wiki', () => {
    expect(quickjs.minVersion).toBeNull()
    expect(isRuntimeUsable('0.9.0', quickjs)).toBe(true)
    expect(isRuntimeUsable('0.11.9', quickjs)).toBe(true)
    expect(isRuntimeUsable('0.17.0', quickjs)).toBe(true)
  })

  it('reports an unoptimized runtime as slow without calling it unusable', () => {
    expect(isBelowOptimizedFloor('0.11.9', quickjs)).toBe(true)
    expect(isBelowOptimizedFloor('0.12.0', quickjs)).toBe(false)
    expect(isBelowOptimizedFloor('0.17.0', quickjs)).toBe(false)
    // Deno has no documented optimization floor, so it never trips this.
    expect(isBelowOptimizedFloor('2.0.0', deno)).toBe(false)
  })

  it('keeps the deno support floor at the documented 2.0.0', () => {
    expect(isRuntimeUsable('2.9.7', deno)).toBe(true)
    expect(isRuntimeUsable('2.1.0', deno)).toBe(true)
    expect(isRuntimeUsable('1.9.0', deno)).toBe(false)
  })

  it('treats a runtime that reported no version as unusable', () => {
    expect(isRuntimeUsable(null, quickjs)).toBe(false)
    expect(isRuntimeUsable(null, deno)).toBe(false)
  })
})

describe('JsRuntimeService', () => {
  it('reports no runtime and empty args when nothing is on disk', async () => {
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/empty', source: 'bundled' }],
    })
    expect(service.args()).toEqual([])
    expect(await service.info()).toEqual(NO_JS_RUNTIME)
  })

  it('emits the bundled pair and reports a usable version', async () => {
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/bundled', source: 'bundled' }],
      exists: existsIn(['C:/bundled/qjs.exe', 'C:/bundled/yt-dlp.exe']),
      probe: async () => '0.17.0',
    })
    expect(service.args()).toEqual(['--js-runtimes', 'quickjs'])
    expect(await service.info()).toEqual({
      name: 'quickjs',
      version: '0.17.0',
      source: 'bundled',
      usable: true,
      // null = yt-dlp accepts every QuickJS-NG version, which is what the EJS wiki says.
      // Reporting 0.12.0 here previously implied a support floor that does not exist.
      minVersion: null,
    })
  })

  it('keeps an unoptimized but supported runtime usable, warning only about speed', async () => {
    // The bug this replaces: 0.9.0 was reported as unusable with the message "below the minimum
    // yt-dlp supports". The wiki says all QuickJS-NG versions are supported; they are just slow.
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/bundled', source: 'bundled' }],
      exists: existsIn(['C:/bundled/qjs.exe']),
      probe: async () => '0.9.0',
    })
    const info = await service.info()
    expect(info.usable).toBe(true)
    expect(info.minVersion).toBeNull()
  })

  it('still fails a deno older than the documented 2.0.0 floor', async () => {
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/bundled', source: 'bundled' }],
      exists: existsIn(['C:/bundled/deno.exe']),
      probe: async () => '1.9.0',
    })
    const info = await service.info()
    expect(info.name).toBe('deno')
    expect(info.usable).toBe(false)
    expect(info.minVersion).toBe('2.0.0')
  })

  it('probes once, caches, and re-probes after invalidate()', async () => {
    const probe = vi.fn().mockResolvedValue('0.17.0')
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/bundled', source: 'bundled' }],
      exists: existsIn(['C:/bundled/qjs.exe']),
      probe,
    })
    expect(await service.info()).toEqual(await service.info())
    expect(probe).toHaveBeenCalledTimes(1)

    // An updater apply can swap the binary underneath us (AM-03).
    service.invalidate()
    await service.info()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('survives a probe that throws or finds nothing', async () => {
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/bundled', source: 'bundled' }],
      exists: existsIn(['C:/bundled/qjs.exe']),
      probe: async () => {
        throw new Error('spawn failed')
      },
    })
    expect(await service.info()).toEqual({
      name: 'quickjs',
      version: null,
      source: 'bundled',
      usable: false,
      minVersion: null,
    })
  })
})

describe('spawn-argv contract (every yt-dlp invocation carries the runtime)', () => {
  const runtimeArgs = ['--js-runtimes', 'quickjs']

  it('appends the runtime to download base args without reordering existing flags', () => {
    const without = buildBaseDownloadArgs('C:/bin/ffmpeg.exe', 'C:/tmp/%(title)s.%(ext)s')
    const withRuntime = buildBaseDownloadArgs(
      'C:/bin/ffmpeg.exe',
      'C:/tmp/%(title)s.%(ext)s',
      runtimeArgs,
    )

    expect(without).toEqual(expect.not.arrayContaining(['--js-runtimes']))
    // Existing M3 snapshots stay byte-identical: the runtime is appended, never interleaved.
    expect(withRuntime.slice(0, without.length)).toEqual(without)
    expect(withRuntime.slice(without.length)).toEqual(runtimeArgs)
  })

  it('appends the runtime to analyze args and keeps the URL as the final argv element', () => {
    const url = 'https://example.com/watch?v=abc'
    const args = buildAnalyzeArgs(url, null, undefined, runtimeArgs)
    expect(args).toContain('--js-runtimes')
    expect(args.at(-1)).toBe(url)
    expect(args).toEqual(expect.not.arrayContaining(['--js-runtimes quickjs']))
  })

  it('appends the runtime to per-entry info args', () => {
    const url = 'https://example.com/watch?v=abc'
    const args = buildEntryInfoArgs(url, 'C:/cookies.txt', runtimeArgs)
    expect(args).toContain('--js-runtimes')
    expect(args).toContain('quickjs')
    expect(args.at(-1)).toBe(url)
  })

  it('emits nothing extra when main holds no runtime', () => {
    const url = 'https://example.com/watch?v=abc'
    expect(buildAnalyzeArgs(url)).toEqual(['-J', '--no-warnings', '--flat-playlist', url])
    expect(buildEntryInfoArgs(url)).toEqual(['-J', '--no-warnings', url])
  })
})
