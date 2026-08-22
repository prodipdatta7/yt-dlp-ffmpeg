# Demo Log

Visible-improvement checkpoints per `specs/Implementation_Plan.md`. One entry per completed phase.

## P8 — Package, measure, ship  `[M7]` · done 2026-08-22

- **Installer ships:** `dist/MediaForge Desktop-Setup-0.1.0.exe` — **149.7 MB** vs the ≤180 MB
  budget ✅ (installed footprint 486 MB; ffmpeg LGPL 110 MB + yt-dlp 17 MB dominate).
  First build came in at 183 MB; fixed by excluding unused ffprobe.exe from the bundle.
- **App icon:** generated procedurally (`scripts/make-icon.mjs` → multi-size ICO incl. 256px).
- **Packaged smoke (workstation):** installed-tree exe launches, logs `packaged:true`, both
  engines resolve `source:"bundled"` offline.
- **First-run ToS notice:** dismissible amber bar (site ToS/copyright responsibility) persisted
  via settings — legal hygiene per AGENTS.md §14.
- **Memory probe harness:** `MF_MEMORY_PROBE=1` samples `getAppMetrics()` every 2 s →
  `logs/mem.jsonl`. Dev-mode idle recorded: summed working set 348–376 MB
  (Browser 96 / GPU 139 / Utility 48 / Tab 86). Flagged **DEVIATION-PENDING**: summed working
  sets double-count shared pages + dev-mode renderer overhead; packaged clean-VM re-measure
  with private WS is the authoritative follow-up. Peak-during-download likewise pending VM run.
- **Docs finalized:** `specs/perf-report.md` (size ✅ / memory methodology + deviation),
  `specs/clean-vm-smoke.md` (13-step Win10/Win11 matrix with memory fill-in table).
- Code signing: placeholder — no cert configured; SmartScreen expected until OV cert applied.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **141/141** ✓.

## P7 — Settings screen & OTA core-driver updates  `[M6]` · done 2026-08-22

- **Settings screen** (⚙ in header): destination folder display + Browse, cookies status with
  import/clear, diagnostics (open logs folder), and the **Core drivers** panel.
- **OTA updater:** "Check for updates" queries the official yt-dlp GitHub release; when newer,
  "Update Core Drivers → v<tag>" downloads `yt-dlp.exe` + `SHA2-256SUMS`, verifies SHA-256,
  swaps atomically into the userData override dir, then re-runs `--version` on the swapped
  binary before declaring success — engines reload without app restart (`getInfo` invalidated).
- **Safety:** tampered payload → rejected at checksum, nothing written. Binary that won't run
  post-swap → automatic rollback from `.bak`. Both proven by network-free mocked-API tests.
- **EC-02 wired:** stale-extractor errors now show an "Update Core Drivers…" button that opens
  Settings directly.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **141/141** ✓.

## P6 — Robustness pass: edge cases become features  `[M5]` · done 2026-08-22

- **Network retry ladder (AM-05):** transient failures now show an amber banner
  "Network issue — retrying in 5s (attempt 1 of 3)…" and re-spawn identical argv into a
  deterministic per-URL temp dir, so `.part` files resume natively. After the ladder exhausts,
  a **Resume Download** button restarts into the same dir. Proven by stateful flaky fixture
  (fails twice → succeeds; exactly two retry events; attempt counter = 3).
- **Close-guard (EC-05):** closing mid-job raises Run in Background / Cancel Download & Exit /
  Stay. Background mode hides to a tray icon with Show action; job keeps streaming progress.
- **Live recording (EC-06):** live URLs enter recording mode — amber **Stop Recording & Save**
  control finalizes the `.part` capture as a verified completed file.
- **Cookies (EC-07):** age-gate/bot-check errors now embed an "Import cookies.txt…" button;
  footer adds import/clear/logs actions; cookies flow into analyze + download argv via
  `--cookies`, never logged.
- **Orphan sweep:** startup removes `tmp/job-*` dirs older than 24 h.
- Full evidence matrix: `specs/ec-verifications.md`.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **131/131** ✓.

## P5 — Filesystem integration  `[M4]` · done 2026-08-22

- **Browse…** button opens the native folder picker, defaulting to last-used folder
  (persisted in `%APPDATA%/MediaForge Desktop/settings.json` via atomic write-tmp-rename);
  choice survives restarts (simulated-restart test proves fresh-instance read-back).
- Destination defaults to OS Downloads on first run.
- App-side sanitizer as defense-in-depth: illegal chars → `-`, control chars stripped,
  emoji/non-BMP → `-`, trailing dots/spaces removed, reserved device names prefixed
  (`CON.mp4` → `_CON.mp4`), 200-char cap preserving the extension.
- Collision auto-rename `_1.._n` with case-insensitive compare — re-downloading the same
  video never overwrites.
- **Low-disk pre-flight (AM-06):** renderer estimates bytes from stream metadata (shown in
  UI); main aborts before spawn with EC-03 message when free space < estimate + 50 MB margin.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **125/125** ✓.

## P4 — All modes + playlist queue  `[M3 rest]` · done 2026-08-22

- ModeSelector is now tri-state: **Video+Audio / Audio Only / Advanced**.
  - Audio Only: MP3/M4A/OGG/FLAC/WAV dropdown; bitrate selector (High/Medium/Low)
    **auto-hides for FLAC/WAV** with a "lossless" hint — AM-04 enforced in UI, argv builder,
    AND hostile-input validation (lossless+bitrate config rejected).
  - Advanced: two stream pickers fed by the analyzed FormatMatrix (`#id · ext · res · kbps`),
    plus merge container; argv pairs `-f "<vid>+<aud>/b"`.
- **Playlists work:** pasting a playlist shows entry preview; button becomes
  "Download All (N)" → sequential queue with per-entry status rows
  (pending/downloading/done/failed), "Stop After Current" control. AM-07 serialization
  proven by orchestrator busy-guard test (second concurrent launch rejected).
- Live-fire: jNQXAC9IVRw → `--audio-format mp3 --audio-quality 128K` produced an MP3;
  ffprobe confirms `codec_name=mp3 @ 48000 Hz`.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **101/101** ✓.

## P3 — Download pipeline core (Mode A)  `[M3 core]` · done 2026-08-22

- **First real download:** after analysis, resolution (8K→360p) + container (MP4/MKV/WebM)
  dropdowns + destination folder appear; "Start Production-Grade Download" launches the job.
- Live PipelineStatus tracker: smooth % bar, speed MB/s, ETA mm:ss, phase chips
  (Queued → Downloading Video → Downloading Audio → Merging → Finalizing), Cancel button,
  and a completion banner showing the saved file path.
- Orchestrator proven end-to-end against fake binaries: two-stream phase sequencing,
  final-path capture via `after_move:filepath`, collision-free move to destination,
  **cleanup-on-verify** (temp wiped only after moved output verified >0 bytes — AM-06);
  failure fixture retains `.part` partials and classifies MF_RATE_LIMITED.
- **Live-protocol discovery:** `--print after_move:filepath` implies `--quiet`, silently killing
  all download progress output. Fix: `--progress` flag added to base args. Verified live:
  18 real `MF|` records parsed from an actual jNQXAC9IVRw download; merged MP4 produced.
- ⚠️ Known upstream risk recorded: yt-dlp now warns that YouTube extraction without a JS
  runtime (deno/node) is deprecated → some formats may be missing in production. Mitigation
  options (ELECTRON_RUN_AS_NODE shim or bundling deno) tracked for P6/P7.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **91/91** ✓.

## P2 — URL engine & metadata module  `[M2]` · done 2026-08-22

- **First user payoff:** paste a link → Analyze → spinner → thumbnail, title, channel, duration,
  views, upload date render; full stream FormatMatrix table (ID/ext/codecs/res/fps/bitrate/~size)
  sorted by resolution; Cancel button kills the probe mid-flight.
- Playlist URLs show a "Playlist · N entries" badge with the entry list (queue lands in P4).
- Live URLs flagged with a red LIVE chip (recording workflow lands in P6).
- Invalid input shows inline hint; dead links surface catalog messages, never raw stderr —
  verified live: `BaW_jenozKc` now returns "Video unavailable" → mapped to
  MF_OFFLINE_OR_PRIVATE message; happy path verified on `jNQXAC9IVRw` (Me at the zoo,
  19s, 24 formats parsed).
- Retry strategy implemented: full URL first, tracking params stripped only on extractor-class
  failure (never blind-strip).
- Fixtures committed: youtube-single / playlist / live `-J` dumps drive parser tests.
- Gate evidence: typecheck ✓ · lint ✓ · vitest **70/70** ✓ (45 new: urlCleaner table-driven,
  classifyStderr per §10 row, fixture mapping, cancel <500ms scripted, service validation).

## P1 — Binary manager & process runner  `[M1]` · done 2026-08-22

- Footer status strip now shows **live engine badges**: `yt-dlp: v2026.08.19 [BUNDLED]` /
  `ffmpeg: vN-126239… [BUNDLED]` with green dots; turns red "missing" when `binaries/win32` is emptied.
- Real binaries fetched via new `npm run fetch-binaries` (yt-dlp latest release + BtbN LGPL FFmpeg).
- Locator precedence unit-tested: env `MEDIAFORGE_BIN_DIR` → userData → bundled (AM-03).
- Runner proven against node-as-fixture: line emission, stderr split, non-zero codes,
  timeout kill; **kill-tree test** kills parent+grandchild via `taskkill /T /F` (AM-09).
- Structured logger live at `%APPDATA%/MediaForge Desktop/logs/mf-YYYY-MM-DD.log` —
  app log records `binary ready: yt-dlp 2026.08.19 | {"source":"bundled"}` on startup;
  URL query redaction covered by tests (§11.3).
- IPC `mf:binaries:info` round-trips renderer→main→spawn→probe.
- Gate evidence: typecheck ✓ · lint ✓ · vitest 25/25 ✓ · two dev smokes clean.

## P0 — Scaffold & guardrails  `[M0]` · done 2026-08-22

- `npm run dev` opens the MediaForge Desktop shell: dark theme, header w/ logo + version chip,
  disabled URL bar + Analyze button placeholders, status footer.
- Preload bridge verified live: footer shows "bridge ok" via `window.mf.ping()` IPC round-trip.
- Gate evidence: `npm run typecheck` ✓ · `npm run lint` ✓ (eslint flat + prettier) ·
  `npm run test` ✓ 5/5 (`tests/unit/securityFlags.test.ts` asserts PRD §5.1 flags:
  contextIsolation/nodeIntegration/sandbox/webSecurity).
- Dev-smoke: electron started (4 procs), main+preload built, renderer dev server on :5173, clean kill.
- CSP: strict policy injected at build; dev-only relaxation for HMR (connect/ws to localhost).
- Note: npm 11 blocked install scripts by default — approved `electron` postinstall manually;
  fresh clones may need `npm approve-scripts electron && npm rebuild electron`.
