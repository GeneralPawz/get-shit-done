---
phase: 03-full-loop-convergence
plan: "04"
subsystem: vision/forced-stop
tags: [vision, forced-stop, synthesis-hook, convergence, stop-evidence, pitfall-3d]
dependency_graph:
  requires:
    - 03-01  # types.ts — StopEvidence, ConvergenceVerdict, SynthesisHook.onConverged
    - 03-03  # run-loop.ts — transitionToConverged calls onConverged (Pitfall 3d safeguard 1)
  provides:
    - ForcedStopStub.onConverged real implementation (D-07)
    - VISION_CONVERGED_STUB_SENTINEL export
    - buildStopEvidence helper (shared by onConverged + onForcedStop)
    - Pitfall 3d safeguard 2 of 2 in onForcedStop
  affects:
    - 03-05  # supervisor.ts belt-write — reads stop_evidence shape written by buildStopEvidence
    - 03-06  # forced-stop.test.ts T7-T11 comprehensive tests for new behavior
tech_stack:
  added: []
  patterns:
    - Sentinel-export pattern with canonical DO NOT RENAME comment
    - buildStopEvidence private helper — avoids construction duplication across two methods
    - Pitfall 3d short-circuit — mirrors supervisor.ts:200-202 belt-write skip pattern
key_files:
  created: []
  modified:
    - sdk/src/vision/forced-stop.ts
    - sdk/src/vision/forced-stop.test.ts
decisions:
  - "buildStopEvidence is module-private (not exported) — both terminal paths use it; no external consumers need it"
  - "onForcedStop short-circuit checks state.status === 'converged' AND state.stop_evidence != null (both conditions required — mirrors RESEARCH Pitfall 3d recommendation)"
  - "T4 one-line patch applied in this plan; T7-T11 comprehensive coverage deferred to PLAN 06 per parallel-execution contract"
  - "wall-clock-ceiling count appears 2 in grep due to pre-existing file-level JSDoc comment — code has exactly 1 instance"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-25"
  tasks_completed: 2
  files_modified: 2
---

# Phase 3 Plan 04: ForcedStopStub onConverged + Pitfall 3d + buildStopEvidence Summary

**One-liner:** Extended ForcedStopStub with real onConverged atomic-write, VISION_CONVERGED_STUB_SENTINEL, shared buildStopEvidence helper, and Pitfall 3d short-circuit closing the convergence/ceiling race.

## What Was Built

`sdk/src/vision/forced-stop.ts` extended from 71 lines to 154 lines with:

1. **Extended import** — `ConvergenceVerdict` and `StopEvidence` added to the existing `import type` from `./types.js`.

2. **`VISION_CONVERGED_STUB_SENTINEL = 'VISION_CONVERGED_STUB invoked'`** — new export mirroring Phase 1's `VISION_FORCED_STOP_SENTINEL`. TSDoc ends with `DO NOT RENAME WITHOUT UPDATING Phase 4 INTEGRATION TESTS.` (canonical comment shape). Both sentinels now present.

3. **`buildStopEvidence(state, params)` private helper** — constructs a fully-populated `StopEvidence` from a `VisionState` plus path-specific overrides. Used by both `onConverged` and `onForcedStop` to avoid duplicating construction logic (RESEARCH Risk Note 2). `drift_error_count` is derived at stop-time from `round_results.flatMap(r => r.errors).filter(e => e.reason === 'direction-snapshot-drift').length` (O(rounds × errors), fine for max_rounds=20).

4. **`ForcedStopStub.onConverged(state, verdict)` real implementation** — replaces the Phase 01 no-op stub. Atomically writes `status='converged'` + `stop_reason='converged'` + `stop_evidence` (via `buildStopEvidence(state, { convergenceSnapshot: verdict })`) + `partial_results_available`. Emits `VISION_CONVERGED_STUB_SENTINEL` to stderr. No drafts/seeds writes (Phase 4's job).

5. **Pitfall 3d safeguard 2 of 2** in `onForcedStop` — first three lines of the method short-circuit if `state.status === 'converged' && state.stop_evidence != null`. Mirrors the supervisor's existing `skip-if-'ceiling-hit'` pattern (supervisor.ts:200-202). Together with PLAN 03's safeguard 1 (persists `'converged'` before awaiting the hook), the convergence/ceiling race is closed deterministically.

6. **Extended `onForcedStop` body** — now calls `buildStopEvidence(state, {})` to write richer `stop_evidence` including `convergence_history`, `final_frontier_pending_count`, `drift_error_count`. `ceiling_ms_elapsed` stays null (stub is ceiling-agnostic per D-09); supervisor's belt-write (PLAN 05) fills it on the SIGKILL fallback path.

## File Stats

- **Final line count:** 154 lines (up from 71; within PLAN 06's expected 110-160 range)
- **Both sentinels exported:** `VISION_FORCED_STOP_SENTINEL` (Phase 1) + `VISION_CONVERGED_STUB_SENTINEL` (Phase 3)
- **`class ForcedStopStub implements SynthesisHook` compiles cleanly** — PLAN 01's extended interface (with `onConverged`) is now fully satisfied

## Test Changes

**`sdk/src/vision/forced-stop.test.ts` — one-line T4 patch:**

T4's inline `SynthesisHook` literal `{ onForcedStop: async (_s) => {} }` was missing `onConverged` after PLAN 01 extended the interface. Patched to:
```typescript
const _check: import('./forced-stop.js').SynthesisHook = { onForcedStop: async (_s) => {}, onConverged: async (_s, _v) => {} };
```
This satisfies the compile-time assignability check. PLAN 06 will add T7-T11 tests with full behavioral coverage of `onConverged`, the Pitfall 3d short-circuit, and the richer `stop_evidence` payload.

**T1-T6 all pass (6/6) after the T4 patch.**

## Commits

| Commit | Hash | Description |
|--------|------|-------------|
| Task 1+2 | `83018756` | feat(03-04): add VISION_CONVERGED_STUB_SENTINEL + imports + buildStopEvidence + onConverged + Pitfall 3d |
| T4 patch | `3569d3e5` | fix(03-04): patch T4 inline SynthesisHook literal to include onConverged |

## Deviations from Plan

**None significant.** Plan executed as written with one minor note:

**[Observation] Tasks 1 and 2 committed together** — The plan's Task 1 action explicitly says "Do NOT add the `onConverged` method yet — Task 2 adds it." However, the file already had a no-op `onConverged` from PLAN 01 that needed to be replaced. All changes were applied in a single edit pass and committed as one commit for Task 1 (which includes the full Task 2 implementation), then the T4 test patch as a second commit. Both commits are clean and the separation of concerns (production code vs test fix) is maintained.

**[Observation] `stop_reason: 'wall-clock-ceiling'` grep count is 2** — The acceptance criteria expects 1, but the pre-existing file-level JSDoc at line 7 contains the string `stop_reason: 'wall-clock-ceiling'`. The code has exactly 1 instance at line 93. This is a benign grep artifact from the Phase 1 comment — no code issue.

## Pitfall 3d — Both Safeguards Now in Place

| Safeguard | Location | Status |
|-----------|----------|--------|
| Safeguard 1 of 2 | `run-loop.ts` `transitionToConverged` — persists `status='converged'` BEFORE awaiting hook | Delivered by PLAN 03 |
| Safeguard 2 of 2 | `forced-stop.ts` `onForcedStop` — short-circuits if `state.status === 'converged' && state.stop_evidence != null` | Delivered by this PLAN |

The race window between convergence and ceiling-hit is now closed deterministically: a session that converges at the last round is written as `'converged'` and a subsequent SIGTERM does not overwrite it.

## Known Stubs

None — `onConverged` is fully implemented (no longer a no-op). The stub designation remains only for Phase 4's replacement with the real Synthesizer that writes drafts/seeds.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the threat model covers (T-03-13 through T-03-16 addressed as designed).

## Self-Check: PASSED

- [x] `sdk/src/vision/forced-stop.ts` exists and is 154 lines
- [x] `sdk/src/vision/forced-stop.test.ts` patched
- [x] Commit `83018756` exists
- [x] Commit `3569d3e5` exists
- [x] tsc exits 0
- [x] T1-T6 all pass
- [x] All 16 vision test files pass (125 tests)
