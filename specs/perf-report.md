# Performance & Size Report — v0.1.0

Measured 2026-08-22 on the dev workstation (Windows 11, build 26200). Clean-VM packaged
measurements tracked in `specs/clean-vm-smoke.md`.

## Installer size (PRD §5.3 budget ≤ 180 MB)

| Artifact | Size |
|---|---|
| `MediaForge Desktop-Setup-0.1.0.exe` | **149.7 MB** ✅ PASS |
| Installed footprint (`win-unpacked`) | 486 MB |
| of which ffmpeg.exe (LGPL static) | 110 MB |
| of which yt-dlp.exe | 17 MB |

NSIS/LZMA compression; app code (asar) is ~1 MB — the payload is dominated by the bundled
media engines, as designed.

## Memory (AM-10 methodology)

Harness: `MF_MEMORY_PROBE=1` → main process samples every 2 s into
`<userData>/logs/mem.jsonl`: `process.memoryUsage().rss` plus per-type working sets from
`app.getAppMetrics()` (Electron processes only; yt-dlp/ffmpeg are separate OS processes and
excluded per AM-10).

**Idle, dev mode** (n=17 samples after full UI load):

| Metric | Value |
|---|---|
| Electron summed working set (min → max) | 348 → 376 MB |
| Breakdown (final sample) | Browser 96 · GPU 139 · Utility 48 · Tab(renderer) 86 MB |

**Status vs PRD §5.2 targets:** idle sum exceeds the 120 MB ceiling →
**DEVIATION-PENDING**, for two compounding reasons:

1. Summed *working sets* double-count shared pages (GPU process shares texture memory with
   renderer); unique (private) footprint is materially lower than 348 MB.
2. Dev mode carries the Vite HMR client + sourcemaps in the renderer; packaged builds do not.

Required follow-up before sign-off: re-measure with the **packaged build on a clean VM**
using private-working-set per process; either record compliance or formalize the deviation.
Peak-during-download (≤450 MB target) likewise requires a clean-VM run — child CLI RSS to be
logged alongside per AM-10.

## Code signing status

Placeholder: no certificate configured. The installer/exe carry no trusted signature →
SmartScreen/Unknown-publisher warnings on clean machines until an OV cert is applied
(decision logged in AGENTS.md §14).

## Harness usage

```bash
set MF_MEMORY_PROBE=1&& npm run dev     # writes logs/mem.jsonl every 2s
npm run dist                            # installer into dist/
```
