# EC Verifications — Robustness Matrix Evidence

One verification per edge-case row of the PRD §4 matrix (as amended by AGENTS.md §2).
"Scripted" = automated vitest coverage; "Manual" = scripted manual repro with expected result.

## EC-01 — Dead / private / offline media link

- **Behavior:** friendly catalog message, input re-enabled, no crash. Never raw stderr.
- **Scripted:** `tests/unit/classifyStderr.test.ts` maps `Video unavailable`, `has been removed`,
  `Private video`, `members-only` → `MF_OFFLINE_OR_PRIVATE`; renderer renders
  `ERROR_MESSAGES[code]`.
- **Real-world:** confirmed 2026-08-22 — dead canonical ID `BaW_jenozKc` returned
  "Video unavailable" and surfaced the catalog message in-app.

## EC-02 — Platform player change broke extraction

- **Behavior:** `MF_EXTRACTOR_STALE` message points to "Update Core Drivers" (updater ships P7).
- **Scripted:** classify tests cover `Unable to extract`, `Unsupported URL`.
- **Manual:** until P7 lands, verify the error text names the Settings action.

## EC-03 — Disk runs out of space

- **Behavior:** abort BEFORE spawn when estimate known (AM-06); runtime `ENOSPC` classifies to
  `MF_DISK_FULL`; partials retained.
- **Scripted:** `tests/unit/diskSpace.test.ts` — insufficient-space rejection with zero temp dirs
  created; margin rule table; statfs ancestor resolution.

## EC-04 — Network drops mid-download

- **Behavior:** retry ladder 5s→15s→30s re-spawning identical argv (yt-dlp resumes `.part`
  natively); deterministic temp dir per URL guarantees resume continuity; afterwards a
  **Resume Download** button restarts into the same dir.
- **Scripted:** `tests/unit/robustness.test.ts` — flaky fixture fails twice then succeeds;
  exactly two visible "retrying…" events; attempt counter proves 3 executions; failed attempt
  leaves the hashed job dir intact for relaunch.
- **Manual:** start a large download, disable Wi-Fi ~10 s, observe amber retry banner,
  reconnect, confirm completion or use Resume Download.

## EC-05 — Window closed while job active

- **Behavior:** native warning modal offers **Run in Background** (hide window + tray icon,
  job continues) / **Cancel Download & Exit** (kill tree, quit) / Stay.
- **Manual repro:** start any download → click window ✕ → choose "Run in Background" →
  verify tray icon appears, window hides, log continues writing progress → tray ▸ Show
  MediaForge restores it. Repeat choosing "Cancel Download & Exit" → app exits, partials kept.

## EC-06 — Live stream instead of VOD

- **Behavior:** analysis flags `is_live`; download enters recording workflow; cancel control
  becomes **Stop Recording & Save** which finalizes the `.part` capture as a completed file.
- **Scripted:** fixture-mapped metadata marks live (`metadata.test`); `robustness.test`
  live-stop converts an in-flight `.part` into a verified saved file and wipes temp.

## EC-07 — Age-gated / bot-checked content

- **Behavior:** classifier routes to `MF_AGE_RESTRICTED` / `MF_BOT_CHECK`; error banner shows an
  **Import cookies.txt…** deep-link; imported file lives at `<userData>/cookies.txt`, passed via
  `--cookies` for analyze AND download, never logged; footer provides import/clear actions.
- **Scripted:** classify tests for both codes; cookie argv inclusion covered by arg builder
  contract (optional param appends `--cookies <path>`).
- **Manual:** export cookies.txt from a signed-in browser (Netscape format), import via the
  banner, re-run the gated URL; then Clear cookies and confirm the file is removed.
