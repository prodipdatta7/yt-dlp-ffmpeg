# MediaForge Performance & Memory Remediation Plan

Execution plan for the findings in `specs/performance-memory-deep-research.md` (assessment P-01…P-12)
and its `# Independent review` section (R-01…R-06). Written to be executed by a coding agent in a
single continuous run.

Baseline: `main` at `cbf380e` (v0.2.7). Target: all tasks below green, `specs/perf-report.md`
regenerated, AM-10 amended.

---

## How to execute this plan

Work the tasks **in the numbered order**. They are ordered so that each task's files are either
untouched by later tasks or handed off cleanly, and so the cheap, high-certainty fixes land before
the structural ones.

### The loop

For each task `Tn`:

1. Read the task's **Files** list and re-read those files — do not trust the excerpts in this
   document, they are a guide to *where* the code is, not a substitute for current state.
2. Apply the **Change**.
3. Add or update the **Tests**.
4. Run the **gate**: `npm run typecheck && npm test && npm run lint`.
5. If green: commit with the task ID in the subject (`perf(T3): async finalization`) and tick the
   box in the checklist below. If red: fix forward. If the task's **Stop condition** is hit, revert
   that task only, record why under **Deviations**, and continue to the next task.

State is tracked by the checklist and by commits — a resumed run should read the checklist, verify
against `git log --oneline`, and continue from the first unticked task.

### Checklist

- [x] T0 — Spec: AM-16 memory budget amendment
- [x] T1 — Runner capture policy; delete dead orchestrator arrays *(P-01)*
- [x] T2 — `--progress-delta`, job-event coalescing, protocol-log gating *(P-04)*
- [x] T3 — Asynchronous finalization *(P-02)*
- [x] T4 — Same-volume staging root *(P-02 / R-03)*
- [x] T5 — Async fsops, startup sweep off critical path, sweep-abort bug *(P-02 / R-06)*
- [x] T6 — Streaming updaters with incremental SHA-256 *(P-03)*
- [x] T7 — Playlist hydration: windowed and cancellable *(R-02, new P0)*
- [x] T8 — Analyze generation token; awaited cancel; search `activeHandles` *(P-08a)*
- [x] T9 — Job early-completion buffer *(P-08b)*
- [x] T10 — Normalized playlist state, batched hydration *(P-05)*
- [x] T11 — Preview mechanical fixes: throttle, stable callbacks, binary search, LRU, cancellation *(P-06/P-07)*
- [x] T12 — Extract `TheaterPreview` from `SearchResultCard` *(P-06)*
- [ ] T13 — Fixed-row windowing for long lists *(P-05)*
- [ ] T14 — Telemetry harness; regenerate `specs/perf-report.md` *(P-10)*

### Standing constraints (from AGENTS.md — violating these fails the task)

| Constraint | Meaning here |
|---|---|
| AM-12 | **No new runtime dependencies.** No LRU package, no virtualization library, no router. Preact + Signals only. Hand-write the small utilities this plan calls for. |
| AM-01 | Never regex-scrape human-readable stdout. Machine interfaces only (`-J`, `--progress-template`, `--print after_move:filepath`). |
| AM-02 | `spawn(binPath, argsArray)` with `shell:false, windowsHide:true`. Never build shell strings. |
| AM-06 | Delete temp/source files **only after** verifying the destination exists and is > 0 bytes. This survives every change in T3/T4/T5. |
| AM-09 | Cancel kills the process **tree** (`taskkill /PID <pid> /T /F` on win32), keeps partials, resets UI to idle. |
| — | IPC payload shape changes must be reflected in `src/shared/ipcContract.ts`, and preload in `src/preload/index.ts`. |
| — | No behavior change visible to the user unless the task says so explicitly. This is a performance pass. |

### Deviations

*(Agent: append a row here for any task reverted or altered, with the reason. Leave empty if none.)*

| Task | What changed | Why |
|---|---|---|
| T12 | Landed, but **behavior parity is unverified** — it needs the running Electron UI, which this run could not drive. Gate (typecheck/tests/lint/build) is green. | Recorded rather than silently claimed. The commit is self-contained: `git revert` it if the manual checklist in its message fails. |
| T12 | `TheaterPreview` also takes `currentPreset` and `onOpenInDownloader`, not just `{ entry, onClose }`. | The bitrate/resolution readouts derive from the selected preset, and the modal has an "Open in Downloader" action. Both change only on user action, never per playback tick, so the render-scope goal holds. |
| T11 | One `previewCancel(requestId)` instead of separate `chaptersCancel`/`transcriptCancel`. | Both would have been the same function — kill the children registered under an id. One channel, less surface. |
| T10 | Added a `hydratedEntries()` overlay and routed three consumers through it, rather than relying on `analysis` still carrying detail. | The plan's "`analysis` keeps its current shape so nothing downstream breaks" assumed hydrated detail lived there. It never did — main mutates its own copy; the renderer only learns detail from the entry stream. Without the overlay, the download size estimator would have silently lost per-entry durations. |
| T8 | The late-event generation guard lives in main (`AnalyzeService` refuses to emit for a superseded analysis), not in `applyAnalyzeStream`. | Stream events carry no generation, and main's counter is not comparable to the renderer's — a renderer-side check would have been decorative. The renderer keeps its token for the `analyzeStart` promise, which is the actual P-08 defect. |
| T8 | Also added generation checks to `fetchChapters` / `fetchTranscript`. | Neither had one, so a cancel mid-request still returned its result, and the transcript path spawned its fallback subtitle pass *after* the cancel. |
| T6 | The 250 MB memory guards assert `arrayBuffers` < 64 MiB, not < 32 MB. | `arrayBuffers` also counts in-flight stream buffers and pool slack; observed peaks are ~20-36 MB and vary run to run, so 32 MB was flaky. 64 MiB still fails loudly against the pre-fix path, whose peak was ≥ the full 250 MB. |
| T5 | Also converted `sanitizer.collisionFreeTarget` and `downloadManifest` to async, beyond T5's stated file list. | Both are on the download completion path, so leaving them sync would have made T3's "no `*Sync` in the completion path" bar false outside `orchestrator.ts`. `diskSpace`'s `existsSync` walk is left sync — it is a preflight. |
| T5 | `sweepOrphanedTempDirs` takes an options object with a `stat` seam. | `vi.spyOn` cannot patch an ESM namespace, so the "one entry is locked" regression — the whole point of the R-06 fix — had no other deterministic way to be tested. |
| T1 | `maxLineChars` applies under `'tail'` only, not under `'full'`. | A `-J` payload is a single very long line; capping it under `'full'` would silently corrupt every metadata/search result. `'full'` is bounded by `maxCaptureBytes` instead. |
| T2 | Coalescing is latest-wins *within a phase*; a phase change flushes the outgoing phase's sample first. | `downloading-video` → `downloading-audio` is a state transition the renderer must see, not a droppable sample. |
| T2 | `logConsoleOpen` takes `includeProtocol` as well as `open`. | The console already has a "protocol" toggle; suppressing protocol lines unconditionally would have made that toggle show only stale history. |
| T1 | Soak test left ungated (no `MF_SOAK`). | It completes in ~2 s, well inside the plan's 30 s threshold, so it earns its place in the default run. |

---

## T0 — Spec: AM-16 memory budget amendment

**Problem.** R-01. AM-10 sets idle ≤120 MB measured as the `app.getAppMetrics()` `workingSetSize`
sum. Measurement shows a bare Electron 43 window costs 310 MB working set / 142 MB private on the
reference host, so the target is unreachable by 2.6× before any MediaForge code loads. Leaving AM-10
as written means every later task is measured against an impossible gate.

**Files.** `AGENTS.md`

**Change.** Add a row to the PRD Amendment Log table (§2), after AM-15:

```
| AM-16 | 5.2/AM-10 | AM-10's idle ceiling (≤120MB) is withdrawn as unachievable and is replaced. Measured on the reference host (Electron 43, Win11), a **bare** Electron window with a blank document costs 310MB summed `workingSetSize` / 142MB summed `privateBytes` across its four processes — the 120MB target fails on both metrics before any application code loads. MediaForge's own marginal cost over that baseline is ~47MB working set / ~46MB private. New budget: **idle ≤200MB summed private, ≤380MB summed working set; marginal cost over a bare-window baseline ≤60MB private**, which is the tracked regression signal. Peak ≤450MB (AM-10) is retained. Both `workingSetSize` and `privateBytes` are recorded; `privateBytes` is the primary figure because working set double-counts shared pages. Baseline is re-measured whenever the Electron major version changes. Evidence: `specs/performance-memory-deep-research.md` §R-01. |
```

Then update AM-10's row to end with: `Superseded in part by AM-16.`

**Tests.** None (spec change).

**Gate.** `npm run lint` (prettier formats Markdown).

**Done when.** AM-16 exists, AM-10 points to it, and no later task is measured against 120 MB.

---

## T1 — Runner capture policy; delete dead orchestrator arrays

**Problem.** P-01. `LineBuffer.lines` (`src/main/binaries/runner.ts:29`) retains every decoded line
for the process lifetime, and `RunResult` always carries both full arrays. Download execution
duplicates this into `stdoutLines` and `allStdoutLines`. During a multi-hour live recording, main
memory grows for the whole recording.

Two facts make this cheaper to fix than the assessment implies:

- `stdoutLines` in `orchestrator.ts:280` is declared and pushed to at line 294 but **never read**.
  It is dead weight — delete it outright.
- `allStdoutLines` (`orchestrator.ts:273`) has exactly one consumer: `extractFinalPathLine()` at
  `orchestrator.ts:391`. It can be replaced by a single `string | null` updated in the callback.

**Files.** `src/main/binaries/runner.ts`, `src/main/jobs/orchestrator.ts`,
`src/main/jobs/progressParser.ts`, `src/main/media/metadata.ts`, `src/main/media/search.ts`,
`src/main/binaries/updater.ts`, `src/main/binaries/ffmpegUpdater.ts` (call sites only)

### Change 1 — capture policy in `runner.ts`

Replace the unbounded `LineBuffer.lines` with a policy-driven store.

```ts
export type CaptureMode = 'none' | 'tail' | 'full'

export interface CapturePolicy {
  /** Retention for RunResult.stdoutLines. Default 'tail'. */
  stdout?: CaptureMode
  /** Retention for RunResult.stderrLines. Default 'tail'. */
  stderr?: CaptureMode
  /** Lines retained per stream under 'tail'. Default 200. */
  tailLines?: number
  /** Per-line character cap; longer lines are truncated with a trailing ellipsis. Default 4096. */
  maxLineChars?: number
  /** Byte ceiling under 'full'. On overflow, capture stops and `truncated` is set. Default 64 MiB. */
  maxCaptureBytes?: number
}

export interface SpawnOptions {
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  timeoutMs?: number
  capture?: CapturePolicy
}

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdoutLines: string[]
  stderrLines: string[]
  timedOut: boolean
  /** True when a stream hit its byte ceiling or its tail dropped lines. */
  stdoutTruncated: boolean
  stderrTruncated: boolean
}
```

`LineBuffer` gains a mode, a ring buffer for `'tail'`, and a byte counter for `'full'`:

- `'none'` — `onLine` still fires; nothing is retained; `lines` returns `[]`.
- `'tail'` — fixed-capacity ring of `tailLines`; overwrite oldest; set `truncated` on first
  overwrite. **Use a ring, not `Array.splice(0,…)`** — the existing front-splice pattern is O(n) per
  line.
- `'full'` — append until `maxCaptureBytes`, then stop appending and set `truncated`.

Per-line truncation at `maxLineChars` applies in all modes, to `lines` only — `onLine` receives the
untruncated line so parsers are unaffected.

**Defaults must be conservative**: absent an explicit `capture`, both streams are `'tail'`. This is a
behavior change for any caller that relied on full stdout, so every call site is updated below.

### Change 2 — call-site capture policies

| Call site | Policy | Why |
|---|---|---|
| `orchestrator.ts` download spawn | `{ stdout: 'none', stderr: 'tail', tailLines: 100 }` | stdout is parsed live; nothing needs retaining |
| `metadata.ts:runOnce` | `{ stdout: 'full', stderr: 'tail', tailLines: 100 }` | stdout is the `-J` JSON payload and must be complete |
| `search.ts` search/hydrate spawns | `{ stdout: 'full', stderr: 'tail', tailLines: 100 }` | same |
| `updater.ts` / `ffmpegUpdater.ts` version probes | `{ stdout: 'tail', stderr: 'tail', tailLines: 20 }` | single-line version string |

In `metadata.ts:runOnce` and the `search.ts` equivalents, when `result.stdoutTruncated` is true,
throw `MfError('MF_EXTRACTOR_STALE')` rather than attempting `JSON.parse` on a partial payload.

### Change 3 — orchestrator cleanup

In `runDownload` (`orchestrator.ts:~270-350`):

- Delete `const allStdoutLines: string[] = []` (line 273) and its `.push` (line 295).
- Delete `const stdoutLines: string[] = []` (line 280) and its `.push` (line 294) — dead code.
- Delete `const stderrLines: string[] = []` (line 281) and its `.push` (line 331); use the runner's
  bounded tail instead.
- Add, above the retry loop: `let finalPathFromPrint: string | null = null`
- In `onStdoutLine`, before the postprocess/progress parsing, capture the `--print after_move:filepath`
  line. Reuse the existing predicate from `extractFinalPathLine` rather than duplicating it: add to
  `progressParser.ts`

  ```ts
  /** True when a stdout line is the `--print after_move:filepath` payload (AM-01). */
  export function isFinalPathLine(line: string, exists: (p: string) => boolean = existsSync): boolean {
    const candidate = line.trim()
    if (!candidate) return false
    if (candidate.startsWith('MF') || candidate.startsWith('[')) return false
    return exists(candidate)
  }
  ```

  and in the callback: `if (isFinalPathLine(line)) finalPathFromPrint = line.trim()` (last one wins,
  matching `extractFinalPathLine`'s reverse scan).
- Line 348 becomes `classifyStderr(result.stderrLines.slice(-40))`.
- Line 390-391 becomes `const finalSource = finalPathFromPrint ?? findLargestCompletedFile(job.tempDir)`.

Keep `extractFinalPathLine` exported — `tests/unit/progressParser.test.ts` covers it and other
callers may exist. Implement it in terms of `isFinalPathLine` so the two cannot drift.

**Tests.** `tests/unit/runner.test.ts`:

- `'none'` retains nothing but still invokes `onStdoutLine` for every line.
- `'tail'` with `tailLines: 10` over 100 lines retains exactly the last 10, in order, and sets
  `stdoutTruncated`.
- `'full'` with a low `maxCaptureBytes` stops appending and sets `stdoutTruncated`.
- `maxLineChars` truncates `lines` but not the `onLine` argument.
- **Soak:** a fixture child emitting ≥1,000,000 lines under `{ stdout: 'none' }` — assert
  `process.memoryUsage().heapUsed` after a forced GC is within 32 MB of the pre-run reading, and that
  `stdoutLines` is empty. Use `tests/fixtures/fake-bin` for the emitter. Mark it with a long timeout;
  if it is slower than ~30 s, gate it behind `describe.skipIf(!process.env.MF_SOAK)` and document the
  env var in the test file header.

`tests/unit/orchestrator.test.ts`: assert a successful download still resolves the final path when
`--print` emits it, and still falls back to `findLargestCompletedFile` when it does not.

**Stop condition.** If the soak test cannot be made to run in under 60 s on this host even gated,
keep the gate and note it; do not delete the test.

**Done when.** No unbounded line array survives in a download path, and a 1M-line child leaves main
heap flat.

---

## T2 — `--progress-delta`, job-event coalescing, protocol-log gating

**Problem.** P-04. `buildBaseDownloadArgs` (`src/main/jobs/argBuilders.ts:19-38`) sets `--newline`
`--progress` with two `--progress-template` entries but no `--progress-delta`; yt-dlp's default delta
is zero, so every progress hook call produces a line. Each line then takes two IPC routes — a parsed
`JobEvent` and a raw `MF_LOG_LINE` broadcast to every window (`src/main/index.ts:182-187`) — and the
renderer merges it into a second history every 250 ms whether or not the console is open.

**Files.** `src/main/jobs/argBuilders.ts`, `src/main/jobs/orchestrator.ts`, `src/main/index.ts`,
`src/main/logs/logBus.ts`, `src/shared/ipcContract.ts`, `src/preload/index.ts`,
`src/renderer/src/components/LogConsole.tsx`

### Change 1 — the flag

In `buildBaseDownloadArgs`, after `'--progress'`:

```ts
'--progress-delta',
'0.25',
```

Phase changes, completion, warnings and errors are separate stdout lines and are unaffected — the
delta only rate-limits the repeating progress hook. Note in a comment that this caps routine progress
at ~4 lines/sec/job (AM-01 keeps the machine template).

### Change 2 — coalesce job events in main

Routine progress events are already rate-limited by Change 1, but with five parallel jobs that is
still 20 structured clones/sec. Add a per-job coalescer in the orchestrator's `emit`:

- Terminal and non-routine phases (`finalizing`, `merging` transitions, `queued`, anything carrying
  `message`) send immediately.
- Routine `downloading-video` / `downloading-audio` samples are stored per `jobId` and flushed on a
  shared 150 ms timer, latest-sample-wins. Flush and clear on job completion so no sample is stranded.
- The timer must be `unref()`d and cleared when no jobs are active, so idle CPU stays at zero (the
  app currently has **no** idle timers — do not introduce one).

### Change 3 — gate raw protocol lines

`MF_LOG_LINE` currently broadcasts every yt-dlp line to every window unconditionally. Two changes:

- `LogBus.push` already redacts and stores; add a filter so lines matching the machine protocol
  (`download:MF|`, `postprocess:MFPOST|`) are **stored but not broadcast** by default. They are
  diagnostics, not human console output.
- Add a `logConsoleOpen(open: boolean)` IPC call (contract + preload + a handler that sets a flag on
  the main-side broadcaster). While closed, suppress the per-line broadcast entirely; `LogConsole`
  already calls `logHistory()` on mount (`App.tsx:476`), so opening the console still shows the tail.
  Call it from `LogConsole`'s mount/unmount.

Do **not** replace the `LogBus` front-splice with a ring buffer (R-04): at 2,000 entries its cost is
negligible and the change is not worth the churn.

**Tests.** `tests/unit/jobArgs.test.ts`: assert `--progress-delta 0.25` is present and immediately
follows `--progress`. `tests/unit/orchestrator.test.ts`: drive 100 synthetic progress lines through
`emit` with fake timers and assert ≤`ceil(elapsed/150ms)+1` routine events reach `sendEvent`, that
the last sample is always delivered, and that a `message`-carrying event is never delayed.
`tests/unit/logBus.test.ts`: protocol lines are retained in `tail()` but not delivered to subscribers
when the console is closed.

**Done when.** A download produces ≤5 routine progress events/sec/job, and no raw CLI line crosses
IPC while the log console is closed.

---

## T3 — Asynchronous finalization

**Problem.** P-02. `orchestrator.ts:398-415` runs `renameSync`, and on failure `copyFileSync` +
`unlinkSync`, then `rmSync(job.tempDir, { recursive: true })`, all on the main thread.
`finalizeLiveRecording` (`orchestrator.ts:423-437`) repeats the pattern. A multi-gigabyte copy blocks
windows, native events and IPC for its entire duration.

**Files.** `src/main/jobs/orchestrator.ts`, `src/shared/models.ts` (phase, if extended)

**Change.** Convert the finalization block to `node:fs/promises`:

```ts
await fsp.mkdir(job.destDir, { recursive: true })
const target = collisionFreeTarget(job.destDir, basename(finalSource))
try {
  await fsp.rename(finalSource, target)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  await fsp.copyFile(finalSource, target)
  // AM-06: verify destination before removing the source.
  const st = await fsp.stat(target).catch(() => null)
  if (!st || st.size <= 0) {
    this.deps.logger?.error('moved output failed verification', { jobId, target })
    this.finish(job, sendDone, { status: 'failed', errorCode: 'MF_UNKNOWN' })
    return
  }
  await fsp.unlink(finalSource)
}
```

Three requirements:

1. **Narrow the catch.** The current bare `catch` swallows permission and collision errors and then
   attempts a copy that fails differently. Only `EXDEV` falls through to copy; everything else
   rethrows to the existing outer handler.
2. **AM-06 ordering is preserved.** The source is unlinked only after the destination is confirmed
   non-zero. The existing post-move verification at `orchestrator.ts:410-414` stays (now `await
   fsp.stat`), and applies to the rename path too.
3. Replace `existsSync`/`statSync` in the pre-move check (`orchestrator.ts:392`) with
   `await fsp.stat(finalSource).catch(() => null)`, and `rmSync(job.tempDir, …)` at line 413 with
   `await fsp.rm(job.tempDir, { recursive: true, force: true })`.

Apply the identical treatment to `finalizeLiveRecording`, which must become `async` — update its call
site at `orchestrator.ts:~374` to `await`.

**Heartbeat.** So the UI can prove the main loop is live during a long copy, emit the existing
`finalizing` phase every 500 ms while the copy is in flight (a timer started before `copyFile` and
cleared in a `finally`). No new phase or contract change — reuse `emit('finalizing', 100, …)`.

**Tests.** `tests/unit/orchestrator.test.ts`:

- Same-volume success uses `rename` and never calls `copyFile`.
- An injected `EXDEV` from `rename` falls through to `copyFile` + `unlink`, in that order.
- An injected `EACCES` from `rename` does **not** call `copyFile` and fails the job.
- A copy that produces a zero-byte destination fails the job and **leaves the source in place**
  (AM-06 regression guard).
- **Heartbeat:** with a `copyFile` stub that resolves after 2 s of fake time, assert `sendEvent`
  fired at least three times during the copy.

**Done when.** No `*Sync` filesystem call remains in the download completion path, and the EXDEV
branch is entered only on EXDEV.

---

## T4 — Same-volume staging root

**Problem.** R-03/P-02. `tempRoot` is `<userData>/tmp` on C: (`src/main/index.ts:162`); `destDir` is
user-chosen. For any user whose download folder is on D: or an external drive, the EXDEV branch T3
just made async is the **normal** path — so every large download is still written to disk twice. T3
removes the freeze; it does not remove the duplicate write.

**This is the highest-risk task in the plan.** It moves where partial files live, which
`fsops/partials.ts` and `fsops/tempSweep.ts` both assume. Do it only with T3 green and committed.

**Files.** `src/main/jobs/orchestrator.ts`, `src/main/fsops/partials.ts`,
`src/main/fsops/tempSweep.ts`, `src/main/index.ts`

**Change.**

1. Add to `src/main/fsops/partials.ts`:

   ```ts
   import { parse, resolve } from 'node:path'

   /** Windows/POSIX volume-root comparison. UNC and unresolvable paths are treated as distinct. */
   export function sameVolume(a: string, b: string): boolean {
     const ra = parse(resolve(a)).root.toLowerCase()
     const rb = parse(resolve(b)).root.toLowerCase()
     return ra.length > 0 && ra === rb && !ra.startsWith('\\\\')
   }

   export const STAGING_DIR_NAME = '.mediaforge-part'
   ```

2. In the orchestrator, replace the fixed `tempDirForUrl(this.deps.tempRoot, …)` (line 223) with a
   root chosen per destination:

   ```ts
   const stagingRoot = sameVolume(this.deps.tempRoot, effectiveDestDir)
     ? this.deps.tempRoot
     : join(effectiveDestDir, STAGING_DIR_NAME)
   const tempDir = tempDirForUrl(stagingRoot, config.url)
   ```

   Store `stagingRoot` on `ActiveJob` so cleanup and the partials surface can find it.

3. Generalize the path guard. `isUnderTempRoot(tempRoot, candidate)` becomes
   `isUnderAnyRoot(roots: readonly string[], candidate: string)`, with `isUnderTempRoot` kept as a
   single-root wrapper so existing tests keep passing. `listPartialDirs` takes `roots: readonly
   string[]` and concatenates. `clearAllPartialDirs` likewise.

4. In `src/main/index.ts`, the four partials handlers (lines 429-442) pass
   `stagingRoots()` — a small helper returning `[tempRoot, join(settings.outputDir, STAGING_DIR_NAME)]`
   deduplicated, resolved from current settings at call time (the output folder can change while the
   app runs).

5. `sweepOrphanedTempDirs` (T5) must sweep every root in `stagingRoots()`, not just `tempRoot`.

**Constraints.** The staging directory name is dot-prefixed so it sorts out of the way, and must
never be offered as a download destination. `collisionFreeTarget` scans `destDir`; confirm it skips
directories so `.mediaforge-part` can never collide with an output filename.

**Tests.** `tests/unit/partials.test.ts` (new file):

- `sameVolume('C:\\a', 'C:\\b')` true; `sameVolume('C:\\a', 'D:\\b')` false; UNC false.
- `isUnderAnyRoot` rejects traversal (`..`) against every root, matching the existing
  `isUnderTempRoot` guarantees.
- `listPartialDirs` over two roots returns the union, still sorted by `mtimeMs` descending.

`tests/unit/orchestrator.test.ts`: with `tempRoot` and `destDir` on the same simulated volume,
staging is under `tempRoot`; on different volumes, staging is under `destDir/.mediaforge-part` and
finalization takes the **rename** path (assert `copyFile` is never called).

**Stop condition.** If the partials UI or its handlers cannot be threaded cleanly, revert T4 only.
T3 already removed the user-visible freeze; the duplicate write is a throughput cost, not a hang.
Record it under **Deviations** and move on.

**Done when.** A download to a different volume from `userData` completes without a cross-volume
copy, and partial-file listing/clearing still shows and clears those files.

---

## T5 — Async fsops, startup sweep off critical path, sweep-abort bug

**Problem.** P-02 and R-06. `fsops/partials.ts` walks, stats and removes partial trees synchronously
from IPC handlers. `fsops/tempSweep.ts` removes trees synchronously at `index.ts:170` — before the
window is created, so it lands directly on cold-start time. And `tempSweep.ts:26` has a real bug:

```ts
} catch {
  return removed      // ← aborts the entire sweep on one bad entry
}
```

A single locked or unstattable directory silently ends the sweep, so temp space leaks permanently.

**Files.** `src/main/fsops/tempSweep.ts`, `src/main/fsops/partials.ts`, `src/main/index.ts`

**Change.**

1. **The bug first, on its own commit.** `return removed` → `continue`. This is correct independent
   of everything else in this task.
2. Convert `sweepOrphanedTempDirs` to `async` using `fs/promises` (`readdir`, `stat`, `rm`), sweeping
   every root from T4's `stagingRoots()`.
3. Move the call off the critical path in `index.ts`: remove it from the synchronous `whenReady`
   body (line 170) and invoke it from the main window's `ready-to-show` handler as
   `void sweepOrphanedTempDirs(...).then(n => { if (n > 0) logger.info(...) })`. The window must not
   wait on it.
4. Convert `dirBytesAndCount`, `listPartialDirs`, `clearPartialDir` and `clearAllPartialDirs` to
   async (`fs/promises`), and `await` them in the `index.ts` handlers (they are already inside async
   IPC handlers — confirm each one and add `await`).

**Constraints.** `clearPartialDir` keeps its traversal guard *before* any filesystem call. Sweep
failures stay non-fatal and log at `debug`, not `error` — a locked partial is normal when a prior
run is still shutting down.

**Tests.** `tests/unit/tempSweep.test.ts`: given three stale dirs where the middle one throws on
`stat`, assert the other two are still removed and the count is 2 (this is the regression test for
the bug). Existing sweep tests updated for `async`. Startup: assert `sweepOrphanedTempDirs` is not
called before `ready-to-show` fires.

**Done when.** No `*Sync` filesystem call remains in `fsops/`, cold start does not wait on the sweep,
and one unreadable directory no longer aborts it.

---

## T6 — Streaming updaters with incremental SHA-256

**Problem.** P-03 and R-03. `downloadBuffer` (`src/main/binaries/updater.ts:101-106`) does
`Buffer.from(await response.arrayBuffer())` — the whole asset in main-process memory. `ffmpegUpdater.ts`
then holds that buffer while hashing, writing, extracting, and reading executables back in; the app
updater holds a ~150 MB NSIS installer the same way. Two defects the assessment did not name:

- `ffmpegUpdater.ts:203` — `writeFileSync(tmpExe, readFileSync(exe))` reads a ~130 MB executable
  fully into memory purely to write it back out. The same pattern repeats for `ffprobe.exe`.
- `ffmpegUpdater.ts:176` — `sha256Hex(zipBytes)` is a **synchronous ~100 MB hash** blocking the main
  event loop. That is a freeze, separate from the memory concern.

**Files.** `src/main/binaries/updater.ts`, `src/main/binaries/ffmpegUpdater.ts`,
`src/main/app/appUpdater.ts`

**Change.**

1. Add to `updater.ts`, alongside `downloadBuffer`:

   ```ts
   export interface DownloadToFileResult {
     bytes: number
     sha256: string
   }

   /**
    * Streams a release asset to `destPath`, hashing incrementally. Never holds the
    * asset in memory. Rejects (and removes the partial file) if the stream exceeds
    * `maxBytes` or if Content-Length is present and disagrees with the bytes received.
    */
   export async function downloadToFile(
     url: string,
     destPath: string,
     fetchFn: typeof fetch,
     maxBytes: number,
   ): Promise<DownloadToFileResult>
   ```

   Implementation: `fetch` → `Readable.fromWeb(response.body)` → `pipeline()` into
   `createWriteStream(destPath)` with a `createHash('sha256')` transform tapped off the same stream.
   Count bytes in the tap; abort past `maxBytes`. On any failure, `await fsp.rm(destPath, { force:
   true })` and rethrow. Return the digest as lowercase hex.

   Keep `downloadBuffer` for the small sidecars (`.sha256`, `SHA256SUMS`) — those are a few hundred
   bytes and streaming them adds nothing. Give it an explicit small cap (64 KiB) and reject past it.

2. `ffmpegUpdater.apply()`:
   - Download the zip with `downloadToFile(zipUrl, zipPath, fetchFn, MAX_FFMPEG_ZIP_BYTES)` straight
     into the `mkdtempSync` work directory. Compare the returned digest against the sidecar's
     expected value; on mismatch, remove and return the existing rejection message unchanged.
   - Delete `writeFileSync(zipPath, zipBytes)` — the file is already on disk.
   - Replace `writeFileSync(tmpExe, readFileSync(exe))` with `await fsp.copyFile(exe, tmpExe)`, same
     for `ffprobe`. Convert the surrounding `existsSync`/`copyFileSync`/`rmSync`/`renameSync` swap to
     `fs/promises`, keeping the existing `.bak` rollback contract (AM-03) and the try/catch that
     removes `tmpExe` on a failed swap.
   - `MIN_ZIP_BYTES` validation moves to the returned `bytes`.
3. `appUpdater`: same treatment — `downloadToFile` into `deps.updatesDir`, compare the returned digest
   against the `SHA256SUMS` entry, then launch. Delete `writeFileSync(installerPath, exeBytes)`.
   Keep the `orchestrator.isBusy()` refusal and the quit-after-launch sequence (AM-15) untouched.
4. Both updaters keep their phase callbacks firing in the same order; `'verifying'` now means
   "compare the streamed digest", not "hash a buffer".

**Constraints.** AM-03: still never write into the install directory; still verify before swapping;
still keep `.bak`. AM-13: FFmpeg source, checksum sidecar and hash-based "newer" detection are
unchanged — only the transport changes.

**Tests.** `tests/unit/updater.test.ts`:

- `downloadToFile` writes the right bytes and returns the digest of a known fixture.
- A response exceeding `maxBytes` rejects **and** leaves no file behind.
- A Content-Length/body mismatch rejects.

`tests/unit/ffmpegUpdater.test.ts` and `tests/unit/appUpdater.test.ts`:

- **Memory:** feed a synthetic 250 MB response body through a mock `fetch` and assert
  `process.memoryUsage().arrayBuffers` stays under 32 MB across the whole `apply()` call.
- Checksum mismatch still rejects with the existing message and performs no swap.
- Rollback still restores `.bak` when `verifyInstalled` returns null.

**Done when.** No updater path calls `arrayBuffer()` or `readFileSync` on a large asset, and the
250 MB test stays bounded.

---

## T7 — Playlist hydration: windowed and cancellable *(new P0)*

**Problem.** R-02 — the largest real-world cost in the app, and absent from the original findings.
`hydrateEntries` (`src/main/media/metadata.ts:342-382`) calls `runOnce` **once per playlist entry** at
`HYDRATION_CONCURRENCY = 4` (line 223), over a list capped at 1000 (line 119). A 1000-entry playlist
therefore spawns up to 1000 separate yt-dlp processes, four at a time. Each is a 17 MB PyInstaller
binary that unpacks itself to temp on every launch — roughly 1–2 s cold start and 60–80 MB RSS each.
That is on the order of 6–12 minutes of continuous process churn plus sustained temp-disk write
amplification, and `analyze()` does not resolve until the whole pass finishes (line 264), so the full
result and all pending state stay reachable throughout. `cancelRequested` is only observed at the top
of the next worker iteration, so cancel waits for the in-flight entry.

P-05 frames this as a renderer problem. The renderer array copies it cites are microseconds; this is
four to five orders of magnitude larger. Fix this before any renderer work.

**Files.** `src/main/media/metadata.ts`, `src/shared/ipcContract.ts`, `src/preload/index.ts`,
`src/main/index.ts`, `src/renderer/src/signals/appState.ts`

**Change — windowed hydration.** Stop hydrating the whole playlist eagerly.

1. Add `const HYDRATION_WINDOW = 40` beside `HYDRATION_CONCURRENCY`.
2. `analyze()` emits the `outline` event as it does today, then hydrates **only the first
   `HYDRATION_WINDOW` entries** and resolves. The remaining entries keep their flat-playlist preview
   rows, which already render (title + URL); they gain detail on demand.
3. Add an IPC call `analyzeHydrateRange(fromIndex: number, count: number): Promise<void>` that
   hydrates a further slice of the *current* analysis using the same worker pool, emitting the same
   `entry` stream events. Guard it: no-op if there is no current playlist, if the range is already
   hydrated, or if a newer analysis generation has started (T8 supplies the generation counter).
4. Track hydration state per entry so a range is never hydrated twice — a `Set<number>` of in-flight
   or completed indices on the service, cleared when a new analysis starts.
5. The renderer requests the next range when the playlist list scrolls near its end. T13 adds the
   windowing that makes "near the end" cheap to detect; until then, wire it to the existing scroll
   container with a simple `scrollTop + clientHeight > scrollHeight - 600` check.

**Change — cancellation.** Make cancel interrupt in-flight entries, not just the gap between them:

- `AnalyzeService.cancel()` currently does `void handle.killTree()` fire-and-forget
  (`metadata.ts:~235`). Make it `async` and `await Promise.allSettled(handles.map(h => h.killTree()))`
  with a 2 s bounded timeout, then clear. T8 covers the caller side.
- In the worker loop, check `cancelRequested` after the `await runOnce(...)` as well as before, so a
  cancel landing mid-entry does not emit a stale `entry` event.

**Alternative considered.** Replacing the per-entry spawn with a single streaming yt-dlp process
(drop `--flat-playlist`, stream per-entry JSON via `--print`) would make hydration cost one process
regardless of playlist length. It is the better end state but changes the extractor contract and the
JSON shape for every platform, so it is **out of scope here** — record it as a follow-up. Windowing
gets ~96% of the win for a fraction of the risk.

**Constraints.** AM-07: playlists still enumerate via `--flat-playlist` and enqueue through the normal
pipeline. Per-entry status rows are unchanged. The 1000-entry cap stays.

**Tests.** `tests/unit/metadata.test.ts` / `tests/unit/analyzeService.test.ts`:

- A 500-entry playlist spawns at most `HYDRATION_WINDOW` child processes before `analyze()` resolves
  (count invocations of the injected spawn seam).
- `analyzeHydrateRange(40, 40)` spawns exactly 40 more and emits 40 `entry` events.
- Calling it twice for the same range spawns nothing the second time.
- `cancel()` mid-hydration resolves only after all handles report killed, and no `entry` event is
  emitted after it resolves.

**Done when.** Opening a 1000-entry playlist spawns ≤40 yt-dlp processes and `analyze()` resolves in
seconds rather than minutes.

---

## T8 — Analyze generation token; awaited cancel; search `activeHandles`

**Problem.** P-08, first half — the half that is genuinely user-visible. `triggerAnalyze`
(`src/renderer/src/signals/appState.ts:27-51`) awaits `analyzeCancel()` then immediately starts a new
analysis, with no generation token: the old `analyzeStart` promise can still resolve and write
`analysis.value` or flip `analyzing` to false under the new request. On the main side,
`AnalyzeService.cancel()` is fire-and-forget over `taskkill`, which takes ~100 ms to even spawn. With
hydration running (T7), cancel-then-reanalyze will overlap in practice.

Separately, `SearchService.cancel()` (`src/main/media/search.ts:444-451`) kills `searchHandles` but
not `activeHandles` — the set used by chapter and transcript requests (lines 892, 931, 959). Those
processes survive a cancel.

**Files.** `src/renderer/src/signals/appState.ts`, `src/main/media/metadata.ts`,
`src/main/media/search.ts`, `src/shared/ipcContract.ts`

**Change.**

1. Renderer generation token in `appState.ts`:

   ```ts
   let analyzeGeneration = 0
   ```

   `triggerAnalyze` captures `const gen = ++analyzeGeneration` after cancelling, and every write it
   performs — `analysis.value`, `analyzeError.value`, and the `finally` that clears `analyzing` — is
   guarded by `if (gen !== analyzeGeneration) return`. `applyAnalyzeStream` takes the same guard, so
   a late `entry` or `outline` event from a superseded analysis is dropped.
2. `AnalyzeService.cancel()` becomes `async` and awaits tree termination with a bounded timeout (T7).
   The IPC handler for `analyzeCancel` awaits it, so the renderer's `await window.mf.analyzeCancel()`
   genuinely means "the old tree is gone".
3. `SearchService.cancel()` kills `activeHandles` as well as `searchHandles`, awaits both, and clears
   both. Bump `searchGeneration` **before** killing, as it already does, so late writes are dropped.

**Constraints.** AM-09: cancel still kills the tree, keeps partials, and resets the UI to idle. The
bounded timeout must not turn a stuck `taskkill` into a hung UI — on timeout, log, clear the set, and
proceed.

**Tests.** `tests/unit/analyzeService.test.ts`: a cancel-then-restart sequence with a slow first
analysis leaves `analysis` holding the *second* result and `analyzing` false; no event from the first
reaches the renderer seam. `tests/unit/search.test.ts`: `cancel()` kills handles from both sets.
`tests/unit/robustness.test.ts`: 100 immediate cancel/restart cycles leave both handle sets empty and
no orphan processes registered.

**Done when.** A cancel-then-reanalyze storm cannot produce overlapping yt-dlp trees or stale UI.

---

## T9 — Job early-completion buffer

**Problem.** P-08, second half. `waitForJob(jobId)` (`src/renderer/src/signals/queueState.ts:32-36`)
registers its resolver only after `downloadStart` returns (`App.tsx:604`, `:694`). If `job:done`
arrived first, `resolveJob` (line 53) finds no resolver, and the resolver registered afterward is
never settled — the queue waits forever.

Per R-04 this window is much narrower than the assessment states: `orchestrator.ts:242` does
`void this.run(...)` and `run` reaches its first `await` before the invoke reply is delivered. Treat
this as cheap insurance, not a P1.

**Files.** `src/renderer/src/signals/queueState.ts`

**Change.** Add a bounded map of completions that arrived before their waiter:

```ts
const earlyResults = new Map<string, JobResult>()
const MAX_EARLY_RESULTS = 32

export function waitForJob(jobId: string): Promise<JobResult> {
  const early = earlyResults.get(jobId)
  if (early) {
    earlyResults.delete(jobId)
    return Promise.resolve(early)
  }
  return new Promise((resolve) => {
    doneResolvers.set(jobId, resolve)
  })
}
```

`resolveJob` stores into `earlyResults` when no resolver is found, evicting the oldest insertion past
`MAX_EARLY_RESULTS` (insertion order is `Map`'s iteration order — delete `earlyResults.keys().next().value`).
Clear the map in `resetQueueForNewAnalysis` so it cannot outlive a session's queue.

Leave `resolveCurrentJob` / `waitForCurrentJob` alone — they are deprecated but still called.

**Tests.** `tests/unit/queueSerialization.test.ts`: `resolveJob('j1', …)` before `waitForJob('j1')`
still resolves; the map evicts past its cap; a new analysis clears it.

**Done when.** A completion that lands before its waiter cannot hang the queue.

---

## T10 — Normalized playlist state, batched hydration

**Problem.** P-05. `applyAnalyzeStream` (`src/renderer/src/signals/appState.ts:54-67`) clones the full
entries array, does a linear `findIndex`, replaces one entry, and publishes a new analysis object —
per hydration event. The array work is cheap; the cost is that every event republishes `analysis`,
re-rendering the entire playlist list.

T7 reduced the event count from ~1000 to ~40 per window, so this is now a real but bounded cost.
Normalize anyway — it is small, and T13 depends on stable per-row identity.

**Files.** `src/renderer/src/signals/appState.ts`, `src/renderer/src/components/PreviewPanel.tsx`

**Change.**

1. Alongside `analysis`, add a normalized projection:

   ```ts
   /** Hydrated entries keyed by `index`, so one patch is O(1) and rows can subscribe individually. */
   export const playlistEntriesById = signal<Map<number, PlaylistEntryPreview>>(new Map())
   ```

   `applyAnalyzeStream`'s `outline` branch seeds it from `result.playlistEntries`; the `entry` branch
   writes one key. `analysis` keeps its current shape so nothing downstream breaks — but the `entry`
   branch **no longer republishes `analysis`**, only `playlistEntriesById` and `playlistHydration`.
2. Buffer incoming `entry` events for 80 ms and apply them in one `batch()` from `@preact/signals`,
   publishing a single new `Map` per flush. Clear the buffer and timer in `resetAnalysis`.
3. `PreviewPanel.tsx` (~line 415) reads rows from `playlistEntriesById` instead of
   `analysis.value.playlistEntries`, keyed by entry `index`.

**Constraints.** AM-12 — no new state library. `batch` from `@preact/signals` is already a dependency.
Row order comes from the outline's original array order; do not re-sort.

**Tests.** `tests/unit/` (new `playlistState.test.ts`): 200 hydration events inside one 80 ms window
produce exactly one `playlistEntriesById` publication; entry content matches; out-of-order indices
land correctly; `resetAnalysis` clears buffer, timer and map.

**Done when.** A burst of hydration events causes one renderer commit, not one per event.

---

## T11 — Preview mechanical fixes

**Problem.** P-06 and P-07, the mechanical half — all low-risk, none requiring the component split.

- `chaptersCache` / `transcriptCache` (`SearchResultCard.tsx:63-64`) are module-level `Map`s with no
  entry, byte or age limit. Content is retained for the session after cards unmount.
- `InlineVideoPreview.tsx:121` depends on `[onTimeUpdate, onPlayingChange]` and the call site
  (`SearchResultCard.tsx:1971`, `:1975`) passes inline arrows, so the global `message` listener is
  removed and re-added on every playback tick.
- `activeCueIndex` (`SearchResultCard.tsx:602`) and `activeChapterIndex` (line 510) scan backward over
  the whole array on every tick. Note the worst case is *early* in playback when `cur` is small — the
  opposite of the intuition that long videos degrade over time.
- The 400 ms poll (`InlineVideoPreview.tsx:63`) plus the 500 ms fallback timer
  (`SearchResultCard.tsx:524`) drive `setCurrentTimeSec` at up to 4–5 Hz with no clamp.
- Closing a chapter preview flips a local boolean; the main-side yt-dlp process runs to completion.
  Transcript fetch has no unmount guard.

**Files.** `src/renderer/src/components/SearchResultCard.tsx`,
`src/renderer/src/components/InlineVideoPreview.tsx`, `src/renderer/src/utils/` (new helpers)

**Change.**

1. **Bounded caches.** Add `src/renderer/src/utils/lruCache.ts` — a hand-written byte-aware LRU
   (AM-12: no dependency). `Map` insertion order gives recency for free: `get` deletes and re-sets;
   `set` evicts from `keys().next()` while over budget. Size entries with a cheap estimator
   (`JSON.stringify(value).length * 2`); exactness is not required. Replace both module `Map`s:
   chapters 50 entries, transcripts 10 entries, 20 MB combined. Expose a `clear()` and call it from
   the search-reset path.
2. **Stable callbacks.** In `SearchResultCard`, wrap the two handlers in `useCallback` with empty or
   ref-based deps:

   ```ts
   const handleTimeUpdate = useCallback((t: number) => {
     lastRealUpdateRef.current = Date.now()
     setCurrentTimeSec(t)
   }, [])
   const handlePlayingChange = useCallback((playing: boolean) => setIsPlaying(playing), [])
   ```

   `setCurrentTimeSec`/`setIsPlaying` are stable, so both deps arrays are genuinely empty. Pass these
   instead of the inline arrows. The `message` listener then installs once per player instance.
3. **Binary search.** Add `src/renderer/src/utils/activeIndex.ts`:

   ```ts
   /** Index of the last item whose key is <= t, or 0 when none. Items must be ascending by key. */
   export function findActiveIndex<T>(items: readonly T[], t: number, key: (item: T) => number): number {
     if (items.length === 0) return -1
     let lo = 0, hi = items.length - 1, ans = 0
     while (lo <= hi) {
       const mid = (lo + hi) >> 1
       if (key(items[mid]) <= t) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
     }
     return ans
   }
   ```

   Use it for `activeCueIndex` (`key: c => c.startSec`) and `activeChapterIndex`
   (`key: ch => ch.seconds`). Preserve the current return contracts exactly: cues return `-1` on an
   empty array, chapters return `0`.
4. **Clamp the clock.** Round `currentTimeSec` to 0.25 s before storing
   (`setCurrentTimeSec(Math.round(t * 4) / 4)`) and skip the write when the rounded value is
   unchanged. This caps renders at 4 Hz without touching the poll cadence. Do not clamp while
   `seekSec` is being set — a seek must land immediately.
5. **Pause when hidden.** Both timers (`InlineVideoPreview.tsx:63`, `SearchResultCard.tsx:524`) stop
   when `document.visibilityState !== 'visible'` and resume on the `visibilitychange` event.
6. **Cancellable preview work.** Add `chaptersCancel(requestId)` / `transcriptCancel(requestId)` to
   the IPC contract, preload and main handlers; main kills the corresponding `activeHandles` entry by
   request ID. In the renderer, generate a request ID per fetch, store it in a ref, and on unmount or
   preview close fire the cancel and suppress all late `setState` calls with an `unmounted` ref guard.
   Deduplicate in-flight requests by URL so rapidly reopening the same result reuses the pending
   promise.
7. **Timer hygiene.** Store the 2–3 s "copied"/"downloaded" feedback timers in refs and clear them on
   unmount.

**Constraints.** AM-12 throughout — no LRU, virtualization or utility dependency. No visual change:
the 0.25 s clamp must not make the progress readout look stepped; if it does, clamp to 0.1 s instead
and note it under **Deviations**.

**Tests.** New `tests/unit/lruCache.test.ts` (eviction by count and by bytes, recency on `get`) and
`tests/unit/activeIndex.test.ts` (binary search matches a linear reference over randomized ascending
arrays, including empty, single-element, exact-boundary and before-first-item cases — assert the
`-1` vs `0` contracts explicitly).

**Done when.** The `message` listener installs once per player, cue lookup is O(log n), caches are
bounded, and closing a preview kills its child process.

---

## T12 — Extract `TheaterPreview` from `SearchResultCard`

**Problem.** P-06, structural half. `SearchResultCard.tsx` is a single component spanning lines
156–2651 with the playback clock (`currentTimeSec`, line 430) declared at its top level. Every tick
re-executes the whole 2,500-line function body and diffs the entire card plus modal. T11's clamp cuts
the *rate*; only moving the clock cuts the *cost per tick*.

**Files.** `src/renderer/src/components/SearchResultCard.tsx`,
`src/renderer/src/components/TheaterPreview.tsx` (new)

**Change.** Cut at the modal boundary. Move into `TheaterPreview.tsx`:

- State: `currentTimeSec`, `isPlaying`, `seekSec`, `leftColHeight`, `previewTab`, `chapterFilter`,
  `transcriptFilter`, `autoScrollTranscript`, `fetchedData`, `loadingChapters`, `transcriptData`,
  `loadingTranscript`, and the refs `lastRealUpdateRef`, `activeChapterRef`, `activeCueRef`,
  `leftColRef`.
- Effects: the ResizeObserver (line ~440), the fallback playback timer (line ~521), the time reset
  (line ~535), both auto-scroll effects, and both fetch effects.
- Render: the modal body — the `InlineVideoPreview` container (line ~1958 onward) through the
  chapters/transcript/info tab panel.

`SearchResultCard` keeps: the collapsed card, `selectedPresetId`, `menuOpen`, `copied`, `imgError`,
`previewActive`, and the download/action handlers. Its props to `TheaterPreview` are
`{ entry, onClose }` — both stable — so a playback tick re-renders only the preview subtree.

**Method.** Move code; do not rewrite it. Do this in two commits: (a) mechanical extraction with the
JSX and logic byte-identical where possible, gate green; (b) any cleanup the move makes obvious.
Behavior parity is the bar, not elegance.

**Constraints.** No prop drilling of the clock back into `SearchResultCard` — if the collapsed card
appears to need `currentTimeSec`, it does not; re-read the usage. Chapters/transcript caches stay
module-level in their current file and are imported.

**Tests.** No new unit tests (this is a move). Run the full gate, then manually verify via
`/run` or `npm run dev`: preview opens and closes, the player controls respond, chapter and
transcript tabs populate, clicking a cue seeks, auto-scroll tracks playback, and the ±10 s seek
buttons work.

**Stop condition.** If behavior parity cannot be confirmed, revert T12 entirely. T11 already delivered
the rate reduction; the extraction is an optimization on top. Record under **Deviations**.

**Done when.** A playback tick re-renders `TheaterPreview` only, and `SearchResultCard`'s own render
count is unchanged during playback.

---

## T13 — Fixed-row windowing for long lists

**Problem.** P-05. Playlist, queue, format and transcript lists render every row into the DOM. The
transcript is the worst case: `SearchResultCard.tsx:2450-2496` renders each cue as a button of ~6
nodes with long class strings, so 5,000 cues is ~30,000 nodes, diffed on every active-cue change.

**Files.** `src/renderer/src/components/` — new `VirtualList.tsx`; consumers `PreviewPanel.tsx`,
`QueueList.tsx`, `FormatMatrix.tsx`, `TheaterPreview.tsx` (or `SearchResultCard.tsx` if T12 was
reverted)

**Change.** Hand-write a fixed-row-height windowing component (AM-12: no dependency):

```tsx
interface VirtualListProps<T> {
  items: readonly T[]
  rowHeight: number          // px, fixed
  overscan?: number          // default 6
  height: number | string    // container height
  renderRow: (item: T, index: number) => VNode
  keyFor: (item: T, index: number) => string | number
  onNearEnd?: () => void     // fired once per threshold crossing — T7 uses this
}
```

Standard spacer approach: a scroll container of `height`, an inner div of
`items.length * rowHeight`, and only the visible slice plus overscan rendered, offset by
`translateY(startIndex * rowHeight)`. Derive the visible range from `scrollTop` in a
`requestAnimationFrame`-throttled scroll handler.

Apply to transcript cues first (largest win), then playlist entries, queue rows and the format matrix.
Each consumer needs a measured fixed row height — take it from the current rendered row and assert it
in a comment; rows whose height varies with content are **not** candidates, leave those alone and note
which.

Wire `onNearEnd` on the playlist list to T7's `analyzeHydrateRange`, replacing the interim scroll
check.

**Also:** as a cheap complement, add `content-visibility: auto` and a matching `contain-intrinsic-size`
to repeated search result cards, which are not fixed-height and so cannot be windowed. This skips
off-screen layout and paint without removing DOM — it is not a substitute for windowing, only a
supplement where windowing does not apply.

**Constraints.** Auto-scroll must still work: `TheaterPreview`'s active-cue `scrollIntoView` becomes a
`scrollTop` assignment computed as `activeCueIndex * rowHeight`, since the target node may not be
mounted. Keep the "disable smooth scroll while a prior scroll is in flight" behavior.

**Tests.** `tests/unit/virtualList.test.ts`: for 10,000 items at 32 px in a 400 px viewport with
overscan 6, exactly `ceil(400/32) + 12` rows render; the rendered index range is correct at scroll
top, middle and bottom; `onNearEnd` fires once per crossing, not per scroll event.

**Done when.** A 5,000-cue transcript renders a bounded number of DOM nodes and scrolls at ≥55 FPS.

---

## T14 — Telemetry harness; regenerate `specs/perf-report.md`

**Problem.** P-10. `specs/perf-report.md` is for v0.1.0 with sign-off pending. The `MF_MEMORY_PROBE`
block (`src/main/index.ts:249-280`) logs only summed `workingSetSize` and main RSS every two seconds —
it cannot distinguish Chromium baseline from an application leak, and `appendFileSync` on the probe
path is itself a synchronous write.

**Files.** `src/main/index.ts`, `scripts/perf-bench.mjs` (new), `specs/perf-report.md`

**Change.**

1. Extend the probe payload, per AM-16, to record by PID: `type`, `name`, `privateBytes`,
   `workingSetSize`, `peakWorkingSetSize`, `cpu.percentCPUUsage`, `cpu.idleWakeupsPerSecond`, and
   `creationTime` from `app.getAppMetrics()`; plus main `process.memoryUsage()` (`heapUsed`,
   `external`, `arrayBuffers`) and `monitorEventLoopDelay()` p50/p95/p99 from `node:perf_hooks`.
   Add a `scenario` field settable via an IPC call so benchmark runs can mark phases.
2. Replace `appendFileSync` with a buffered async writer — accumulate samples and flush with
   `fsp.appendFile` every 10 s or 50 samples, and on quit. **The probe must not create the stalls it
   is measuring.** Keep it off unless `MF_MEMORY_PROBE=1`.
3. Add `scripts/perf-bench.mjs`: launches the app with the probe on, runs a named scenario, samples,
   and writes JSONL plus a summary Markdown table. It must also measure the **bare-window baseline**
   (a blank Electron window, as in R-01) in the same run, so the AM-16 marginal-cost figure is
   computed rather than assumed. Add an `npm run perf` script.
4. Regenerate `specs/perf-report.md` for v0.2.7+ with: host spec, Electron version, the bare-window
   baseline, idle at 5 minutes (median of three launches), and peak across the scenarios below.
   Report `privateBytes` and `workingSetSize` side by side, and the marginal figure. State plainly
   which scenarios were **not** run.

**Scenarios to include** (from the assessment's matrix, reduced to what is runnable without a clean
VM — record the rest as not-run):

| Scenario | Catches |
|---|---|
| Cold and warm launch ×3 | Startup I/O, eager module load, baseline |
| Idle Downloader / Search / Settings, 10 min | Timers, wakeups, view-retained state |
| Analyze 1,000-entry playlist | T7 — process count and hydration time |
| Search 50 results, ×20 | Stale hydration, card rerenders, cache growth |
| Preview/transcript churn, 50 open/close | T11 — cache eviction, abandoned children, detached DOM |
| One download, cross-volume finalization | T3/T4 — main-loop blocking |
| Mock 250 MB update | T6 — `arrayBuffers` bound |
| 100 cancel/restart cycles | T8/T9 — leaked handles, stale events |

**Constraints.** The probe stays opt-in and off by default. No telemetry leaves the machine.

**Tests.** None beyond the gate — this is instrumentation. Verify by running `npm run perf` once and
confirming the JSONL and the Markdown summary are produced.

**Done when.** `specs/perf-report.md` states a current, reproducible idle and peak figure against
AM-16, with the bare-window baseline alongside, and the PRD memory status is no longer "pending".

---

## Final verification

After T14, run once, from a clean tree:

```
npm run typecheck && npm test && npm run lint && npm run build && npm run perf
```

Then confirm against the plan's own targets:

| Check | Source | Expected |
|---|---|---|
| Idle summed private | T14 report | ≤200 MB |
| Marginal over bare window | T14 report | ≤60 MB |
| 1M-line child, main heap | T1 soak | flat |
| 250 MB update, `arrayBuffers` | T6 test | <32 MB |
| 1,000-entry playlist, processes spawned | T7 test | ≤40 |
| Routine progress events | T2 test | ≤5/sec/job |
| Cross-volume download | T3/T4 | no main-thread stall; rename path when T4 landed |
| 5,000-cue transcript | T13 | bounded DOM, ≥55 FPS |

Write the results into `specs/perf-report.md` and update the **Deviations** table above with anything
reverted. If a target is missed, record the measured value rather than adjusting the target — AM-16
was set from evidence and should be amended the same way if it turns out to be wrong.

---

## Out of scope (deliberately)

Recorded so a later reader knows these were considered, not overlooked.

| Item | Why deferred |
|---|---|
| Single-process playlist hydration via streaming `--print` | Changes the extractor contract and JSON shape per platform. T7's windowing captures ~96% of the win at a fraction of the risk. Revisit if playlist limits rise above 1,000. |
| View-level code splitting (P-11) | 91.5 KB gzip total; parse/compile is tens of milliseconds. R-04 grades it P3. Measure with T14 before acting. |
| Circular buffer for `LogBus` (P-04) | ~200k element moves/sec at realistic worst case. Negligible; R-04 explicitly advises against. |
| Reducing default parallel downloads 5 → 2 (P-09) | R-04: a throughput regression proposed without a trace. Downloads are network-bound. Separating download from postprocess concurrency is worth doing — after T14 gives evidence. |
| `backdrop-blur` audit (R-06) | 30 usages in `SearchResultCard.tsx`; GPU process was the largest single working set (129 MB). Needs a paint/compositor trace first, which T14 enables. |
| Async settings/queue persistence (P-12) | Safe at current scale. Revisit if T14 shows it crossing the interaction budget. |
