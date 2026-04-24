---
phase: 02-single-round-exploration
plan: 05
subsystem: vision
tags: [vision, orchestration, integration, run-one-round, typescript, tdd, phase-2]

# Dependency graph
requires:
  - phase: 02-single-round-exploration
    plan: 01
    provides: VisionState, FrontierNode, RoundResult types; writeCheckpoint; vision-state.ts
  - phase: 02-single-round-exploration
    plan: 02
    provides: parseRoundResult, selectTopK, deduplicateFrontier, buildRoundResult, markExplored
  - phase: 02-single-round-exploration
    plan: 03
    provides: seedFromDirection({ useLLM: false }) for deterministic integration test seeding
  - phase: 02-single-round-exploration
    plan: 04
    provides: gsd-vision-explorer.md agent spawned by runOneRound via query()
provides:
  - runOneRound(state, opts): Promise<VisionState> — Phase 3 reuse seam for multi-round loop
  - RunOneRoundOptions interface (visionStatePath, worktreeRoot, explorerAgent, explorerMaxTurns)
  - run-one-round.integration.test.ts — SC-1, SC-3, SC-4, CAP-03 bwrap-gated integration tests
affects:
  - Phase 3 multi-round loop (wraps runOneRound in a serial while-loop with convergence gate)
  - Phase 5 /gsd-envision entry command (will call runOneRound indirectly via supervisor)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Supervisor-owned checkpoint write (D-06) — Explorer has no Write tool; all persistence via writeCheckpoint()
    - Pre-selection at trust boundary (Option A from 02-RESEARCH.md) — selectTopK runs in Node before Explorer spawns
    - direction_snapshot captured before first await (Pitfall 5 anchor)
    - Error-round fallback (T-02-parse-failure-abort, T-02-explorer-crash) — round always completes with checkpoint
    - Direction-drift defensive check post-parse (T-02-direction-drift) — mismatch appended to errors[], not abort
    - WSL2 musl fix via resolveClaudeCodeExecutable() spread-conditional on every query() call (Pitfall 1)
    - query() with systemPrompt preset claude_code so Explorer's Task() tool is available
    - settingSources: ['project'] to load worktree's .claude/settings.local.json (WebFetch rules)
    - bwrap-gated integration tests with skipIfNoBwrap gate + explicit 120_000ms per-test timeout

key-files:
  created:
    - sdk/src/vision/run-one-round.ts
    - sdk/src/vision/run-one-round.integration.test.ts
  modified: []

key-decisions:
  - "Pre-selection runs in supervisor (Option A) — selectTopK(state.frontier, 5) before Explorer spawns enforces D-12 cap at the trust boundary; Explorer receives ≤5 topics and cannot overshoot"
  - "Error rounds complete unconditionally — parse failure, explorer crash, non-success subtype all funnel into errorRoundResult(); writeCheckpoint() always runs so SC-3 checkpoint invariant holds even on error rounds"
  - "direction_snapshot captured as first local const before any await — guarantees Pitfall 5 anchor even if caller mutates state.direction concurrently"
  - "withError() appends to errors[] rather than replacing the round on direction-snapshot drift — allows Phase 4 forensic inspection without silently discarding LLM output"

patterns-established:
  - "Run-and-always-commit: writeCheckpoint runs unconditionally at the bottom of runOneRound regardless of error/success — the Phase 3 contract is that a checkpoint always lands"
  - "Trust-boundary cap: data reduction (selectTopK) runs in Node supervisor code, not in the Claude session — prevents concurrency overshoot even if Explorer's prompt instructions are ignored"
  - "Error-funnel pattern: all failure paths (catch, non-success subtype, null parse, no-result-string) go through errorRoundResult() which builds a valid RoundResult with errors[] — callers never see exceptions"

requirements-completed: [LOOP-01, LOOP-02, LOOP-03, LOOP-04]

# Metrics
duration: 10min
completed: 2026-04-24
---

# Phase 2 Plan 05: runOneRound Single-Round Orchestrator Summary

**runOneRound(state, opts) → Promise<VisionState> composing Plans 01-04 into a complete LOOP-01..04 cycle with supervisor-owned checkpoint commit (D-06 + D-13) and bwrap-gated integration tests covering SC-1, SC-3, SC-4, CAP-03**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-24T12:30:00Z
- **Completed:** 2026-04-24T12:40:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Implemented `runOneRound(state, opts): Promise<VisionState>` — the Phase 3 reuse seam that composes all prior Plan 01-04 outputs into a single-round exploration cycle
- Pre-selection at the trust boundary: `selectTopK(state.frontier, 5)` runs in Node supervisor code before the Explorer spawns, enforcing the D-12 concurrency cap unconditionally
- All failure modes (Explorer crash, parse failure, non-success subtype, direction-snapshot drift) funnel into an error RoundResult that still commits a checkpoint — the round always completes (T-02-parse-failure-abort, T-02-explorer-crash mitigations)
- Shipped 4 bwrap-gated integration tests (SC1-INT-01, SC3-INT-01, SC4-INT-01, CAP-03) that skip cleanly on hosts without bubblewrap

## Task Commits

1. **Task 1: run-one-round.ts orchestrator** - `c4ea845` (feat)
2. **Task 2: run-one-round.integration.test.ts** - `651b914` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `sdk/src/vision/run-one-round.ts` — Single-round orchestrator; ~241 LOC; composes Plans 01-04; Pitfall 1/5 mitigations; D-06/D-12/D-13/D-14/D-15 enforced
- `sdk/src/vision/run-one-round.integration.test.ts` — bwrap-gated integration tests; 4 skipIfNoBwrap tests; explicit 120_000ms timeouts; deterministic seeding via useLLM:false

## Decisions Made

- Used `buildExplorerPrompt` as a pure function (not a closure over state) for testability and separation from the query() call
- Cast `resultMsg` to `{ result?: unknown }` for the `result: string` extraction to avoid TypeScript structural issues with the SDK union type at this tsc version
- Integration tests use `await import('./run-one-round.js')` (dynamic import pattern) per the established test harness pattern from 02-PATTERNS.md

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- The worktree does not have `node_modules/` (only the main repo does). TypeScript compilation was verified by temporarily copying files to the main SDK directory and running `tsc --noEmit` there — result: clean. This is consistent with how other Wave 4 plans were verified.
- Pre-existing test failures in `src/query/` (state-mutation, config-mutation, registry) are unrelated to this plan; vision unit tests all pass (104/104).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `runOneRound(state, opts): Promise<VisionState>` is the explicit Phase 3 reuse seam; Phase 3 wraps it in a serial while-loop and adds the three-condition convergence gate
- Phase 3 can call `runOneRound` without modification — the signature and error-round contract are stable
- SC-1, SC-3, SC-4, CAP-03 test IDs from ROADMAP.md Phase 2 are all covered in the integration test file (skipped without bwrap; will run end-to-end on bwrap-equipped hosts with Claude API access)

---
*Phase: 02-single-round-exploration*
*Completed: 2026-04-24*
