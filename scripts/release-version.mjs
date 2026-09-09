#!/usr/bin/env node
// Cuts a release: optionally bumps package.json to a version passed via
// `--v=X.Y.Z` / `--version=X.Y.Z` (npm requires the `--` separator for this —
// `--v`/`--version` without it are npm's own reserved flags and never reach
// this script — e.g. `npm run release-version -- --v=0.1.3`), otherwise uses
// whatever version is already in package.json. Either way it commits the
// bump if needed, pushes main, tags it, and pushes the tag (which triggers
// .github/workflows/release.yml).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const RELEASE_BRANCH = 'main'

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim()
}

function gitInherit(args) {
  execFileSync('git', args, { stdio: 'inherit' })
}

function parseRequestedVersion() {
  const flag = process.argv.find((a) => /^--v(?:ersion)?=/.test(a))
  const raw = flag ? flag.slice(flag.indexOf('=') + 1) : (process.env.npm_config_v ?? null)
  if (raw === null) return null
  if (!/^\d+\.\d+\.\d+$/.test(raw)) {
    throw new Error(`invalid --v "${raw}" — expected a plain X.Y.Z semver`)
  }
  return raw
}

function readVersion() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`package.json version "${pkg.version}" is not a plain X.Y.Z semver`)
  }
  return pkg.version
}

function writeVersion(version) {
  const pkgRaw = readFileSync('package.json', 'utf8')
  const pkg = JSON.parse(pkgRaw)
  pkg.version = version
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

  if (existsSync('package-lock.json')) {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    lock.version = version
    if (lock.packages?.['']) lock.packages[''].version = version
    writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n')
  }
}

function tagExists(tag) {
  const local = git(['tag', '-l', tag])
  if (local) return true
  const remote = git(['ls-remote', '--tags', 'origin', tag])
  return remote.length > 0
}

function remoteRepoSlug() {
  const url = git(['remote', 'get-url', 'origin'])
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/)
  return match ? match[1] : null
}

async function main() {
  const branch = git(['branch', '--show-current'])
  if (branch !== RELEASE_BRANCH) {
    throw new Error(
      `must be on "${RELEASE_BRANCH}" to release (currently on "${branch}"). ` +
        `Run: git checkout ${RELEASE_BRANCH} && git pull`,
    )
  }

  const requested = parseRequestedVersion()
  const targetTag = `v${requested ?? readVersion()}`
  if (tagExists(targetTag)) {
    throw new Error(
      `tag ${targetTag} already exists (locally or on origin). Pick a different version.`,
    )
  }

  if (requested !== null) {
    process.stdout.write(`setting package.json version to ${requested}\n`)
    writeVersion(requested)
  }

  const version = readVersion()
  const tag = `v${version}`

  // Raw (untrimmed) — trimming would eat the leading space of the first
  // status line and misalign the fixed-width slice(3) below.
  const statusRaw = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  const dirtyFiles = statusRaw
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
  const unexpectedDirty = dirtyFiles.filter(
    (f) => f !== 'package.json' && f !== 'package-lock.json',
  )
  if (unexpectedDirty.length > 0) {
    throw new Error(
      `working tree has unrelated uncommitted changes, aborting:\n  ${unexpectedDirty.join('\n  ')}`,
    )
  }

  if (dirtyFiles.length > 0) {
    process.stdout.write(`committing version bump (${dirtyFiles.join(', ')})\n`)
    gitInherit(['add', ...dirtyFiles])
    gitInherit(['commit', '-m', `chore: release ${tag}`])
  }

  process.stdout.write(`pushing ${RELEASE_BRANCH}\n`)
  gitInherit(['push', 'origin', RELEASE_BRANCH])

  process.stdout.write(`tagging ${tag}\n`)
  gitInherit(['tag', '-a', tag, '-m', `Release ${tag}`])

  process.stdout.write(`pushing tag ${tag}\n`)
  gitInherit(['push', 'origin', tag])

  const slug = remoteRepoSlug()
  process.stdout.write(`\n${tag} pushed — release.yml is now building it.\n`)
  if (slug) {
    process.stdout.write(`Watch:   https://github.com/${slug}/actions\n`)
    process.stdout.write(`Release: https://github.com/${slug}/releases/tag/${tag}\n`)
  }
}

main().catch((err) => {
  console.error(`release-version failed: ${err.message ?? String(err)}`)
  process.exit(1)
})
