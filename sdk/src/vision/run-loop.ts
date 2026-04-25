/**
 * Multi-round serial control loop — wraps Phase 2's runOneRound (D-05) in a
 * serial while-loop with the three-condition convergence gate (D-01/02/03/04),
 * deterministic decision-queue rule (D-08), and four terminal paths
 * (converged | aborted-max-rounds | aborted-consec-error | ceiling — supervisor/stub).
 *
 * Called by:
 *   - sdk/src/vision/supervisor.ts (Phase 3 PLAN 05) — supervisor invokes runLoop
 *     as the session's entry inside the bwrap jail
 *
 * Owns:
 *   - Loop body (while !converged && !signal.aborted && state.round < max_rounds &&
 *     !consecutiveErrorRoundsTripped)
 *   - evaluateConvergence (pure D-06) — fixture-testable; no I/O
 *   - populateDecisionsLog (deterministic D-08) — per-finding rule, not per-round
 *   - windowConverged (D-04 fire-timing) — first line guards Pitfall 3b
 *   - consecutiveErrorRoundsTripped (D-20) — conservative: errors > 0 AND findings === 0
 *   - appendVerdictToHistory (D-12 — accumulates stop_evidence.convergence_history every round)
 *   - transitionToConverged / transitionToAborted (terminal-path branch arms)
 *   - drift_error_count (derived at stop time per RESEARCH Recommendation: derived not materialized)
 *
 * Does NOT own:
 *   - Phase 2 reuse seam (run-one-round.ts) — D-10 invariant: NEVER modify
 *   - Signal ladder + ceiling timer (supervisor.ts — Phase 1 D-05/D-06)
 *   - Ceiling-hit stop_evidence (forced-stop.ts onForcedStop owns inside-jail; supervisor belt-write owns outside)
 *   - LLM-driven convergence (D-06 forbids; gate is pure function over state + config)
 *
 * duplicate-commit pattern (RESEARCH Risk Note 7 + 10 — option (c) chosen):
 *   runOneRound calls writeCheckpoint at end of its body (line 120). runLoop calls
 *   writeCheckpoint AGAIN after populateDecisionsLog + appendVerdictToHistory to
 *   persist the post-processed state. Result: TWO `checkpoint round N` commits per
 *   round in the worktree's git log. This is acceptable (forensics still work; the
 *   ROADMAP SC1 git-log assertion `count >= 2 after 2 rounds` passes with 4 commits).
 *   Document via section banner so the planner-of-future selves don't re-litigate.
 *
 * Pitfall 3a guard (RESEARCH Risk Note pitfall 3a):
 *   NEVER mutate `state.round` inside runLoop. The increment lives ONLY in runOneRound.
 *   runLoop's only consumer of state.round is the loop condition.
 *
 * Pitfall 3b guard (RESEARCH Risk Note pitfall 3b):
 *   First line of windowConverged MUST be `if (history.length < window) return false;`.
 *   Without it, Array.prototype.every on a length-1 array returns true and a single
 *   converged round triggers transition (defeats D-04 fire-timing).
 *
 * Pitfall 3d guard (RESEARCH Open Q3 + Pitfall 3d):
 *   runLoop persists status='converged' via writeCheckpoint BEFORE awaiting
 *   onConverged. The forced-stop stub then short-circuits if state.status===
 *   'converged' (PLAN 04). Together these two guards close the convergence/ceiling
 *   race deterministically.
 */

import type {
  VisionState,
  VisionConfig,
  ConvergenceVerdict,
  DecisionLogEntry,
  StopEvidence,
  Finding,
  SynthesisHook,
} from './types.js';
import { runOneRound, type RunOneRoundOptions } from './run-one-round.js';
import { writeCheckpoint } from './vision-state.js';
import { mintSessionId } from './id.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/** D-05 + D-09: options the supervisor passes to runLoop. */
export interface RunLoopOptions extends RunOneRoundOptions {
  /**
   * D-09 cancellation surface. Supervisor's setTimeout(ceilingMs) fires SIGTERM
   * to the in-jail Node child; the child's runLoop also receives `signal`. The
   * loop checks `signal.aborted` between rounds; mid-round cancellation is
   * inherited via SIGTERM to the session process (Phase 1 D-05/D-06).
   */
  signal?: AbortSignal;

  /**
   * D-07 converged-path callback. Phase 1 ForcedStopStub provides a no-op
   * implementation (PLAN 04); Phase 4 Synthesizer replaces it. runLoop
   * persists `status='converged'` via writeCheckpoint BEFORE awaiting this
   * (Pitfall 3d safeguard 1 of 2; safeguard 2 lives in the stub).
   */
  synthesisHook: SynthesisHook;
}

/**
 * Multi-round serial loop. Returns the final VisionState with one of:
 *   - status='converged' + stop_reason='converged' + stop_evidence populated
 *   - status='aborted'   + stop_reason='aborted'   + stop_evidence.reason set
 *   - (signal-aborted: returns whatever state runOneRound last produced; supervisor/stub
 *      writes the final ceiling-hit terminal state — runLoop does NOT write status here)
 *
 * @throws never — all errors are captured in round_results[N].errors via runOneRound's
 *                 own error-round path; consecutive errors trip the D-20 abort.
 */
export async function runLoop(
  initialState: VisionState,
  opts: RunLoopOptions,
  config: VisionConfig,
): Promise<VisionState> {
  // PLAN 03 Task 3 implements the body.
  void initialState; void opts; void config;
  throw new Error('not implemented — PLAN 03 Task 3');
}

// ─── Convergence verdict (D-06, D-23) ────────────────────────────────────────

/**
 * Pure convergence verdict. Fixture-testable. No I/O. LLM output never drives
 * the stopping contract (D-06).
 *
 * D-01 — C1 frontier: pending_count <= config.convergence.pending_threshold
 * D-02 — C2 queue:    blocking_unresolved_count === 0
 * D-03 — C3 plateau:  last RoundResult.new_frontier_nodes.length <= plateau_threshold
 */
export function evaluateConvergence(
  state: Readonly<VisionState>,
  config: Readonly<VisionConfig>,
): ConvergenceVerdict {
  // PLAN 03 Task 3 implements the body.
  void state; void config;
  throw new Error('not implemented — PLAN 03 Task 3');
}

// ─── Decision-queue population rule (D-08) ───────────────────────────────────

/**
 * Deterministic per-finding rule. NOT per-round (Pitfall 3c — only inspects the
 * last round's findings; never re-processes prior rounds).
 *
 * Rule: append one DecisionLogEntry when a finding has
 *   confidence < config.decision_queue.confidence_max (default 0.6) AND
 *   surprises.length >= config.decision_queue.surprises_min (default 1).
 *
 * Type classification (no LLM call):
 *   - surprises.length >= 2          → 'path_fork'
 *   - follow_up_questions matches /risk|hazard|threat|concern/i → 'risk_alert'
 *   - otherwise                       → 'assumption_unverified'
 *
 * Blocking classification (RESEARCH Open Q1 — hard-coded threshold + Phase 6
 * tuning marker): blocking = (finding.confidence < 0.4). The 0.4 threshold is
 * a first-principles starting point; Phase 6 dogfood will calibrate.
 */
export function populateDecisionsLog(
  state: VisionState,
  config: VisionConfig,
): VisionState {
  // PLAN 03 Task 3 implements the body.
  void state; void config;
  throw new Error('not implemented — PLAN 03 Task 3');
}

// ─── Unused import suppression ────────────────────────────────────────────────
// These are used by Task 2/3 helpers and are imported now to avoid re-imports
// being treated as changes to the public import surface.
void (mintSessionId as unknown);
void (runOneRound as unknown);
void (writeCheckpoint as unknown);
type _SuppressUnused = DecisionLogEntry | Finding | StopEvidence;
