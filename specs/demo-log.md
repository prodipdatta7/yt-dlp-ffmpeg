# Demo Log

Visible-improvement checkpoints per `specs/Implementation_Plan.md`. One entry per completed phase.

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
