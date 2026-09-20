#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const OUT_DIR = join(process.cwd(), 'binaries', 'win32')
const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FFMPEG_RELEASE_API_URL = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest'
// BtbN has switched their master-build asset name between a stable alias
// (ffmpeg-master-latest-win64-lgpl.zip) and a commit-based one
// (ffmpeg-N-126482-g903325e279-win64-lgpl.zip) more than once, so match either
// scheme instead of hardcoding one. Excludes the "-shared" build and the
// version-pinned "ffmpeg-n<digit>..." release builds (e.g. ffmpeg-n9.0-...).
const FFMPEG_ASSET_RE = /^ffmpeg-(?!n\d).*-win64-lgpl\.zip$/
// AM-21: yt-dlp needs an external JS runtime to solve YouTube's JS challenges, and the official
// yt-dlp.exe already bundles the yt-dlp-ejs solver scripts — the runtime is the only missing
// piece. QuickJS-NG is ~2 MB against Deno's ~42 MB, and yt-dlp supports it as a first-class
// runtime, so it is what ships in the installer. Must be >= 0.12.0 or a solve can take minutes.
const QUICKJS_RELEASE_API_URL = 'https://api.github.com/repos/quickjs-ng/quickjs/releases/latest'
const QUICKJS_ASSET_RE = /^qjs-windows-x86_64\.exe$/
const DENO_RELEASE_API_URL = 'https://api.github.com/repos/denoland/deno/releases/latest'
// yt-dlp's wiki is explicit: take `deno`, not `denort`.
const DENO_ASSET_RE = /^deno-x86_64-pc-windows-msvc\.zip$/
const MIN_BYTES = 1_000_000

const force = process.argv.includes('--force')
// Deno is the optional fast path a user can drop into <userData>/binaries/win32 (AM-21). It is
// deliberately NOT bundled: it is ~20x the size of the shipped runtime.
const wantDeno = process.argv.includes('--deno')

/** Exactly what electron-builder.yml's extraResources filter copies into the app. */
const BUNDLED_FILES = ['yt-dlp.exe', 'ffmpeg.exe', 'qjs.exe']

// `--verify` skips every download and only asserts the bundled set is complete. Packaging runs it
// first, because electron-builder's extraResources filter is an ALLOWLIST THAT SILENTLY SKIPS
// ABSENT FILES: a missing qjs.exe yields a valid installer with no YouTube runtime and no error.
const verifyOnly = process.argv.includes('--verify')

async function download(url, dest) {
  process.stdout.write(`downloading ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const headers = {
    'User-Agent': 'mediaforge-fetch-binaries',
    Accept: 'application/vnd.github+json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function resolveRelease(url) {
  const res = await fetch(url, { headers: githubHeaders() })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function resolveFfmpegZipUrl() {
  const release = await resolveRelease(FFMPEG_RELEASE_API_URL)
  const asset = (release.assets ?? []).find((a) => FFMPEG_ASSET_RE.test(a.name))
  if (!asset) throw new Error(`no ffmpeg win64-lgpl asset found in release ${release.tag_name}`)
  return asset.browser_download_url
}

async function sha256File(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * Verifies a downloaded artifact against the SHA-256 the GitHub release publishes for it
 * (AM-03's "verify before trust" rule, applied to the runtime we bundle).
 */
async function verifyDigest(path, asset) {
  const expected = (asset.digest ?? '').replace(/^sha256:/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(
      `release publishes no sha256 digest for ${asset.name}; refusing to bundle an unverified binary`,
    )
  }
  const actual = await sha256File(path)
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset.name}: expected ${expected}, got ${actual}`)
  }
  process.stdout.write(`verified sha256 ${asset.name} ${actual.slice(0, 16)}...\n`)
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' })
}

function findFile(rootDir, fileName) {
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === fileName) return full
    }
  }
  return null
}

async function fetchQuickJs() {
  const dest = join(OUT_DIR, 'qjs.exe')
  if (!force && existsSync(dest)) {
    process.stdout.write('qjs.exe already present, skipping (use --force to re-download)\n')
    return
  }
  const release = await resolveRelease(QUICKJS_RELEASE_API_URL)
  const asset = (release.assets ?? []).find((a) => QUICKJS_ASSET_RE.test(a.name))
  if (!asset) throw new Error(`no qjs windows asset found in release ${release.tag_name}`)
  await download(asset.browser_download_url, dest)
  await verifyDigest(dest, asset)
  if (statSync(dest).size < MIN_BYTES) throw new Error('qjs.exe looks truncated')
  process.stdout.write(`quickjs-ng ${release.tag_name} -> qjs.exe\n`)
}

async function fetchDeno() {
  const dest = join(OUT_DIR, 'deno.exe')
  if (!force && existsSync(dest)) {
    process.stdout.write('deno.exe already present, skipping (use --force to re-download)\n')
    return
  }
  const release = await resolveRelease(DENO_RELEASE_API_URL)
  const asset = (release.assets ?? []).find((a) => DENO_ASSET_RE.test(a.name))
  if (!asset) throw new Error(`no deno windows asset found in release ${release.tag_name}`)
  const work = mkdtempSync(join(tmpdir(), 'mf-deno-'))
  try {
    const zipPath = join(work, 'deno.zip')
    await download(asset.browser_download_url, zipPath)
    await verifyDigest(zipPath, asset)
    extractZip(zipPath, work)
    const found = findFile(work, 'deno.exe')
    if (!found) throw new Error('deno.exe not found inside archive')
    copyFileSync(found, dest)
    process.stdout.write(`deno ${release.tag_name} -> deno.exe (override only, never bundled)\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('fetch-binaries currently supports win32 only (Phase 1 target).')
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })

  if (verifyOnly) {
    // Fail before a multi-minute build rather than shipping a package that is missing a driver.
    verifyBundledSet()
    return
  }

  const ytDlpDest = join(OUT_DIR, 'yt-dlp.exe')
  if (force || !existsSync(ytDlpDest)) {
    await download(YT_DLP_URL, ytDlpDest)
  } else {
    process.stdout.write('yt-dlp.exe already present, skipping (use --force to re-download)\n')
  }

  const ffmpegDest = join(OUT_DIR, 'ffmpeg.exe')
  if (force || !existsSync(ffmpegDest)) {
    const work = mkdtempSync(join(tmpdir(), 'mf-ffmpeg-'))
    try {
      const zipPath = join(work, 'ffmpeg.zip')
      const ffmpegZipUrl = await resolveFfmpegZipUrl()
      await download(ffmpegZipUrl, zipPath)
      if (statSync(zipPath).size < MIN_BYTES) throw new Error('ffmpeg zip looks truncated')
      extractZip(zipPath, work)
      const found = findFile(work, 'ffmpeg.exe')
      if (!found) throw new Error('ffmpeg.exe not found inside archive')
      copyFileSync(found, ffmpegDest)
      const ffprobe = findFile(work, 'ffprobe.exe')
      if (ffprobe) copyFileSync(ffprobe, join(OUT_DIR, 'ffprobe.exe'))
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  } else {
    process.stdout.write('ffmpeg.exe already present, skipping (use --force to re-download)\n')
  }

  await fetchQuickJs()
  if (wantDeno) await fetchDeno()

  verifyBundledSet()
  process.stdout.write(`binaries ready in ${OUT_DIR}\n`)
}

/**
 * Asserts the three binaries the package must contain, and reports the rest of the directory so an
 * unexpected (or unexpectedly missing) file is visible rather than silently dropped by the filter.
 */
function verifyBundledSet() {
  for (const name of BUNDLED_FILES) {
    const p = join(OUT_DIR, name)
    if (!existsSync(p)) {
      throw new Error(
        `${name} is missing from ${OUT_DIR} — electron-builder would silently ship without it`,
      )
    }
    if (statSync(p).size < MIN_BYTES) throw new Error(`${name} looks truncated`)
  }

  const present = readdirSync(OUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const notBundled = present.filter((name) => !BUNDLED_FILES.includes(name))
  process.stdout.write(
    `bundled: ${BUNDLED_FILES.join(', ')}` +
      (notBundled.length > 0 ? `  (present but NOT bundled: ${notBundled.join(', ')})` : '') +
      '\n',
  )
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
