# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

`AGENTS.md` is the living engineering spec for this repo and takes precedence over this file and
over the PRD (`specs/MediaForge_Desktop_PRD.md`). Before implementing anything, read the relevant
PRD section **and** its correction in AGENTS.md §2 (the `AM-nn` amendment log) — amendments override
the PRD, and several of them (AM-02 spawn safety, AM-03 binary override path, AM-21 JS runtime,
AM-22 MSIX) encode non-obvious constraints that are easy to regress.

Companion specs: `specs/Implementation_Plan.md` (phase breakdown, P0–P8 ≡ M0–M7),
`specs/ec-verifications.md` (edge-case repro scripts), `specs/perf-report.md` +
`specs/performance-memory-deep-research.md` (memory budgets), `specs/UI_Design_Update_Plan.md`.

## Commands

```bash
npm install
npm run fetch-binaries        # REQUIRED before dev/test: downloads yt-dlp.exe, ffmpeg.exe,
                              # qjs.exe into ./binaries/win32 (gitignored, never committed).
                              # --deno adds the optional deno.exe override; --verify only asserts
                              # the bundled set is complete (what `npm run dist` runs first).
npm run dev                   # electron-vite dev (renderer HMR, main watched)
npm run typecheck             # tsc --noEmit over tsconfig.node.json AND tsconfig.web.json
npm run lint                  # eslint . && prettier --check .
npm run format                # prettier --write .
npm run test                  # vitest run
npm run build                 # typecheck + electron-vite build → out/
npm run dist                  # verify binaries + build + electron-builder --win nsis
npm run dist:store            # same, --win msix (Microsoft Store, AM-22)
npm run perf                  # build + scripts/perf-bench.mjs → perf-out/ (AM-16 memory budgets)
```

Gate before any commit (same as CI, which runs on `windows-latest` with Node 22.12.0):
`npm run typecheck && npm run lint && npm run test`.

Single test / subset:

```bash
npx vitest run tests/unit/orchestrator.test.ts
npx vitest run -t "kills the process tree"     # filter by test name
npx vitest tests/unit/search.test.ts           # watch mode
```

Environment flags:

- `MEDIAFORGE_BIN_DIR=D:\path\to\bins` — dev override consulted first by `BinaryLocator`.
- `MF_E2E_REAL=1` — opts `tests/e2e/real-download.e2e.test.ts` in; it hits the real network with
  real binaries. Skipped by default.
- `MF_MEMORY_PROBE=1` — enables `MemoryProbe` sampling and the `probe:scenario` IPC no-op gate.

## Architecture

Electron three-process model; the renderer has **zero** filesystem, network, or shell access.

```
renderer (Preact + signals, sandboxed)
  ↕ window.mf.*                       ← preload/index.ts, the only contextBridge surface
preload (contextBridge over ipcRenderer.invoke / .on)
  ↕ mf:* channels                     ← src/shared/ipcContract.ts, single source of truth
main (services below)
  ↓ spawn(absPath, argv[], {shell:false, windowsHide:true})
yt-dlp.exe / ffmpeg.exe / qjs.exe
```

Load-bearing seams — changing any of these means touching several files at once:

- **`src/shared/ipcContract.ts`** — channel-name constants plus request/response types, imported by
  both preload and main, so the contract is compile-time enforced. Adding a channel means: declare
  the constant and types here → `ipcMain.handle` in `src/main/ipc/handlers.ts` (with a server-side
  validator; never trust the renderer's payload) → a named method on the `mf` object in
  `src/preload/index.ts` → `IpcDeps` wiring in `src/main/index.ts`. `src/shared/models.ts` holds the
  domain types (`JobConfig`, `JobEvent`, `MfErrorCode`, `ERROR_MESSAGES`, format/bitrate enums).
- **Arg builders are the only place CLI argv is composed** — `src/main/jobs/argBuilders.ts`
  (download) and `src/main/media/argBuilders.ts` (analyze, entry-info, search targets/filters).
  Never build a shell string; every user value is one argv element. `buildBaseDownloadArgs` appends
  the AM-21 `--js-runtimes` pair **last** so pre-AM-21 argv snapshots stay byte-identical.
- **`src/main/binaries/`** — `locator.ts` is pure (candidate list in, path out) and resolves
  `MEDIAFORGE_BIN_DIR` → `<userData>/binaries/<platform>` → bundled `resources/binaries/<platform>`;
  the candidate list itself is built in `main/index.ts:binaryCandidates`. `runner.ts` owns every
  spawn (`spawnProcess` for streaming line output, `runCapture` for one-shot, `killTree` for
  win32 `taskkill /T /F`). `jsRuntime.ts`/`jsRuntimeService.ts` pick the external JS runtime that
  yt-dlp needs for YouTube (Deno override preferred over bundled QuickJS; main-process only).
  `updater.ts` / `ffmpegUpdater.ts` / `app/appUpdater.ts` all follow the same shape: resolve tag via
  the `releases/latest` redirect (**no GitHub REST API**), SHA-256 verify, atomic swap, keep `.bak`,
  roll back on failure.
- **`src/main/jobs/orchestrator.ts`** — `DownloadOrchestrator` runs jobs (sequential by default,
  bounded-parallel optionally), owns retry backoff (`DEFAULT_RETRY_DELAYS_MS`), temp staging under
  `<userData>/tmp/job-<uuid>/`, finalize/verify-then-cleanup, and cancellation. Its filesystem and
  binary-resolution dependencies are injected (`OrchestratorDeps`, `FinalizeFs`) so it unit-tests
  without Electron. `progressParser.ts` turns the `MF|`/`MFPOST|` machine lines into `JobEvent`s;
  `eventCoalescer.ts` throttles routine progress to 150 ms latest-wins (phase transitions and
  anything with a `message` always pass through).
- **`src/main/media/`** — `metadata.ts` (`AnalyzeService`, `-J` JSON → typed model + FormatMatrix,
  windowed playlist hydration), `search.ts` (`SearchService`: native yt-dlp query extractors for
  YouTube/SoundCloud/Bilibili, DuckDuckGo→Brave public-web discovery for the rest, with generation-
  scoped cancellation), `classifyStderr.ts` (stderr patterns → one `MF_*` code → one user string —
  raw stderr must never reach the UI), `urlCleaner.ts`.
- **Renderer state lives in `src/renderer/src/signals/`**, not in components: `appState`
  (analysis/playlist entries), `jobState`, `queueState`, `searchState`, `logState`, `uiState`
  (`activeView` drives the Downloader/Search/Queue/Share/Help/Settings screens). `App.tsx` is the
  screen switch and the queue driver (`runQueue`/`runParallelQueue`, `launchQueueFromSearch`).

## Conventions worth knowing

- **Dependency budget is deliberate**: runtime deps are Preact + `@preact/signals` (+ `qrcode` for
  Local Share) and nothing in main beyond Electron. React and UI/icon kits are banned; icons are
  inline SVG in `components/icons.tsx`. Build-time tooling (Tailwind) is exempt because it compiles
  away. Any new runtime dependency needs a justification against AGENTS.md §3.
- **Styling**: Tailwind v4 utilities over intent-named tokens defined in
  `src/renderer/src/styles/global.css` (`text-ink`, `bg-wash-1`, `bg-recess`, `border-line`…).
  Avoid raw `white`/`black` opacity washes; the Tailwind names `sky-*`/`indigo-*` are brand aliases,
  not literal hues. Native title-bar colors live in `src/shared/themeChrome.ts` and
  `tests/unit/themeChrome.test.ts` fails if the CSS and that manifest drift apart.
- **CSP is generated at build time** by the `mf:csp` plugin in `electron.vite.config.ts`, which
  substitutes `%MF_CSP%` in `src/renderer/index.html` (strict for production, localhost-relaxed for
  dev). Edit the constants there, not the HTML.
- **Tests import no Electron.** Keep logic in pure modules and inject side effects; `tests/unit`
  and `tests/renderer` both run in the `node` environment (renderer tests exercise signals, not
  DOM). Integration tests drive the stub executables in `tests/fixtures/fake-bin/` (canned `MF|`
  output, hangs, non-zero exits, process trees); `-J` parsing runs against the committed dumps in
  `tests/fixtures/ytdlp-json/`. Vitest runs with `--expose-gc` because the memory-retention tests
  need it.
- **Lint rules that bite**: `@typescript-eslint/no-explicit-any` is an error, unused args must be
  `_`-prefixed, and `console.log` is banned (`warn`/`error`/`info` allowed) — main-process logging
  goes through `store/logger.ts` / `logs/logBus.ts`, which redact URL query strings and cookies.
- Commit messages in this repo use Conventional Commits and cite `AM-nn` / `Mn` / audit IDs when the
  change traces to one.
