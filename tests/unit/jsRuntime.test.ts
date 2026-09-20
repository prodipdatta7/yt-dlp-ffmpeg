import { describe, expect, it, vi } from 'vitest'
import {
  JS_RUNTIME_PREFERENCE,
  jsRuntimeArgs,
  jsRuntimeFileNames,
  locateJsRuntime,
  meetsMinimumVersion,
  parseDenoVersion,
  parseQuickJsVersion,
} from '../../src/main/binaries/jsRuntime'
import { JsRuntimeService, NO_JS_RUNTIME } from '../../src/main/binaries/jsRuntimeService'
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

  it('parses the QuickJS banner on either spelling', () => {
    expect(parseQuickJsVersion(['QuickJS-ng version 0.17.0'])).toBe('0.17.0')
    expect(parseQuickJsVersion(['qjs 0.12.1'])).toBe('0.12.1')
    expect(parseQuickJsVersion(['unrelated output'])).toBeNull()
  })

  it('gates on the version yt-dlp documents as the minimum', () => {
    // yt-dlp: QuickJS < 2025-04-26 / QuickJS-NG < 0.12.0 can take minutes per solve.
    expect(meetsMinimumVersion('0.17.0', '0.12.0')).toBe(true)
    expect(meetsMinimumVersion('0.12.0', '0.12.0')).toBe(true)
    expect(meetsMinimumVersion('0.11.9', '0.12.0')).toBe(false)
    expect(meetsMinimumVersion('2.9.7', '2.3.0')).toBe(true)
    expect(meetsMinimumVersion('2.2.0', '2.3.0')).toBe(false)
    expect(meetsMinimumVersion(null, '0.12.0')).toBe(false)
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
      minVersion: '0.12.0',
    })
  })

  it('flags a runtime that is older than yt-dlp supports as unusable', async () => {
    const service = new JsRuntimeService({
      platform: 'win32',
      candidates: [{ dir: 'C:/bundled', source: 'bundled' }],
      exists: existsIn(['C:/bundled/qjs.exe']),
      probe: async () => '0.9.0',
    })
    expect((await service.info()).usable).toBe(false)
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
      minVersion: '0.12.0',
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
