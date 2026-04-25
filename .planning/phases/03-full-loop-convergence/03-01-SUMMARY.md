---
phase: 03-full-loop-convergence
plan: 01
subsystem: vision/types
tags: [vision, types, convergence, stop-evidence, tdd, phase-3]

# Dependency graph
requires:
  - phase: 02-single-round-exploration
    plan: 01
    provides: VisionState, FrontierNode, RoundResult, SHAManifestEntry, SynthesisHook base types
  - phase: 02-single-round-exploration
    plan: 02
    provides: RoundResult usage in VisionState.round_results
provides:
  - DecisionLogEntry (D-02) — typed decision queue entry shape for run-loop.ts
  - ConvergenceVerdict (D-06) — pure convergence verdict shape for evaluateConvergence
  - StopEvidence (D-11/D-17) — stop evidence shape for all four terminal paths
  - VisionConfig (D-21) — config surface for run-loop.ts loadVisionConfig()
  - VisionState.decisions_log narrowed from unknown[] to DecisionLogEntry[]
  - VisionState.stop_evidence: StopEvidence | null field (initially null)
  - SynthesisHook.onConverged additive method (D-07)
affects:
  - Phase 3 PLAN 03 (run-loop.ts imports VisionConfig, ConvergenceVerdict, DecisionLogEntry)
  - Phase 3 PLAN 04 (forced-stop.ts extended onConverged)
  - Phase 3 PLAN 05 (supervisor.ts belt-write extension uses StopEvidence)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN: test file reads source via readFileSync; grep-based assertions on TypeScript source text
    - node_modules symlink: worktree has no node_modules; symlinked from main repo SDK for test execution
    - Additive type extension: new banner section inserted between Phase 2 and Manifest sections
    - Surgical forward-compatibility patch: stop_evidence: null added to supervisor.ts/worktree-lifecycle.ts to keep tsc clean across plans

key-files:
  created:
    - sdk/src/vision/types-phase3.test.ts
  modified:
    - sdk/src/vision/types.ts
    - sdk/src/vision/supervisor.ts
    - sdk/src/vision/forced-stop.ts
    - sdk/src/vision/worktree-lifecycle.ts

key-decisions:
  - "D-07 onConverged added to ForcedStopStub as no-op: Phase 4 replaces both onForcedStop and onConverged with the real Synthesizer; stub is minimal correct implementation"
  - "D-11 stop_evidence placed after artifact_manifest in VisionState: TSDoc comment clarifies null-until-terminal semantics; existing readers must tolerate undefined (treat as null)"
  - "D-16 onForcedStop signature unchanged: acceptance grep verifies exact frozen string; additive-only extension"
  - "worktree-lifecycle.ts and supervisor.ts get stop_evidence: null surgical patches: keeps tsc clean for PLAN 02-07; PLAN 05 extends the supervisor belt-write to populate full StopEvidence"

metrics:
  duration_minutes: 5
  completed_date: "2026-04-25"
  tasks_completed: 2
  files_changed: 5
---

# Phase 03 Plan 01: Phase 3 Type Surface Summary

**One-liner:** Phase 3 convergence + stop-evidence type surface (DecisionLogEntry, ConvergenceVerdict, StopEvidence, VisionConfig) with VisionState narrowings and SynthesisHook.onConverged additive extension.

## What Was Built

Added the complete Phase 3 type surface to `sdk/src/vision/types.ts` via two TDD tasks:

**Task 1 — Four new interfaces exported:**
- `DecisionLogEntry` (D-02): 5-field decision queue entry shape
- `ConvergenceVerdict` (D-06): pure convergence verdict with conditions + evidence
- `StopEvidence` (D-11/D-17): stop reason evidence for all four terminal paths
- `VisionConfig` (D-21): grouped config surface (convergence, safety, decision_queue)

**Task 2 — VisionState narrowings + SynthesisHook extension:**
- `decisions_log: unknown[]` → `decisions_log: DecisionLogEntry[]` (D-02)
- New field `stop_evidence: StopEvidence | null` added to VisionState (D-11)
- `SynthesisHook` extended with additive `onConverged(state, verdict)` method (D-07)
- `onForcedStop` signature unchanged (D-16 frozen interface preserved)

**Surgical tsc patches (scope-creep one-liners to keep sdk/ clean for downstream plans):**
- `supervisor.ts` fallback minimal state: `stop_evidence: null,` added (line ~233)
- `worktree-lifecycle.ts` initial state: `stop_evidence: null,` added (line ~109)
- `forced-stop.ts` ForcedStopStub: no-op `onConverged` added (Phase 4 replaces)

## Lines Changed

- `sdk/src/vision/types.ts`: +51 lines (147 → 198); zero lines removed
- `sdk/src/vision/supervisor.ts`: +1 line (`stop_evidence: null,` in fallback minimal state)
- `sdk/src/vision/worktree-lifecycle.ts`: +1 line (`stop_evidence: null,` in initial state)
- `sdk/src/vision/forced-stop.ts`: +4 lines (no-op `onConverged` stub)
- `sdk/src/vision/types-phase3.test.ts`: +85 lines (new TDD test file)

## Verification

- `tsc --noEmit`: clean (exit 0) across entire sdk/ tree
- `vitest run --project unit`: 116/116 vision tests pass
- Pre-existing failures in `src/query/` (6 tests, 4 files) confirmed pre-existing in main repo HEAD — not caused by this plan
- All 9 types-phase3 assertions pass GREEN after Task 2 completion

## TDD Gate Compliance

- RED commit: `6be629c8` test(03-01): add failing tests — 8/9 tests failing as expected
- GREEN commit: `ec93a507` feat(03-01): narrow VisionState + extend SynthesisHook — all 9 pass

## Notes for Downstream Plans

- **PLAN 05** should extend the supervisor.ts belt-write (lines ~206-234) to populate a full `StopEvidence` object rather than `stop_evidence: null`. The surgical `stop_evidence: null` in this plan is a minimal forward-compatibility patch only.
- **PLAN 03** (run-loop.ts): imports `VisionConfig`, `ConvergenceVerdict`, `DecisionLogEntry` — all now available from `./types.js`
- **PLAN 04** (forced-stop.ts extension): imports `ConvergenceVerdict`, `StopEvidence` — available from `./types.js`
- No `pnpm` workspace exists in this repo; canonical test command is `cd sdk && ./node_modules/.bin/vitest run --project unit`

## Known Stubs

- `ForcedStopStub.onConverged` in `forced-stop.ts`: no-op stub. Phase 4 replaces with real converged-path handling.
- `stop_evidence: null` in `supervisor.ts` fallback minimal state: PLAN 05 extends to full StopEvidence.

## Threat Flags

None. All changes are compile-time type declarations only. No new network endpoints, auth paths, file access patterns, or trust boundary schema changes beyond the planned `stop_evidence` top-level field addition documented in the threat model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Fixed ForcedStopStub.onConverged + worktree-lifecycle.ts stop_evidence: null**
- **Found during:** Task 2 — tsc reported three errors after the type changes
- **Issue:** `ForcedStopStub` did not implement the new required `onConverged` method; `worktree-lifecycle.ts` initial state object lacked `stop_evidence`
- **Fix:** Added no-op `onConverged` to ForcedStopStub; added `stop_evidence: null` to worktree-lifecycle.ts initial state
- **Files modified:** `sdk/src/vision/forced-stop.ts`, `sdk/src/vision/worktree-lifecycle.ts`
- **Commit:** `ec93a507`

The plan explicitly anticipated and documented the supervisor.ts fix. The worktree-lifecycle.ts and forced-stop.ts fixes were analogous and necessary to keep tsc clean — same category as the supervisor.ts one-liner.

## Self-Check: PASSED

- `sdk/src/vision/types.ts` exists and contains all 4 new interfaces
- `sdk/src/vision/types-phase3.test.ts` exists
- RED commit `6be629c8` exists in git log
- GREEN commit `ec93a507` exists in git log
- Task 1 commit `6f1bd46a` exists in git log
