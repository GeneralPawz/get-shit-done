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
  // Pitfall 3a guard: state.round is incremented ONLY by runOneRound. runLoop's
  // sole reader is the loop condition below. NEVER assign state.round here.
  let state = initialState;

  while (
    state.round < config.safety.max_rounds &&
    !opts.signal?.aborted &&
    !consecutiveErrorRoundsTripped(state, config)
  ) {
    // 1. Phase 2 reuse seam (D-10 — never modify run-one-round.ts)
    state = await runOneRound(state, opts);

    // 2. Deterministic decision-queue rule (D-08; Pitfall 3c — only the last round)
    state = populateDecisionsLog(state, config);

    // 3. Pure convergence verdict (D-06, D-23 — in-memory state only)
    const verdict = evaluateConvergence(state, config);

    // 4. Accumulate verdict (D-12 — recorded every round on every terminal path)
    state = appendVerdictToHistory(state, verdict);

    // 5. Persist post-processed state (D-13 sole writer).
    // duplicate-commit pattern / RESEARCH Risk Note 7 / option (c): runOneRound already
    // wrote at line 120 of run-one-round.ts; this is the SECOND `checkpoint round N`
    // commit per round. Accepted — forensics still work, ROADMAP SC1 git-log assertion passes.
    await writeCheckpoint(opts.visionStatePath, state, opts.worktreeRoot);

    // 6. D-04 window fire-timing exit (Pitfall 3b guard lives inside windowConverged)
    if (windowConverged(state, config)) break;
  }

  // ─── Terminal-path branch arms ─────────────────────────────────────────────
  // Order matters: signal-aborted MUST be checked first — supervisor/stub owns the
  // ceiling-hit terminal write (D-09 + D-13); runLoop is silent on this path.

  if (opts.signal?.aborted) {
    // D-09 + D-13: ceiling/cancellation path. supervisor.ts + forced-stop.ts own
    // the terminal write of status='ceiling-hit' + stop_evidence. runLoop is silent.
    return state;
  }

  if (windowConverged(state, config)) {
    const lastVerdict = state.stop_evidence?.convergence_history.at(-1) ?? null;
    return transitionToConverged(state, lastVerdict, opts);
  }

  if (consecutiveErrorRoundsTripped(state, config)) {
    return transitionToAborted(state, 'consecutive-error-rounds', opts);
  }

  // state.round >= max_rounds is the only remaining exit (D-18)
  return transitionToAborted(state, 'max-rounds-exceeded', opts);
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
  const pendingCount = state.frontier.filter(n => n.status === 'pending').length;
  const blockingUnresolvedCount = state.decisions_log.filter(
    e => e.blocking && !e.resolved,
  ).length;
  const lastResult = state.round_results[state.round_results.length - 1];
  const newFrontierDelta = lastResult?.new_frontier_nodes.length ?? 0;

  const c1 = pendingCount <= config.convergence.pending_threshold;
  const c2 = blockingUnresolvedCount === 0;
  const c3 = newFrontierDelta <= config.convergence.plateau_threshold;

  return {
    converged: c1 && c2 && c3,
    conditions: { frontier: c1, queue: c2, sources: c3 },
    evaluated_at: new Date().toISOString(),
    round: state.round,
    evidence: {
      pending_count: pendingCount,
      blocking_unresolved_count: blockingUnresolvedCount,
      new_frontier_nodes_delta: newFrontierDelta,
    },
  };
}

// ─── Decision-queue rule (D-08) ──────────────────────────────────────────────

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
  const lastResult = state.round_results[state.round_results.length - 1];
  if (!lastResult) return state;

  const entries: DecisionLogEntry[] = [];
  for (const finding of lastResult.findings) {
    const surprises = finding.surprises ?? [];      // RESEARCH A1 defensive
    if (
      finding.confidence < config.decision_queue.confidence_max &&
      surprises.length >= config.decision_queue.surprises_min
    ) {
      entries.push({
        id: mintSessionId(),
        round_added: lastResult.round,
        type: classifyDecisionType(finding),
        blocking: finding.confidence < 0.4,           // RESEARCH Open Q1 — hard-coded; Phase 6 tuning target
        resolved: false,
      });
    }
  }
  if (entries.length === 0) return state;
  return { ...state, decisions_log: [...state.decisions_log, ...entries] };
}

function classifyDecisionType(f: Finding): DecisionLogEntry['type'] {
  const surprises = f.surprises ?? [];
  if (surprises.length >= 2) return 'path_fork';
  const followUps = f.follow_up_questions ?? [];        // RESEARCH A2 defensive
  if (followUps.some(q => /risk|hazard|threat|concern/i.test(q))) {
    return 'risk_alert';
  }
  return 'assumption_unverified';
}

// ─── Window fire timing (D-04) ───────────────────────────────────────────────

function windowConverged(state: VisionState, config: VisionConfig): boolean {
  if (config.convergence.window <= 0) return false;  // guard: window=0 would cause vacuous-truth convergence via slice(-0)
  if ((state.stop_evidence?.convergence_history ?? []).length < config.convergence.window) return false; // Pitfall 3b
  const history = state.stop_evidence?.convergence_history ?? [];
  return history.slice(-config.convergence.window).every(v => v.converged);
}

// ─── Consecutive-error rule (D-20) ───────────────────────────────────────────

function consecutiveErrorRoundsTripped(state: VisionState, config: VisionConfig): boolean {
  const K = config.safety.consecutive_error_abort;
  const tail = state.round_results.slice(-K);
  if (tail.length < K) return false;
  // CONTEXT Specifics — conservative: requires errors.length > 0 AND findings.length === 0.
  // A round where one researcher fails but others succeed does NOT count toward the tally.
  return tail.every(r => r.errors.length > 0 && r.findings.length === 0);
}

// ─── Stop-evidence accumulators (D-12, D-17) ─────────────────────────────────

function appendVerdictToHistory(state: VisionState, verdict: ConvergenceVerdict): VisionState {
  const baseEvidence: StopEvidence = state.stop_evidence ?? {
    stopped_at: '',                     // populated at terminal time
    final_round: state.round,
    final_frontier_pending_count: state.frontier.filter(n => n.status === 'pending').length,
    convergence_history: [],
  };
  return {
    ...state,
    stop_evidence: {
      ...baseEvidence,
      convergence_history: [...baseEvidence.convergence_history, verdict],
    },
  };
}

function computeDriftErrorCount(state: VisionState): number {
  return state.round_results
    .flatMap(r => r.errors)
    .filter(e => e.reason === 'direction-snapshot-drift').length;
}

// ─── Terminal-path helpers (D-07, D-17, D-19) ────────────────────────────────

async function transitionToConverged(
  state: VisionState,
  verdict: ConvergenceVerdict | null,
  opts: RunLoopOptions,
): Promise<VisionState> {
  const baseEvidence = state.stop_evidence ?? {
    stopped_at: '', final_round: state.round, final_frontier_pending_count: 0,
    convergence_history: [],
  };
  const stopEvidence: StopEvidence = {
    ...baseEvidence,
    stopped_at: new Date().toISOString(),
    final_round: state.round,
    final_frontier_pending_count: state.frontier.filter(n => n.status === 'pending').length,
    convergence_snapshot: verdict,
    drift_error_count: computeDriftErrorCount(state),
  };
  const nextState: VisionState = {
    ...state,
    status: 'converged',
    stop_reason: 'converged',
    partial_results_available: state.round > 0 || state.round_results.length > 0,
    stop_evidence: stopEvidence,
  };

  // Pitfall 3d safeguard 1 of 2: persist status='converged' BEFORE awaiting hook.
  // Safeguard 2 lives in PLAN 04 (forced-stop.ts onForcedStop short-circuits when
  // state.status === 'converged' && state.stop_evidence != null).
  await writeCheckpoint(opts.visionStatePath, nextState, opts.worktreeRoot);

  if (verdict) {
    await opts.synthesisHook.onConverged(nextState, verdict);
  }

  return nextState;
}

async function transitionToAborted(
  state: VisionState,
  reason: 'max-rounds-exceeded' | 'consecutive-error-rounds',
  opts: RunLoopOptions,
): Promise<VisionState> {
  const baseEvidence = state.stop_evidence ?? {
    stopped_at: '', final_round: state.round, final_frontier_pending_count: 0,
    convergence_history: [],
  };
  const stopEvidence: StopEvidence = {
    ...baseEvidence,
    stopped_at: new Date().toISOString(),
    final_round: state.round,
    final_frontier_pending_count: state.frontier.filter(n => n.status === 'pending').length,
    drift_error_count: computeDriftErrorCount(state),
    reason,
  };
  const nextState: VisionState = {
    ...state,
    status: 'aborted',
    stop_reason: 'aborted',
    partial_results_available: state.round > 0 || state.round_results.length > 0,
    stop_evidence: stopEvidence,
  };

  await writeCheckpoint(opts.visionStatePath, nextState, opts.worktreeRoot);
  // Aborted path does NOT call the synthesis hook (neither onConverged nor onForcedStop).
  // Phase 4 Synthesizer reads stop_evidence.reason to render the abort branch.
  return nextState;
}
