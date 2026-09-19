# F4 — Dev ergonomics: protocol-line console toggle + scripted perf-scenario runner

**Recommendation strength:** Worth exploring (internal tooling) · **Effort:** S · **Risk:** low

## Current state

Two diagnostic capabilities exist in the IPC contract but have no usable affordance:

1. **Protocol lines**: `log:console-open` accepts `includeProtocol` (P-04, §8) — raw
   `MF|`/`MFPOST|` lines are withheld unless set — but nothing in the renderer can
   toggle it. Diagnosing a progress-parser miss means editing preload/constants and
   restarting.
2. **Perf scenarios**: `probe:scenario` (P-10) labels memory-probe samples but is a
   no-op without `MF_MEMORY_PROBE=1`, and 8 of the integration scenarios in
   `specs/perf-report.md` (L106-111) have **never been run** — partly because driving
   them is manual.

## Solution

1. **Dev-only console toggle** for `includeProtocol` in the live console dock
   (session-persisted in memory or sessionStorage — *not* in the Settings schema).
   Visible only in dev (`!app.isPackaged`) or behind an existing dev affordance.
2. **Scripted scenario runner**: a script (extend `scripts/perf-bench.mjs` or a new
   `scripts/perf-scenarios.mjs`) that launches the built app with `MF_MEMORY_PROBE=1`,
   drives `probe:scenario` labels through the 8 unrun perf-report scenarios (search
   50 results, hydrate, preview open/close, playlist queue, parallel run, cancel
   mid-download, resume, local share transfer), and appends samples to `perf-out/`.

## Constraints (AGENTS.md)

- **§11.3**: protocol lines are diagnostic-only — they must never be written to log
  files (console display only; the redaction rules still apply to anything logged).
- §6: the toggle changes only which already-emitted lines reach the console dock —
  no new privileged capability is exposed to the renderer.
- Perf runner spawns the app as a child process; it must not relax CSP or security
  flags to work.

## Implementation steps

1. Console dock: add a dev-only "protocol" checkbox wired to
   `log:console-open { open, includeProtocol }` re-invocation.
2. Preload: confirm the flag is already plumbed (P-04) — if not, add it to the
   typed `mf.*` surface with server-side boolean validation.
3. Scenario runner script: for each scenario — set label via `probe:scenario`,
   perform the UI/main-process actions (via IPC-driving harness or scripted input),
   settle, sample. Reuse the T14 bare-window baseline harness for sampling.
4. Record results into `specs/perf-report.md` (new scenario rows) or `perf-out/`
   artifacts referenced from it.
5. Tests: unit-test that `includeProtocol` gating includes/excludes `MF|` lines
   correctly (extend the log-bus / console tests); the runner itself is a script —
   smoke-run it in the M7 perf pass.

## Acceptance criteria

- [ ] Dev console can toggle protocol lines live, without restart.
- [ ] `npm run perf` (or the new script) produces samples for the 8 previously-unrun
      scenarios, labeled via `probe:scenario`.
- [ ] No protocol line appears in any log file (grep test in the log suite).
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- This is the evidence pipeline P1 and P6 depend on: without scenario coverage, GPU
  and concurrency claims stay single-run anecdotes.
