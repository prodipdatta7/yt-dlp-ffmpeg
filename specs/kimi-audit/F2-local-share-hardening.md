# F2 — Local Share hardening: connection caps, multi-range policy, sidecar MIME types

**Recommendation strength:** Worth exploring · **Effort:** S-M · **Risk:** low

## Current state

The v0.4.0 Local Share feature (`src/main/sharing/localShareServer.ts`, QR + LAN HTTP
server) works and has unit tests (`tests/unit/localShareServer.test.ts`). Single-range
requests are already served (206/416, `Accept-Ranges`, per-transfer
`activeConnections` tracking L495; 15-min TTL L13; MIME map L110-124).

Gaps:

1. **No global connection cap.** A phone's download manager opens 4–8 parallel range
   requests; N receivers × M ranges all stream unthrottled — one aggressive receiver
   can saturate the host's Wi-Fi and starve others.
2. **Multi-range** (`multipart/byteranges`) requests are unserved (undefined behavior).
3. **MIME table misses** `.opus` / `.aac` / `.srt` / `.vtt` / `.json` — exactly the
   sidecar types F1 will start producing.
4. Transfer history is hard-pruned at 12 entries (L649); no per-share budget surfaced
   in the activity snapshot.

## Solution

1. Global `MAX_ACTIVE_CONNECTIONS` (~8) with `503 + Retry-After` overflow responses.
2. Explicit multi-range rejection: respond `416` (or ignore extra ranges and serve the
   first — choose one, document it, test it). Keep `parseRange` single-range
   semantics unchanged.
3. Extend the MIME map for F1 sidecar types (`.srt`, `.vtt`, `.json`, `.opus`, `.aac`).
4. Optional: per-share connection budget + current/peak counts in the activity
   snapshot the renderer polls.

## Constraints (AGENTS.md)

- Isolated HTTP layer in main; the renderer still performs zero network operations
  (§4 hard boundary) — all changes stay in `localShareServer.ts` + its IPC surface.
- §6.3: any new IPC payload (activity snapshot fields) validated server-side.
- No new runtime dependency — Node's `http` suffices.

## Implementation steps

1. Add the global semaphore around request acceptance (count active sockets;
   overflow → `503` + `Retry-After: 2`, logged at DEBUG).
2. Detect `Range: bytes=a-b,c-d` → the chosen rejection policy; unit-test both the
   206 single-range path (existing tests stay green) and the new rejection.
3. Extend `MIME` map; unit-test content-type for each new extension.
4. Surface `activeConnections`/`peakConnections` in the existing activity snapshot;
   render in `LocalShareScreen.tsx` activity list.
5. Tests to add in `tests/unit/localShareServer.test.ts`:
   - 9th concurrent connection gets 503 + Retry-After;
   - multi-range request gets the documented rejection;
   - `.srt`/`.vtt`/.json` served with correct content-type;
   - TTL expiry mid-transfer still behaves (existing suite pattern).

## Acceptance criteria

- [ ] Saturation test: 8 streaming + 1 overflow → deterministic 503.
- [ ] New MIME types verified; F1 artifacts downloadable via Local Share.
- [ ] Activity snapshot shows live connection counts.
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- Land independently of F1, but the MIME additions are what make F1's multi-file
  outputs coherent to share — sequence F2's MIME step with F1's artifact step.
