# MediaForge Desktop Performance and Memory Risk Assessment

## Executive summary

MediaForge has a sound lightweight foundation: Preact and Signals are the only renderer runtime
dependencies, yt-dlp and FFmpeg run as separate child processes, the renderer is sandboxed, and
production JavaScript is under 0.5 MB uncompressed. The application is not presently suffering
from framework bloat. Its main performance risks come from data lifetime, event frequency, and
doing potentially large filesystem work on Electron's main thread.

The current risk level is **medium-high**, with three issues that should be treated as release
blockers before substantially larger playlists, longer live recordings, or more updater usage:

1. **Child-process output is retained without a bound.** Every stdout and stderr line is held by
   `LineBuffer` until the process exits, and download callers retain additional copies. A long live
   recording can therefore grow the main process for the entire recording.
2. **Large final-file and updater operations are synchronous in the main process.** A cross-volume
   copy of a multi-gigabyte video, recursive cleanup, or writing a 100–150 MB update can block the
   process Electron uses for windows, native events, and IPC. Electron explicitly recommends
   asynchronous I/O in the main process.[^1]
3. **Renderer work scales poorly for large collections and transcripts.** Playlist hydration
   copies and searches the complete entries array for every hydrated item; playlist, queue, format,
   search, and transcript lists are not virtualized; playback updates can re-render a 2,651-line
   result-card component every 400–500 ms.

The binding 120 MB idle target is not currently demonstrated. In a local v0.2.7 production-renderer
launch, the four Electron processes used **184.7 MB total private memory** and **356.5 MB summed
working set** after settling. This is a provisional measurement rather than a clean-VM packaged
result, but it misses the private-memory target by 64.7 MB (54%). The existing v0.1.0 performance
report records only summed working set, which can double-count shared pages; Electron exposes
`privateBytes` on Windows specifically for memory not shared with other processes.[^2]

The recommended order is: install trustworthy telemetry; bound process output; make file and update
I/O streaming/asynchronous; coalesce progress and log events; then virtualize and split the rich
search/preview UI. Those changes address the credible leaks and freezes before lower-return bundle
micro-optimizations.

## Scope and method

This assessment covers Electron main/preload/renderer code at tag `v0.2.7` (`cbf380e`), the current
performance report and PRD constraints, a production build, the automated test baseline, and two
short idle launches on Windows 11. It focuses on user-perceived responsiveness, Electron memory,
child-process lifecycle, large-file operations, IPC volume, and growth over repeated workflows.

Evidence includes:

- Static review of all main-process synchronous filesystem calls, process output capture, IPC event
  paths, global caches, timers/listeners, list rendering, and queue/search orchestration.
- `npm run build`: successful. Output was 497.7 KB JavaScript (91.6 KB gzip) and 147.9 KB CSS
  (19.8 KB gzip) for the renderer, plus 140.2 KB main and 6.2 KB preload bundles.
- `npm test -- --reporter=dot`: 241 tests passed and one network E2E test was skipped. Windows
  process-tree tests require an unrestricted run because sandboxed `taskkill` is denied; they passed
  when rerun in the normal host environment.
- Idle process samples from the existing `MF_MEMORY_PROBE` and Windows `Get-Process`. The production
  sample used built local assets without Vite/HMR, but was not an installed NSIS package or clean VM.
- Current official Electron, Chromium DevTools, Node.js, Preact, web-platform, and yt-dlp guidance.

No representative 4K download, hours-long live recording, giant playlist, updater download, or
low-end clean-VM trace was run. Consequently, code-proven growth mechanisms are identified as
confirmed risks, while peak sizes and jank durations remain to be measured by the proposed harness.

## Baseline

### Current local measurements

| Measurement | Result | Interpretation |
|---|---:|---|
| Production renderer, Electron process count | 4 | Browser, GPU, Utility, Tab |
| Production renderer, summed working set | 356.5 MB | Shared pages can be counted in more than one process |
| Production renderer, summed private memory | **184.7 MB** | Best available local Windows total; provisional fail against 120 MB |
| Working-set breakdown | Browser 96.7; GPU 131.5; Utility 46.3; Tab 82.0 MB | GPU is the largest working set, but working set is not ownership |
| Dev/HMR, summed working set | 400.8 MB | Expected to exceed production |
| Dev/HMR, summed private memory | 226.3 MB | Useful only as a development regression baseline |
| Renderer JS | 497.7 KB raw; 91.6 KB gzip | Modest; not the primary memory cause |
| Renderer CSS | 147.9 KB raw; 19.8 KB gzip | Modest; review visual effects only when traces implicate paint/GPU |
| Automated tests | 241 pass; 1 skipped | Functional baseline is healthy |

Electron's `app.getAppMetrics()` returns per-process CPU and memory, and each call resets the CPU
measurement interval.[^3] The current harness records only `workingSetSize`; it should record
`privateBytes`, peak working set, CPU, idle wakeups, PID, process creation time, service name, and
main/renderer heap data. Working set is still useful for system pressure, but private memory should
be the primary value for the PRD's Electron-only ownership budget.

### What is already done well

- Only Preact and Signals ship as renderer runtime dependencies.
- Main-to-renderer APIs are asynchronous; no `sendSync` or `@electron/remote` usage was found.
- Active jobs and process handles are stored in maps/sets and normally deleted in `finally` or
  completion paths.
- Preload event APIs return unsubscribe functions, and `App` uses them on unmount.
- Main and renderer live-log histories are capped at 2,000 and 1,500 records respectively.
- Search result count is clamped to 50 and hydration concurrency is bounded to two.
- Thumbnail images use lazy loading in repeated result/playlist cards.
- Transcript temporary directories are removed in `finally`.
- The renderer is production-bundled, matching Electron's performance recommendation.[^1]

These controls prevent several common leaks. They do not offset the unbounded process output,
unbounded content caches, or high-cost update/finalization paths described below.

## Prioritized findings

| ID | Priority | Finding | Likely symptom | Confidence |
|---|---|---|---|---|
| P-01 | P0 | Unbounded and duplicated child stdout/stderr retention | Main memory grows throughout long jobs; GC pauses | Confirmed in code |
| P-02 | P0 | Synchronous large-file finalization and cleanup in Electron main | Whole-app freezes after download or while clearing partials | Confirmed in code |
| P-03 | P0 | Updaters buffer complete assets and synchronously write/copy them | 100–300+ MB transient main memory; frozen update UI | Confirmed in code |
| P-04 | P1 | Progress/log IPC is unthrottled and duplicates each progress line | High CPU, allocation churn, stuttering with parallel jobs | Confirmed mechanism; magnitude unmeasured |
| P-05 | P1 | Playlist hydration is O(N²)-like and long lists are not virtualized | Large playlists progressively slow or lock the renderer | Confirmed in code |
| P-06 | P1 | Preview playback invalidates a very large component and full transcript DOM | Preview/transcript jank, high CPU, growing DOM memory | Confirmed in code |
| P-07 | P1 | Transcript/chapter caches are unbounded; closed previews do not cancel all work | Session memory rises after many previews; orphan work continues | Confirmed in code |
| P-08 | P1 | Cancellation and completion have race windows | Overlapping processes, stale UI, unresolved job promises | Confirmed design risk |
| P-09 | P1 | Parallel mode has no resource-aware postprocess control | Five FFmpeg jobs can starve UI, disk, and battery | Confirmed design risk |
| P-10 | P1 | Current telemetry cannot prove the PRD budgets or isolate regressions | Performance failures reach users undetected | Confirmed gap |
| P-11 | P2 | Entire feature set is loaded in one renderer chunk | Unnecessary startup parse/compile and retained code | Confirmed; current bundle is modest |
| P-12 | P2 | Smaller synchronous I/O and linear/copying collections accumulate | Short stalls and needless GC under scale | Confirmed; lower individual impact |

## Detailed analysis and mitigations

### P-01 — Unbounded process output retention

`src/main/binaries/runner.ts:27-55` stores every decoded line in `LineBuffer.lines`; the returned
`RunResult` always owns both complete arrays. Download execution then creates `stdoutLines`,
`stderrLines`, and `allStdoutLines` in `src/main/jobs/orchestrator.ts:274-295`, duplicating stdout
already retained by the runner. Analyze and search paths repeat the caller-side arrays
(`src/main/media/metadata.ts:295-325` and `src/main/media/search.ts:496-535`).

For a finite metadata command this is bounded by the response. For a live recording, the process can
run for hours. Progress output remains reachable through the unresolved result promise for the
entire process lifetime, so memory grows linearly even though the UI only needs the latest progress,
the final moved path, and a short error tail. This is a true unbounded-retention defect, not merely
Chromium baseline overhead.

Mitigation:

1. Change `SpawnOptions` to make capture explicit: no capture, bounded byte capture, or a fixed-size
   line tail. Default to a conservative bounded tail rather than complete history.
2. For downloads, parse lines as they arrive, store only `finalPath`, the latest event, and the last
   40–100 stderr lines. Do not retain stdout arrays at all.
3. For version probes and chapter output, impose both a byte ceiling and maximum line length.
4. For metadata JSON, enforce a documented maximum payload and playlist-entry limit. Longer-term,
   prefer an incremental per-entry protocol rather than one whole-playlist `-J` object.
5. Add a synthetic soak test whose child emits at least 100 MB/one million lines. Assert that main
   private memory reaches a plateau and the final-path/error behavior remains correct.

Node streams are designed to keep producers and consumers from overwhelming memory through
backpressure; storing every decoded line defeats that property.[^4]

### P-02 — Main-process blocking during finalization

`src/main/jobs/orchestrator.ts:398-415` first attempts `renameSync`. When source and destination are
on different volumes, it falls back to `copyFileSync`, then `unlinkSync`. A large 4K/8K file copied
from the user-data temp drive to another drive can block the main event loop for seconds or minutes.
The same module uses recursive `rmSync` after success. `src/main/fsops/partials.ts` recursively walks,
stats, and removes partial trees synchronously from IPC handlers. `src/main/fsops/tempSweep.ts` also
removes trees synchronously during startup.

Electron states that its main process handles windows, native interactions, and inter-component
communication and should not perform blocking I/O.[^1] Node confirms that synchronous filesystem
APIs block the event loop, while promise APIs run filesystem operations via the thread pool.[^5]

Mitigation:

- Convert finalization to `fs.promises.rename`; on `EXDEV`, use asynchronous copy followed by size
  verification and asynchronous unlink. A stream-based copy can additionally expose finalization
  progress and cancellation.
- Convert recursive cleanup, partial enumeration, collision scans, manifest reads/writes, and the
  startup sweep to asynchronous APIs. Startup cleanup should begin after the first window is shown
  or run in a utility process if directories can be very large.
- Preserve AM-06 ordering: verify non-zero destination before deleting source/temp files.
- Serialize writes per destination manifest and keep atomic temp-file replacement.
- Add a cross-volume test with a sparse/large fixture and a main-loop-delay assertion. The UI should
  continue receiving a 100 ms heartbeat during copy and cleanup.

### P-03 — Update paths create large transient memory spikes

`downloadBuffer` calls `response.arrayBuffer()` and returns a complete `Buffer`
(`src/main/binaries/updater.ts:101-106`). The FFmpeg updater downloads the full archive, retains it
for hashing, writes it synchronously, then reads complete extracted executables back into memory and
writes them again (`src/main/binaries/ffmpegUpdater.ts:162-215`). The app updater similarly holds the
complete NSIS installer and synchronously writes it (`src/main/app/appUpdater.ts:143-161`).

This path can temporarily retain an FFmpeg archive or roughly 150 MB installer in the Electron main
process, plus fetch and filesystem buffers. It is a credible route past the 450 MB Electron peak
budget even though normal downloads keep media bytes in external processes.

Mitigation:

- Stream HTTP response bodies directly to a uniquely named temp file.
- Update SHA-256 incrementally while streaming, compare only after the stream closes, then atomically
  rename. Node's hash object is a transform stream; its documentation recommends one-shot hashing
  only for small, already-available data.[^6]
- Enforce `Content-Length` and streamed-byte caps appropriate to each asset; abort on overflow or
  missing/truncated data.
- Use asynchronous `copyFile`/`rename` for extracted executables. Never `readFileSync` a 100 MB
  binary merely to write it elsewhere.
- Delete failed temp files asynchronously and keep verified backups under the existing rollback
  contract.
- Test update memory with an artificial 250 MB response and assert bounded main `arrayBuffers` and
  private bytes.

### P-04 — Progress and log amplification

Every yt-dlp stdout line can take two IPC routes: parsed `JobEvent` and raw `MF_LOG_LINE`. The main
log bus retains it, sends it to every window, and the renderer batches it into another history.
`applyJobEvent` also creates a new job-event record on every progress line. The download arguments do
not set `--progress-delta`; yt-dlp's documented default is zero seconds.[^7] With up to five parallel
jobs, this can produce unnecessary structured-clone work, signal updates, VDOM work, and garbage.

The renderer log history is capped, which prevents unlimited growth, but it still allocates merged
arrays every 250 ms while the console is closed. After the main log reaches 2,000 entries, every new
entry uses a front splice, shifting the retained array.

Mitigation:

- Add `--progress-delta 0.2` or `0.25` so each job reports at most 4–5 routine progress updates per
  second. Always preserve phase changes, completion, warnings, and errors immediately.
- Coalesce progress by `jobId` in main and send only the latest sample on a 100–200 ms cadence.
- Exclude machine `MF|` records from the human console by default; expose a diagnostic opt-in.
- Notify main when the console opens. While closed, retain only a circular error/status tail and do
  not stream every raw line to the renderer.
- Replace front-splicing arrays with a fixed circular buffer.
- Track IPC messages/second, bytes/second, and renderer commits/second in performance builds.

Electron IPC uses structured cloning, so event rate and payload size both matter.[^8] A MessagePort
can support explicit streaming when warranted, but coalescing the tiny progress state is simpler and
should be attempted first.[^9]

### P-05 — Collection updates and full-list rendering

For each playlist hydration event, `src/renderer/src/signals/appState.ts:54-67` clones the full
entries array, performs a linear `findIndex`, replaces one entry, and publishes a new analysis
object. The visible playlist then maps every entry into DOM (`PreviewPanel.tsx:415+`). This produces
roughly quadratic update work as playlist size grows. Queue and format lists also render every row.

Search is capped at 50, but each hydration maps the entire result array
(`src/shared/searchHydration.ts:5-18`) and re-renders all `SearchResultCard` children because they are
not memoized and receive new inline callback props. The individual card is 2,651 lines with 14 state
hooks, 11 effects, and 23 memoized computations, making each unnecessary render expensive.

Mitigation:

- Normalize playlist state as `order: string[]` plus `byId/byIndex`, so one hydration patch is O(1).
- Batch incoming hydration patches for 50–100 ms and commit them with Signals `batch()`. Preact
  documents batching as a way to combine several signal writes into one commit.[^10]
- Hand-build fixed-row windowing for playlist, queue, format, and transcript lists to preserve the
  no-runtime-UI-library constraint. Render a small overscan region and spacer heights.
- As an immediate low-risk bridge, apply `content-visibility: auto` and
  `contain-intrinsic-size` to repeated cards/rows. This can skip off-screen layout and paint, but it
  does not remove their DOM or JavaScript memory, so it is not a replacement for virtualization.[^11]
- Memoize result-card shell components and provide stable callbacks with `useCallback`, or have each
  row subscribe to only its own normalized record. Preact notes that stable callback identity is
  useful when children skip updates by referential equality.[^12]
- Cap or paginate playlist metadata presented in one renderer view even if the queue can contain
  more items.

### P-06 — Preview and transcript rerender pressure

The active search preview updates `currentTimeSec` from iframe messages and a 500 ms fallback timer.
That state belongs to the full `SearchResultCard`, so a playback tick can re-execute the entire giant
component and diff a large modal. The preview passes inline callbacks to `InlineVideoPreview`; its
message-listener effect depends on those callback identities (`InlineVideoPreview.tsx:69-121`), so
the listener may be removed and re-added after every parent render.

When the transcript tab is open, every cue is rendered as a button
(`SearchResultCard.tsx:2450-2496`). Active-cue selection scans backward through all cues on each time
update. Long videos can have thousands of cues, multiplying JavaScript, DOM, style, layout, and
smooth-scroll work. Chrome treats tasks over 50 ms as long tasks that block interaction.[^13]

Mitigation:

- Extract the theater/modal player into focused components. Keep the high-frequency clock in the
  smallest subtree possible.
- Use stable `useCallback` handlers or refs so the global `message` listener is installed once per
  player instance.
- Clamp UI time updates to 4 Hz unless the user is scrubbing. Render progress through direct signal
  bindings where appropriate; Preact can update signal values in DOM text/props without a full VDOM
  rerender.[^10]
- Use binary search for the active cue/chapter and update only when the active index changes.
- Virtualize transcript cues, disable smooth auto-scroll while a prior scroll is active, and pause
  polling when the document/player is hidden or paused.
- Measure preview open/close, seek, chapter change, and transcript filtering in the DevTools
  Performance panel. Chromium's tooling exposes FPS, scripting/rendering/paint work, and long tasks.[^14]

### P-07 — Unbounded caches and abandoned preview work

`chaptersCache` and `transcriptCache` are module-level maps with no entry, byte, or age limit
(`SearchResultCard.tsx:64-65`). Repeated searches and previews retain descriptions and complete cue
arrays after cards unmount. This is an actual session-lifetime cache leak: retained content has no
eviction path.

Closing a chapter preview only flips a local cancellation boolean; the main yt-dlp process continues
until completion/timeout. Transcript fetch has no unmount guard and no cancellation request. The
main `SearchService.cancel()` kills `searchHandles` but not the separate `activeHandles` used by
chapter and transcript requests. Rapidly opening different results can therefore overlap several
yt-dlp subtitle processes and retain their component closures temporarily.

Mitigation:

- Replace both maps with byte-aware LRU caches. A reasonable starting policy is 50 chapter entries,
  10 transcript entries, and a combined 20 MB cap, then tune from traces.
- Clear result-associated caches on explicit search reset and expose a cache-clear action in
  Diagnostics if previews remain a major feature.
- Deduplicate in-flight requests by URL and place preview metadata work behind a small central
  semaphore (one or two processes).
- Add request IDs and cancel IPC for chapters/transcripts. On close/unmount, kill the corresponding
  process tree and suppress all late writes.
- Store timers in refs and clear the 2–3 second feedback timers on unmount. These timers are not a
  long-term leak, but they retain component closures unnecessarily.
- Verify with heap-snapshot comparisons after 50 open/close cycles. Chrome heap snapshots identify
  retained arrays, strings, and detached DOM trees; allocation timelines reveal monotonic growth.[^15]

### P-08 — Cancellation and completion races

`AnalyzeService.cancel()` and `SearchService.cancel()` call `killTree()` without awaiting it, clear
their sets, and allow replacement work to start. A rapid cancel/restart can overlap old and new
processes. Renderer analysis has no request-generation token, so an older invoke can set
`analyzing=false` or deliver an entry event after a newer analysis starts.

The queue registers `waitForJob(jobId)` only after `downloadStart` returns. Existing-download
completion is explicitly deferred because of this race, but normal very-fast failures/completions
are not governed by a general handshake. If `job:done` arrives first, `resolveJob` finds no resolver;
the subsequently inserted resolver can remain forever and the queue waits indefinitely.

Mitigation:

- Make cancel asynchronous and await both tree termination and process `close`, with a bounded
  timeout and forced fallback.
- Add `analysisId`, `searchId`, and client-generated `jobId`/request ID to all request and event
  payloads. Ignore stale generations in both main and renderer.
- Establish job state before execution begins: either send a client-generated ID with the start
  request or have main return the ID before scheduling the process on the next event-loop turn.
- Store early completions in a bounded completed-result map so a waiter registered slightly later
  still resolves.
- Add race tests for immediate spawn error, immediate success, cancel-then-start, repeated search,
  destroyed sender, and failed `taskkill`.

### P-09 — Resource oversubscription in parallel mode

The orchestrator permits up to five concurrent jobs. A job can include network download and FFmpeg
postprocessing, so five jobs can compete for CPU, disk bandwidth, memory bandwidth, and thermal
headroom while the renderer is trying to animate progress. The cap prevents unlimited process
growth, but it is not a responsiveness policy.

Mitigation:

- Default parallel downloads to two on Windows; treat higher values as an advanced override.
- Separate download concurrency from postprocess concurrency. Keep at most one CPU-heavy transcode
  active by default, or two lightweight remuxes after measurement.
- Delay launching additional work when main event-loop p99, renderer long-task rate, or system
  memory pressure breaches a guardrail.
- Use Electron's battery and speed-limit signals to reduce optional concurrency on battery or when
  the OS is thermally throttling.[^16]
- Report external yt-dlp/FFmpeg RSS and CPU separately, as AM-10 requires, and also report total
  user-visible process-tree consumption.

### P-10 — Measurement gaps

`specs/perf-report.md` is for v0.1.0 and labels idle/peak sign-off as pending. The runtime probe logs
summed working set and main RSS every two seconds, but not private memory, heap, external buffers,
CPU, event-loop latency, renderer DOM/Blink memory, child CLI resources, or scenario markers. It
cannot distinguish Chromium baseline from a JavaScript leak or connect a spike to a workflow.

Mitigation:

- Record `app.getAppMetrics()` fields by PID and creation time: type/name, private bytes, working and
  peak working set, CPU, and idle wakeups.
- Record main `process.memoryUsage()` including `heapUsed`, `external`, and `arrayBuffers`, plus
  `monitorEventLoopDelay()` p50/p95/p99. Node provides an event-loop-delay histogram for precisely
  this purpose.[^17]
- In a performance-only renderer bridge, collect Electron process memory, V8 heap statistics, and
  Blink allocated/total values. Electron exposes all three after app ready.[^18]
- Capture user-timing marks for startup, analyze, first result, preview open, queue launch,
  finalization, and updater phases. Chromium can display custom marks alongside its performance
  trace.[^19]
- Add opt-in `contentTracing` scenarios for cross-process CPU/render analysis; Electron supports
  Chromium tracing and, in Electron 43+, experimental memory-infra heap profiling.[^20]
- Use `webContents.takeHeapSnapshot()` at controlled checkpoints for automated leak triage.[^21]
- Keep probes disabled by default and write asynchronously in batches so measurement does not
  create the very stalls being measured.

### P-11 — Single startup chunk

`App.tsx` statically imports Search, Settings, Queue, preview, diagnostics, and updater UI. The 497.7
KB renderer chunk is not alarming, but `SearchResultCard.tsx` alone is 136.8 KB of source and is
irrelevant to the first Downloader screen. As the app continues to grow, a single chunk will increase
cold-start parsing, compilation, and baseline retained code.

Mitigation:

- Dynamically import view-level features: Search, Settings, diagnostics/log console, and theater
  preview. Preload Search shortly after first paint or when the user hovers its navigation item.
- Keep the first screen, title bar, signals, and shared lightweight controls in the initial chunk.
- Add bundle-size budgets in CI: initial renderer JavaScript under 250 KB raw as a starting target,
  no single lazy chunk over 200 KB raw, and explicit approval for regression.
- Do not add a heavyweight router or virtualization dependency merely to split code; native dynamic
  imports and a small fixed-row window are sufficient.

### P-12 — Lower-severity allocation and I/O costs

Several smaller patterns are safe at today's scale but will add friction as data grows:

- Settings read/parse and atomic write are synchronous; queue persistence can serialize a large
  snapshot after repeated row changes.
- Collision detection reads every destination filename into a lowercase set for every completed
  job. Large shared download folders make this increasingly expensive.
- Log writing uses `appendFileSync`; currently app-level messages are sparse, but this must never be
  placed on the raw CLI hot path.
- Queue row patches map the full array; progress is stored separately, which is good, but very large
  queues still make status transitions O(N).
- Repeated state writes are not grouped with Signals `batch()`.

Use async settings/manifest persistence with serialized write queues, an in-memory destination-name
index scoped to a batch, normalized queue state, and batched signal commits. These are P2 until
profiles or very large playlists show them crossing the interaction budget.

## Performance budget and acceptance gates

The following budget turns “buttery smooth” into testable release criteria. The memory ceilings from
AM-10 remain binding; the other values are recommended engineering gates and should be calibrated on
a representative low-end Windows device.

| Area | Proposed gate |
|---|---|
| Idle Electron private memory | ≤120 MB after 5 minutes, packaged build, median of three clean launches |
| Peak Electron private memory | ≤450 MB during each defined workload, including updates but excluding CLI children per AM-10 |
| Total process-tree memory | Report Electron + yt-dlp + FFmpeg peak; set warning baseline after first full run |
| Leak slope | After GC/settling, ≤10 MB retained growth after 20 repeated workflow cycles; no monotonic growth across three batches |
| Main event-loop delay | p95 ≤20 ms; p99 ≤50 ms; no single filesystem-induced stall >100 ms |
| Renderer long tasks | Zero tasks >100 ms and fewer than one >50 ms per minute during steady progress/preview |
| Animation/scroll | ≥55 FPS p95 during active progress and list scrolling on the reference machine |
| Progress IPC | ≤5 routine updates/sec/job; terminal and error events immediate |
| Idle CPU | <1% average across Electron processes after settling, with no continuous wakeup regression |
| Warm startup | Ready-to-show ≤1.5 s on the reference machine |
| Cold startup | Ready-to-show ≤2.5 s on the reference machine after reboot/cache-clear protocol |
| Initial renderer JS | ≤250 KB raw target after view-level splitting; track raw and parsed cost |

Working-set and private-memory numbers answer different questions and should both be reported. A hard
120 MB total for a modern four-process Electron application may prove unrealistic on some Windows
builds. Do not silently change it: first measure a signed packaged build on clean Win10/Win11 VMs,
then either meet it or amend the product requirement with an evidence-backed private-memory budget.

## Required benchmark matrix

Run each scenario on at least a low-end 4-core/8 GB Windows machine and a mainstream development
machine. Use the packaged NSIS build, production assets, default settings, and three repetitions.

| Scenario | Duration/repetition | What it catches |
|---|---|---|
| Cold and warm launch | 3 each | Startup I/O, eager module load, baseline memory |
| Idle Downloader/Search/Settings | 10 min each | Timers, animations, background wakeups, view-retained state |
| Analyze one large-format video | 20 cycles | JSON allocations, stale requests, format-list DOM |
| Analyze 1,000-entry playlist | Full hydration | O(N²) updates, event flood, list rendering, thumbnail pressure |
| Search 50 results | 20 searches | Stale hydration, card rerenders, image/cache growth |
| Preview/transcript churn | Open/close 50 results; load 20 transcripts | cache eviction, abandoned children, detached DOM, listener cleanup |
| Long transcript playback | 30 min | per-tick rendering, cue lookup, auto-scroll, animation CPU |
| Long live recording | 2 hours | unbounded stdout retention, log growth, stable progress CPU |
| Parallel downloads | 2, 3, and 5 jobs | IPC scaling, process-tree RSS, disk/network/CPU contention |
| Cross-volume finalization | ≥10 GB fixture to slow drive | main-thread blocking, copy progress, cancel semantics |
| FFmpeg/app update | Realistic 150–250 MB mock assets | streaming behavior, `arrayBuffers`, checksum and disk I/O |
| Cancel/retry storm | 100 immediate cancel/restart cycles | leaked handles, process overlap, stale events, unresolved promises |

For leak scenarios, take a baseline heap snapshot, execute a fixed batch, force GC through the
profiling environment, settle for 30 seconds, and take a comparison snapshot. Repeat the batch twice.
A one-time cache warm-up is acceptable; continued retained growth is not. Chrome DevTools distinguishes
leaks, bloat, and frequent garbage collection and provides heap snapshots, allocation timelines, and
detached-element analysis.[^15]

## Implementation roadmap

### Phase 0 — Make regressions visible

Estimated effort: 2–4 engineering days.

- Replace the current memory sample shape with per-process private/working/peak memory, CPU, heap,
  external buffers, event-loop delay, CLI process metrics, and scenario markers.
- Add a repeatable packaged-build benchmark script and write JSONL plus a summarized Markdown table.
- Establish the low-end Windows reference device and commit baseline artifacts.
- Add CI checks for bundle size and unit-level memory bounds; keep long soak tests scheduled/manual.

Exit gate: packaged clean-VM idle, one download, and one preview trace are reproducible and the PRD
memory status is no longer “pending.”

### Phase 1 — Remove release-blocking growth and freezes

Estimated effort: 4–7 engineering days.

- Redesign `spawnProcess` capture policy and eliminate duplicate line arrays.
- Make final move/copy/cleanup asynchronous and add finalization progress.
- Stream updater assets to disk with incremental SHA-256; remove full-file reads/writes.
- Add `--progress-delta`, job-event coalescing, protocol-log filtering, and circular log buffers.
- Add immediate-completion and cancel/restart race tests.

Exit gate: 100 MB synthetic output and 250 MB update tests remain bounded; a 10 GB cross-volume copy
does not block the main heartbeat; two-hour live recording shows no meaningful Electron-memory slope.

### Phase 2 — Make renderer cost proportional to what is visible

Estimated effort: 5–9 engineering days.

- Normalize playlist/search/queue state and batch hydration patches.
- Virtualize playlist, queue, format, and transcript lists.
- Split `SearchResultCard` into memoizable card shell, platform details, theater player, chapters,
  transcript, and actions.
- Stabilize preview callbacks, isolate the playback clock, use binary cue lookup, and cap updates.
- Introduce bounded LRU caches and cancellable/deduplicated preview requests.

Exit gate: 1,000-entry playlist and 5,000-cue transcript stay within the long-task, FPS, and leak
budgets.

### Phase 3 — Control workload and startup growth

Estimated effort: 3–5 engineering days.

- Add separate download/postprocess semaphores and resource-aware defaults.
- Lazy-load Search, Settings, diagnostics, and preview modules.
- Move large startup cleanup off the critical path.
- Tune GPU-heavy visual effects only where traces show paint or compositor cost; do not disable
  hardware acceleration globally merely to make one memory column smaller.

Exit gate: parallel-mode responsiveness and startup budgets pass on the low-end reference system.

## Recommended first pull requests

1. **Bounded runner output:** add capture modes and ring tails; migrate download/orchestrator first;
   include a 100 MB output test.
2. **Async finalization:** replace cross-volume synchronous copy and cleanup; surface a `finalizing`
   progress state; include heartbeat tests.
3. **Streaming updater:** stream, hash, cap, and atomically swap yt-dlp, FFmpeg, and app installers.
4. **Progress coalescing:** set yt-dlp delta, coalesce job events, and stop raw protocol streaming when
   diagnostics are closed.
5. **Renderer scale pass:** normalized hydration, list windowing, bounded caches, and preview split.
6. **Performance gate:** packaged scenario harness and a current replacement for
   `specs/perf-report.md`.

The first three PRs should land before expanding playlist limits, increasing concurrency, or adding
more media-rich screens. They close mechanisms that can grow without a ceiling or freeze the app on
ordinary user hardware.

## Sources

[^1]: Electron. [“Performance.”](https://www.electronjs.org/docs/latest/tutorial/performance) Accessed September 2026.
[^2]: Electron. [“MemoryInfo Object.”](https://www.electronjs.org/docs/latest/api/structures/memory-info/) Accessed September 2026.
[^3]: Electron. [“app — `getAppMetrics()`.”](https://www.electronjs.org/docs/latest/api/app) Accessed September 2026.
[^4]: Node.js. [“Stream.”](https://nodejs.org/api/stream.html) Accessed September 2026.
[^5]: Node.js. [“File system.”](https://nodejs.org/api/fs.html) Accessed September 2026.
[^6]: Node.js. [“Crypto — `createHash()`.”](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) Accessed September 2026.
[^7]: yt-dlp. [“README — progress options.”](https://github.com/yt-dlp/yt-dlp/blob/master/README.md) Accessed September 2026.
[^8]: Electron. [“ipcRenderer.”](https://www.electronjs.org/docs/latest/api/ipc-renderer) Accessed September 2026.
[^9]: Electron. [“MessagePorts in Electron.”](https://www.electronjs.org/docs/latest/tutorial/message-ports) Accessed September 2026.
[^10]: Preact. [“Signals.”](https://preactjs.com/guide/v10/signals/) Accessed September 2026.
[^11]: MDN Web Docs. [“`content-visibility`.”](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) Accessed September 2026.
[^12]: Preact. [“Hooks — memoization.”](https://preactjs.com/guide/v10/hooks/#memoization) Accessed September 2026.
[^13]: web.dev. [“Optimize long tasks.”](https://web.dev/articles/optimize-long-tasks) Accessed September 2026.
[^14]: Chrome for Developers. [“Analyze runtime performance.”](https://developer.chrome.com/docs/devtools/performance/) Accessed September 2026.
[^15]: Chrome for Developers. [“Fix memory problems.”](https://developer.chrome.com/docs/devtools/memory-problems) Accessed September 2026.
[^16]: Electron. [“powerMonitor.”](https://www.electronjs.org/docs/latest/api/power-monitor/) Accessed September 2026.
[^17]: Node.js. [“Performance measurement APIs — `monitorEventLoopDelay()`.”](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions) Accessed September 2026.
[^18]: Electron. [“process.”](https://www.electronjs.org/docs/latest/api/process) Accessed September 2026.
[^19]: Chrome for Developers. [“Customize performance data with the extensibility API.”](https://developer.chrome.com/docs/devtools/performance/extension) Accessed September 2026.
[^20]: Electron. [“contentTracing.”](https://www.electronjs.org/docs/latest/api/content-tracing/) Accessed September 2026.
[^21]: Electron. [“webContents — `takeHeapSnapshot()`.”](https://www.electronjs.org/docs/latest/api/web-contents) Accessed September 2026.

---

# Independent review

Reviewer: Claude Opus 5, 2026-09-11. Method: line-by-line verification of every code claim above
against the working tree at `cbf380e` (v0.2.7), plus independent paired memory measurements on the
same Windows 11 host. This section records where the assessment holds, where its framing would
misdirect work, and what it missed.

## Summary of the review

The assessment is **technically accurate**. Every code citation spot-checked resolves to real code
doing what is described, the bundle figures are exact to the byte, and the memory measurements
reproduce. Two things need correcting before the roadmap is acted on:

1. The **idle-memory headline is misattributed**. Measured against a bare Electron window,
   MediaForge's own marginal cost is ~46 MB private. The AM-10 target is unreachable by 2.6x before
   any application code runs. See R-01.
2. The **largest real-world cost is absent from the findings**: playlist hydration spawns one yt-dlp
   process per entry, up to 1000 of them. See R-02.

The P0/P1 mechanisms (P-01 through P-04, P-06, P-07) are correctly identified and should proceed,
with the sequencing change in R-05 and the cheaper/better fixes in R-03.

## R-01 — Idle memory is Chromium baseline, not application cost

The assessment reports 184.7 MB private as a "provisional fail" missing the target "by 64.7 MB
(54%)", which reads as application fault. Paired measurement against a bare Electron 43 window
(blank `data:` document, same `sandbox`/`contextIsolation` settings, 40 s settle, two repetitions
each, same host and Electron build) shows otherwise:

| Configuration | Summed working set | Summed private | Processes |
|---|---:|---:|---:|
| Bare Electron window, run 1 | 309.2 MB | 141.1 MB | 4 |
| Bare Electron window, run 2 | 312.1 MB | 142.7 MB | 4 |
| MediaForge v0.2.7, run 1 | 360.6 MB | 190.2 MB | 4 |
| MediaForge v0.2.7, run 2 | 354.3 MB | 185.6 MB | 4 |
| **MediaForge marginal cost** | **~47 MB** | **~46 MB** | — |

Run-to-run variance is under 2%. A third MediaForge run measured 351.6 MB / 188.7 MB, consistent
with the assessment's own 356.5 MB / 184.7 MB.

Two conclusions follow.

**The metric was substituted without saying so.** AM-10 defines the ceiling as the
`app.getAppMetrics()` **`workingSetSize`** sum. The assessment reports its verdict against
`privateBytes`. On AM-10's own metric the figure is 357 MB, not 185 MB — the substitution makes the
miss look *smaller* than the binding requirement shows. Private bytes is a defensible metric and
arguably the better one, but changing it is an amendment to AM-10 and must be stated as such.

**The target is unachievable, and packaging will not change that.** A blank Electron 43 window fails
the 120 MB target on both metrics — 310 MB working set, 142 MB private — with zero MediaForge code
loaded. The assessment's advice to "first measure a signed packaged build on clean VMs, then either
meet it or amend" defers a decision the data already settles; packaging cannot close a 168 MB gap.

Recommended instead: amend AM-10 now against this evidence, and change what is tracked. The app's
marginal cost over a bare Electron window is the only figure the team controls, and ~46 MB for this
feature set is healthy. Proposed replacement gates:

| Gate | Proposed value |
|---|---|
| Idle summed private memory | <=200 MB |
| Idle summed working set | <=380 MB |
| Marginal cost over bare-window baseline | <=60 MB private (the tracked regression signal) |

This correction matters operationally: "54% over the memory target" drives effort toward bundle
splitting and allocation micro-optimization (P-11, P-12) that cannot move the number at all.

## R-02 — Missing P0: playlist hydration spawns one yt-dlp process per entry

`src/main/media/metadata.ts:342-382` — `hydrateEntries()` calls `runOnce()` once per playlist entry
at `HYDRATION_CONCURRENCY = 4` (`metadata.ts:223`), over an entry list capped at 1000
(`metadata.ts:119`).

A 1000-entry playlist therefore spawns **up to 1000 separate yt-dlp processes**, four at a time.
Each is a 17 MB PyInstaller binary that unpacks itself to temp on every launch — roughly 1–2 s cold
start and 60–80 MB RSS apiece. The result is on the order of **6–12 minutes of continuous process
churn** plus sustained temp-disk write amplification. `analyze()` does not resolve until the whole
pass finishes (`metadata.ts:264`), so the complete result object and all pending hydration state
stay reachable for the entire run, and `cancelRequested` is only observed at the top of the next
worker iteration.

P-05 frames the 1000-entry playlist as a renderer O(N^2) problem. The array copies it cites are
microseconds; the process spawning is four to five orders of magnitude more expensive. P-05's
mitigations are correct in themselves but do not touch the dominant cost. This belongs in the P0
band, above the renderer work.

Mitigation options, in preference order:

1. Hydrate only the visible window (~40 entries) and continue on scroll. Smallest change, removes
   the cost entirely for the common case of a user who opens a large playlist and picks a few items.
2. Replace the per-entry spawn with a single streaming process — drop `--flat-playlist` and have one
   yt-dlp emit per-entry JSON through `--print`/`-J` — so hydration costs one process regardless of
   playlist length.
3. Independently of both, make cancellation interrupt in-flight entries rather than only the gap
   between them.

These processes are excluded from AM-10's ceiling as external CLIs, but they are real user-visible
memory and disk load and must be reported under AM-10's RSS-logging clause.

## R-03 — Confirmed findings, with corrections that make the fixes cheaper or better

### P-01 — the first fix is three lines, not a redesign

Triple retention is confirmed: `runner.ts:29` (`LineBuffer.lines`), plus `stdoutLines` and
`allStdoutLines` at `orchestrator.ts:279` and `orchestrator.ts:273`. But `allStdoutLines` has
exactly one consumer — `extractFinalPathLine()` at `orchestrator.ts:391`. Replacing it with a single
`let finalPath` updated inside the existing `onStdoutLine` callback removes the largest of the three
copies immediately, with no change to `SpawnOptions` and no new capture-mode API. Do this before the
runner redesign, not after it.

### P-02 — the cross-volume path is the normal case, and the proposed fix leaves the 2x I/O in place

`tempRoot` is `userData/tmp` on C: (`index.ts:162`); `destDir` is user-chosen. For any user saving to
D: or an external drive, the `EXDEV` fallback at `orchestrator.ts:405-408` is the **default** path,
not an edge case — so every large download is written to disk twice and the UI freezes for the
duration of the copy.

Converting the copy to async (the assessment's mitigation) removes the freeze but keeps the
duplicate write. Staging into a hidden subdirectory of `destDir` instead makes `rename` always
same-volume, which makes finalization near-instant and the async conversion largely moot. Prefer
that; it is also less code.

### P-03 — two additional defects in the same paths

- `ffmpegUpdater.ts:203` does `writeFileSync(tmpExe, readFileSync(exe))`, reading a ~130 MB
  executable fully into memory purely to write it back out. `copyFileSync` is a drop-in replacement
  and removes that spike on its own. The same pattern repeats for `ffprobe.exe` a few lines below.
- `sha256Hex(zipBytes)` at `ffmpegUpdater.ts:176` is a synchronous ~100 MB hash that blocks the main
  event loop outright. This is a separate defect from the buffering concern and is fixed by the same
  streaming-hash change, but should be called out as a freeze, not only as memory.

### P-04 — confirmed, and it is the best value-per-line change in the document

`src/main/jobs/argBuilders.ts:21-22` sets `--newline --progress` with a custom `--progress-template`
and no `--progress-delta`. Adding the delta flag belongs in the first PR.

### P-06 and P-07 — confirmed as written

`SearchResultCard.tsx` is a single component spanning lines 156–2651 with the playback clock
(`currentTimeSec`, line 430) declared at its top level. `InlineVideoPreview.tsx:121` depends on
`[onTimeUpdate, onPlayingChange]`, and `SearchResultCard.tsx:1971` and `:1975` pass inline arrows, so
the global `message` listener is genuinely removed and re-added on every playback tick. One
refinement: `activeCueIndex` (`SearchResultCard.tsx:602`) scans backward from the end of the cue
array, so its worst case is *early* in playback when `cur` is small — the opposite of the intuition
that long videos degrade over time. `chaptersCache` and `transcriptCache`
(`SearchResultCard.tsx:63-64`) are module-level and unbounded as described.

## R-04 — Findings to downgrade or reconsider

| ID | Review position |
|---|---|
| P-08 | Two findings graded as one. The **analyze** race is real and user-visible: `cancel()` is fire-and-forget `void handle.killTree()` (which shells out to `taskkill`), `triggerAnalyze` has no generation token (`appState.ts:27-51`), and hydration runs for minutes — cancel-then-reanalyze will overlap in practice. Fix it. The **queue-resolver** hang is much narrower than stated: `orchestrator.ts:242` does `void this.run(...)` and `run` reaches its first await before the invoke reply is delivered, so `job:done` beating `waitForJob` registration is a thin window. Worth a cheap early-completion buffer, but P2. |
| P-09 | "Default parallel downloads to two on Windows" is a throughput regression proposed without a trace. Downloads are network-bound and do not contend for CPU. Separating download from postprocess concurrency is right; cutting download parallelism is not, absent measurement. |
| P-04 (log buffer) | The front-splice at `logBus.ts:27-29` costs roughly 200k element moves/sec at the realistic worst case. Negligible. Do not build a circular buffer for it; the rest of P-04 stands. |
| P-11 | 91.5 KB gzip total; parse/compile cost is tens of milliseconds. Graded P2 in the assessment; treat as P3 and measure before acting. |

## R-05 — Sequencing

The roadmap places 2–4 engineering days of telemetry (Phase 0) ahead of every fix. P-01's
`allStdoutLines` removal, P-04's `--progress-delta` flag, and P-03's `copyFileSync` substitution
total roughly one day between them and require no measurement to justify — the mechanisms are
proven by inspection and the fixes are locally obvious.

Recommended order: land those three first, then build Phase 0 telemetry, then proceed with the
assessment's Phase 1–3 as written (with R-02 inserted at the top of Phase 1 and R-01's AM-10
amendment recorded before any memory gate is enforced).

## R-06 — Items not covered by the assessment

- **`tempSweep.ts:26`** — `catch { return removed }` sits inside the `for` loop, so a single locked or
  unstattable directory silently aborts the entire sweep and leaks temp space permanently. Should be
  `continue`. Real bug; one-word fix.
- **Startup sweep placement** — `sweepOrphanedTempDirs` runs synchronously at `index.ts:170`, before
  window creation, so it lands directly on cold-start time. P-02 covers the synchronous I/O but does
  not connect it to the startup budget.
- **GPU-side cost** — 30 `backdrop-blur` usages in `SearchResultCard.tsx`. The GPU process was the
  largest single working set in measurement (129 MB). Worth one trace before acting on the
  assessment's (correct) advice not to disable hardware acceleration globally.
- **Analyze result lifetime** — the `analyze()` promise holds the full 1000-entry result plus all
  pending hydration state for the entire hydration run, compounding R-02.
