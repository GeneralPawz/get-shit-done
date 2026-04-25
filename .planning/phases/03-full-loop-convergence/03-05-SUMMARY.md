---
phase: 03-full-loop-convergence
plan: 05
subsystem: vision/supervisor
tags: [vision, supervisor, ceiling, stop-evidence, D-13, D-17]
requirements: [STOP-04]

dependency_graph:
  requires:
    - 03-01 (StopEvidence type in types.ts)
    - 03-04 (ForcedStopStub.onForcedStop writes richer stop_evidence — the skip guard now requires it)
  provides:
    - Supervisor ceiling-hit belt-write populates stop_evidence on SIGKILL fallback path (D-13)
    - Supervisor uncaughtException handler writes crashed-path stop_evidence.last_caught_error (D-17)
    - reconstructStopEvidenceFromState private helper shared across both call sites
  affects:
    - 03-07 (integration test T1 extension will assert stop_evidence non-null on prev-exists path)

tech_stack:
  added: []
  patterns:
    - Fire-and-forget Promise inside uncaughtException handler (best-effort I/O, structurally no-throw)
    - Tightened idempotency guard: status AND evidence presence together form the skip contract

key_files:
  modified:
    - sdk/src/vision/supervisor.ts

decisions:
  - "Tightened skip guard requires BOTH status='ceiling-hit' AND stop_evidence!=null — presence of stop_evidence is the stub-completion marker (D-13/RESEARCH Risk Note 4)"
  - "reconstructStopEvidenceFromState accepts ceilingMs as number|null so the same helper serves ceiling-path (ceilingMs) and crashed-path (null)"
  - "Fallback minimal state (prev null) retains stop_evidence: null — no source state to reconstruct from outside-jail context"
  - "Crashed-path write is best-effort fire-and-forget; documented as such; Phase 6 calibration may add setImmediate deferral if race is observed"

metrics:
  duration_seconds: 183
  completed_date: "2026-04-25"
  tasks_completed: 2
  files_modified: 1
---

# Phase 03 Plan 05: Supervisor Belt-Write Stop-Evidence Population Summary

One-liner: Extended supervisor.ts ceiling-hit belt-write and uncaughtException handler to populate `stop_evidence` on the SIGKILL fallback path (D-13) and crashed terminal path (D-17) via a shared `reconstructStopEvidenceFromState` helper.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Tighten ceiling-hit belt-write guard + reconstructStopEvidenceFromState helper | 9c05af3f | sdk/src/vision/supervisor.ts |
| 2 | Extend uncaughtException handler with best-effort crashed-path stop_evidence write | 6c2011f8 | sdk/src/vision/supervisor.ts |

## What Was Built

### Task 1 — Belt-write extension (D-13 SIGKILL fallback path)

Three edits to `sdk/src/vision/supervisor.ts`:

**1. Extended type import** (line 30):
```typescript
import type { JailPolicy, VisionState, StopEvidence } from './types.js';
```

**2. Tightened skip guard** in the `if (ceilingFired)` block:
- Before: `if (prev?.status === 'ceiling-hit')`
- After: `if (prev?.status === 'ceiling-hit' && prev.stop_evidence != null)`

The presence of `stop_evidence` is the stub-completion marker (D-13/RESEARCH Risk Note 4). If the stub completed its atomic write, both fields are set. If somehow status was set without evidence (defense-in-depth: atomicWriteJson makes this impossible), supervisor still writes.

**3. stop_evidence in prev-exists branch**:
```typescript
stop_evidence: prev.stop_evidence ?? reconstructStopEvidenceFromState(prev, ceilingMs),
```
Preserves whatever the stub may have partially written; falls back to reconstruction.

**4. Fallback minimal state** (prev null) retains `stop_evidence: null` — no source state to reconstruct from.

**5. New private helper** at file bottom:
```typescript
function reconstructStopEvidenceFromState(prev: VisionState, ceilingMs: number | null): StopEvidence
```
Populates: `stopped_at`, `final_round`, `final_frontier_pending_count`, `convergence_history` (from prev.stop_evidence if any), `convergence_snapshot` (from prev.stop_evidence if any), `ceiling_ms_elapsed` (from parameter), `drift_error_count` (derived from round_results.errors), `reason: null`, `last_caught_error: null`.

### Task 2 — crashHandler extension (D-17 crashed terminal path)

The existing `crashHandler` (SIGTERM to child + console.error) gained a fire-and-forget Promise:

```typescript
(async () => {
  try {
    const prev = await readCheckpoint(visionStatePath);
    if (!prev) return;
    const crashedState: VisionState = {
      ...prev,
      status: 'crashed',
      stop_reason: 'crashed',
      partial_results_available: prev.round > 0 || prev.round_results.length > 0,
      stop_evidence: {
        ...reconstructStopEvidenceFromState(prev, null),
        reason: 'uncaught-exception',
        last_caught_error: { message: err.message, stack: err.stack },
      },
    };
    await atomicWriteJson(visionStatePath, crashedState);
  } catch { /* best effort */ }
})().catch(() => {});
```

Key design properties:
- **Fire-and-forget**: Node's default terminate-on-uncaught races with the I/O; best-effort by design
- **Structurally no-throw**: inner try/catch + outer `.catch(()=>{})` guarantee the handler never throws
- **Skips write when prev is null**: no meaningful crashed state constructable from outside-jail context
- **Reuses reconstructStopEvidenceFromState with `null` ceilingMs**: a crash is not ceiling-related

## Two Call Sites of reconstructStopEvidenceFromState

| Call site | ceilingMs argument | Rationale |
|-----------|-------------------|-----------|
| Ceiling-hit belt-write (Task 1) | `ceilingMs` (number) | The wall-clock ceiling is known; `ceiling_ms_elapsed` should reflect it |
| Crashed-path handler (Task 2) | `null` | A crash is not ceiling-related; `ceiling_ms_elapsed` is null in the output |

## Final File State

- **Line count**: 314 (was 252 before this plan; +62 lines)
- Breakdown: helper ~30 lines, belt-write extension ~12 lines, crash-handler extension ~27 lines, comments ~13 lines

## Unchanged Invariants (visual confirmation)

The following Phase 1 elements are byte-identical to the pre-edit file:
- `setTimeout(...ceilingMs)` ceiling timer — line 103
- `process.on('SIGINT', forwardTerm)` and `process.on('SIGTERM', forwardTerm)` signal forwarding
- `child = spawn('bwrap', argv, ...)` spawn invocation
- Re-entrancy guard (`_activeSession` flag) at lines 38–85
- `sessionProvenance` parameter plumbing

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The crashed-path write is intentionally best-effort (documented); this is an architectural decision, not a stub.

## Threat Flags

None. The new write surfaces (ceiling-hit belt-write enrichment, crashed-path write) are already covered by the plan's threat model (T-03-17 through T-03-21).

## Notes for Phase 6 Calibration

The crashed-path I/O may lose the race with Node's process termination. If Phase 6 dogfood shows the write failing more often than expected, consider deferring `process.exit` via `setImmediate` inside the crash handler to give the I/O one tick to complete before termination. This is deliberately deferred to Phase 6 per plan output spec.

## Self-Check

Files exist:
- sdk/src/vision/supervisor.ts: present (314 lines)
- .planning/phases/03-full-loop-convergence/03-05-SUMMARY.md: this file

Commits exist:
- 9c05af3f: Task 1 (tighten belt-write, add helper)
- 6c2011f8: Task 2 (crash handler extension)

## Self-Check: PASSED
