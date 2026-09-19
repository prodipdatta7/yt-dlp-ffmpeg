# F1 — Clip / chapter / subtitle downloads (execute the v2 plan)

**Recommendation strength:** Strong (spec written, UI half-built) · **Effort:** L · **Risk:** medium

## Current state

The renderer already *browses* chapters and transcripts in the theater preview
(`TheaterPreview.tsx`), but there is no way to **download** a chapter range, clip, or
subtitle file. Users must download the whole video and cut/convert externally.

`specs/clip-chapter-subtitle-metadata-implementation-plan-v2.md` is the complete,
current spec (the v1 plan was superseded in commit `dbbbb9f`). Its **M9.0 gate**
requires landing amendments **AM-17…AM-20** in AGENTS.md §2 first (clip args live in
the argBuilders choke point; subtitle downloads via `--write-subs`/`--convert-subs`;
metadata sidecars opt-in; all through the existing spawn contract).

## Dependencies (hard gates)

1. **P4 must land first.** The v2 plan itself (L598-612, item L-03) documents that
   `parseJobConfig` silently drops fields today; the new clip/chapter/subtitle fields
   on `JobConfig` would be dropped the same way `audioBoost`/`isLive` were. P4's
   round-trip test is the standing guard.
2. **AM-17…AM-20** written into AGENTS.md §2 before implementation starts (M9.0).

## Scope (from the v2 plan)

- Chapter-range / timestamp-range selection in the preview UI (chapter browsing UI
  largely exists — extend with selection).
- Args in the §7 choke point only: `--download-sections` + `--force-keyframes-at-cuts`
  for clips; `--write-subs` / `--write-auto-subs` / `--convert-subs srt` for subtitles;
  optional metadata/thumbnail sidecars as additional job artifacts.
- Job model gains clip range + subtitle selections; pipeline reports multi-artifact
  outputs (final path + sidecars) through the existing `job:done` payload.

## Constraints (AGENTS.md)

- §7: **all** new CLI args are composed in `src/main/jobs/argBuilders.ts` — nowhere else.
- AM-02: ranges and language codes are argv elements, never string-concatenated.
- §6.3: `parseJobConfig` validates range shape (`*HH:MM:SS-HH:MM:SS` / chapter indices)
  and subtitle language allowlists server-side.
- §7.4/AM-06: sidecar artifacts join the verify-then-cleanup rule (final outputs exist
  and are >0 bytes before temp wipe).
- §10: new failure modes (e.g. "Requested format is not available" for sub-only runs)
  map to catalog codes, never raw stderr.
- §3 budget: selection UI uses existing Preact + signals + inline SVG only.

## Implementation steps

1. Land AM-17…AM-20 in AGENTS.md §2 (per v2 plan M9.0 wording).
2. Land P4 (validation base + round-trip test).
3. Extend `JobConfig`/`MediaMetadata` shared models; server-side validation for the
   new fields (ranges, languages, sidecar flags).
4. argBuilders: clip/subtitle/sidecar argv + snapshot tests per mode (mirroring §7.3's
   existing snapshot style).
5. Orchestrator: multi-artifact finalization (collect every output path; verify each
   >0 bytes; report all in `job:done`).
6. Renderer: range/chapter selection in preview; per-artifact rows in the download
   summary (the v0.3.0 summary components already show output-size verification —
   extend, don't replace).
7. Local Share (v0.4.0) should serve the new artifacts — coordinate with F2's MIME
   map (`.srt/.vtt/.json`).
8. Tests: argBuilder snapshots; parseJobConfig round-trip incl. new fields;
   integration against fake-bin fixture producing a clip + `.srt`; cleanup verified
   only after all artifacts exist.

## Acceptance criteria

- [ ] Download a chapter range end-to-end (opt-in real-network test `MF_E2E_REAL=1`
      on the small CC clip) producing a playable trimmed file.
- [ ] Subtitle-only and video+subtitle runs produce verified `.srt` artifacts.
- [ ] All new args snapshot-tested in argBuilders; all new fields round-trip-tested.
- [ ] Multi-artifact cleanup follows AM-06 (temp retained on any partial failure).
- [ ] AGENTS.md amendment log updated (AM-17…AM-20).
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Highest user value on the board: this is the most-requested feature class for
  downloader GUIs, and half the UI already exists.
- P3's retained-metadata cache makes chapter/subtitle availability instant in the
  preview — land P3 before or alongside for the best UX.
