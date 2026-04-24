---
phase: 02-single-round-exploration
plan: 02
subsystem: vision
tags: [vision, round-result, typescript, phase-2, pure-functions, tdd]

# Dependency graph
requires:
  - phase: 02-single-round-exploration
    plan: 01
    provides: FrontierNode, RoundResult, Finding, RoundScores, RoundError types; normalizeTopic helper
provides:
  - parseRoundResult() — null-return never-throw JSON parser with markdown-fence stripping (T-02-parse-corruption)
  - selectTopK() — greedy top-K pending-only selector with stable-FIFO tie-breaking (D-14, D-12)
  - deduplicateFrontier() — D-15 dedup-at-append, higher-score winner, parent_round merge
  - buildRoundResult() — constructor hard-coding backtrack_flag: false and selection_method: greedy-top-k (LOOP-04)
  - markExplored() — pure flip of picked nodes pending→explored
  - round-result.test.ts — 21 unit tests covering all 02-RESEARCH.md Validation Architecture test IDs owned by this file
affects:
  - 02-05-run-one-round (imports parseRoundResult, selectTopK, deduplicateFrontier, buildRoundResult, markExplored)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Null-return never-throw parser (mirrors readCheckpoint pattern from vision-state.ts)
    - Literal hard-coding in constructors (backtrack_flag, selection_method — not passable by callers)
    - Omit<RoundScores, 'selection_method'> on buildRoundResult input — prevents callers from overriding hard-coded literal
    - Defensive .slice() before .sort() in selectTopK — no mutation of input array
    - Map<string, number> index for O(n) dedup in deduplicateFrontier

key-files:
  created:
    - sdk/src/vision/round-result.ts
    - sdk/src/vision/round-result.test.ts

key-decisions:
  - "buildRoundResult accepts Omit<RoundScores, 'selection_method'> so callers cannot pass a different selection_method — constructor hard-codes 'greedy-top-k'"
  - "parseRoundResult uses permissive regex (\\s* around fence backticks) to tolerate leading/trailing whitespace on fence lines — common LLM output pattern"
  - "deduplicateFrontier's indexByKey Map gives O(n+m) dedup (n=existing, m=incoming) rather than O(n*m) nested loop — important for large frontiers in later phases"
  - "selectTopK defensive .slice() before .sort() prevents mutation of input — callers can reuse the frontier array"

requirements-completed: [LOOP-01, LOOP-04]

# Metrics
duration: 5min
completed: 2026-04-24
---

# Phase 2 Plan 02: Round Result Helpers Summary

**Five pure data-shape helpers shipped in round-result.ts: parseRoundResult (markdown-fence-stripping null-return parser), selectTopK (greedy top-K with stable-FIFO tie-breaking), deduplicateFrontier (D-15 higher-score winner + parent_round merge), buildRoundResult (LOOP-04 backtrack_flag hard-coded), markExplored (pure status flip) — 21 unit tests all pass, tsc clean**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-24T10:20:05Z
- **Completed:** 2026-04-24T10:25:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Shipped `sdk/src/vision/round-result.ts` with five public pure functions (zero I/O, no forbidden imports)
- `parseRoundResult` strips markdown fences with whitespace-tolerant regex (Pitfall 5 mitigation T-02-parse-corruption), enforces `backtrack_flag: boolean` and non-empty `direction_snapshot: string`, returns null on any failure — never throws
- `selectTopK` filters `status === 'pending'` nodes only, uses defensive `.slice()` before `.sort()`, stable-FIFO tie-breaking honors LOOP-04 greedy invariant
- `deduplicateFrontier` uses O(n+m) Map-indexed approach for D-15 higher-score winner with `Math.min(parent_round)` merge (T-02-dedup-thrash mitigation)
- `buildRoundResult` accepts `Omit<RoundScores, 'selection_method'>` so callers cannot override the hard-coded `'greedy-top-k'` literal; `backtrack_flag: false` is literal in the constructor body
- `markExplored` returns new array, never mutates input — pure transform
- Shipped `sdk/src/vision/round-result.test.ts` with 21 tests covering all required test IDs (SC1-UNIT-03/04, SC4-UNIT-01/02, SCHEMA-01..03, CAP-01..02, PARSE-FENCE, DEDUP-MERGE, MARK-EXPL) plus additional robustness and mutation-safety tests

## Task Commits

Each task was committed atomically:

1. **Task 1: round-result.ts — five pure functions** — `82b0202` (feat)
2. **Task 2: round-result.test.ts — 21 unit tests** — `a35bb89` (feat)

## Files Created/Modified

- `sdk/src/vision/round-result.ts` — 162 lines, five exported pure functions, zero I/O imports
- `sdk/src/vision/round-result.test.ts` — 266 lines, 21 unit tests via dynamic import pattern

## Decisions Made

- Used `Omit<RoundScores, 'selection_method'>` for the `scores` parameter of `buildRoundResult` — this enforces at compile time that callers cannot supply a different `selection_method`, since the constructor hard-codes `'greedy-top-k'`. Any attempt to pass `selection_method` directly produces a TypeScript error.
- Used permissive regex `/^```(?:json)?\s*\n?/` and `/\n?\s*```\s*$/` for fence stripping — tolerates leading/trailing whitespace on fence lines which is a common LLM output variation.
- Implemented `deduplicateFrontier` with a `Map<string, number>` index over result positions — O(n+m) rather than O(n*m) nested loop. Important because the frontier may grow large across rounds in Phase 3.

## Deviations from Plan

None — plan executed exactly as written. All five functions match the verbatim signatures from 02-PATTERNS.md §"Signatures / Contracts". All 21 tests pass. TypeScript exits 0.

Note: SDK `node_modules` were not present in the worktree's `sdk/` directory (same as 02-01). Applied `npm install` before running tsc and vitest — Rule 3 auto-fix (blocking issue). Pre-existing 6 test failures in `src/query/` (config-mutation, decomposed-handlers, registry, state-mutation) confirmed identical to those documented in 02-01-SUMMARY.md; out of scope per scope boundary rules.

## Threat Model Coverage

All three mitigate-disposition threats from the plan's `<threat_model>` are implemented:

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-02-parse-corruption | `parseRoundResult` strips fences, enforces `typeof backtrack_flag !== 'boolean'` + non-empty `direction_snapshot`, returns null on any failure, never throws |
| T-02-topk-violation | `selectTopK` filters `status === 'pending'` only, stable sort desc, slices to k |
| T-02-dedup-thrash | `deduplicateFrontier` normalizes via `normalizeTopic` before compare, keeps higher score, merges `parent_round` to `Math.min` |

T-02-false-empty-round is the accept disposition — empty `findings: []` and `new_frontier_nodes: []` are accepted by `parseRoundResult` and `buildRoundResult` (D-07 valid empty round). Test SCHEMA-03 verifies this acceptance.

## Known Stubs

None. All five functions are fully implemented with correct behavior. No hardcoded empty values, no placeholder text.

## Self-Check: PASSED

- FOUND: sdk/src/vision/round-result.ts (created, 162 lines)
- FOUND: sdk/src/vision/round-result.test.ts (created, 266 lines)
- FOUND commit 82b0202: feat(02-02): add round-result.ts
- FOUND commit a35bb89: feat(02-02): add round-result.test.ts
- tsc --noEmit: exits 0
- vitest run round-result.test.ts: 21/21 passing
- Full unit suite: 6 pre-existing failures in src/query/ (confirmed identical to 02-01 report); all vision tests pass
