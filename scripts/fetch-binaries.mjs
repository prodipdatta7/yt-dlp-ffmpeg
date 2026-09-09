#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
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
// BtbN's master builds are named after the commit (e.g. ffmpeg-N-126482-g903325e279-win64-lgpl.zip),
// so the asset name changes on every build; resolve it from the release API instead of hardcoding it.
const FFMPEG_ASSET_RE = /^ffmpeg-N-.*-win64-lgpl\.zip$/
const MIN_BYTES = 1_000_000

const force = process.argv.includes('--force')

async function download(url, dest) {
  process.stdout.write(`downloading ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function resolveFfmpegZipUrl() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const headers = {
    'User-Agent': 'mediaforge-fetch-binaries',
    Accept: 'application/vnd.github+json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(FFMPEG_RELEASE_API_URL, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${FFMPEG_RELEASE_API_URL}`)
  const release = await res.json()
  const asset = (release.assets ?? []).find((a) => FFMPEG_ASSET_RE.test(a.name))
  if (!asset) throw new Error(`no ffmpeg win64-lgpl asset found in release ${release.tag_name}`)
  return asset.browser_download_url
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

async function main() {
  if (process.platform !== 'win32') {
    console.error('fetch-binaries currently supports win32 only (Phase 1 target).')
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })

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

  for (const name of ['yt-dlp.exe', 'ffmpeg.exe']) {
    const p = join(OUT_DIR, name)
    if (!existsSync(p) || statSync(p).size < MIN_BYTES)
      throw new Error(`${name} missing or too small`)
  }
  process.stdout.write(`binaries ready in ${OUT_DIR}\n`)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
