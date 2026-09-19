# P4 — `parseJobConfig` silently drops fields: audio boost and live Stop & Save are dead code

**Recommendation strength:** Strong (defect) · **Effort:** S · **Risk:** low

## Problem

`JobConfig` (`src/shared/models.ts`) declares `audioBoost` and `isLive`. The
server-side validator `parseJobConfig` (`src/main/ipc/handlers.ts` L636-742) **reads
neither**, and none of its three per-mode return objects (L681, L705, L727) forwards
them. Consequences:

- The **Audio Boost selector is dead UI** — the renderer collects it, main drops it.
- **`orchestrator.finalizeLiveRecording` (Stop & Save) is unreachable** in shipped
  code, because `isLive` never survives IPC validation.

This is documented as **L-03** in
`specs/clip-chapter-subtitle-metadata-implementation-plan-v2.md` (L598-612). The
three branches each re-specify `url/destDir/estimatedBytes/playlistTitle`, so every
new `JobConfig` field must be added in 3+ places — a defect-multiplier. The v2 clip /
chapter fields (F1) would fall into the same trap, which is why **P4 gates F1**.

Adjacent friction: `extractUrl` (L622-628) and `parseSearchRequest` (L541+)
re-implement overlapping trim/length/pattern checks.

Root cause of it shipping: `src/main/ipc/handlers.ts` (683 LOC, 40+ channels, the
hottest file in the repo at 27 recent changes) has **no direct unit test**.

## Solution

1. Restructure `parseJobConfig` to build **one validated `base` object** (url, destDir,
   estimatedBytes, playlistTitle, audioBoost, isLive, …) that every mode branch spreads,
   adding only its mode-specific fields.
2. Parse `audioBoost` against an allowlist; `isLive` as strict boolean; reject unknown
   shapes per §6.3 (treat renderer input as hostile).
3. Add a **round-trip test**: for each mode, assert every declared `JobConfig` field
   survives validation — the permanent guard that keeps L-03 closed.
4. Consolidate the URL trim/length/pattern checks into one helper used by both
   `extractUrl` and `parseSearchRequest`.
5. Create `tests/unit/ipcHandlers.test.ts` — the file's first direct test suite —
   starting with the `parseJobConfig` / `parseSearchRequest` validation tables.

## Constraints (AGENTS.md)

- §6.3: validation stays server-side, shape/type/range checked.
- AM-02: the forwarded `audioBoost` value flows into ffmpeg args via argBuilders only
  (the §7 choke point) — never string-concatenated.
- No behavior change for well-formed existing callers beyond the two fields now
  working as the UI always implied.

## Implementation steps

1. Write the failing round-trip test first (proves `audioBoost`/`isLive` drop today).
2. Refactor to the shared `base` + per-mode spread; forward the two fields.
3. Verify `orchestrator` consumes `audioBoost` in the audio-mode arg builder (add the
   ffmpeg `-af volume=` filter there if absent) and that `isLive` reaches
   `finalizeLiveRecording`'s gate.
4. Consolidate URL validation helpers; delete duplicated checks.
5. Fill out `ipcHandlers.test.ts` with table-driven invalid-input cases (wrong types,
   out-of-range tier/bitrate, unknown platform) mirroring §10 catalog behavior.

## Acceptance criteria

- [ ] Round-trip test: every `JobConfig` field survives `parseJobConfig` for all modes.
- [ ] Audio Boost end-to-end: selecting it changes the spawned argv (snapshot test in
      argBuilders) — previously a no-op.
- [ ] Live flow: `isLive: true` config reaches the orchestrator and Stop & Save becomes
      callable (integration test against fake-bin fixture).
- [ ] `tests/unit/ipcHandlers.test.ts` exists with the validation tables.
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Every future bug-fix here ships with its regression test (§12) — the round-trip
  test *is* the regression test for the whole field-drop class.
