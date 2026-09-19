# F3 — Federated search quality: hydration-aware ranking, shortlink dedup, coverage notes

**Recommendation strength:** Worth exploring · **Effort:** M · **Risk:** medium (UX jumpiness)

## Current state

Federated discovery (Facebook/Instagram/X/TikTok/Reddit, AM-14) admits results in raw
DuckDuckGo/Brave order with placeholder titles ("${platform} video",
`src/main/media/search.ts` L825), then hydrates at concurrency 2
(`hydrateFederatedEntries` L913+). Consequences:

1. The visible list starts as N identical placeholder cards, and **ranking never
   improves after hydration** — relevance order is frozen pre-metadata even though
   hydration learns views/likes/recency.
2. **Duplicates slip through**: `fb.watch` vs `facebook.com` shortlink variants pass
   the `seen` set because normalization happens before redirect resolution.
3. AM-14's "public-web discovery may be incomplete" caveat only surfaces on errors —
   users can't tell a thin result set is expected vs broken.

## Solution

1. **Post-hydration re-rank**: once a generation's hydration completes, re-sort by
   available signals (views/likes/recency) with a "sorted by relevance, refined as
   details arrive" affordance. **Defer the reorder to a generation boundary or user
   action** — never re-order under the user's cursor mid-hydration.
2. **Shortlink dedup**: resolve shortlink hosts (`fb.watch`, `vm.tiktok.com`) during
   hydration and merge duplicates via the existing exact-key `search:entry` patch
   mechanism.
3. **Persistent coverage note**: per-platform "public-web discovery may be incomplete"
   line in the results header for federated platforms (AM-14 requires honesty about
   the strategy's limits).

## Constraints (AGENTS.md)

- AM-14: no new platform without a defined discovery strategy — this plan adds none;
  it improves quality within the existing five federated platforms.
- §7.7: advanced filters stay disabled for federated platforms; re-ranking is a
  *presentation* step over already-fetched data, not a new discovery query — no new
  network cost (P3's retained payloads supply the signals).
- §8: `search:entry` remains an exact-key patch; dedup merges must not reorder keys
  mid-stream.
- Federated relevance-only constraint stays: re-rank happens client/main-side on
  hydrated fields, never via new DuckDuckGo/Brave requests.

## Implementation steps

1. During hydration, capture hydrated signal fields (views/likes/upload_date) — free
   once P3's retained-payload cache exists; without P3, read them from the hydration
   responses directly.
2. Implement `resolveShortlink` in the hydration path (HEAD/GET redirect resolution
   already happens implicitly in yt-dlp hydration — key the cache by the *resolved*
   URL and emit a merge patch for the duplicate card).
3. Add a "refined" sort pass at hydration completion: stable re-sort by
   `(views, likes, recency)` descending; mark the UI state so the results header can
   show "refined as details arrived".
4. Renderer: coverage note for federated platforms; re-rank happens only when the
   list is idle (generation boundary) or on explicit "Sort by relevance" click.
5. Tests (extend `tests/unit/search.test.ts`):
   - `fb.watch/X` + `facebook.com/.../X` hydrate to one card (merge patch asserted);
   - re-rank ordering correct given synthetic hydrated fields;
   - no re-rank emitted before hydration completes for the generation;
   - stale generation patches still suppressed (existing guard, now with merges).

## Acceptance criteria

- [ ] Duplicate shortlink variants collapse to one card in a unit test.
- [ ] Post-hydration re-rank demonstrably orders by hydrated signals (unit test).
- [ ] No mid-hydration reordering (renderer test or scripted-manual note).
- [ ] Coverage note visible on all five federated platforms.
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Sequence after P3 (retained payloads) and P5 (batched patches) for the smoothest
  result; each is independently shippable if needed.
