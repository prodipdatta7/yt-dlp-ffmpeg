# P2 — SettingsStore: memoized reads instead of sync re-read/parse/validate per call

**Recommendation strength:** Strong (code-verified) · **Effort:** S · **Risk:** low

## Problem

`SettingsStore.load()` (`src/main/store/settingsStore.ts:108-123`) performs
`existsSync` + `readFileSync` + `JSON.parse` + full `isAppSettings` structural
validation **on every invocation**. There is no in-memory cache and nothing to
invalidate.

Call sites in `src/main/index.ts` (≈15): `stagingRoots()` (L193, per job),
`getMaxConcurrent` (L242, per job launch), job-done notification (L324), IPC settings
and dialog handlers (L365-444), updater/about flows (L636-710) — plus every
`nativeTheme.on('updated')` firing on OS theme toggle.

This is synchronous disk I/O on the **main process**, on the job-launch critical path.
It was deferred in the remediation plan as P-12 "safe at current scale" — but it
multiplies across every job launch, every completion, every settings IPC call.

## Solution

Add a memoized `get()` that returns a cached settings object, invalidated **only** by
`save()`. The settings file can only change through this process (there is no
external-editor contract), so a cache is sound.

## Constraints (AGENTS.md)

- §11.1: atomic JSON writes (write-tmp-then-rename), corrupted file → rebuild defaults,
  never crash. The cache must sit *in front of* reads and *behind* writes — `save()`
  still does the atomic write and only then replaces the cache.
- Keep `load()` (cold read) for startup so the corruption-recovery path stays exercised.

## Implementation steps

1. In `settingsStore.ts`, add a module-level (or instance) `cache: AppSettings | null`.
2. `get()`: if `cache` is set, return it (defensive copy if callers mutate); else
   `cache = load()` and return.
3. `save(next)`: perform the existing atomic write; on success set `cache = next`;
   on failure leave `cache` untouched (next `get()` re-reads truth from disk).
4. Migrate hot call sites in `src/main/index.ts` from `load()` to `get()` — all
   read-only sites; keep `load()` at startup.
5. Optional (same pass, P-12's deferred item): make `save()` async
   (`fs.promises` + rename) so writes also leave the event loop alone.
6. Tests: extend `tests/unit/settingsStore.test.ts`:
   - repeated `get()` after one `load()` performs no second disk read (spy on `fs`);
   - `save()` invalidates: `get()` after `save()` returns the new object without disk;
   - corrupted file on cold start still rebuilds defaults (existing behavior, cached);
   - failed `save()` (mock rename rejection) leaves the previous cache intact.

## Acceptance criteria

- [ ] No `readFileSync` on the job-launch/job-done path (assert via fs spy test).
- [ ] Cache-invalidation test green; corruption-rebuild test still green.
- [ ] Atomic write + backup contract unchanged (existing tests still green).
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Expected win per call is small (0.1–several ms); the real value is removing sync I/O
  from the main-process critical path and deepening the module: the seam becomes
  "settings object" instead of "settings file", which also simplifies future
  schema migrations (one read path to version).
