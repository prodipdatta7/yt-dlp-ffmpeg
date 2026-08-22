# MediaForge Desktop — Phased Implementation Plan

Executable delivery plan derived from `AGENTS.md` §9 (milestones) and `specs/MediaForge_Desktop_PRD.md`.
Every phase is **modular**: it touches only its own modules, ends green on the quality gate, and
finishes with a **visible, demoable improvement** in the running app (`npm run dev`).

**Rules of engagement**

1. Strict order P0 → P8. A phase starts only when the previous one's gate passes.
2. Gate before closing any phase: `npm run typecheck && npm run lint && npm run test` + that phase's scripted checks.
3. Each phase ends with a recorded demo checkpoint (screenshot or 30-second repro note) in `specs/demo-log.md`.
4. Traceability tags (`AM-nn`, PRD §) come from `AGENTS.md` §2; cite them in commits/tests.
5. Effort sizes: S ≤ 1 day · M ≤ 3 days · L ≤ 1 week · XL ≥ 1 week (single dev, indicative only).

---

## Overview — what you SEE after each phase

| Phase | Milestone | Theme | Visible improvement (demo moment) |
|-------|-----------|-------|-----------------------------------|
| P0 | M0 | Scaffold & guardrails | Branded dark-mode shell window opens via `npm run dev`; URL bar + layout skeleton; HMR live |
| P1 | M1 | Engine room | Status strip shows detected **yt-dlp vX.Y / ffmpeg vN.N** with source badge (bundled/override); red "missing" state when absent |
| P2 | M2 | Analyze flow | Paste YouTube link → spinner → thumbnail, title, channel, duration, format matrix render; Cancel works; dead link shows friendly error |
| P3 | M3-core | First real download | Pick tier+container → live progress bar with %/speed/ETA/phase labels → playable MP4 lands in Downloads; temp dir wiped |
| P4 | M3-rest | All modes + playlists | Audio-only dropdowns work (bitrate auto-hides for FLAC/WAV); Advanced format-ID pairing; playlist URL → sequential queue rows complete one-by-one |
| P5 | M4 | Filesystem polish | Browse dialog defaults to OS Downloads and remembers last folder across restarts; ugly titles sanitized; duplicates get `_1` suffix; low-disk warning pre-flight |
| P6 | M5 | Robustness | Kill Wi-Fi mid-download → retry ladder → **Resume** button finishes job; close-window guard modal with Run-in-Background; age-gate → cookie hint |
| P7 | M6 | Settings + OTA drivers | Settings screen functional; "Update Core Drivers" fetches latest yt-dlp.exe, SHA-256-verifies, swaps atomically; new version shown after relaunch |
| P8 | M7 | Package & ship | Double-clickable NSIS installer; happy-path download works on clean Win10/11 VM; perf + size report card |

---

## P0 — Scaffold & guardrails  `[M0]` · effort **S**

**Goal:** Running Electron shell with locked toolchain, security posture enforced by tests.

**Build items**
- Init repo: `package.json`, `electron.vite.config.ts`, TS strict configs (main/preload/renderer project refs)
- Deps: `electron`, `electron-vite`, `typescript`, `preact`, `@preact/signals`, `tailwindcss@^4` (build-time), ESLint flat + Prettier, Vitest
- `BrowserWindow` options factory: `contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true`
- Preload skeleton exposing `window.mf.ping()` only
- Renderer: App.tsx shell (header w/ app name+version, content area, status-strip placeholder), Tailwind entry CSS
- CSP meta tag in `index.html` (§6.5 of AGENTS.md)
- Unit test asserting window-options factory flags
- `.gitignore`: `/binaries`, `node_modules`, `dist`, `out`

**Visible:** styled empty app window; editing renderer source hot-reloads.
**Gate:** M0 ACs — window opens; security-flag test passes; full quality gate green.

---

## P1 — Binary manager & process runner  `[M1]` · effort **M**

**Goal:** Privileged foundation: locate, probe, execute, and kill external binaries safely (PRD §5.1–6.2).

**Build items**
- `scripts/fetch-binaries.mjs` → downloads current stable yt-dlp.exe + FFmpeg essentials build into `./binaries/win32` (dev-only, gitignored)
- `src/main/binaries/locator.ts` — resolution order: `<userData>/binaries/win32` → bundled `resources/binaries/win32` → env `MEDIAFORGE_BIN_DIR` (AM-03)
- `src/main/binaries/runner.ts` — spawn wrapper: args-array exec, `shell:false, windowsHide:true` (AM-02), utf-8 line emitter for stdout/stderr, exit-code capture, kill-tree via `taskkill /PID x /T /F` (AM-09)
- `versions.ts` — probe `yt-dlp --version`, `ffmpeg -version`; parse + cache
- `store/logger.ts` — structured logging to `<userData>/logs/mf-YYYY-MM-DD.log`, query-string redaction (§11.3)
- IPC `binaries:getInfo` + preload method; renderer status strip consumes it
- Tests: locator precedence (incl. override wins AM-03); runner against `tests/fixtures/fake-bin/` stub emitting canned lines; kill-tree test

**Visible:** footer strip shows both versions + source badges; turns red "binary missing" when `binaries/win32` is emptied.
**Gate:** M1 ACs all pass; no other module composes argv yet (contract reserved for argBuilders).

---

## P2 — URL engine & metadata module  `[M2]` · effort **M**

**Goal:** Paste URL → see real preview. First user-visible payoff (PRD §3.1–3.2).

**Build items**
- `media/urlCleaner.ts` — reject empty/no-scheme; whitespace trim; tracking-param strip with retry strategy (full URL first, strip only if extraction fails — never blind-strip)
- `media/metadata.ts` — run `yt-dlp -J --no-warnings <url>` via runner; map JSON → `MediaMetadata` + `FormatMatrix` rows (format_id, ext, codecs, height, fps, abr/tbr, filesize_approx)
- Error classification v1: `classifyStderr()` covering EC-01 patterns (`Video unavailable`, `Private video`) per AGENTS.md §10
- Cancellation: `analyze:cancel` kills child tree <500ms (AM-09)
- Fixtures: committed redacted `-J` dumps — youtube-single.json, playlist.json, live.json
- IPC `analyze:start/cancel`; preload surface; hostile-input validation in handler (§6.3)
- Renderer: UrlBar component (validation hints under input), Preview panel (thumbnail `<img>`, title, uploader, duration HH:MM:SS, views, upload date), FormatMatrix table, loading spinner, cancel button

**Visible:** analyze a real video end-to-end; matrix populates; invalid input gets inline warnings; dead link yields catalog message, never raw stderr.
**Gate:** M2 ACs — table-driven validator tests; parser vs 3 fixtures; classifyStderr unit tests; cancel-timing script <500ms.

---

## P3 — Download pipeline core (Mode A)  `[M3 core]` · effort **XL**

**Goal:** One real Video+Audio download with live telemetry (PRD §3.3A, §3.5–3.6).

**Build items**
- `jobs/argBuilders.ts` — base args block (AGENTS.md §7.2 verbatim: `--newline`, progress templates `MF|`/`MFPOST|`, `--windows-filenames --trim-filenames 200`, `-o` into temp job dir, `--ffmpeg-location`, `--print after_move:filepath`)
- Mode A builder: `-f "bv*[height<=H]+ba/b" -S "res,fps" --merge-output-format C` (tier H, container C from UI)
- Temp staging: `<userData>/tmp/job-<uuid>/`; cleanup rule — delete only after verifying final output exists and >0 bytes (AM-06)
- `jobs/progressParser.ts` — parse `MF|status|downloaded|total|estimate|speed|eta` lines → `JobEvent{phase, percent, speedBps, etaSec}`; `MFPOST|%` → merging phase; defensive flip on `[Merger]`/`[ExtractAudio]`
- `jobs/orchestrator.ts` — single-job lifecycle; final path capture via `after_move:filepath`; move to destination; emit `job:event`/`job:done`
- IPC `download:start/cancel`; kill-tree cancel keeps partials (AM-09)
- Renderer: PipelineStatus tracker — smooth % bar, speed MB/s, ETA mm:ss, phase label chips (`Downloading Video Layer` → `Merging` → `Finalizing`), Start/Cancel buttons, done-state output path display
- Tests: argv snapshot (mode A); progress parser vs synthetic `MF|` fixtures; cleanup-on-verify (success wipes temp; failure retains)

**Visible:** download a chosen-tier video with animated progress + speed + ETA + phase labels; playable file appears in destination; temp dir verified empty after success.
**Gate:** M3 ACs subset — snapshots, parser fixtures, e2e CC-clip integration test (`MF_E2E_REAL=1`) producing expected container, temp-empty assertion.

---

## P4 — All modes + playlist queue  `[M3 rest]` · effort **L**

**Goal:** Complete the selection matrix and playlist handling (PRD §3.3B–C, §7; AM-04, AM-07).

**Build items**
- Mode B builders: lossy `-x --audio-format mp3|m4a|vorbis --audio-quality {320K,192K,128K}`; lossless FLAC/WAV without bitrate flag (AM-04)
- Mode C: Advanced pairing of `format_id`s from FormatMatrix → `-f "<vid>+<aud>/b"` + merge container dropdown
- Playlist queue: detect `_type:playlist` → enumerate via `--flat-playlist -J` → enqueue entries sequentially through the normal single-job pipeline (never concurrent children — AM-07)
- Renderer: ModeSelector tri-state; audio container dropdown with bitrate selector disabled+hidden for FLAC/WAV (UI logic mirrors AM-04); Advanced mode two-column stream picker with estimated sizes; QueueList rows with per-entry state (pending/downloading/done/failed)
- Tests: argv snapshots per mode incl. lossless-no-bitrate case; ffprobe verification of produced codec/container; queue serialization test (second entry starts strictly after first completes)

**Visible:** switch modes freely — audio jobs produce correct containers/codecs; Advanced pairs exact stream IDs; pasting a playlist fills a queue that processes top-to-bottom.
**Gate:** remaining M3 ACs — per-mode snapshots, integration downloads for B/C, playlist sequencing proof.

---

## P5 — Filesystem integration  `[M4]` · effort **M**

**Goal:** Users control where files land; Windows-hostile names handled (PRD §3.4; AM-06).

**Build items**
- `ipc dialog:chooseDirectory` — native picker defaulting to OS Downloads; `store/settingsStore.ts` persists `lastOutputDir` atomically (write-tmp-rename; corrupt file → defaults, never crash)
- `fsops/sanitizer.ts` — defense-in-depth beyond yt-dlp flags: strip `\ / : * ? " < > |` + control chars 0–31, trailing dots/spaces, reserved device names (CON, PRN, AUX, COM¹⁻⁹, LPT¹⁻⁹), cap 200 chars, emoji/non-BMP → `-` (AGENTS.md §7.4)
- Collision policy: `_1.._n` suffix, case-insensitive compare, extension preserved
- `fsops/diskSpace.ts` pre-flight: estimate required bytes from selected formats; abort-before-spawn with EC-03 message when insufficient (AM-06)
- Renderer wiring: Output Folder row + Browse button; estimated size shown per option

**Visible:** folder picker opens at last-used location which survives restart; a title like `AC/DC: Best?*Track<1>` saves clean; re-downloading same video yields `_1` copy instead of overwrite; low-space disk aborts with clear message before any bytes move.
**Gate:** M4 ACs — sanitizer table tests (incl. CON/PRN/trailing-dot/control-char/200-char); collision `_1/_2` test; simulated-restart persistence test; preflight-abort test.

---

## P6 — Robustness pass: edge cases become features  `[M5]` · effort **L**

**Goal:** Every EC row in the matrix behaves as specified (PRD §4; AM-05/06/09).

**Build items**
- Full error catalog wiring: `classifyStderr` extended to all §10 codes; every user-visible failure renders catalog strings only
- Retry ladder on `MF_NETWORK`: re-spawn same argv at 5s/15s/30s (yt-dlp resumes `.part` files natively), then expose **Resume Download** button (AM-05); Resume re-invokes orchestrator with identical JobConfig
- Close-guard (EC-05): intercept `close` while job active → modal Confirm-Cancel / Run-in-Background; background hides window, tray indicator, job continues
- Cookies import (EC-07): Settings-side file picker copies cookies.txt → `<userData>/cookies.txt` (restrictive ACL, never logged); `--cookies` appended; "clear stored cookies" action; age-gate errors deep-link to this flow
- Live detection (EC-06): metadata `is_live/live_status=is_live` → recording workflow banner + explicit Stop Recording control; stop finalizes partial recording
- Orphaned temp sweep on startup (>24h old dirs); rate-limit backoff messaging (`MF_RATE_LIMITED`)
- `specs/ec-verifications.md`: one scripted/manual repro per EC-01…EC-07
- Tests: resume-after-kill integration; close-guard blocks quit; catalog mapping table-driven

**Visible:** pull-the-cable during a large download → app retries visibly → Resume completes the file; closing mid-job prompts instead of silently dying; age-gated link routes to cookie guidance; live URL flips UI into record mode with Stop control.
**Gate:** M5 ACs — all EC repros documented and passing.

---

## P7 — Settings & OTA driver updates  `[M6]` · effort **M**

**Goal:** Self-healing yt-dlp without reinstalling the app (PRD §6.3; AM-03/AM-08).

**Build items**
- Settings screen: default output folder, cookie-file status + clear, check-for-updates, open logs folder, version info (app / yt-dlp / ffmpeg, source badge)
- `binaries/updater.ts`: GET latest release via GitHub API (main-process only); date-based tag compare; download `yt-dlp.exe` + official SHA2-256SUMS asset; verify locally; atomic replace into `<userData>/binaries/win32/` (tmp + rename), keep `.bak` rollback; any-step failure keeps current binary
- EC-02 hookup: `MF_EXTRACTOR_STALE` surfaces "Update Core Drivers" CTA wired to updater
- IPC `updater:check/apply`; `binaries:getInfo` reflects override post-relaunch
- Tests: mocked-release-API updater flow (no network in CI); tampered-binary rejection + rollback; getInfo override visibility

**Visible:** click Update Core Drivers → progress states (checking/downloading/verifying/swapping) → relaunch shows new yt-dlp version tagged `override`; a corrupted download is visibly rejected and rolled back.
**Gate:** M6 ACs pass.

---

## P8 — Package, measure, ship  `[M7]` · effort **M**

**Goal:** Installer a stranger can use on a clean PC (PRD §5.2–5.3, §6).

**Build items**
- `electron-builder.yml`: nsis win32-x64 target bundling binaries into `resources/binaries/win32`; app icon; first-run ToS notice (legal hygiene, §14)
- `resources/LICENSES/`: yt-dlp (Unlicense), FFmpeg license (prefer LGPL build), Electron notices
- Code-signing placeholder config; cert decision logged before exit
- Memory profiling harness per AM-10 methodology (Electron-proc sum via `app.getAppMetrics()`; child RSS logged separately)
- Size report vs ≤180MB installer budget; clean-VM smoke matrix Win10 + Win11
- `specs/perf-report.md` + `specs/demo-log.md` finalized

**Visible:** `MediaForgeSetup-1.0.0.exe` installs offline-capable app on a clean VM; paste → analyze → download works there; report card shows memory/idle numbers and installer size.
**Gate:** M7 ACs — install + happy path on clean Win10/11 VM; idle ≤120MB & peak ≤450MB Electron RSS recorded (or approved deviation); size reported.

---

## Dependency & risk notes

- **Critical path:** P0→P1→P2→P3. P4–P7 can partially overlap after P3 (different modules), but gates still apply sequentially.
- **Highest-risk items:** P3 progress-template parsing edge cases (yt-dlp template escaping) and P6 live-recording workflow (platform-dependent behavior). Spike both early within their phases; timebox spikes to 0.5 day each.
- **Never-do reminders:** no shell strings ever (AM-02); no regex scraping of human-readable CLI output (AM-01); no binary writes inside the install dir (AM-03).
