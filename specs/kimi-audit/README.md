# kimi-audit — Performance & Enhancement Implementation Plans

Audit date: 2026-09-19 · codebase: MediaForge Desktop v0.4.0 (`main` @ `3f5a39e`)

This folder contains the implementation plans produced by a read-only, whole-project
review focused on (a) remaining performance improvements and (b) feature enhancements.
The first performance wave (T0–T14 in `specs/performance-remediation-plan.md`) was
verified as landed; everything here is what **remains** after it.

Each plan cites file:line evidence, states AGENTS.md constraints that bind the fix,
lists implementation steps, and defines acceptance criteria with tests.

## Performance plans

| ID | Title | Evidence class | Effort | Risk | File |
|----|-------|----------------|--------|------|------|
| P1 | GPU/compositor memory — persistent `backdrop-blur` fails the AM-16 budget | Measured (perf-report: idle 215.2MB vs ≤200MB, marginal 74.8MB vs ≤60MB) | M | Low | [P1-gpu-backdrop-blur.md](P1-gpu-backdrop-blur.md) |
| P2 | SettingsStore sync re-read/parse/validate on every call | Code-verified (~15 call sites on hot paths) | S | Low | [P2-settings-store-cache.md](P2-settings-store-cache.md) |
| P3 | Duplicate yt-dlp `-J` spawns — discovery payload discarded, previews/hydration re-fetch | Code-verified (search.ts L590-630 vs L913-1152) | M | Medium | [P3-metadata-spawn-dedup.md](P3-metadata-spawn-dedup.md) |
| P4 | `parseJobConfig` silently drops fields — audio boost + live Stop & Save are dead code | Code-verified defect (handlers.ts L636-742; v2 plan L-03) | S | Low | [P4-parsejobconfig-field-drop.md](P4-parsejobconfig-field-drop.md) |
| P5 | Renderer hydration patch storms — full results-array clone per `search:entry` | Code-verified (T10 pattern never applied to search) | S-M | Low | [P5-renderer-patch-storms.md](P5-renderer-patch-storms.md) |
| P6 | Phase-blind concurrency — downloads and CPU-bound transcodes share one knob | Design gap (deep-research doc recommendation untouched) | M | Moderate | [P6-phase-aware-concurrency.md](P6-phase-aware-concurrency.md) |

## Enhancement plans

| ID | Title | User value | Effort | Risk | File |
|----|-------|-----------|--------|------|------|
| F1 | Clip / chapter / subtitle downloads (v2 plan execution) | High | L | Medium | [F1-clip-chapter-subtitle.md](F1-clip-chapter-subtitle.md) |
| F2 | Local Share hardening — connection caps, multi-range policy, sidecar MIME | Medium | S-M | Low | [F2-local-share-hardening.md](F2-local-share-hardening.md) |
| F3 | Federated search quality — hydration-aware ranking, shortlink dedup, coverage notes | Medium-high | M | Medium | [F3-federated-search-quality.md](F3-federated-search-quality.md) |
| F4 | Dev ergonomics — protocol-line console toggle + scripted perf-scenario runner | Internal | S | Low | [F4-dev-ergonomics.md](F4-dev-ergonomics.md) |
| F5 | Housekeeping — `qrcode` dep budget + battery-aware default | Low-medium | S | Low | [F5-dep-budget-and-battery.md](F5-dep-budget-and-battery.md) |

## Recommended execution order

```
P4 → P1 → P2 → F1 → P3 → P5 → F2/F3 → P6/F4/F5
```

Rationale:

1. **P4 first** — Effort S, fixes two shipped-but-broken features, lands the repo's
   highest-value missing test (`ipc/handlers.ts`: 27 recent changes, zero direct tests),
   and is the **gate for F1** (the v2 clip/chapter fields would hit the same
   silent-drop trap that killed `audioBoost`/`isLive`).
2. **P1 second** — the only *measured* failing budget; the T14 perf harness already
   exists to verify the fix.
3. **P2** — cheap, unblocks hot-path hygiene everywhere.
4. **F1** — largest user-facing win; spec is written; gated on P4 + AGENTS.md
   amendments AM-17…AM-20.
5. **P3** — makes F1's preview flows feel instant; its retained-payload cache is
   also what F3's re-ranking reuses for free.

## Cross-cutting: test coverage vs hot files

| File | Changes (last 80 commits) | Direct unit test? | Gap |
|------|---------------------------|-------------------|-----|
| `src/main/ipc/handlers.ts` | 27 | ❌ none | No test exercises the parse/validation tables — L-03's silent field drop shipped because of this. Closed by P4. |
| `src/main/index.ts` | 26 | ❌ (by design) | `toSettingsView` / `stagingRoots()` / `binaryCandidates()` are pure and extractable. |
| `src/renderer/src/App.tsx` | 26 | partial | `runParallelQueue` launch matrix untested. |
| `src/main/sharing/localShareServer.ts` | new in 0.4.0 | ✅ | No overflow / multi-range test (feature doesn't exist yet — F2 adds both). |
| `src/main/jobs/orchestrator.ts` | 14 | ✅ strong | P6 extends the existing fake-bin fixtures. |

## Global constraints (apply to every plan)

- **AM-01**: machine-parseable CLI interfaces only (`-J`, `--print`, `--progress-template`) — never regex human stdout.
- **AM-02**: `spawn(bin, args[], {shell:false})` only; user input never concatenated into a shell string.
- **AM-03**: never mutate the install dir; userData-override binary resolution.
- **§3 budget**: renderer runtime deps = Preact + signals only (F5 audits the existing `qrcode` exception).
- **§6**: every `ipcMain.handle` validates argument shape/type/range; renderer input is hostile.
- **§11.1**: settings writes stay atomic (write-tmp-then-rename + backup) — P2's cache must not bypass this.
- **§11.3**: logs redact URL queries/cookies; protocol lines stay out of logs (F4).
- **§17 DoD**: typecheck + lint + tests green; new behavior ships with tests; amendment log updated when behavior intentionally diverges from the PRD.
