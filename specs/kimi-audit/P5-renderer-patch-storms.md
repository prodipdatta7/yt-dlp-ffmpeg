# P5 — Renderer patch storms: batch `search:entry` hydration commits

**Recommendation strength:** Worth exploring (proven in-repo pattern) · **Effort:** S-M · **Risk:** low

## Problem

Federated hydration emits one `search:entry` patch per result (up to 50). The handler
at `src/renderer/src/signals/searchState.ts` L310-313 applies each patch by replacing
the **entire** `searchResults.value` array, so a 50-card hydration run triggers ~50
full list re-renders.

This is the same storm class that **T10 fixed for playlist hydration** ("normalize
playlist state, batch hydration commits", commit `cefa271`) — the pattern exists in
the repo but was never applied to search.

Secondary friction:

- `SearchResultCard.tsx` is a 1,590-line component; any prop change re-renders the
  whole card including its preview sub-tree (T12 extracted `TheaterPreview` for
  exactly this reason, but the card body is still monolithic).
- Thumbnails use `loading="lazy"` (L450/842/1169 ✓) but lack `decoding="async"` and
  width/height hints, so late-arriving images cause layout shift during hydration.

## Solution

1. **Batch search-entry patches** the way T10 batched playlist hydration: buffer
   incoming `search:entry` patches in a short window (microtask or ~50-150 ms),
   exact-key merge them, and commit one array replacement per window. Card identity
   stays stable → Preact re-renders only changed cards.
2. **Image hints**: add `decoding="async"` and explicit width/height (or aspect-ratio
   CSS) to result thumbnails.
3. **Optional split**: extract the card's preview sub-tree (mirroring the T12
   TheaterPreview extraction) so card chrome doesn't re-render with preview state.

## Constraints (AGENTS.md)

- Renderer stays Preact + signals only (§3 budget) — batching is hand-rolled (the T10
  implementation is the template; no new dependency).
- `search:entry` patches are exact-key updates (§8) — the merge must preserve that
  contract; no reordering of results during hydration (see F3 for the intentional
  post-hydration re-rank, which is a separate, gated step).

## Implementation steps

1. In `searchState.ts`, add a patch buffer: `pending: Map<key, patch>`, flushed by a
   microtask/timeout; flush does one `searchResults.value = next` with merged entries.
2. Cancel/flush semantics: a new search generation clears the buffer (mirror the
   generation guard already used for stale-process suppression).
3. Add `decoding="async"` + dimensions to thumbnail `<img>` tags in
   `SearchResultCard.tsx`.
4. Tests: extend the renderer signal tests (there is an existing `virtualList` /
   signals test area):
   - N patches arriving within one window produce **1** signal commit;
   - patches across windows produce 1 commit per window;
   - generation change discards buffered patches;
   - exact-key merge updates only the targeted entry.
5. Manual check: federated search on TikTok/Reddit, 50 results — scrolling during
   hydration stays smooth; no visible card shuffling.

## Acceptance criteria

- [ ] 50-result hydration produces ≤ a handful of list commits (instrumented in test).
- [ ] No result reordering during hydration (patch contract preserved).
- [ ] Thumbnails no longer cause layout shift (manual check, both themes).
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Locality is the win: the fix lives entirely in `searchState.ts`, reusing a pattern
  reviewers already approved for playlist hydration.
