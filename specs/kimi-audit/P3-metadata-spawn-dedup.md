# P3 — Metadata spawn dedup: stop re-running yt-dlp `-J` for data already fetched

**Recommendation strength:** Strong (code-verified) · **Effort:** M · **Risk:** medium (staleness)

## Problem

The pipeline pays for full metadata multiple times for the same video:

1. **Search discovery** (`src/main/media/search.ts` L590-630) spawns yt-dlp with `-J`,
   parses the full JSON… and discards everything except the few list-row fields.
2. **Federated hydration** (`hydrateFederatedEntries`, L913-965) re-runs full `-J`
   per URL via `buildEntryInfoArgs` (L922) — even though the flat-playlist discovery
   payload already carries duration/views/upload_date for native results.
3. **Chapter preview** (`fetchChapters`, L967-1010) spawns a fresh yt-dlp
   (`--print %(chapters)j`, 15 s timeout) even when a prior `-J` had `chapters`.
4. **Transcript preview** (L1045-1152) spawns up to two `--write-subs` runs.
5. **Playlist hydration** (`src/main/media/metadata.ts` `hydrateEntries` L424-484)
   re-spawns `-J` per entry to extract 5 fields, discarding formats/chapters/subtitles
   it just paid the network cost for.

Each spawn costs ~2–6 s latency and ~30–50 MB child RSS. This is the unmeasured
"50-result search ×20" churn flagged in `specs/perf-report.md` L106-111.

## Solution

Introduce a **generation-scoped metadata cache** in the main process (the v2 plan's
§7.2 "main-process authority" cache, L407-416):

1. When search discovery parses `-J`, retain the per-entry payload keyed by canonical
   URL, scoped to the current `searchGeneration` (existing pattern, search.ts L552).
2. `hydrateFederatedEntries` / playlist `hydrateEntries`: merge retained fields first;
   spawn only for entries with a cache miss.
3. Carry `chapters` and subtitle-availability through `MediaMetadata` so
   `fetchChapters` serves from cache when analysis was preceded by a search; spawn
   only on miss.
4. Transcript fetch still needs `--write-subs` for body text (not in `-J`), but skip
   the *availability probing* spawn when the retained payload lists subtitles.

## Constraints (AGENTS.md)

- **AM-01**: any enrichment output must use `--print`-style machine output (as the
  chunk-mode `hydrateEntries` at search.ts L878-885 already does) — never stdout regex.
- **AM-02**: spawn with arg arrays only.
- §11.3: cached payloads must not leak URL queries into logs.
- Staleness policy: cache invalidates on (a) new search generation, (b) cookie-file
  change, (c) explicit user refresh. Wrong staleness shows outdated counts — acceptable
  within a session, not across sessions.

## Implementation steps

1. Define `RetainedEntry` (subset of `-J` fields: duration, view_count, upload_date,
   like_count, chapters, subtitles/automatic_captions availability flags, formats if
   cheap) in `src/shared/models.ts` if it crosses IPC, else keep main-internal.
2. Add `Map<canonicalUrl, RetainedEntry>` alongside `searchGeneration` in
   `SearchService`; populate in the discovery parse path.
3. Rework `hydrateFederatedEntries` and `metadata.ts hydrateEntries` to consult the
   map first; count spawns avoided (log at DEBUG).
4. Extend `MediaMetadata` with optional `chapters`/`subtitleLangs`; wire
   `media:fetch-chapters` to short-circuit on a hit.
5. Tests (extend `tests/unit/search.test.ts`, metadata tests):
   - discovery → hydration for a fully-retained entry spawns **zero** processes;
   - cache miss still spawns exactly once;
   - new generation / cookie change invalidates;
   - `fetchChapters` after search-based analysis makes no spawn; after direct-URL
     analysis makes exactly one.

## Acceptance criteria

- [ ] Federated search on a cached platform performs ≤1 spawn per *uncached* entry.
- [ ] Chapter preview after search-based analysis spawns 0 processes.
- [ ] Spawn-avoidance counters visible in DEBUG logs (redacted URLs).
- [ ] No staleness across generations or cookie changes (unit-tested).
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Synergy: F3's post-hydration re-ranking reuses these retained payloads for free.
- Do not cache across app restarts in v1 (avoids a persistence/invalidation design).
