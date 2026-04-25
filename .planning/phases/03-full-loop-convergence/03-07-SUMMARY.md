---
phase: 03-full-loop-convergence
plan: "07"
subsystem: vision/integration-tests
tags: [vision, integration-tests, bwrap, multi-round, ceiling, stop-evidence, SC1, D-22]
requirements: [STOP-03, STOP-04]

dependency_graph:
  requires:
    - 03-03 (run-loop.ts — runLoop function under integration test)
    - 03-04 (forced-stop.ts — ForcedStopStub used as synthesisHook in run-loop test)
    - 03-05 (supervisor.ts — reconstructStopEvidenceFromState now populates stop_evidence; T1 asserts it)
    - 03-06 (run-loop unit tests — PLAN 06 covers all unit-level invariants; PLAN 07 covers only bwrap-gated invariants)
    - Phase 2 run-one-round.integration.test.ts (pattern source — verbatim skipIfNoBwrap + beforeEach scaffold)
  provides:
    - sdk/src/vision/run-loop.integration.test.ts (ONE bwrap-gated multi-round test, ROADMAP SC1)
    - sdk/src/vision/supervisor.integration.test.ts T1 extended with stop_evidence assertions (D-13/ROADMAP SC4)
  affects:
    - Phase 6 calibration (convergence_history[] in stop_evidence is the calibration goldmine)

tech_stack:
  added: []
  patterns:
    - bwrap-gated integration test (skipIfNoBwrap verbatim from run-one-round.integration.test.ts)
    - Visible skip-notice tail when BWRAP_OK === false (same pattern as Phase 2)
    - mkdtemp prefix 'gsd-vision-run-loop-' per RESEARCH §Code Examples
    - 120_000ms timeout per Phase 2 convention (real SDK calls may take 60–90s)
    - T1 extension appended after existing assertions (non-destructive)

key_files:
  created:
    - sdk/src/vision/run-loop.integration.test.ts (174 lines)
  modified:
    - sdk/src/vision/supervisor.integration.test.ts (+11 lines, T1 extended)

decisions:
  - "ONE bwrap-gated test (D-22 literal): SC1-INT asserts >= 2 distinct checkpoint round commits after max_rounds=2 — contract is >= 2, not >= 4 (RESEARCH Risk Note 10 documents 4 at 2 rounds but >= 2 is the contractual minimum)"
  - "window=99 forces max-rounds-exceeded path: convergence cannot fire in 2 rounds with a 99-round window; this guarantees the loop runs both rounds and exits via the aborted path"
  - "consecutive_error_abort=99 prevents error-rounds abort from racing with max-rounds abort during integration test"
  - "T1 extension is strictly additive — appended after existing assertions, no modifications to existing lines; T2/T3/skip-notice unchanged"
  - "stop_evidence.reason asserted as null in T1 (ceiling-hit path uses no reason discriminator; reason is only set for aborted/crashed paths)"

metrics:
  duration_seconds: 356
  completed_date: "2026-04-25"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 03 Plan 07: Multi-Round Integration Test + Supervisor T1 Stop-Evidence Extension Summary

One-liner: Created ONE bwrap-gated multi-round integration test asserting ROADMAP SC1 (>= 2 distinct checkpoint commits at max_rounds=2) and extended supervisor T1 with stop_evidence assertions covering D-13 supervisor belt-write population.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create run-loop.integration.test.ts — ONE bwrap-gated multi-round test (ROADMAP SC1) | 12569a27 | sdk/src/vision/run-loop.integration.test.ts |
| 2 | Extend supervisor.integration.test.ts T1 with stop_evidence assertions (D-13/ROADMAP SC4) | c9953456 | sdk/src/vision/supervisor.integration.test.ts |

## What Was Built

### Task 1 — run-loop.integration.test.ts (ROADMAP SC1 integration gate)

New file `sdk/src/vision/run-loop.integration.test.ts` (174 lines) with ONE bwrap-gated multi-round integration test:

**Test ID**: `SC1-INT: runLoop with max_rounds=2 + window=99 produces >= 2 distinct checkpoint round commits (ROADMAP SC1)`

**Test behavior**:
1. Initializes a git worktree (`initGitWorktree` — verbatim from run-one-round.integration.test.ts)
2. Seeds a frontier via `seedFromDirection({ useLLM: false })` (deterministic fallback, >= 3 nodes)
3. Configures `VisionConfig` with `safety.max_rounds=2, convergence.window=99, consecutive_error_abort=99`
4. Calls `runLoop(initialState, { visionStatePath, worktreeRoot, synthesisHook: new ForcedStopStub(...) }, config)`
5. Asserts terminal state: `status==='aborted'`, `stop_reason==='aborted'`, `stop_evidence.reason==='max-rounds-exceeded'`, `stop_evidence.convergence_history.length===2`, `round===2`
6. Asserts `git log --oneline` in worktree contains `>= 2` occurrences of `checkpoint round` (ROADMAP SC1)

**Structural elements**:
- `const BWRAP_OK = spawnSync('bwrap', ['--version']).status === 0` (verbatim)
- `const skipIfNoBwrap = BWRAP_OK ? it : it.skip` (verbatim)
- `mkdtemp` prefix: `'gsd-vision-run-loop-'` (per RESEARCH §Code Examples)
- `120_000` ms timeout (Phase 2 convention)
- `afterEach` cleanup: `rm(tmpDir, { recursive: true, force: true })`
- `initGitWorktree()` helper: verbatim from run-one-round.integration.test.ts
- `seedVisionState()` helper: populates `stop_evidence: null`, `decisions_log: [] as DecisionLogEntry[]`
- Visible skip-notice tail: `if (!BWRAP_OK) { describe('run-loop integration (SKIPPED — bwrap not installed)', ...) }`

**bwrap NOT installed on this host**: Both tests skip cleanly with `BWRAP_OK === false`. The test code is correct and validated against the type system. Per Phase 2 and Phase 1 verification records, bwrap is not installed on this WSL2 dev host — the test will run and pass when bwrap is installed.

### Task 2 — supervisor.integration.test.ts T1 extension

Extended T1 with 7 stop_evidence assertions appended after the existing assertions (non-destructive addition):

```typescript
// Phase 3 D-13 + ROADMAP SC4 supervisor-fallback assertions:
// The child does NOT instantiate ForcedStopStub, so the supervisor's belt-write
// (PLAN 05) is the writer. It reconstructs stop_evidence from outside the jail.
expect(parsed.stop_evidence).not.toBeNull();
expect(parsed.stop_evidence!.ceiling_ms_elapsed).toBeGreaterThanOrEqual(2000);
expect(parsed.stop_evidence!.final_round).toBe(0);                       // seedStartingState seeds round=0
expect(typeof parsed.stop_evidence!.stopped_at).toBe('string');
expect(parsed.stop_evidence!.reason).toBeNull();                         // ceiling-hit path uses no reason discriminator
expect(parsed.stop_evidence!.last_caught_error).toBeNull();              // not a crashed path
expect(parsed.stop_evidence!.convergence_history).toEqual([]);           // seedStartingState had no prior history
```

Why these assertions match the actual supervisor behavior:
- **`stop_evidence` non-null**: T1's child is `/usr/bin/node -e 'setTimeout(...)'` — it does NOT instantiate `ForcedStopStub`. When SIGTERM fires and the child exits, the supervisor's belt-write runs (`reconstructStopEvidenceFromState(prev, ceilingMs)`), populating `stop_evidence`.
- **`ceiling_ms_elapsed >= 2000`**: `superviseSession(policy, 2000, ...)` passes `ceilingMs=2000`; `reconstructStopEvidenceFromState` sets `ceiling_ms_elapsed: ceilingMs`.
- **`final_round === 0`**: `seedStartingState` writes `round: 0`; the child never ran a loop iteration.
- **`stopped_at` is string**: `reconstructStopEvidenceFromState` always sets `new Date().toISOString()`.
- **`reason === null`**: ceiling-hit path calls `reconstructStopEvidenceFromState(prev, ceilingMs)` with `reason: null` hardcoded (reason is only for aborted/crashed paths).
- **`last_caught_error === null`**: not a crashed path; `reconstructStopEvidenceFromState` sets `last_caught_error: null`.
- **`convergence_history === []`**: `seedStartingState` has `stop_evidence: undefined` (no field); `reconstructStopEvidenceFromState` reads `prev.stop_evidence?.convergence_history ?? []` → empty array.

T2, T3, and the visible skip-notice tail are unchanged (verified by grep counts).

## Bwrap Gate Status

**bwrap is NOT installed on this host** — confirmed by `spawnSync('bwrap', ['--version']).status !== 0`.

Both test files skip cleanly:
- `run-loop.integration.test.ts`: 2 tests skipped (vitest output: "Test Files 1 skipped (1), Tests 2 skipped (2)")
- `supervisor.integration.test.ts`: 4 tests skipped (vitest output: "Test Files 1 skipped (1), Tests 4 skipped (4)")

**HUMAN VERIFICATION REQUIRED**: Install bwrap (`sudo apt-get install -y bubblewrap`) on the dev host AND run the integration suite:
```bash
cd sdk && npx vitest run src/vision/run-loop.integration.test.ts --reporter=verbose
cd sdk && npx vitest run src/vision/supervisor.integration.test.ts --reporter=verbose
```
This is a deferred manual step inherited from Phase 1 + Phase 2 preflight (per 01-VERIFICATION.md and 02-VERIFICATION.md, bwrap installation has been flagged as pending on this WSL2 host).

## Checkpoint Commit Count at max_rounds=2

Per RESEARCH Risk Note 10 (option c — documented in run-loop.ts header):
- `runOneRound` writes `checkpoint round N` at end of each round body
- `runLoop` writes `checkpoint round N` again after `populateDecisionsLog + appendVerdictToHistory`
- Result: 2 `checkpoint round` commits per round
- At `max_rounds=2`: **4** `checkpoint round` commits (rounds 1 and 2, each with 2 writes)
- `transitionToAborted` may add a **5th** terminal-path checkpoint write

The SC1-INT assertion uses `>= 2` (the ROADMAP SC1 contractual minimum), not `>= 4`. This is intentional — the `>= 4` count is an implementation detail documented in code; the `>= 2` is the public contract from ROADMAP SC1 + CONTEXT D-22 Specifics ("unmistakable test").

## VALIDATION.md Rows Updated by PLAN 07

PLAN 06's SUMMARY mapped Task IDs to VALIDATION.md rows at the unit level. PLAN 07 adds:
- **SC1-INT integration test row**: `sdk/src/vision/run-loop.integration.test.ts` → PLAN 07 Task 1 (this plan)
- **Supervisor T1 extension row**: `sdk/src/vision/supervisor.integration.test.ts` T1 → PLAN 07 Task 2 (this plan)

These two rows should be incorporated into VALIDATION.md's integration-test section when the phase is finalized.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The skip-when-bwrap-absent behavior is intentional (not a stub); it will run end-to-end when bwrap is installed per the deferred human verification gate above.

## Threat Flags

None. Both new/modified files exercise existing trust boundaries (bwrap jail, claude-agent-sdk) already audited in Phase 1 and Phase 2 threat models. No new network endpoints, auth paths, or file access patterns introduced.

## Self-Check

Files exist:
- sdk/src/vision/run-loop.integration.test.ts: present (174 lines)
- sdk/src/vision/supervisor.integration.test.ts: present (199 lines)
- .planning/phases/03-full-loop-convergence/03-07-SUMMARY.md: this file

Commits exist:
- 12569a27: Task 1 (run-loop.integration.test.ts created)
- c9953456: Task 2 (supervisor.integration.test.ts T1 extended)

## Self-Check: PASSED
