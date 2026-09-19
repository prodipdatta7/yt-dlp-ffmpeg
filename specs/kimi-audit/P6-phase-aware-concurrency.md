# P6 — Phase-aware concurrency: separate network-bound downloads from CPU-bound transcodes

**Recommendation strength:** Worth exploring (design gap) · **Effort:** M · **Risk:** moderate

## Problem

One concurrency knob (`getMaxConcurrent`, 2–5, default 3 —
`src/main/jobs/orchestrator.ts` L74; UI stepper in
`src/renderer/src/components/settings/DownloadsSection.tsx`) governs all work. A
parallel run of 4 jobs can reach **4 simultaneous FFmpeg transcodes** (CPU-heavy),
because the orchestrator tracks *job* occupancy, not *phase* occupancy.

`specs/performance-memory-deep-research.md` recommends exactly this split: cap
CPU-heavy postprocess at 1–2 while allowing more network-bound downloads, and throttle
on battery. The remediation plan deferred "reduce default 5→2" (rightly — no trace),
but the **phase-separation** idea itself is untouched.

User-visible symptoms: laptops thermal-throttle mid-playlist; parallel downloads
stutter while a 4K transcode saturates cores.

## Solution

1. **Postprocess semaphore**: track per-job phase in the orchestrator's `activeJobs`
   map. Admit a new job's *download* phase against `maxConcurrent` as today, but queue
   its *postprocess* spawn (merge/transcode/extract-audio) behind a separate
   `postprocessSlots = 1` (optionally 2) semaphore. Waiting jobs report a
   `finalizing`-adjacent queued state so the UI stays truthful.
2. **Battery throttle** (can ship independently — see F5): `powerMonitor` in main;
   on battery, clamp `maxConcurrent` to 2; default-on, one Settings toggle.

## Constraints (AGENTS.md)

- AM-07/D2a: the parallel orchestrator is Map-based; disk preflight reserves the sum
  of in-flight estimates — the semaphore must not change the reservation math.
- AM-16: child processes are excluded from the Electron memory ceiling but RSS-logged —
  more overlapping downloads still raise child RSS; keep `maxConcurrent` bounds as-is.
- §8 phase labels: do not break the `job:event` coalescer guarantees — a job waiting
  on the postprocess semaphore must still emit a phase transition promptly.
- AM-09: cancel while queued-on-semaphore must release the slot and kill nothing
  (no child exists yet).

## Implementation steps

1. Extend `activeJobs` entries with `phase` (already implied by emitted events — reuse,
   don't duplicate).
2. Add a tiny FIFO semaphore module (`src/main/jobs/postprocessSlots.ts`, pure,
   unit-testable): `acquire(): Promise<release>`; wired where the orchestrator spawns
   the postprocess step.
3. Emit a `message` ("waiting for transcode slot") on the job event when queued, so
   the UI explains the pause (§17.5: user-visible states use catalog-style strings).
4. Settings: optional `throttleOnBattery?: boolean` (schema already tolerates optional
   keys); main subscribes to `powerMonitor` and recomputes effective concurrency.
5. Tests (extend `tests/unit/orchestrator.test.ts` with the existing fake-bin
   fixtures):
   - 4-job parallel run: at most `postprocessSlots` ffmpeg-phase children alive at once
     (assert via runner spy);
   - a job cancelled while waiting releases its slot and spawns nothing;
   - disk preflight still reserves the full in-flight sum;
   - battery clamp: effective concurrency 2 when `onBatteryPower === true`;
   - phase transitions still emit immediately (no coalescer starvation).

## Acceptance criteria

- [ ] Measured: parallel playlist with ≥3 transcodes no longer exceeds
      `postprocessSlots` concurrent ffmpeg processes (asserted in test).
- [ ] No job-event ordering regressions (existing orchestrator tests stay green).
- [ ] Battery toggle present in Settings → Downloads, honored live.
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Ship order: the battery clamp is independent and cheaper — it can land alone (F5)
  while the semaphore gets its own PR.
