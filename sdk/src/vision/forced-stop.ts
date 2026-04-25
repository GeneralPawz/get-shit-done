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

import type { VisionState, SynthesisHook } from './types.js';
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

export interface ForcedStopStubOptions {
  /** Absolute path to the vision-state.json file this stub will update on SIGTERM. */
  visionStatePath: string;
}

export class ForcedStopStub implements SynthesisHook {
  private readonly visionStatePath: string;

  constructor(opts: ForcedStopStubOptions) {
    this.visionStatePath = opts.visionStatePath;
  }

  /** Phase 3 D-07 additive no-op — Phase 4 Synthesizer replaces this with real converged-path handling. */
  async onConverged(_state: Readonly<VisionState>, _verdict: Readonly<import('./types.js').ConvergenceVerdict>): Promise<void> {
    // Phase 1 stub: no-op for converged path. Phase 4 replaces this.
  }

  async onForcedStop(state: Readonly<VisionState>): Promise<void> {
    // (a) D-07 literal: atomically write ceiling-hit status into vision-state.json.
    // partial_results_available: true when the session completed at least one round
    // or produced any round_results; false when session died before finishing round 0.
    const partialResultsAvailable = state.round > 0 || state.round_results.length > 0;
    const ceilingHitState: VisionState = {
      ...state,
      status: 'ceiling-hit',
      stop_reason: 'wall-clock-ceiling',
      partial_results_available: partialResultsAvailable,
    };
    await atomicWriteJson(this.visionStatePath, ceilingHitState);

    // (b) Sentinel log for Phase 4 integration tests.
    // Callers grep captured stderr for this exact string to verify the stub is still
    // in place; absence of this string means Phase 4 replaced it with the real Synthesizer.
    console.error(VISION_FORCED_STOP_SENTINEL, { session_id: state.session_id });

    // (c) No drafts/seeds writes — Phase 4 replaces this class with the real synthesizer.
  }
}
