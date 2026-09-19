# P1 — GPU/compositor memory: persistent `backdrop-blur` fails the AM-16 budget

**Recommendation strength:** Strong (measured) · **Effort:** M · **Risk:** low (visual only)

## Problem

`npm run perf` (T14 harness, bare-window baseline methodology per AM-16) measures:

- idle summed **private 215.2 MB vs ≤200 MB budget → FAIL**
- marginal cost over bare window **74.8 MB vs ≤60 MB budget → FAIL**

`specs/perf-report.md` (§R, lines 34-63) attributes ~35 MB of the marginal to the **GPU
process** and names the `backdrop-blur` audit as the closing work item. It was deferred
as R-06 ("out of scope") in `specs/performance-remediation-plan.md` and never done.

`backdrop-blur` forces the compositor to keep a persistent GPU layer + backdrop filter
for every surface using it, even when nothing behind it is animating. Current usage:

| File | Usages | Persistence |
|------|--------|-------------|
| `src/renderer/src/components/SearchResultCard.tsx` | 16 | always-on (result grid) |
| `src/renderer/src/components/PreviewPanel.tsx` | 3 | always-on while preview open |
| `src/renderer/src/components/InlineVideoPreview.tsx` | 2 | per preview |
| `src/renderer/src/components/FormatMatrix.tsx` | 1 | always-on |
| `src/renderer/src/components/TheaterPreview.tsx` | 1 | per overlay — **keep** |

## Solution

Convert **persistent** blur surfaces to solid translucent fills; keep blur only on
transient modal/overlay surfaces where the layer exists for seconds, not the session.

The design-token system already supports this: use intent-named tokens
(`bg-wash-1`, `bg-recess`, scrim variants) with alpha, e.g. `bg-recess/85`, instead of
`backdrop-blur-*` over a translucent wash. Accent ramps stay as-is (§3.1 brand aliases).

## Constraints (AGENTS.md)

- AM-12: Tailwind utilities are sanctioned (build-time only) — no new machinery needed.
- §3.1: prefer intent-named tokens; `white`/`black` stay literal.
- AM-16: verify via `npm run perf`; `privateBytes` is the primary figure.

## Implementation steps

1. **Inventory**: grep `backdrop-blur` across `src/renderer/`; classify each site as
   *persistent* (grid cards, panels, matrices) or *transient* (modals, theater overlay).
2. **Replace persistent sites** with token-based translucent fills
   (e.g. `backdrop-blur-md bg-ink-950/40` → `bg-ink-950/85`, or `bg-recess/85`).
   Check both themes (`:root` Warm Studio, `[data-theme='dark']` Warm Ember) for AA
   contrast of any text on the new fills.
3. **Keep transient sites** (TheaterPreview overlay, modal dialogs) unchanged.
4. **Verify visually**: screenshot-compare the Search grid, Preview panel, and Format
   matrix in both themes.
5. **Measure**: `npm run perf` on the changed build; compare GPU-process private bytes
   and idle/marginal totals against the recorded baseline in `specs/perf-report.md`.

## Acceptance criteria

- [ ] `npm run perf`: idle summed private ≤200 MB and marginal ≤60 MB (or a documented
      residual < the current 15.2/14.8 MB overage, with remaining sources identified).
- [ ] `specs/perf-report.md` updated with the before/after GPU-process numbers.
- [ ] No `backdrop-blur-*` remains on persistent surfaces; transient overlays keep it.
- [ ] Both themes pass a manual AA spot-check on changed surfaces.
- [ ] Gate: `npm run typecheck && npm run lint && npm run test` green.

## Notes

- If the audit shows blur is *not* the dominant contributor after re-measurement,
  fall back to the perf-report's other named suspects before touching more CSS —
  record findings either way so R-06 is closed with evidence, not assumption.
