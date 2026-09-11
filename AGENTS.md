# AGENTS.md — MediaForge Desktop

Engineering guide for AI agents and humans working in this repository. It converts the product
spec (`specs/MediaForge_Desktop_PRD.md`) into an executable, milestone-driven implementation plan,
including binding corrections where the PRD was technically inaccurate.

**Rule zero:** Before implementing any feature, read the corresponding PRD section **and** its
amendments in §2 of this file. If they conflict, this file wins.

---

## 1. Project Overview

MediaForge Desktop is an Electron GUI wrapper around the CLIs of **yt-dlp** and **FFmpeg**.
It lets non-technical users download/transcode media with zero host dependencies (both binaries
ship inside the app), while power users retain raw access to stream formats.

Core flows:

1. Paste URL → validate → extract metadata (`yt-dlp -J`) → show preview + format matrix.
2. Pick mode (Video+Audio / Audio-only / Advanced) + quality + destination folder.
3. Download streams to a temp dir (yt-dlp) → mux/transcode (FFmpeg, invoked by yt-dlp) → move
   final file to destination → clean temp.
4. Real-time progress, speed, ETA, phase labels surfaced to the UI at all times.

## 2. PRD Amendment Log (binding corrections)

These amend the PRD. Traceability: `AM-nn` may appear in commit messages and tests.

| ID | PRD § | Correction |
|----|-------|------------|
| AM-01 | 3.6 | Do NOT regex-scrape human-readable stdout. Use machine-parseable interfaces: `-J` (metadata JSON), `--newline` + `--progress-template` (download/postprocess progress), `--print after_move:filepath` (final path). See §7. |
| AM-02 | 5.1 | Never construct shell command strings. Execute via `spawn(binPath, argsArray)` with `shell:false, windowsHide:true`. URLs are passed as one argv element — injection-safe by construction. No string concatenation of user input ever reaches a shell. |
| AM-03 | 6.3 | Never swap/update binaries inside the install directory (`Program Files` needs admin; modifying a signed `.app` breaks its signature). Updated binaries are written atomically to `<userData>/binaries/<platform>/` and the loader resolves **userData override → bundled binary**. Verify SHA-256 against official checksums before swapping; keep `.bak` for rollback. |
| AM-04 | 3.3B | Bitrate tiers (320/192/128 kbps) apply only to lossy targets (MP3, M4A/AAC, Vorbis/OGG). When FLAC or WAV is selected, hide/disable the bitrate selector and transcode from best source audio. |
| AM-05 | EC-04 | The app cannot reconnect the OS network. "Retry loop" means: detect failure, retry spawning `yt-dlp` (default resume via `.part` files) up to N=3 times with backoff (5s/15s/30s), then surface the **Resume Download** button. |
| AM-06 | EC-03 + 3.5 | Cleanup rule: delete temp files **only after verifying** the final output exists and is > 0 bytes. On any failure, retain partials (enables resume). Pre-flight disk space check before starting a job; abort early with required-bytes message when estimable. |
| AM-07 | 7 | Playlists ARE in scope as a queue: if metadata reports `_type: playlist`, enumerate entries (`--flat-playlist`) and enqueue them through the normal single-job pipeline, with per-entry status rows. **Per-entry metadata hydration is windowed** (`PLAYLIST_HYDRATION_WINDOW`, R-02): each hydration spawns its own yt-dlp, so only the first window is filled in before `analyze()` resolves and the renderer asks for further slices via `analyze:hydrate-range` as the list scrolls. Entries past the window keep their flat-playlist preview row, which already renders. Default run is sequential (one child at a time). Optional **parallel** mode (UI: "Download in Parallel") allows up to N=2–5 concurrent jobs via a Map-based orchestrator (D2a / `specs/UI_Design_Update_Plan.md`); disk preflight reserves the **sum** of in-flight estimates. |
| AM-08 | EC-02/EC-07 | A Settings screen exists (referenced but unspecified in PRD): default output folder, cookie-file import, check-for-updates, open logs folder, version info. See §9/M6. |
| AM-09 | 3.2 | Cancel semantics defined for ALL phases: cancel kills the child process **tree** (win32: `taskkill /PID <pid> /T /F`), keeps partial files, resets UI to idle. Applies mid-analysis and mid-download. |
| AM-10 | 5.2 | Memory ceilings cover **Electron processes only** (measured via `app.getAppMetrics()` sum: main + renderer + gpu + utility). FFmpeg/yt-dlp are separate OS processes — excluded from the ceiling but RSS-logged during performance tests. Idle target ≤120MB, peak ≤450MB. Superseded in part by AM-16. |
| AM-11 | — | Additions the PRD omitted: structured logging with redaction (§11.3), error catalog mapping CLI stderr → user messages (§10), licensing/distribution notes (§14), filename safety delegated primarily to yt-dlp flags `--windows-filenames --trim-filenames` with app-side sanitizer as defense-in-depth (§7.4). |
| AM-12 | 5.3 | Tailwind CSS v4 is sanctioned as a **build-time-only** styling layer (compiles to static CSS before packaging ⇒ zero runtime weight, honors §5.3's actual target of installer/runtime size). Plain CSS / CSS Modules remain allowed side-by-side where utility classes don't fit. React remains banned — renderer framework stays Preact (AM rationale: identical rendering, ~10× smaller runtime). No UI kits/icon libraries still applies; use inline SVG icons. |
| AM-13 | 7.6 | FFmpeg self-updating is now in scope (was excluded for v1). Updates come from `BtbN/FFmpeg-Builds` **LGPL** `ffmpeg-master-latest-win64-lgpl.zip` + its `.sha256` sidecar (same source as `fetch-binaries.mjs`), checksum-verified before a `tar -xf` extraction, atomic swap into `<userData>/binaries/win32/`, and rollback on failure. Because the rolling build has no comparable version tag, "newer" is detected by comparing the installed build's zip hash (stored in `.ffmpeg-update.json`). The Settings updater is now split into per-driver **yt-dlp** and **FFmpeg** cards (`DriverUpdateCard`). |
| AM-14 | — | In-app keyword search (M8, new — not in the original PRD) has two explicit discovery strategies. YouTube, SoundCloud, and Bilibili use native yt-dlp query extractors (`ytsearch`/`ytsearchdate`, `scsearch`, `bilisearch`). Facebook, Instagram, X, TikTok, and Reddit use best-effort cookie-free DuckDuckGo public-web discovery scoped with fixed `site:` expressions, with Brave Search as a fallback when DuckDuckGo returns a challenge page or no usable links; every discovered URL is then allowlist/path validated and hydrated by its native yt-dlp extractor. Federated discovery is relevance-only and may be incomplete because it uses public result HTML rather than a supported API. `gvsearch` must not be used here: Google currently responds with a JavaScript challenge and yt-dlp returns an empty success playlist. Do not add another platform without defining and testing its discovery strategy, media-URL policy, and capabilities in `SEARCH_PLATFORMS`. |
| AM-15 | 6.3/AM-08 | AM-08's "check-for-updates" covered only the core drivers (yt-dlp/FFmpeg, §7.6) — the app itself had no version-check surface, leaving users with no in-app way to learn a new MediaForge release exists or install it. Closed with a Settings **About** section: resolves the latest tag from `github.com/<owner>/<repo>/releases/latest` (same no-REST-API redirect pattern as §7.6, reusing `resolveLatestTag`/`isNewerVersion`) and compares it against `app.getVersion()`. "View Release" opens that page via `shell.openExternal`. "Download & Install" goes further than the drivers do — it downloads the NSIS installer asset, checksum-verifies it against a `SHA256SUMS` sidecar `release.yml` now publishes (added there for this; same shape as yt-dlp's SHA2-256SUMS), writes it to `<userData>/updates/`, launches it detached, then quits the app so the installer isn't fighting file locks on its own running executable. Still no silent/background auto-update (no `electron-updater`, no differential patching) — this is a user-initiated foreground action, refused while `orchestrator.isBusy()` (an active download would otherwise be killed by the quit). The app never swaps its **own** installed files itself (AM-03's Program-Files rationale applies harder here) — the downloaded installer wizard does that. |
| AM-16 | 5.2/AM-10 | AM-10's idle ceiling (≤120MB) is withdrawn as unachievable and is replaced. Measured on the reference host (Electron 43, Win11), a **bare** Electron window with a blank document costs 310MB summed `workingSetSize` / 142MB summed `privateBytes` across its four processes — the 120MB target fails on both metrics before any application code loads. MediaForge's own marginal cost over that baseline is ~47MB working set / ~46MB private. New budget: **idle ≤200MB summed private, ≤380MB summed working set; marginal cost over a bare-window baseline ≤60MB private**, which is the tracked regression signal. Peak ≤450MB (AM-10) is retained. Both `workingSetSize` and `privateBytes` are recorded; `privateBytes` is the primary figure because working set double-counts shared pages. Baseline is re-measured whenever the Electron major version changes. Evidence: `specs/performance-memory-deep-research.md` §R-01. |

## 3. Locked Technology Decisions

Do not introduce alternatives without updating this section first.

| Concern | Decision | Notes |
|---|---|---|
| Shell | Electron (latest stable major) | Main + preload + renderer |
| Build tooling | `electron-vite` + TypeScript (strict) | One toolchain for main/preload/renderer |
| Renderer framework | **Preact** (+ JSX) | Per owner decision; tiny runtime honors PRD §5.3 |
| State management | `@preact/signals` | Signals only; no Redux/Zustand |
| Styling | Tailwind CSS v4 (build-time only) + plain CSS / CSS Modules | Per AM-12: Tailwind compiles to static CSS pre-packaging, so it adds zero runtime weight. No UI kits, no icon libraries (inline SVG only) |
| Packaging | `electron-builder`, target `nsis` (win32 x64) | Phase 1 ships Windows only |
| Persistence | Hand-rolled JSON store in `<userData>` (atomic write + backup) | No electron-store dependency |
| Unit testing | Vitest | Pure functions must be testable without Electron |
| Lint/format | ESLint (flat config, `typescript-eslint`) + Prettier | CI-equivalent local gate |
| Runtime deps budget | Renderer: Preact + signals ONLY. Main: none beyond Electron itself unless justified in the PR. Build-time tooling (Tailwind, etc.) exempt — it must not ship in the bundle | Keeps installer small (PRD §5.3) |
| Node.js | ≥ 20 LTS | |

### 3.1 Design tokens (renderer)

Themes live in `src/renderer/src/styles/global.css` (`:root` = Warm Studio light,
`:root[data-theme='dark']` = Warm Ember). Prefer **intent-named** Tailwind colors over
opacity washes of `white`/`black`:

| Token | Utility examples | Intent |
|-------|------------------|--------|
| `--color-ink` | `text-ink` | Primary readable text on page/card surfaces |
| `--color-wash-1/2` | `bg-wash-1`, `hover:bg-wash-2` | Subtle hover / chip fills |
| `--color-recess` | `bg-recess` | Recessed wells (inputs, segmented controls, nav) |
| `--color-line` / `--color-line-strong` | `border-line`, `border-line-strong` | Hairline / stronger borders |
| `--color-ink-950` | `bg-ink-950` | Title bar + footer chrome |

`white`/`black` stay **literal** (CTA on-accent text, badge dots). Accent ramps keep their
Tailwind names (`sky-*` = vermillion, `indigo-*` = gold) for historical continuity — treat them
as brand aliases, not literal hues.

Native title-bar colors come from `src/shared/themeChrome.ts` (`THEME_CHROME`);
`windowOptions.ts` imports that module. `tests/unit/themeChrome.test.ts` fails if
`--color-ink-950` in CSS drifts from the manifest.

## 4. Architecture

Three-process model mandated by PRD §5.1:

```
┌─────────────────────────────┐        ┌──────────────────────────┐
│ Renderer (Preact, sandboxed)│  IPC   │ Preload (contextBridge)  │
│ No Node, no fs, no net      │◄──────►│ Exposes typed mf.* API   │
└─────────────────────────────┘        └───────────┬──────────────┘
                                                   │ ipcMain.handle/on
                                       ┌───────────▼──────────────┐
                                       │ Main process             │
                                       │ • BinaryLocator          │
                                       │ • ProcessRunner (spawn)  │
                                       │ • JobOrchestrator        │
                                       │ • ProgressParser         │
                                       │ • SettingsStore          │
                                       │ • UpdaterService         │
                                       │ • DialogService          │
                                       │ • SearchService (M8)     │
                                       └───────────┬──────────────┘
                                    spawn(args[])  │  stdout/stderr lines
                                       ┌───────────▼──────────────┐
                                       │ yt-dlp.exe / ffmpeg.exe  │
                                       └──────────────────────────┘
```

Hard boundaries:

- The renderer performs **zero** filesystem/network/shell operations. All privileged work goes
  through the preload bridge (`window.mf.*`), implemented exclusively with
  `ipcRenderer.invoke` / event subscription.
- Only the main process spawns child processes and touches disk/network.
- Remote content (thumbnails) is loaded by the renderer as plain `<img src="https://…">` only;
  CSP must allow images but nothing else remote (§8).

## 5. Directory Layout

```
mediaforge/
├── AGENTS.md                      ← this file
├── specs/
│   └── MediaForge_Desktop_PRD.md  ← product source of truth
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json                  (+ per-target refs)
├── binaries/                      ← dev-time binaries, GITIGNORED (see §13)
│   └── win32/{yt-dlp.exe, ffmpeg.exe}
├── resources/                     ← packaged assets (icon, license texts)
├── scripts/
│   └── fetch-binaries.mjs         ← dev helper: download current stable binaries
└── src/
    ├── main/
    │   ├── index.ts               ← app lifecycle, window, close-guard (EC-05)
    │   ├── binaries/              ← locator.ts, runner.ts, versions.ts, updater.ts
    │   ├── jobs/                  ← orchestrator.ts, argBuilders.ts, progressParser.ts
    │   ├── media/                 ← metadata.ts (-J parse → typed model), urlCleaner.ts, search.ts (M8)
    │   ├── fsops/                 ← paths.ts, sanitizer.ts, diskSpace.ts
    │   ├── store/                 ← settingsStore.ts, logger.ts
    │   └── ipc/                   ← handlers.ts (all channels registered here)
    ├── preload/
    │   └── index.ts               ← contextBridge exposing `mf` API, nothing else
    ├── shared/
    │   ├── ipcContract.ts         ← channel names + request/response types (single source)
    │   └── models.ts              ← FormatMatrix, JobConfig, JobEvent, Settings, ErrorCode
    └── renderer/
        ├── index.html             ← includes CSP meta tag
        └── src/
            ├── main.tsx           ← Preact mount
            ├── App.tsx            ← screens: Input, Preview/Config, PipelineStatus, Settings
            ├── components/        ← UrlBar, FormatMatrix, ModeSelector, ProgressBar, LogLine…
            │                         SearchBar/SearchResults/SearchScreen (M8)
            ├── signals/           ← appState, jobState, searchState (M8)
            └── styles/            ← *.css (modules)
```

Rules: every module above is importable standalone for unit tests (no top-level Electron
side effects outside `main/index.ts`). Shared types live in `shared/` and are imported by both
processes — the IPC contract is compile-time enforced.

## 6. Security Rules (non-negotiable)

Violations block merge regardless of feature completeness.

1. BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
   `webSecurity: true`. Load only local files; `navigate`/`new-window` events denied except
   explicitly whitelisted external opens via shell (`mf.openExternal`, https-only).
2. Preload exposes ONE object (`window.mf`) with named methods; it must not leak `ipcRenderer`,
   `ipcMain`, `remote`, paths, or environment to the renderer.
3. Every `ipcMain.handle` validates argument shape/type/range in the handler before use.
   Treat renderer input as hostile.
4. Child processes: `spawn(binaryAbsPath, args[], {shell:false, windowsHide:true})` (AM-02).
   Binary path always comes from `BinaryLocator`, never from input.
5. CSP in `index.html`: `default-src 'self'; img-src 'self' https: data:; style-src 'self';
   script-src 'self'; connect-src 'none'`. No inline handlers/styles.
6. Cookies: imported `cookies.txt` is copied into `<userData>/cookies.txt`, passed via
   `--cookies`, never logged, never transmitted anywhere. Provide "clear stored cookies".
7. Updater downloads execute only after SHA-256 verification against that driver's upstream
   checksums (yt-dlp `SHA2-256SUMS`; FFmpeg BtbN `.sha256` sidecar) (AM-03). Reject mismatch → rollback.
8. Logs redact URL query strings and never contain cookie contents or raw env (§11.3).
9. No telemetry, no crash reporting, no analytics. Network egress is limited to: user-requested
   media hosts (via yt-dlp), DuckDuckGo and Brave public-web discovery for an explicit Search
   action (cookie-free),
   thumbnail hosts, GitHub API/releases (updater only).

## 7. External CLI Integration Contract

Single choke point: `src/main/jobs/argBuilders.ts` builds argv arrays; `runner.ts` executes them.
No other file composes CLI arguments.

### 7.1 Metadata extraction

```text
yt-dlp -J --no-warnings <URL>
# playlist enumeration (AM-07):
yt-dlp -J --no-warnings --flat-playlist <URL>
```

Parse stdout as JSON into `MediaMetadata` (title, duration sec, uploader, view_count,
upload_date, thumbnail, `is_live`/`live_status`, `formats[]` → FormatMatrix rows:
format_id, ext, vcodec/acodec, height, fps, abr/tbr, filesize/filesize_approx).

### 7.2 Download job (base args, order-insensitive)

```text
--newline
--no-colors
--windows-filenames
--trim-filenames 200
--ffmpeg-location <resolved ffmpeg.exe>      # lets yt-dlp drive ffmpeg for mux/transcode
-o "<tempJobDir>/%(title).200B [%(id)s].%(ext)s"
--progress-template "download:MF|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"
--progress-template "postprocess:MFPOST|%(progress._percent_str)s"
--print after_move:filepath
```

Progress protocol: lines beginning `MF|` are pipe-delimited machine records → `JobEvent`;
`MFPOST|NN.N%` covers the merge/transcode phase. Any `[Merger]`/`[ExtractAudio]` line also flips
phase label to `merging` defensively. `after_move:filepath` output line (last non-MF line after
completion) is authoritative for the final file path.

### 7.3 Mode selection args

| Mode | Args appended |
|------|---------------|
| Video+Audio, resolution tier H ∈ {4320,2160,1440,1080,720,480,360}, container C ∈ {mp4,mkv,webm} | `-f "bv*[height<=H]+ba/b" -S "res,fps" --merge-output-format C` |
| Audio-only, lossy (MP3/M4A/OGG), bitrate Q ∈ {320K,192K,128K} | `-f ba/b -x --audio-format mp3|m4a|vorbis --audio-quality Q` (OGG → vorbis ⇒ `.ogg`) |
| Audio-only, lossless (FLAC/WAV) | `-f ba/b -x --audio-format flac|wav` — NO bitrate flag (AM-04) |
| Advanced | `-f "<video_format_id>+<audio_format_id>"` (fallback `/b`), merge container from dropdown |

### 7.4 Filename handling

Primary: yt-dlp's own `--windows-filenames --trim-filenames 200`. App-side sanitizer
(`fsops/sanitizer.ts`, used for final rename/destination collision logic) strips `\ / : * ? " < > |`,
control chars 0–31, trailing dots/spaces, reserved device names (CON, PRN, AUX, COM1-9, LPT1-9),
caps length at 200 chars, replaces emoji/non-BMP with `-`. Collision policy: append `_1.._n`
(case-insensitive compare, extension preserved) — PRD §3.4.

### 7.5 Process control

- Version probe: `yt-dlp --version`, `ffmpeg -version` (parsed once at startup, cached).
- Cancel/resume: kill process tree (win32 `taskkill /PID x /T /F`) — AM-09. Resume =
  re-spawn same argv; yt-dlp default `--continue` resumes `.part` files (AM-05).
- Retry ladder on network-class errors (§10): 5s → 15s → 30s → expose Resume button.
- Temp job dir: `<userData>/tmp/job-<uuid>/`, wiped on success-after-verify or via
  startup sweep of orphaned dirs older than 24h (AM-06).

### 7.6 Updater

Both core drivers update into `<userData>/binaries/<platform>/` (AM-03 — never the install dir),
checksum-verified against the upstream shasum, atomically swapped (`.tmp` → rename, `.bak` kept),
run-verified, and rolled back on any failure. `binaries:/getInfo` cache is invalidated after a
successful apply. FFmpeg self-updating is now in scope (see the "Core drivers" update cards).

> **No GitHub REST API.** The unauthenticated `api.github.com` endpoint returns HTTP 403 under
> rate-limit/abuse, so both drivers resolve the release tag via the `github.com/<owner>/<repo>/releases/latest`
> redirect (`resolveLatestTag`) and download assets from the deterministic
> `…/releases/latest/download/<asset>` path (`releaseDownloadUrl`) — the same URLs the
> `fetch-binaries.mjs` dev script already uses.

**yt-dlp**
1. Resolve the latest tag from `https://github.com/yt-dlp/yt-dlp/releases/latest` (redirect).
2. Compare bundled vs release tag (versions are date-based; simple string compare ok).
3. Download `yt-dlp.exe` + the official `SHA2-256SUMS` asset from `…/releases/latest/download/…`;
   hash-check locally (AM-03).
4. Atomic replace into `<userData>/binaries/win32/yt-dlp.exe` (tmp + rename), keep `.bak`.

**FFmpeg**
1. Resolve the latest tag (best-effort, for display) from the `releases/latest` redirect.
2. Download `ffmpeg-master-latest-win64-lgpl.zip` + its `....zip.sha256` sidecar from
   `…/releases/latest/download/…` (LGPL build per §14; same source as `fetch-binaries.mjs`).
3. Hash-check the zip against the sidecar, then extract `ffmpeg.exe` / `ffprobe.exe`.
4. Swap into `<userData>/binaries/win32/`, keep `.bak`. Because the BtbN rolling build has no
   comparable version tag, "newer" is detected by comparing the installed build's zip hash; the
   applied checksum is stored in `.ffmpeg-update.json`.
5. Extraction uses `tar -xf` (spawn with array args, no shell) — Windows 10+ ships bsdtar.

**The app itself (AM-15)** — `src/main/app/appUpdater.ts`. `checkAppUpdate` resolves the latest
tag from `github.com/<owner>/<repo>/releases/latest` (same redirect trick, reusing
`resolveLatestTag`/`isNewerVersion` from the yt-dlp updater), strips the `v` prefix, and compares
it to `app.getVersion()`. The Settings **About** section's "View Release" button just
`shell.openExternal`s the static releases URL.

"Download & Install" calls `downloadAndInstallAppUpdate`, which re-resolves/re-compares (never
trusts a stale prior check), then downloads `${productName}-Setup-${version}.exe` — the exact name
`electron-builder.yml`'s `nsis.artifactName` produces (`installerAssetName`) — plus a `SHA256SUMS`
sidecar that `.github/workflows/release.yml` now computes via `Get-FileHash` and uploads alongside
the installer.

> **Gotcha (confirmed against real releases):** GitHub silently rewrites spaces to periods in a
> release **asset's** filename — the one baked into its download URL — while leaving `SHA256SUMS`'s
> *contents* (opaque text) alone. `MediaForge Desktop-Setup-0.2.2.exe` uploads and downloads as
> `MediaForge.Desktop-Setup-0.2.2.exe`, but `SHA256SUMS` still reads `... MediaForge Desktop-Setup-
> 0.2.2.exe`. Requesting the un-rewritten name 404s. `githubAssetUrlName()` applies the space→period
> rewrite for the download URL only; checksum lookup still uses the original `installerAssetName`.
> If `productName` ever changes to include other GitHub-unsafe characters, re-verify this rewrite
> against a real uploaded asset rather than assuming it's space-only.

It checksum-verifies (reusing `extractExpectedChecksum`/`sha256Hex` from the yt-dlp
updater) before writing anything to disk, writes the verified installer to
`<userData>/updates/`, spawns it detached (array args, `shell:false`, `windowsHide:false` so the
NSIS wizard is visible), then the caller (`main/index.ts`) sets `forceClose = true` and
`app.quit()`s ~800ms later so the installer isn't fighting file locks held by the running
instance. Refuses to start while `orchestrator.isBusy()` — quitting mid-download would kill an
active job. Releases cut before this amendment have no `SHA256SUMS` asset, so "Download & Install"
only works against releases published after it landed; "View Release" always works.

### 7.7 In-app search (M8)

```text
yt-dlp -J --no-warnings --flat-playlist "ytsearch20:lofi hip hop"
```

`SearchService` (`src/main/media/search.ts`) builds native pseudo-URLs via
`buildSearchTarget`/`buildSearchQuery` (`src/main/media/argBuilders.ts`, the §7 choke point).
The whole native query remains one argv element (AM-02). Federated discovery uses the same
allowlisted query builder to request DuckDuckGo's public HTML endpoint without cookies, falling
back to Brave when DuckDuckGo returns no usable result links. Federated
search over-fetches up to 3× (cap 50), admits only platform-specific public media URLs, returns
loading cards, and progressively runs full metadata extraction with concurrency 2.
Generation-based cancellation suppresses stale updates from an earlier search.

Advanced filters remain available for native platforms. Federated platforms force Relevance and
disable advanced filters in both renderer and IPC validation because public-web discovery does not expose
reliable structured fields for those constraints. There is no pagination: a larger `limit`
replaces the result set.

Server-side validation (`parseSearchRequest` in `ipc/handlers.ts`) checks `platform` against the
`SEARCH_PLATFORMS` allowlist, trims/caps `query` to `MAX_SEARCH_QUERY_LENGTH`, and clamps `limit`
to `[1, MAX_SEARCH_LIMIT]` — never trust the renderer's platform id or limit (§6.3).

## 8. IPC Contract

All channel names + payload types live in `src/shared/ipcContract.ts`. Handlers validate inputs.

| Direction | Channel | Payload → Result |
|---|---|---|
| R→M invoke | `analyze:start` | `{url}` → `AnalyzeResult` (metadata + FormatMatrix) or `{error: ErrorCode}` |
| R→M invoke | `analyze:cancel` | `{}` → `{ok}` — awaits process-tree termination (bounded), so the caller can rely on the old tree being gone before starting a new analysis (AM-09) |
| R→M invoke | `analyze:hydrate-range` (R-02) | `{fromIndex, count}` → `{ok}` — hydrates a further slice of the current playlist, streaming the same `analyze:entry` events. No-ops when there is no current playlist, when the range is already hydrated, or when a newer analysis has started |
| R→M invoke | `download:start` | `JobConfig{url, mode, tier?, container?, audioFormat?, bitrate?, formatIds?, destDir}` → `{jobId}` |
| R→M invoke | `download:cancel` | `{jobId}` → `{ok}` |
| R→M invoke | `dialog:chooseDirectory` | `{}` → `{path|null}` (native dialog, defaults last-used) |
| R→M invoke | `settings:get` / `settings:set` | `Settings` / `Partial<Settings>` → `Settings` |
| R→M invoke | `binaries:getInfo` | `{}` → `{ytdlp:{version,source:bundled\|override}, ffmpeg:{version}}` |
| R→M invoke | `updater:check` / `updater:apply` | `{}` → `{current,latest}` / `{ok,newVersion}` |
| R→M invoke | `app:version` (AM-15) | `{}` → `{version}` |
| R→M invoke | `app:update-check` / `app:update-open-release` (AM-15) | `{}` → `{currentVersion,latestVersion,updateAvailable,error?}` / `{ok}` |
| R→M invoke | `app:update-download-install` (AM-15) | `{}` → `{ok,error?}` |
| M→R event | `app:update-phase` (AM-15) | `{phase: checking\|downloading\|verifying\|launching-installer}` |
| R→M invoke | `search:start` (M8) | `SearchRequest{platform, query, limit, sort, filters?}` → `{kind:'ok', results: SearchResultItem[]}` or `{kind:'error', code, message}` |
| R→M invoke | `search:cancel` (M8) | `{}` → `{ok}` — kills both search and preview (chapter/transcript) children (AM-09) |
| R→M invoke | `media:fetch-chapters` / `media:fetch-transcript` | `{url, requestId?}` → `VideoChaptersResult` / `VideoTranscriptResult` |
| R→M invoke | `media:preview-cancel` (P-06) | `requestId` → `{ok}` — kills that preview request's children and blocks any follow-up spawn it would make; fired when a preview closes or its card unmounts |
| M→R event | `search:entry` (M8) | `{sourceUrl, metadataState, patch}` progressive exact-key metadata update |
| R→M invoke | `log:console-open` (P-04) | `{open, includeProtocol?}` → `{ok}` — while the live console is closed, main broadcasts no CLI line at all; entries are still stored and `log:history` supplies the tail on open. Raw `MF\|`/`MFPOST\|` protocol lines are withheld unless `includeProtocol` is set. |
| M→R event | `job:event` | `JobEvent{jobId, phase, percent, speedBps, etaSec, message?}` — routine `downloading-*` samples are coalesced in main at 150 ms, latest-wins per job; phase transitions, terminal phases and anything carrying `message` are never delayed (P-04) |
| M→R event | `job:done` | `{jobId, status: completed\|cancelled\|failed, errorCode?, outputPath?}` |

Phases (PRD §3.6 labels): `analyzing → downloading-video → downloading-audio → merging → finalizing → done`.
For single-stream jobs the two download phases collapse to one.

## 9. Milestone Plan (spec-driven)

Build strictly in order; each milestone ends green (typecheck + lint + tests) before the next.
Each lists PRD coverage and acceptance criteria (AC). A milestone is DONE only when every AC has
an automated or scripted-manual verification noted next to it.

> Phased execution detail — work breakdowns, demo checkpoints, and effort sizing per milestone —
> lives in `specs/Implementation_Plan.md` (P0–P8 ≡ M0–M7).

### M0 — Scaffold & guardrails
Scope: repo init, `electron-vite` + TS strict + Preact scaffold, empty window, CSP, ESLint/Prettier/Vitest wired, shared contract skeleton, gitignore (incl. `/binaries`).
AC: `npm run dev` opens window · security flags asserted by unit test reading window options factory · `npm run typecheck && npm run lint && npm run test` all pass.

### M1 — Binary manager & process runner (PRD §5.1, §6.1–6.2)
Scope: `BinaryLocator` (resolution: `<userData>/binaries/win32` → bundled `resources/binaries/win32` → dev override env `MEDIAFORGE_BIN_DIR`), version probes, `ProcessRunner` spawn wrapper (utf-8 decode, line emitter, windowsHide, kill-tree), logger.
AC: locator order covered by tests incl. override precedence (AM-03) · runner executes a fake fixture exe and emits parsed stdout lines · kill-tree test terminates spawned children.

### M2 — URL engine & metadata module (PRD §3.1–3.2)
Scope: validation (empty/no-scheme rejection), tracking-param strip with retry strategy (try full URL first, strip only on extraction failure — never blind-strip), `media/metadata.ts` mapping `-J` JSON → typed model + FormatMatrix, cancellation, error classification via §10 catalog.
AC: table-driven tests for validator/cleaner · parser tested against checked-in real-world `-J` fixtures (YouTube single, playlist, live) · classifyStderr unit tests per catalog row · cancel aborts within 500ms (scripted).

### M3 — Download pipeline modes A/B/C (PRD §3.3, §3.5–3.6)
Scope: arg builders (§7.3), temp staging, orchestrator emitting `job:event`s, phase labels, final-path capture, cleanup-on-verify, sequential playlist queue (AM-07), Advanced mode format-ID pairing from matrix.
AC: snapshot tests per mode's argv · integration test downloads a small public CC clip end-to-end producing expected container · progress parser feeds synthetic `MF|` fixtures → correct percentages/ETA · temp dir verified empty post-success · second queued entry starts only after first completes.

### M4 — Filesystem integration (PRD §3.4)
Scope: browse dialog defaulting to OS Downloads, persist last-used across restarts, app-side sanitizer (§7.4), collision auto-rename, pre-flight disk space check (AM-06).
AC: sanitizer tests incl. CON/PRN/trailing-dot/control-char/200-char cases · collision `_1/_2` test · persistence survives simulated restart (fresh store read) · low-space preflight aborts before spawn with EC-03 message.

### M5 — Robustness pass (PRD §4, all ECs per amended matrix §10)
Scope: EC-01…EC-07 behaviors, close-guard modal (EC-05), Resume button (EC-04/AM-05), live detection → recording workflow with explicit stop control (EC-06), cookies.txt import flow (EC-07/§6), orphaned-temp sweep.
AC: one scripted/manual repro per EC documented in `specs/ec-verifications.md` and passing · close-guard blocks quit while job active · killed-mid-download job resumes to completion via Resume.

### M6 — Settings & OTA updater (PRD §6.3, AM-03/AM-08/AM-15)
Scope: Settings screen (§9/M6 list), `UpdaterService` (§7.6) with checksum gate + atomic swap + rollback + "Update Core Drivers" surface wired to EC-02 prompt, About section app-version check + download-and-launch-installer flow (AM-15).
AC: updater against mocked release API (vitest, no network) · tampered-binary test rejects swap and rolls back · swapped override visible in `binaries:getInfo` after relaunch · app-update check against mocked release feed reports `updateAvailable` correctly for older/equal/newer tags (vitest, no network) · app installer download+install rejects a tampered `SHA256SUMS` mismatch without writing or launching anything, and refuses to run when already up to date (vitest, no network).

### M7 — Package, measure, ship (PRD §5.2–5.3, §6)
Scope: electron-builder NSIS config bundling binaries, icon/licensing page (§14), memory profiling harness (AM-10 methodology), installer size report, clean-VM smoke matrix.
AC: installer builds and installs on clean Win10 + Win11 VM · happy-path download works there · idle RSS ≤120MB and peak Electron RSS ≤450MB recorded in `specs/perf-report.md` (or deviations approved) · installer size reported vs ≤180MB budget.

### M8 — In-app platform search (AM-14, new — not in the original PRD)
Scope: a dedicated **Search** tab (own nav item, alongside Downloader/Queue/Settings) for
native keyword search on **YouTube, SoundCloud, and Bilibili**, plus best-effort federated public
video discovery for **Facebook, Instagram, X, TikTok, and Reddit** (§7.7/AM-14).

- **Search bar** (`SearchBar.tsx`): three sections in one control — left is a platform picker
  (`Segmented`, `SEARCH_PLATFORMS`), middle is the query input, right is the Search/Cancel button.
  A far-right **Filters** toggle opens an inline panel (not a floating popover, to avoid
  outside-click handling for v1): sort (Relevance / Newest — Newest only offered where a
  `dateSortPrefix` exists), result count (`SEARCH_RESULT_LIMITS`), min/max duration, min views.
- **Results** (`SearchResults.tsx`): a card grid below the bar reusing `EntryThumb`/`CheckSquare`
  from the playlist-entries UI for visual consistency. Multi-select toolbar offers **Open in
  Downloader** (exactly one selected — dispatches a `mf:analyze-url` window event that `UrlBar`
  listens for, switching to the Downloader tab and running a normal full analysis on that one
  URL) and **Add to Queue** (one or more selected — opens a quality-preset modal reusing
  `ModeSelector` with `formats: []`, exactly like queuing an already-analyzed playlist, then feeds
  the same `runQueue`/`runParallelQueue` pipeline via `App.tsx`'s `launchQueueFromSearch`).
- **Main process**: `SearchService` (§7.7) — one flat discovery call per search, URL/path
  validation for federated results, progressive bounded-concurrency metadata hydration, and
  generation-scoped process cancellation separate from `AnalyzeService`.
- **IPC**: `search:start` / `search:cancel` (§8), request/response validated server-side
  (`parseSearchRequest`) against `SEARCH_PLATFORMS`, `MAX_SEARCH_QUERY_LENGTH`, `MAX_SEARCH_LIMIT`.

AC: `buildSearchQuery` unit-tested for prefix/limit/query composition and limit clamping ·
`SearchService` unit-tested for platform/query validation short-circuiting before any process
spawn (mirrors the `AnalyzeService` input-validation tests) · federated URL policies, metadata
updates, and stale-generation suppression unit-tested · typecheck/lint/test gate green · manually
verified: one public result per platform can be opened in Downloader and downloaded through the
existing queue pipeline; external rate limits surface an actionable error.

## 10. Error Catalog & Edge Case Matrix (amended)

`classifyStderr(stderrLines): ErrorCode` — extend this table whenever new patterns appear; every
code maps to exactly one user-facing string.

| Code | Trigger patterns (stderr/stdout) | Behavior (per PRD §4 as amended) |
|---|---|---|
| `MF_OFFLINE_OR_PRIVATE` | `Video unavailable`, `has been removed`, `Private video`, `members-only` | EC-01 message, input re-enabled |
| `MF_AGE_RESTRICTED` | `Sign in to confirm your age`, `age-restricted` | EC-07 modal + link to cookie import in Settings |
| `MF_BOT_CHECK` | `Sign in to confirm you're not a bot` | Same as EC-07 flow |
| `MF_NETWORK` | `getaddrinfo`, `ENOTFOUND`, `Connection reset`, `timed out`, `Unable to download webpage` | Retry ladder 5/15/30s → Resume button (AM-05) |
| `MF_RATE_LIMITED` | `HTTP Error 429`, `403` | Backoff + message suggesting later retry |
| `MF_UNSUPPORTED_SOURCE` | `Unsupported URL` | Valid-looking link that yt-dlp has no extractor for — show a clear "unsupported source" message (no Update Core Drivers) |
| `MF_EXTRACTOR_STALE` | `Unable to extract`, `No video formats found`, `Did not get any formats` after URL validated OK | EC-02: point to Update Core Drivers |
| `MF_DISK_FULL` | `ENOSPC`, `No space left` | EC-03: halt, state missing bytes if known, keep partials |
| `MF_LIVE_STREAM` | metadata `is_live/live_status=is_live` | EC-06: switch to recording workflow + Stop control |
| `MF_CANCELLED` | internal | Keep partials, idle UI (AM-09) |
| `MF_UNKNOWN` | fallback | Generic message + open-logs action |

Disk-full during write is additionally caught via pre-flight estimate + spawn error handling.

## 11. Supporting Subsystems

**11.1 Settings schema:** `{ lastOutputDir: string, defaultOutputDir: 'Downloads', cookieFileSet: boolean, theme?: 'system' }` — atomic JSON writes (`write-tmp-then-rename`), corrupted file → rebuild defaults, never crash.

**11.2 Window close-guard (EC-05):** active job ⇒ intercept `close`, show Confirm-Cancel /
Run-in-Background modal; background mode hides window, job continues, tray indicator shown.

**11.3 Logging:** `<userData>/logs/mf-YYYY-MM-DD.log` (main) + per-job child logs; retention 7 days;
levels DEBUG/INFO/WARN/ERROR; redact URL queries, cookies, absolute user paths optional-off;
every `MF_*` error logs full sanitized stderr under DEBUG for diagnostics.

## 12. Testing Requirements

- **Unit (Vitest):** urlCleaner, argBuilders (snapshot argv), progressParser (synthetic streams),
  sanitizer, classifyStderr, locator precedence, settingsStore atomicity, `buildSearchQuery` +
  `SearchService` input validation (M8, §7.7). No Electron imports — keep logic in pure modules.
- **Integration:** runner against stub executables in `tests/fixtures/fake-bin/` (scripts that
  emit canned `MF|` lines, hang, exit non-zero, etc.). Real-network tests are opt-in
  (`MF_E2E_REAL=1`) and hit one small public Creative Commons clip only.
- **Fixtures:** committed real `-J` dumps (redacted) for YouTube-single / playlist / live.
- **Manual matrices:** EC repro scripts (M5), clean-VM smoke (M7) — recorded in `specs/`.
- Every bug fix ships with the regression test that would have caught it.

## 13. Commands

```bash
npm install
npm run fetch-binaries   # dev only: downloads current stable yt-dlp.exe + ffmpeg essentials build → ./binaries/win32 (gitignored; never commit binaries)
npm run dev              # electron-vite dev (HMR renderer, watch main)
npm run typecheck
npm run lint             # eslint + prettier --check
npm run test             # vitest run
npm run build            # typecheck + electron-vite build
npm run dist             # build + electron-builder --win nsis
MEDIAFORGE_BIN_DIR=D:\path\to\bins   # dev override for BinaryLocator
```

Gate before any commit: `npm run typecheck && npm run lint && npm run test`.

## 14. Licensing & Distribution Notes

- Bundle FFmpeg **LGPL-based** builds where possible (no `--enable-gpl` components) to minimize
  obligations; ship `resources/LICENSES/` with yt-dlp (Unlicense), FFmpeg license, Electron.
- yt-dlp.exe is a PyInstaller onefile (~17MB) — acceptable size cost; do not substitute pip installs.
- Windows code signing (OV at minimum) removes SmartScreen's "Unknown publisher" warning, but an
  OV cert alone doesn't grant instant trust — only a pricier EV cert does; unsigned installers keep
  triggering "Windows protected your PC." **Decision (no-cert path):** given the cost, we're not
  signing for now — `electron-builder.yml`'s signing block stays a placeholder. Mitigated instead
  with a documented workaround (README "Note on Windows SmartScreen": click **Run anyway**) plus
  the in-app SHA-256 checksum verification already covering both the core-driver updaters (§7.6)
  and the app's own installer download (AM-15) — the warning is real but the file underneath is
  still verified. Revisit if/when distribution scale justifies the cert cost.
- Respect robots/ToS realities: app is a passive client; add first-run notice that users are
  responsible for complying with source-site terms (legal hygiene, no nagging).

## 15. Cross-Platform Extension Guide (post-v1)

Both tools officially ship native builds for every target below — compatibility is confirmed;
extension work is packaging/signing only. Platform map (extend `BinaryLocator`):

| `process.platform` | `process.arch` | Binary dir | yt-dlp artifact | FFmpeg artifact |
|---|---|---|---|---|
| `win32` | `x64` | `win32/` (v1) | `yt-dlp.exe` | gyan/BtbN essentials `ffmpeg.exe` |
| `darwin` | `arm64` | `darwin-arm64/` | `yt-dlp_macos` (universal zipapp) | static arm64 build (vendor & pin) |
| `darwin` | `x64` | `darwin-x64/` | `yt-dlp_macos` | static x86_64 build (evermeet.cx, pin) |
| `linux` | `x64` | `linux-x64/` | `yt-dlp_linux` | johnvansickle static / BtbN |
| `linux` | `arm64` | `linux-aarch64/` | `yt-dlp_linux_aarch64` | BtbN arm64 static |

macOS specifics: chmod +x via electron-builder `afterPack` hook; Gatekeeper — proper path is
signing + notarizing the whole bundle (ad-hoc sign + `xattr -dr com.apple.quarantine` at
first-run is the fallback, worse UX); the AM-03 userData-override design already prevents
signature invalidation by the updater. Linux specifics: preserve exec bits in package scripts;
AppImage recommended first, then deb/rpm; optionally fall back to discovered system
`/usr/bin/ffmpeg` if bundled missing. Revisit AM-03 wording per-platform when adding targets.

## 16. Out of Scope (v1)

From PRD §7 plus agreed additions: parallel/concurrent jobs; timeline editing; cloud sync;
subtitles/captions handling; i18n (English-only v1); accessibility beyond baseline semantic HTML;
telemetry/crash reporting; macOS/Linux builds (documented in §15, not shipped).

## 17. Definition of Done (any change)

1. Typecheck, lint, tests green (`npm run …` gate, §13).
2. New behavior has tests matching its milestone AC (§9) or an updated scripted-manual repro.
3. Touching IPC/spawn/fs? Re-audit §6 checklist items affected.
4. No new runtime dependency without a PR-note justifying it against §3 budget.
5. User-visible errors render catalog messages (§10), never raw CLI stderr.
6. Docs: update amendment log (§2) if behavior intentionally diverges from the PRD.
