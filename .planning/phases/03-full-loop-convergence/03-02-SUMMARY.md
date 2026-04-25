---
phase: 03-full-loop-convergence
plan: "02"
subsystem: vision/config
tags: [vision, config, convergence, tdd]
dependency_graph:
  requires:
    - sdk/src/vision/types.ts (VisionConfig interface — Wave 1 parallel; added minimal VisionConfig stub in this worktree)
    - sdk/src/config.ts (loadConfig — existing, delegates I/O)
  provides:
    - sdk/src/vision/config.ts (loadVisionConfig + VISION_CONFIG_DEFAULTS)
  affects:
    - sdk/src/vision/supervisor.ts (PLAN 05 — imports loadVisionConfig at session kickoff)
    - sdk/src/vision/run-loop.ts (PLAN 03 — receives VisionConfig parameter)
    - sdk/src/vision/forced-stop.ts (PLAN 04 — may read VisionConfig)
tech_stack:
  added: []
  patterns:
    - "Per-group spread merge (mirrors loadConfig three-level deep-merge pattern at config.ts:165-185)"
    - "Delegation: no file I/O in vision/config.ts — all delegated to loadProjectConfig"
    - "Unsafe cast (cfg.workflow as { vision?: Partial<VisionConfig> }) at single call site — intentional per RESEARCH Q4"
key_files:
  created:
    - sdk/src/vision/config.ts
    - sdk/src/vision/config.test.ts
  modified:
    - sdk/src/vision/types.ts (added VisionConfig interface in Phase 3 section)
decisions:
  - "VisionConfig NOT added to WorkflowConfig in sdk/src/config.ts — per RESEARCH Open Question 4 recommendation; vision/* stays self-contained"
  - "Single cast site (cfg.workflow as { vision?: Partial<VisionConfig> }) is safe because loadProjectConfig already validates workflow is an object via parent merge"
  - "No structuredClone(VISION_CONFIG_DEFAULTS) at top of loadVisionConfig — per-group spread already constructs fresh object on each call"
  - "VisionConfig interface added to worktree types.ts (minimal Wave 1 parallel bootstrap) to enable tsc clean; full PLAN 01 Phase 3 type surface (DecisionLogEntry, ConvergenceVerdict, StopEvidence, VisionConfig) will merge from PLAN 01 worktree"
metrics:
  duration: "4min"
  completed_date: "2026-04-25"
  tasks_completed: 1
  files_created: 2
  files_modified: 1
requirements_completed: [STOP-03]
---

# Phase 3 Plan 02: Vision Config Loader Summary

**One-liner:** Vision-domain config loader delegating to existing `loadConfig()` with per-group spread merge against canonical D-21 defaults.

## What Was Built

Created `sdk/src/vision/config.ts` (66 lines) with two exports:

1. **`VISION_CONFIG_DEFAULTS: VisionConfig`** — canonical defaults for all seven knobs across three config groups:
   - `convergence`: `pending_threshold=2` (D-01), `plateau_threshold=1` (D-03), `window=2` (D-04)
   - `safety`: `max_rounds=20` (D-18), `consecutive_error_abort=3` (D-20)
   - `decision_queue`: `confidence_max=0.6` (D-08), `surprises_min=1` (D-08)

2. **`loadVisionConfig(projectDir: string): Promise<VisionConfig>`** — reads `.planning/config.json > workflow.vision.*` via `loadProjectConfig` (sdk/src/config.ts), applies per-group spread merge against defaults.

Also added `VisionConfig` interface to `sdk/src/vision/types.ts` in a "Phase 3" section (see Deviations).

## Module Design

- **No file I/O**: `config.ts` contains zero `readFile`/`JSON.parse` calls — all delegated to `loadProjectConfig`.
- **`WorkflowConfig` unpolluted**: `vision` key is NOT added to `WorkflowConfig` in `sdk/src/config.ts`. A single unsafe cast at the read site handles the structural gap (per RESEARCH Open Question 4 recommendation).
- **Fresh object per call**: Per-group spread constructs new nested objects on every `loadVisionConfig` invocation.
- **Missing/empty config.json**: Falls through cleanly — `loadProjectConfig` returns defaults when file is missing; empty file returns empty object; per-group spread yields `VISION_CONFIG_DEFAULTS` verbatim.

## Confirmed: No WorkflowConfig Pollution

`grep -c "vision" sdk/src/config.ts` returns `0`. The `WorkflowConfig` interface in `sdk/src/config.ts` has no `vision` field. The plan's rejected alternative (adding `vision?: VisionConfig` to `WorkflowConfig`) was not implemented.

## Cast Site Safety

```typescript
const v =
  ((cfg.workflow as { vision?: Partial<VisionConfig> } | undefined)?.vision) ?? {};
```

This cast is safe because `loadProjectConfig` already validated that `cfg.workflow` is an object via the parent three-level merge (lines 165–185 of `sdk/src/config.ts`). The cast is structural only; runtime type safety is acceptable for v1 private workflow per T-03-05 threat register entry.

## TDD Gate Compliance

- RED: `test(03-02)` commit `301836a7` — 5 failing tests for `config.js` module not found
- GREEN: `feat(03-02)` commit `609d482f` — all 5 tests pass, tsc clean

## Deviations from Plan

### Auto-added Functionality

**1. [Rule 3 - Blocking Dependency] Added VisionConfig to types.ts to enable tsc clean**

- **Found during:** Task 1 GREEN phase
- **Issue:** `VisionConfig` is exported from `sdk/src/vision/types.ts` (per PLAN 01), but PLAN 01 runs in parallel (Wave 1). Without `VisionConfig` in types.ts, `import type { VisionConfig } from './types.js'` in config.ts would cause tsc errors.
- **Fix:** Added minimal `VisionConfig` interface to types.ts in a `// ─── Phase 3: Convergence + Decision Queue + Stop Evidence + Config ─────────` section, exactly matching the shape PLAN 01 will add. This unblocks tsc for the acceptance criterion.
- **Files modified:** `sdk/src/vision/types.ts` (+9 lines)
- **Commit:** `609d482f`
- **Note:** When PLAN 01's types.ts changes merge (DecisionLogEntry, ConvergenceVerdict, StopEvidence, VisionConfig), the VisionConfig definition will be a duplicate. The merge driver should de-duplicate cleanly since both add identical interface text in the same section.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Module is a pure projection of existing `loadConfig()` output — no new I/O surface.

## Verification Results

All acceptance criteria passed:
- `tsc --noEmit` exits 0
- `sdk/src/vision/config.ts` exists with both exports
- All 7 D-XX default values present (grep confirms count=1 each)
- `from '../config.js'` present (delegates to parent loader)
- `fs/promises|readFile|JSON.parse` count = 0 (no duplicate file I/O)
- Line count: 66 (< 80 threshold)
- 5/5 unit tests pass

Pre-existing failures in `src/query/` (6 tests) are unrelated to this plan and present in the base branch.

## Self-Check: PASSED

- `sdk/src/vision/config.ts` exists: confirmed
- `sdk/src/vision/config.test.ts` exists: confirmed
- `sdk/src/vision/types.ts` modified: confirmed
- Commits `301836a7` (test) and `609d482f` (feat) exist in git log: confirmed
