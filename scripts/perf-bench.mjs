#!/usr/bin/env node
/**
 * Memory/CPU benchmark harness (T14 / P-10).
 *
 * Measures two things in the same run, because AM-16's budget is expressed as a *marginal*
 * cost and a marginal figure computed against a remembered number is worthless:
 *
 *   1. A bare Electron window with a blank document — the floor Chromium costs before any
 *      application code loads.
 *   2. MediaForge itself, idling.
 *
 * Writes JSONL samples plus a Markdown summary. Nothing leaves the machine.
 *
 * Usage: npm run perf [-- --seconds 300 --launches 3]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'perf-out')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const SECONDS = Number(arg('seconds', '60'))
const LAUNCHES = Number(arg('launches', '3'))

// The `electron` package exports the absolute path to its binary when imported from Node.
// The .bin shim is a shell script on Windows and cannot be spawned without a shell.
const electronBin = (await import('electron')).default

/** A minimal Electron app: one window, blank document, sampling the same metrics. */
const BASELINE_MAIN = `
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const out = process.env.MF_BASELINE_OUT
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: true, width: 1280, height: 800 })
  win.loadURL('data:text/html,<!doctype html><title>baseline</title>')
  const samples = []
  const timer = setInterval(() => {
    let priv = 0, ws = 0, peak = 0
    const processes = []
    for (const m of app.getAppMetrics()) {
      const mem = m.memory || {}
      priv += mem.privateBytes || 0
      ws += mem.workingSetSize || 0
      peak += mem.peakWorkingSetSize || 0
      processes.push({ pid: m.pid, type: m.type, privateBytes: mem.privateBytes || 0, workingSetSize: mem.workingSetSize || 0 })
    }
    samples.push({
      t: new Date().toISOString(),
      scenario: 'bare-window',
      processes,
      totals: {
        privateMB: Math.round((priv / 1024) * 10) / 10,
        workingSetMB: Math.round((ws / 1024) * 10) / 10,
        peakWorkingSetMB: Math.round((peak / 1024) * 10) / 10,
      },
    })
  }, 2000)
  timer.unref()
  setTimeout(() => {
    clearInterval(timer)
    fs.writeFileSync(out, samples.map((s) => JSON.stringify(s)).join('\\n') + '\\n')
    app.exit(0)
  }, Number(process.env.MF_BASELINE_MS || 60000))
})
app.on('window-all-closed', () => app.quit())
`

function run(command, args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? 0)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(-1)
    })
  })
}

function readJsonl(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((entry) => entry && entry.totals)
  } catch {
    return []
  }
}

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const max = (values) => (values.length === 0 ? 0 : Math.max(...values))
const r1 = (n) => Math.round(n * 10) / 10

/** Samples from the last 60% of a run, so startup churn does not skew "idle". */
function settled(samples) {
  return samples.slice(Math.floor(samples.length * 0.4))
}

function summarize(samples) {
  const s = settled(samples)
  return {
    count: s.length,
    idlePrivateMB: r1(median(s.map((x) => x.totals.privateMB))),
    idleWorkingSetMB: r1(median(s.map((x) => x.totals.workingSetMB))),
    peakPrivateMB: r1(max(samples.map((x) => x.totals.privateMB))),
    peakWorkingSetMB: r1(max(samples.map((x) => x.totals.workingSetMB))),
    mainHeapMB: r1(median(s.map((x) => x.main?.heapUsedMB ?? 0))),
    arrayBuffersMB: r1(max(samples.map((x) => x.main?.arrayBuffersMB ?? 0))),
    loopP99Ms: r1(max(samples.map((x) => x.eventLoopDelayMs?.p99 ?? 0))),
    loopMaxMs: r1(max(samples.map((x) => x.eventLoopDelayMs?.max ?? 0))),
  }
}

async function measureBaseline() {
  const dir = join(OUT_DIR, 'baseline')
  mkdirSync(dir, { recursive: true })
  const mainFile = join(dir, 'baseline-main.cjs')
  const outFile = join(dir, 'baseline.jsonl')
  writeFileSync(mainFile, BASELINE_MAIN)
  rmSync(outFile, { force: true })

  console.info(`\n== bare Electron window, ${SECONDS}s ==`)
  await run(
    electronBin,
    [mainFile],
    { MF_BASELINE_OUT: outFile, MF_BASELINE_MS: String(SECONDS * 1000) },
    (SECONDS + 30) * 1000,
  )
  return readJsonl(outFile)
}

async function measureApp(run_index) {
  const logDir = join(OUT_DIR, `app-${run_index}`)
  mkdirSync(logDir, { recursive: true })
  const probeFile = join(logDir, 'mem.jsonl')
  rmSync(probeFile, { force: true })

  console.info(`\n== MediaForge idle, launch ${run_index + 1}/${LAUNCHES}, ${SECONDS}s ==`)
  await run(
    electronBin,
    [join(ROOT, 'out', 'main', 'index.js')],
    { MF_MEMORY_PROBE: '1', MF_PERF_LOG_DIR: logDir },
    (SECONDS + 30) * 1000,
  )
  return readJsonl(probeFile)
}

function markdown(baseline, appRuns) {
  const base = summarize(baseline)
  const runs = appRuns.map(summarize).filter((r) => r.count > 0)
  const appIdlePrivate = r1(median(runs.map((r) => r.idlePrivateMB)))
  const appIdleWorking = r1(median(runs.map((r) => r.idleWorkingSetMB)))
  const marginalPrivate = r1(appIdlePrivate - base.idlePrivateMB)
  const marginalWorking = r1(appIdleWorking - base.idleWorkingSetMB)

  const verdict = (value, limit) =>
    value === 0 ? 'not measured' : value <= limit ? `PASS (≤${limit})` : `FAIL (>${limit})`

  return `## Measured ${new Date().toISOString().slice(0, 10)}

Host: ${process.platform} ${process.arch}, Node ${process.versions.node}.
Window: ${SECONDS}s per run, ${LAUNCHES} launches, median of the settled tail.

| Figure | Bare window | MediaForge | Marginal | AM-16 |
|---|---|---|---|---|
| Idle summed private (MB) | ${base.idlePrivateMB} | ${appIdlePrivate} | ${marginalPrivate} | ${verdict(appIdlePrivate, 200)} · marginal ${verdict(marginalPrivate, 60)} |
| Idle summed working set (MB) | ${base.idleWorkingSetMB} | ${appIdleWorking} | ${marginalWorking} | ${verdict(appIdleWorking, 380)} |
| Peak summed private (MB) | ${base.peakPrivateMB} | ${r1(max(runs.map((r) => r.peakPrivateMB)))} | — | — |
| Peak summed working set (MB) | ${base.peakWorkingSetMB} | ${r1(max(runs.map((r) => r.peakWorkingSetMB)))} | — | AM-10 peak ≤450 |
| Main heap used (MB) | — | ${r1(median(runs.map((r) => r.mainHeapMB)))} | — | — |
| Main arrayBuffers peak (MB) | — | ${r1(max(runs.map((r) => r.arrayBuffersMB)))} | — | — |
| Event-loop delay p99 (ms) | — | ${r1(max(runs.map((r) => r.loopP99Ms)))} | — | — |
| Event-loop delay max (ms) | — | ${r1(max(runs.map((r) => r.loopMaxMs)))} | — | — |

Samples: baseline ${baseline.length}, app ${appRuns.map((r) => r.length).join(' / ')}.

Raw JSONL under \`perf-out/\`.
`
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.info(`electron: ${electronBin}`)

  const baseline = await measureBaseline()
  const appRuns = []
  for (let i = 0; i < LAUNCHES; i += 1) appRuns.push(await measureApp(i))

  const summary = markdown(baseline, appRuns)
  const summaryPath = join(OUT_DIR, 'summary.md')
  writeFileSync(summaryPath, summary)

  console.info(`\n${summary}`)
  console.info(`Wrote ${summaryPath}`)

  if (baseline.length === 0 || appRuns.every((r) => r.length === 0)) {
    console.error('\nNo samples collected — the app may not have stayed up. See perf-out/.')
    process.exitCode = 1
  }
}

await main()
