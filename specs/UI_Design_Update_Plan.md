# MediaForge Desktop — UI/Theming Design Update Plan

**Status: Implemented — 2026-09-09.** Phases D0–D3 landed on `feature/ui-fix`. App-shell
self-updater (`electron-updater`) remains a follow-up spec (needs release-signing infra).

Companion to `specs/Implementation_Plan.md`. This plan does not touch download/engine logic —
scope is the renderer's design system, theming architecture, and the UX gaps that separate the
current build from a production-grade desktop app. Findings are from a full read of
`src/renderer/src/**` and `src/main/windowOptions.ts` on 2026-09-09. D2a is the explicit exception
that touches `orchestrator.ts` for bounded playlist concurrency.

**Rules of engagement**

1. Order D0 → D3. D0 is a prerequisite for D1–D3 because it changes the token names those phases
   style against — doing D1–D3 first means redoing them.
2. Gate before closing any phase: `npm run typecheck && npm run lint && npm run test`, plus a
   manual pass in both themes (`Settings → Appearance → Light/Dark/System`) at the min window
   size (960×620).
3. No behavior change to job orchestration, IPC, or binary management in this plan — renderer
   presentation and `windowOptions.ts` chrome colors only. **Exception:** D2's playlist
   parallel-download item necessarily touches `src/main/jobs/orchestrator.ts` (see D2) because the
   UI choice is meaningless without real backend concurrency — called out explicitly there.
4. Effort sizes: S ≤ 1 day · M ≤ 3 days · L ≤ 1 week (single dev, indicative only).

---

## Overview

| Phase | Theme | What changes |
|-------|-------|---------------|
| D0 | Token foundation | Replace the inverted `white`/`black` hijack with real semantic tokens; single source of truth shared with `windowOptions.ts`; contrast pass |
| D1 | Accessibility | Keyboard support on interactive rows, `aria-live` status regions, restore text selection on read-only content |
| D2 | Production UX features | Queue persistence, per-row retry/reorder, OS completion notifications, conditional parallel playlist downloads (D2a) |
| D3 | Polish | Shortcuts palette, first-run notice as modal, responsive behavior at min window size |

---

## D0 — Token foundation `[theming]` · effort **M**

**Problem.** `global.css` remaps `--color-white`/`--color-black` per theme (light: `white =
#2a2118`, `black = #fffdf9` — inverted from their names) so that dark-mode-authored utilities like
`bg-white/[0.04]`, `border-white/10`, `bg-black/30` resolve correctly in both themes without
rewriting component markup. This works today but:

- Any new utility touching `white`/`black` semantically (`ring-white`, `fill-white`,
  `shadow-white`, `from-white`) silently inverts too — a future edit will misread the markup.
- Washes tuned for a dark canvas aren't independently art-directed for light mode. `NavRail`'s
  `bg-black/25` (`App.tsx:133`), and `bg-black/20`/`bg-black/30` inputs in `SettingsScreen.tsx`,
  `ModeSelector.tsx`, `FormatMatrix.tsx` become near-white washes on a cream body in light mode —
  little to no visible separation.
- Tailwind palette names lie about rendered content (`sky-*` → vermillion/orange, `indigo-*` →
  amber/gold), which is confusing for anyone who didn't author the mapping.
- `windowOptions.ts:21-27` hardcodes native title-bar chrome colors as raw hex with a
  comment-enforced "keep in sync with `--color-ink-950`" — no actual mechanism prevents drift.
- A few spots escape theming entirely: `LogConsole.tsx:158` (`bg-slate-900/95` "Jump to latest"
  button, fixed-dark in both themes), `PreviewPanel.tsx` card shadows using raw
  `rgb(67 45 20 / 0.45)`.
- No verified contrast ratios post-inversion (e.g. `text-slate-700`/`text-slate-600` used for
  timestamps/index numbers in `LogConsole.tsx`, `QueueList.tsx`).

**Build items**

- Introduce intent-named tokens (e.g. `--surface-wash-1/2/3`, `--surface-inverse`,
  `--line-hairline`, `--line-strong`) in `global.css`, defined once per theme block — no token
  whose light/dark values are literal inversions of a same-named Tailwind color.
- Sweep `src/renderer/src/components/*.tsx` and `App.tsx` replacing literal `bg-white/[…]`,
  `bg-black/[…]`, `border-white/[…]` utility usage with the new tokens (or thin `mf-*` utility
  classes in `global.css`, consistent with existing `mf-card`/`mf-hairline` pattern).
- Extract a single token manifest (small `.ts`/`.json`) that both `global.css` (via a build step or
  hand-kept `@theme` block) and `windowOptions.ts::chromeThemeColors` read from, so the native
  title bar cannot drift from the CSS surface color without a build/test failure.
- Fix the two hardcoded-dark spots (`LogConsole.tsx` jump-to-latest chip, `PreviewPanel.tsx`
  shadows) to use theme tokens.
- Run a contrast audit (WCAG AA, 4.5:1 body / 3:1 large text) on both themes for every `slate-600`
  through `slate-800` text usage; adjust ramp stops that fail.
- Update `AGENTS.md`/README design-token section (or add one) documenting the token intent map, so
  a future contributor doesn't have to reverse-engineer the palette naming.

**Gate:** visual diff review in both themes at 960×620 and at a larger window; automated contrast
check (script or manual axe DevTools pass) on the token sweep; quality gate green.

---

## D1 — Accessibility `[a11y]` · effort **S**

**Problem.**

- `FormatMatrix.tsx:185-193` — table rows are `<tr onClick>` with no `tabIndex`/keydown handler;
  picking a stream for Advanced mode is mouse-only.
- Status/error transitions (`PipelineStatus.tsx`, `UrlBar.tsx` analyze errors, `QueueList.tsx`)
  aren't wrapped in an `aria-live` region — screen reader users get no announcement when a job
  fails, completes, or pauses.
- `global.css:222` sets `user-select: none` on `body` with only `input`/`textarea` opted back in —
  video titles, error text, and the completed `outputPath` (`App.tsx:302`, shown only via a `title`
  tooltip) can't be selected or copied.

**Build items**

- Make stream rows keyboard-operable: `tabIndex={0}`, `role="button"`, `onKeyDown` (Enter/Space) in
  `FormatMatrix.tsx`, matching the existing `mf-focus-ring` visual treatment already used
  elsewhere.
- Add `aria-live="polite"` (or `assertive` for failures) regions around: `PipelineStatus` status
  label + failure message, `UrlBar` analyze error panel, `QueueList` per-row status changes.
- Re-enable `user-select: text` on read-only informational text (titles, output paths, error
  copy, log lines) while keeping chrome (nav, buttons, tabs) non-selectable; add a small copy
  button next to `done.outputPath` in `PipelineStatus.tsx`.

**Gate:** keyboard-only pass through analyze → pick stream (Advanced) → start → cancel; screen
reader smoke test (Narrator) confirms status changes are announced; quality gate green.

---

## D2 — Production UX features `[features]` · effort **L**

**Problem.** Several gaps separate this from a shippable desktop tool: queue is strictly
sequential with no reordering or per-row retry (`QueueList.tsx`), nothing persists across app
restarts, there's no OS notification when a background download finishes, the app has no
self-updater (only `yt-dlp`/`ffmpeg` update via `DriverUpdateCard`), and playlists have no
concurrency option at all.

**Build items**

- Queue: drag-to-reorder pending rows; per-row "Retry" action for `failed` rows (not just the
  single global "retry last failed" in `PipelineStatus.tsx`); persist `queueRows` +
  `activeJob`/`selection` context to `settingsStore` (or a dedicated store) so relaunching the app
  after a crash/close shows the prior queue state instead of losing it.
- OS notification (Electron `Notification` API) on job completion/failure when the window is
  unfocused or minimized; respect a Settings toggle.
- Evaluate `electron-updater` for the app shell itself (separate from the existing
  yt-dlp/ffmpeg driver updater in `SettingsScreen.tsx`) — scope as its own follow-up spec if it
  needs release-signing infra not yet in place.

### D2a — Conditional parallel playlist downloads

**Problem.** Playlists always download sequentially, one entry at a time (`App.tsx::runQueue`).
Some users want throughput (parallel), some want a controlled sequential run (bandwidth-limited
connections, or platforms that rate-limit concurrent requests from one client). This has to be a
per-run choice, not a global setting, because the two modes need different in-flight controls —
"Stop After Current" (`QueueList.tsx:91-98`, `App.tsx::stopAfterCurrent`) is a sequential-only
concept; there is no single "current" item once several entries are downloading at once.

**UI**

- For playlist results only, replace the single "Download Selected/All · N" CTA
  (`App.tsx:757-771`) with **two buttons**, secondary/primary pair in existing button styling:
  "Download Sequentially" (`btnGhost`-weight, current behavior, one at a time) and "Download in
  Parallel" (`btnPrimary`-weight, new). Single-video results keep the existing one-button flow —
  this only applies where there's a queue at all.
- Concurrency cap: default **3** concurrent jobs. Add a "Downloads" field to `SettingsScreen.tsx`
  (numeric stepper, bounds 2–5) so it's adjustable but never unbounded — no free-text input, no
  "unlimited" option, since it directly governs simultaneous yt-dlp/ffmpeg processes and disk I/O.
- Running-state controls diverge by mode in `QueueList.tsx`:
  - **Sequential** (existing): "Stop After Current" + "Cancel All".
  - **Parallel**: drop "Stop After Current" entirely (it has no referent) — only "Cancel All"
    (stop everything in flight) plus a per-row cancel button (✕) on each `downloading` row, wired
    to `cancel(jobId)` on the map-based orchestrator below. A row that finishes or is cancelled
    immediately backfills the next pending entry up to the concurrency cap.
- Multiple simultaneous `downloading` rows need independent progress (percent/speed/ETA), not one
  shared readout — see backend note below. Failures in one row are isolated: a failed parallel
  entry shows its own `failed` state with its own per-row "Retry" (reuses the D2 per-row retry
  build item) and does not stop or pause sibling rows.

**Backend (required — the UI choice is inert without this).**

- `src/main/jobs/orchestrator.ts::DownloadOrchestrator` currently hard-serializes: a single
  `activeJob: ActiveJob | null` field, and `launch()` throws `MfLaunchError` if one is already set
  (`orchestrator.ts:138-141`). This needs to become a `Map<jobId, ActiveJob>` bounded by the
  concurrency cap, with `cancel(jobId)` and per-job retry/finish logic operating on one map entry
  instead of the single field.
- The disk-space preflight (`freeDiskSpaceBytes`/`isDiskSpaceInsufficient`, called once per
  `launch()`) has to reserve against the **sum** of all jobs currently launching in the same batch,
  not just the one being launched — otherwise N parallel launches can each individually pass the
  check and collectively overrun free disk before any single job would have caught it.
- `JobEvent`/`JobDonePayload` (`src/shared/models.ts`) already carry a `jobId`, so the wire
  protocol is fine as-is. The renderer's collapse of that into singleton signals
  (`activeJob`, `lastJobEvent`, `jobDone` in `src/renderer/src/signals/jobState.ts`) is what
  assumes one job at a time — this needs to become a per-jobId map so `QueueList`/`PlaylistEntries`
  can render N independent live progress rows instead of all "live" rows sharing one global event.
- `queueRunning` (`src/renderer/src/signals/queueState.ts`) stays a fine top-level "is a queue run
  active at all" flag; `App.tsx::runQueue` needs a parallel counterpart that launches up to the
  concurrency cap at once and backfills as slots free, instead of the current `for` loop that
  `await`s each entry before starting the next.

**Gate:** a playlist run in parallel mode shows ≥2 rows genuinely `downloading` simultaneously with
independently-updating percent/speed/ETA; "Cancel All" stops every in-flight entry; disk-space
preflight correctly rejects a parallel batch whose combined estimate exceeds free space even when
no single entry's estimate would have; sequential mode is unchanged.

**Gate (queue/notifications/updater items above):** kill and relaunch app mid-queue → prior queue
state recoverable; minimize during a download → OS notification fires on completion; quality gate
green.

---

## D3 — Polish `[polish]` · effort **M**

**Problem.** Discoverability and small-window behavior are unpolished: `Ctrl+K/L` and `` Ctrl+` ``
exist but aren't discoverable (no menu bar — `autoHideMenuBar: true` — and no cheat sheet); the
first-run compliance notice (`App.tsx:795-812`) is a dismissible bottom strip that can be missed
and competes visually with the log-dock toggle; layout uses fixed pixel widths
(`grid-cols-[minmax(0,1fr)_380px]`, 280px log dock) untested against the 960×620 minimum window.

**Build items**

- Add a lightweight shortcuts overlay (`?` or a rail icon) listing existing bindings.
- Convert the first-run compliance notice to a one-time modal gate instead of a dismissible
  footer strip.
- Manually verify and adjust the aside/log-dock breakpoints so nothing clips or overlaps at
  960×620 with the log dock open.

**Gate:** manual pass at min window size with log dock open + a playlist result showing; quality
gate green.

---

## Out of scope

- Internationalization/localization.
- Any change to `src/main/binaries/*` or the IPC contract shape (`src/shared/ipcContract.ts`,
  `src/shared/models.ts` field definitions) — D2a's orchestrator work reuses the existing `jobId`-
  tagged event/done payloads as-is.
- `src/main/jobs/orchestrator.ts` changes are scoped strictly to D2a (bounded concurrency); no
  other change to job orchestration, retry ladder, or process spawning is in scope here.
