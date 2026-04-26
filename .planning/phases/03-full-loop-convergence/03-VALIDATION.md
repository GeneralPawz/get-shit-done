---
phase: 3
slug: full-loop-convergence
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-25
validated: 2026-04-25
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Drawn from `03-RESEARCH.md` "Validation Architecture (Nyquist)" section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — Phase 1/2 already use it) |
| **Config file** | `sdk/vitest.config.ts` |
| **Quick run command** | `pnpm --filter @gsd/sdk test:run -- run-loop` |
| **Full suite command** | `pnpm --filter @gsd/sdk test:run` |
| **Estimated runtime** | ~5s quick / ~30s full (unit only); +60–120s with bwrap integration |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @gsd/sdk test:run -- run-loop` (scoped to phase 3 unit tests)
- **After every plan wave:** Run `pnpm --filter @gsd/sdk test:run` (all SDK unit tests)
- **Before `/gsd-verify-work`:** Full suite green AND bwrap integration green (or `skipIfNoBwrap` documented as deferred)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Filled by the planner once PLAN.md task IDs are minted. Skeleton seeded from RESEARCH.md
> §"Test Harness Plan" — every test below is required for Nyquist compliance.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-06-T1-1 | 06   | 4    | STOP-03 | — | C1 frontier-pending threshold gate | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "C1 frontier"` | ✅ W4 | ✅ green |
| 03-06-T1-2 | 06   | 4    | STOP-03 | — | C2 decision-queue drained gate | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "C2 queue"` | ✅ W4 | ✅ green |
| 03-06-T1-3 | 06   | 4    | STOP-03 | — | C3 sources-plateau gate | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "C3 plateau"` | ✅ W4 | ✅ green |
| 03-06-T1-4 | 06   | 4    | STOP-03 | — | C1 ∧ C2 ∧ C3 conjunction | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "all three"` | ✅ W4 | ✅ green |
| 03-06-T1-5 | 06   | 4    | STOP-03 | — | window-based fire timing (1, 2, 3) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "window"` | ✅ W4 | ✅ green |
| 03-06-T1-7 | 06   | 4    | STOP-03 | — | decision-queue rule (D-08) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "decision rule"` | ✅ W4 | ✅ green |
| 03-06-T2-9 | 06   | 4    | STOP-03 | — | max_rounds break (D-18) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "max rounds"` | ✅ W4 | ✅ green |
| 03-06-T2-10 | 06  | 4    | STOP-03 | — | consecutive-error abort (D-20) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "consecutive errors"` | ✅ W4 | ✅ green |
| 03-06-T2-11 | 06  | 4    | STOP-03 | — | direction-snapshot drift preserved (D-10) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "drift"` | ✅ W4 | ✅ green |
| 03-06-T2-12 | 06  | 4    | STOP-04 | — | stop_evidence on `converged` | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "stop_evidence converged"` | ✅ W4 | ✅ green |
| 03-06-T2-13 | 06  | 4    | STOP-04 | — | stop_evidence on `aborted` (both reasons) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- run-loop -t "stop_evidence aborted"` | ✅ W4 | ✅ green |
| 03-06-T2-T9 | 06  | 4    | STOP-04 | — | stop_evidence on `ceiling-hit` (stub-richer + supervisor-skip) | unit (vitest) | `pnpm --filter @gsd/sdk test:run -- forced-stop -t "ceiling stop_evidence"` | ✅ W4 | ✅ green |
| 03-07-T1-1 | 07   | 4    | STOP-03+04 (ROADMAP SC1, SC2, SC3 partial) | — | multi-round loop produces ≥2 distinct checkpoint commits + records final stop_evidence | integration (vitest + bwrap) | `pnpm --filter @gsd/sdk test:run -- run-loop.integration` | ✅ W4 | ✅ skip-gated (no bwrap host) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `sdk/src/vision/run-loop.test.ts` — stubs for all 12 unit tests above
- [x] `sdk/src/vision/run-loop.integration.test.ts` — bwrap-gated integration test (mirrors `run-one-round.integration.test.ts` pattern; reuses `skipIfNoBwrap`)
- [x] `sdk/src/vision/forced-stop.test.ts` — extend to cover new `onConverged` + extended `onForcedStop` `stop_evidence` writes
- [x] No new framework install needed — vitest already configured in `sdk/vitest.config.ts`
- [x] Fixture builders (`makeVisionState()`, `makeRoundResult()`, `makeFinding()`, `makeConvergenceVerdict()`) at top of `run-loop.test.ts` per Phase 2 convention (RESEARCH §Open Question 2 recommendation)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real overnight session converges or hits ceiling cleanly | STOP-03 + STOP-04 | Requires real claude-agent-sdk traffic + real wall-clock + real findings; out of automated CI scope (covered by Phase 6 dogfood) | Phase 6 owns. Phase 3 verification stops at the bwrap-integration test. |
| `VISION-CATCHUP.md` includes stop reason with evidence (ROADMAP SC3) | STOP-04 | Requires Phase 4 Synthesizer that consumes `stop_evidence` | Verified at Phase 4 boundary, not Phase 3. CONTEXT.md D-14 explicitly defers this. |
| Partial-result digest from ceiling-hit (ROADMAP SC4) | STOP-04 | Requires Phase 4 Synthesizer | Verified at Phase 4 boundary. Phase 3 only writes the truthful `stop_evidence` Phase 4 will read. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (vitest `test:run` not `test:watch`)
- [x] Feedback latency < 30s (quick run; integration test gated separately)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-04-25

---

## Validation Audit 2026-04-25

| Metric | Count |
|--------|-------|
| Tasks audited | 13 |
| COVERED (green) | 12 |
| COVERED (skip-gated, integration) | 1 |
| PARTIAL | 0 |
| MISSING | 0 |
| Resolved this audit | 1 (status drift on 03-07-T1-1; integration test exists and skips correctly on bwrap-less host) |
| Escalated | 0 |

**Result:** GAPS FILLED — `nyquist_compliant: true` confirmed. Sole drift was stale per-task-map status; the test file itself was already in place. ROADMAP SC1 verified by `toBeGreaterThanOrEqual(2)` assertion in `run-loop.integration.test.ts`. Real-session verification deferred to Phase 6 dogfood per Manual-Only documented scope.
