# Demo Log

Visible-improvement checkpoints per `specs/Implementation_Plan.md`. One entry per completed phase.

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
