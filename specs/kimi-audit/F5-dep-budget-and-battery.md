# F5 — Housekeeping: `qrcode` dependency budget + battery-aware default

**Recommendation strength:** Speculative (small, independent wins) · **Effort:** S · **Risk:** low

## Item A — `qrcode` in the renderer bundle

**Current state.** `package.json` ships `qrcode ^1.5.4` (+ `@types/qrcode`) as a
**renderer runtime dependency** for Local Share QR codes. §3's locked budget says
renderer runtime deps are **"Preact + signals ONLY"**. At ~84 KB with no transitive
deps it's defensible, but it's currently an undocumented exception to a locked
decision.

**Options (pick one, record it):**

1. **Sanction it**: amend §3's budget row with an explicit exception for `qrcode`
   (justification: ~84 KB, zero transitive deps, used only by Local Share). Cheapest;
   keeps the budget honest by making the exception visible instead of implicit.
2. **Replace it**: hand-rolled byte-mode / EC-level-M QR encoder (~600 lines, pure
   TS, fully unit-testable against known-good matrices). Restores the strict budget;
   costs a review cycle and a test suite.

**Recommendation:** option 1 unless installer size pressure returns (AM-12's actual
target is installer/runtime weight; 84 KB is noise next to the bundled binaries).

## Item B — Battery-aware default concurrency

**Current state.** The battery half of P6 needs no semaphore: `powerMonitor` in main
exposes `onBatteryPower`, and nothing consumes it today.

**Solution.** When on battery, clamp effective `maxConcurrent` to 2; default-on with
one toggle in Settings → Downloads (`throttleOnBattery?: boolean` — the settings
schema already tolerates optional keys). Recompute live on `power-monitor` events.

## Constraints (AGENTS.md)

- §3: option A-1 requires an AGENTS.md amendment (locked-decision change); option A-2
  requires the encoder to be dependency-free.
- §11.1: new settings key rides the existing atomic-write store (and P2's cache, if
  landed — the invalidation test must cover it).
- §17.6: AGENTS.md amendment log updated for whichever option is chosen.

## Implementation steps

**A. Dependency budget**
1. Decide option 1 vs 2 (one-line owner decision).
2. Option 1: amend §3 table + a sentence in the audit README. Option 2: implement
   `src/renderer/src/utils/qr.ts` with table-driven tests against reference vectors;
   drop the dependency.

**B. Battery throttle**
1. Settings schema + `isAppSettings`: optional `throttleOnBattery` (default true).
2. Main: subscribe to `powerMonitor.on('on-ac'/'on-battery')`; effective concurrency
   = `onBattery && throttleOnBattery ? min(2, maxConcurrent) : maxConcurrent`.
3. Settings → Downloads: one checkbox.
4. Tests: schema default + round-trip; effective-concurrency function (pure —
   extract and unit-test with battery flag on/off); settings UI unchanged otherwise.

## Acceptance criteria

- [ ] §3 budget is either honored strictly (encoder) or amended explicitly (exception)
      — no undocumented state.
- [ ] Battery toggle present; effective concurrency drops to 2 on battery (unit test).
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Both items are PR-sized and independent of each other and of P6's semaphore.
