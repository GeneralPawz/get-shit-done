/**
 * Forced-stop synthesis handshake — frozen in Phase 1, implemented in Phase 4.
 *
 * The supervisor's SIGTERM handler calls hook.onForcedStop(state) during the
 * 60-second grace window between SIGTERM and SIGKILL. Phase 1 ships
 * ForcedStopStub which per D-07 literal:
 *   (a) atomically writes status: 'ceiling-hit' + stop_reason: 'wall-clock-ceiling'
 *       + partial_results_available into vision-state.json so wake-up flow sees
 *       the correct terminal status,
 *   (b) logs the grep-able sentinel so Phase 4 integration tests can confirm
 *       the stub has been replaced by the real Synthesizer,
 *   (c) does not write any drafts/ or seeds/ artifacts (Phase 4's job).
 *
 * The supervisor (Plan 01-07) performs the SAME status write as belt-and-suspenders
 * for SIGKILL scenarios where this stub did not complete. The operation is
 * idempotent: whichever writer fires first wins; a second write produces the
 * same result. This preserves D-07's literal (stub does (a)) AND Pitfall-A
 * (supervisor is the durable out-of-jail witness).
 */

import type { VisionState, SynthesisHook, ConvergenceVerdict, StopEvidence } from './types.js';
import { atomicWriteJson } from './atomic-write.js';
export type { SynthesisHook } from './types.js';

/**
 * Sentinel string emitted to stderr when the Phase 1 stub is invoked.
 * Phase 4 integration tests grep captured stderr for this literal to
 * confirm the stub has been replaced with the real Synthesizer.
 *
 * DO NOT RENAME WITHOUT UPDATING Phase 4 INTEGRATION TESTS.
 */
export const VISION_FORCED_STOP_SENTINEL = 'VISION_FORCED_STOP_STUB invoked';

/**
 * Phase 3 D-07: sentinel emitted to stderr when ForcedStopStub.onConverged is invoked.
 * Phase 4 integration tests grep captured stderr for this literal to confirm the
 * stub has been replaced with the real Synthesizer.
 *
 * DO NOT RENAME WITHOUT UPDATING Phase 4 INTEGRATION TESTS.
 */
export const VISION_CONVERGED_STUB_SENTINEL = 'VISION_CONVERGED_STUB invoked';

export interface ForcedStopStubOptions {
  /** Absolute path to the vision-state.json file this stub will update on SIGTERM. */
  visionStatePath: string;
}

export class ForcedStopStub implements SynthesisHook {
  private readonly visionStatePath: string;

  constructor(opts: ForcedStopStubOptions) {
    this.visionStatePath = opts.visionStatePath;
  }

  async onConverged(
    state: Readonly<VisionState>,
    verdict: Readonly<ConvergenceVerdict>,
  ): Promise<void> {
    // (a) D-07 literal: atomically write converged status into vision-state.json.
    // Note: runLoop.transitionToConverged (Phase 3 PLAN 03) already persisted
    // status='converged' before calling this hook; this is the stub's idempotent
    // re-write that ALSO sets convergence_snapshot to the explicit verdict param.
    const partialResultsAvailable = state.round > 0 || state.round_results.length > 0;
    const convergedState: VisionState = {
      ...state,
      status: 'converged',
      stop_reason: 'converged',
      partial_results_available: partialResultsAvailable,
      stop_evidence: buildStopEvidence(state, { convergenceSnapshot: verdict }),
    };
    await atomicWriteJson(this.visionStatePath, convergedState);

    // (b) Sentinel log for Phase 4 integration tests.
    console.error(VISION_CONVERGED_STUB_SENTINEL, { session_id: state.session_id });

    // (c) No drafts/seeds writes — Phase 4 replaces this class with the real synthesizer.
  }

  async onForcedStop(state: Readonly<VisionState>): Promise<void> {
    // Pitfall 3d safeguard 2 of 2 (RESEARCH Open Q3): short-circuit when status is
    // already 'converged' AND stop_evidence is populated. runLoop's transitionToConverged
    // (Phase 3 PLAN 03 — safeguard 1 of 2) persists 'converged' BEFORE awaiting any hook.
    // Together these two safeguards close the convergence/ceiling race deterministically.
    if (state.status === 'converged' && state.stop_evidence != null) {
      return;
    }

    // (a) D-07 + D-13: atomically write ceiling-hit status + richer stop_evidence.
    const partialResultsAvailable = state.round > 0 || state.round_results.length > 0;
    const ceilingHitState: VisionState = {
      ...state,
      status: 'ceiling-hit',
      stop_reason: 'wall-clock-ceiling',
      partial_results_available: partialResultsAvailable,
      // D-13: stub-writes-richer. The stub knows convergence_history (already in state)
      // and final_frontier_pending_count; ceiling_ms_elapsed is supervisor-side knowledge,
      // so it stays null here unless prior state populated it. Supervisor's belt-write
      // (PLAN 05) fills ceiling_ms_elapsed on the SIGKILL fallback path.
      stop_evidence: buildStopEvidence(state, {}),
    };
    await atomicWriteJson(this.visionStatePath, ceilingHitState);

    // (b) Sentinel log for Phase 4 integration tests.
    // Callers grep captured stderr for this exact string to verify the stub is still
    // in place; absence of this string means Phase 4 replaced it with the real Synthesizer.
    console.error(VISION_FORCED_STOP_SENTINEL, { session_id: state.session_id });

    // (c) No drafts/seeds writes — Phase 4 replaces this class with the real synthesizer.
  }
}

// ─── Stop-evidence construction helper (D-11/D-13/D-17) ─────────────────────

/**
 * Build a StopEvidence payload from a VisionState plus path-specific overrides.
 * Used by both onConverged (D-07) and onForcedStop (D-13 — stub-writes-richer).
 *
 * The `drift_error_count` is computed by deriving from state.round_results.errors
 * (RESEARCH Open Q recommendation: derived not materialized — simpler, max_rounds=20
 * means O(rounds * errors) is fine).
 */
function buildStopEvidence(
  state: Readonly<VisionState>,
  params: {
    stoppedAt?: string;
    convergenceSnapshot?: ConvergenceVerdict | null;
    ceilingMsElapsed?: number | null;
    reason?: 'max-rounds-exceeded' | 'consecutive-error-rounds' | 'uncaught-exception' | null;
    lastCaughtError?: { message: string; stack?: string } | null;
  } = {},
): StopEvidence {
  const baseEvidence: StopEvidence = state.stop_evidence ?? {
    stopped_at: '',
    final_round: state.round,
    final_frontier_pending_count: 0,
    convergence_history: [],
  };
  return {
    ...baseEvidence,
    stopped_at: params.stoppedAt ?? new Date().toISOString(),
    final_round: state.round,
    final_frontier_pending_count: state.frontier.filter(n => n.status === 'pending').length,
    convergence_snapshot:
      params.convergenceSnapshot ?? baseEvidence.convergence_snapshot ?? null,
    ceiling_ms_elapsed:
      params.ceilingMsElapsed ?? baseEvidence.ceiling_ms_elapsed ?? null,
    drift_error_count: state.round_results
      .flatMap(r => r.errors)
      .filter(e => e.reason === 'direction-snapshot-drift').length,
    reason: params.reason ?? baseEvidence.reason ?? null,
    last_caught_error:
      params.lastCaughtError ?? baseEvidence.last_caught_error ?? null,
  };
}
