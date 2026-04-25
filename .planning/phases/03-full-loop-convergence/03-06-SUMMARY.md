---
phase: 3
plan: 6
subsystem: vision/run-loop
tags: [tdd, unit-tests, convergence, forced-stop, validation]
dependency_graph:
  requires: [03-05-SUMMARY]
  provides: [run-loop-behavioral-tests, forced-stop-onConverged-tests, validation-map]
  affects: [sdk/src/vision/run-loop.test.ts, sdk/src/vision/forced-stop.test.ts]
tech_stack:
  added: []
  patterns: [vitest-vi-mock-hoisting, mockImplementation-state-preservation, tdd-red-green]
key_files:
  created: [.planning/phases/03-full-loop-convergence/03-VALIDATION.md]
  modified:
    - sdk/src/vision/run-loop.test.ts
    - sdk/src/vision/forced-stop.test.ts
decisions:
  - vitest mockImplementation with spread-incoming-state is the canonical pattern for multi-round loop tests
  - window convergence tests require perpetual mockImplementation (not mockResolvedValueOnce) plus frontier=[] and threshold=0
  - Tests that must NOT converge early use 3 pending frontier nodes (> default threshold=2)
  - Renamed pre-existing helpers to makeTestFinding/makeTestRoundResult to avoid conflicts with new plan-06 builders
metrics:
  duration: ~90min
  completed: 2026-04-25T12:46:13Z
  tasks: 3
  files_modified: 3
---

# Phase 3 Plan 6: Behavioral unit tests for run-loop convergence + forced-stop onConverged Summary

**One-liner:** 19 behavioral unit tests covering evaluateConvergence C1/C2/C3, window firing, D-08 decision rule, max-rounds, consecutive-error abort, direction-drift, stop_evidence on all terminal paths, convergence_history accumulation, and ForcedStopStub onConverged/Pitfall-3d; VALIDATION.md per-task map populated.

---

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | evaluateConvergence + populateDecisionsLog + window/D-08 behavioral tests (8 tests) | 111331ea | sdk/src/vision/run-loop.test.ts |
| 2 | max-rounds, consecutive-error, drift, terminal-paths, convergence_history, SC2 + T7-T11 forced-stop | d1962cd9 | sdk/src/vision/run-loop.test.ts, sdk/src/vision/forced-stop.test.ts |
| 3 | Mint task IDs in 03-VALIDATION.md; flip nyquist_compliant + wave_0_complete | ede29760 | .planning/phases/03-full-loop-convergence/03-VALIDATION.md |

---

## Test Coverage Added

### run-loop.test.ts (14 new behavioral tests, rows D-12 through D-22 in plan)

| Test ID | Test Name | Validates |
|---------|-----------|-----------|
| 03-06-T1-1 | C1 frontier-pending threshold gate | evaluateConvergence C1: pending_count <= threshold |
| 03-06-T1-2 | C2 decision-queue drained gate | evaluateConvergence C2: no blocking unresolved decisions |
| 03-06-T1-3 | C3 sources-plateau gate | evaluateConvergence C3: new_frontier_nodes.length <= plateau_threshold |
| 03-06-T1-4 | all three AND required | C1 ∧ C2 ∧ C3 conjunction |
| 03-06-T1-5 | single-round window (window=1) | windowConverged fires after 1 converged round |
| 03-06-T1-5 | two-consecutive window (window=2) | windowConverged fires after 2 consecutive converged rounds |
| 03-06-T1-7 | D-08 decision-queue rule | populateDecisionsLog: confidence < 0.6 AND surprises ≥ 1 (last round only) |
| Pitfall 3c | populateDecisionsLog processes only last round | No double-counting from previous rounds |
| 03-06-T2-9 | D-18 max-rounds abort | runLoop breaks with status=aborted, reason=max-rounds-exceeded |
| 03-06-T2-10 | D-20 consecutive-error abort | runLoop breaks with status=aborted, reason=consecutive-error-rounds |
| 03-06-T2-11 | direction-snapshot drift preserved | D-10 direction_snapshot captures direction at round start |
| 03-06-T2-12 | stop_evidence on converged | stop_evidence.convergence_snapshot populated on convergence |
| 03-06-T2-13 | stop_evidence on aborted | stop_evidence.reason set for both abort causes |
| SC2 | convergence_history accumulates across rounds | appendVerdictToHistory grows history per round |

### forced-stop.test.ts (5 new tests T7-T11)

| Test ID | Test Name | Validates |
|---------|-----------|-----------|
| T7 | onConverged emits VISION_CONVERGED_STUB invoked sentinel | Sentinel emission on converged path |
| T8 | onConverged writes status=converged, stop_reason, convergence_snapshot | D-07 converged-path state writes |
| T9 | onForcedStop writes richer stop_evidence | D-11 ceiling-hit stop_evidence structure |
| T10 | Pitfall 3d short-circuit (converged + non-null evidence) | onForcedStop skips when already converged with evidence |
| T11 | Defense-in-depth (converged + null evidence not short-circuited) | onForcedStop proceeds when evidence is null |

---

## Validation Map Mapping

| VALIDATION.md Row | Task ID | Test Name in run-loop.test.ts |
|-------------------|---------|-------------------------------|
| C1 frontier-pending threshold gate | 03-06-T1-1 | `C1 frontier-pending threshold gate` |
| C2 decision-queue drained gate | 03-06-T1-2 | `C2 decision-queue drained gate` |
| C3 sources-plateau gate | 03-06-T1-3 | `C3 sources-plateau gate` |
| C1 ∧ C2 ∧ C3 conjunction | 03-06-T1-4 | `all three conditions required` |
| window-based fire timing (1, 2, 3) | 03-06-T1-5 | `single-round window` + `two-consecutive window` |
| decision-queue rule (D-08) | 03-06-T1-7 | `D-08 decision-queue rule` |
| max_rounds break (D-18) | 03-06-T2-9 | `D-18 max-rounds abort` |
| consecutive-error abort (D-20) | 03-06-T2-10 | `D-20 consecutive-error abort` |
| direction-snapshot drift (D-10) | 03-06-T2-11 | `direction-snapshot preserved` |
| stop_evidence on converged | 03-06-T2-12 | `stop_evidence on converged` |
| stop_evidence on aborted (both reasons) | 03-06-T2-13 | `stop_evidence on aborted` |
| stop_evidence on ceiling-hit | 03-06-T2-T9 | forced-stop.test.ts `T9` |
| integration (PLAN 07) | 03-07-T1-1 | pending — PLAN 07 scope |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Naming conflict with pre-existing fixture builders**
- **Found during:** Task 1
- **Issue:** `makeFinding` and `makeRoundResult` already existed at lines 37-81 of run-loop.test.ts with incompatible signatures
- **Fix:** Renamed pre-existing helpers to `makeTestFinding` and `makeTestRoundResult`; used new builders in plan-06 section
- **Files modified:** sdk/src/vision/run-loop.test.ts
- **Commit:** 111331ea

**2. [Rule 1 - Bug] Window convergence firing unexpectedly early**
- **Found during:** Task 1 test run
- **Issue:** Pre-seeded `stop_evidence.convergence_history` in mock states caused `windowConverged` to satisfy window=2 too early because `appendVerdictToHistory` extended the pre-seeded list
- **Fix:** Return `stop_evidence: null` in initial mock state; use `mockImplementation` that preserves incoming state's `stop_evidence` via spread
- **Files modified:** sdk/src/vision/run-loop.test.ts
- **Commit:** 111331ea

**3. [Rule 1 - Bug] D-18 max-rounds convergence firing before max_rounds hit**
- **Found during:** Task 2 test run
- **Issue:** 1 pending node with default threshold=2 satisfied C1 on round 1; C3 also satisfied; window fired before max_rounds
- **Fix:** Use 3 pending frontier nodes (> threshold=2) so C1=false every round
- **Files modified:** sdk/src/vision/run-loop.test.ts
- **Commit:** d1962cd9

**4. [Rule 1 - Bug] D-20 wrong import path**
- **Found during:** Task 2 test run
- **Issue:** `const { runLoop } = await import('./run-one-round.js')` should import from `'./run-loop.js'`
- **Fix:** Corrected import path
- **Files modified:** sdk/src/vision/run-loop.test.ts
- **Commit:** d1962cd9

**5. [Rule 1 - Bug] SC2 call count wrong (7 instead of 1) due to mock state not reset between tests**
- **Found during:** Task 2 test run
- **Issue:** `vi.clearAllMocks()` was missing from `beforeEach`; mock accumulated call counts across tests
- **Fix:** Added `beforeEach(() => vi.clearAllMocks())` and switched to `mockImplementation` preserving incoming state
- **Files modified:** sdk/src/vision/run-loop.test.ts
- **Commit:** d1962cd9

**6. [Rule 1 - Bug] D-12 convergence_history length 1 instead of 3 across rounds**
- **Found during:** Task 2 test run
- **Issue:** Each mock round reset `stop_evidence: null`; history accumulated only within a single round call
- **Fix:** `mockImplementation` spreads incoming state so `stop_evidence.convergence_history` accumulates
- **Files modified:** sdk/src/vision/run-loop.test.ts
- **Commit:** d1962cd9

---

## 03-VALIDATION.md Status

- `nyquist_compliant: true` confirmed
- `wave_0_complete: true` confirmed
- Zero TBD cells in per-task map (0 of 13 rows remain TBD; integration row 03-07-T1-1 is pending but has its ID)
- 12 unit test rows mapped to PLAN 06 task IDs; 1 integration row mapped to PLAN 07 task ID

---

## Known Stubs

None — all tests produce real assertions; no hardcoded empty stubs flow to UI.

The integration test row (03-07-T1-1) is correctly marked `pending` in VALIDATION.md — this is not a stub, it's a deferred test scoped to PLAN 07.

---

## Self-Check: PASSED

- sdk/src/vision/run-loop.test.ts: FOUND
- sdk/src/vision/forced-stop.test.ts: FOUND
- .planning/phases/03-full-loop-convergence/03-VALIDATION.md: FOUND
- Commit 111331ea: FOUND
- Commit d1962cd9: FOUND
- Commit ede29760: FOUND
- Vision tests: 177 passed (16 test files)
- Pre-existing query failures (6) confirmed pre-existing on base commit 768cd41f — out of scope
