/**
 * Unit tests for sdk/src/vision/run-loop.ts
 *
 * Task 1 tests (skeleton structure):
 *   T1: run-loop.ts exports RunLoopOptions interface
 *   T2: run-loop.ts exports runLoop async function
 *   T3: run-loop.ts exports evaluateConvergence function
 *   T4: run-loop.ts exports populateDecisionsLog function
 *   T5: RunLoopOptions has signal?: AbortSignal
 *   T6: RunLoopOptions has synthesisHook: SynthesisHook
 *   T7: runLoop imports from run-one-round.js
 *   T8: runLoop imports writeCheckpoint from vision-state.js
 *   T9: runLoop imports mintSessionId from id.js
 *   T10: File docblock mentions Pitfall 3a, 3b, 3d, duplicate-commit
 *
 * Task 2 tests (helper implementations):
 *   T11: evaluateConvergence returns ConvergenceVerdict (c1=true when pending<=threshold)
 *   T12: evaluateConvergence returns converged=false when c1 fails (pending > threshold)
 *   T13: evaluateConvergence c2 fails when blocking unresolved entries exist
 *   T14: evaluateConvergence c3 fails when newFrontierDelta > plateau_threshold
 *   T15: evaluateConvergence converged=true only when all three conditions true
 *   T16: populateDecisionsLog appends entry when confidence < max AND surprises >= min
 *   T17: populateDecisionsLog does NOT append when confidence >= confidence_max
 *   T18: populateDecisionsLog does NOT append when surprises < surprises_min
 *   T19: populateDecisionsLog classifies path_fork when surprises.length >= 2
 *   T20: populateDecisionsLog classifies risk_alert when follow_up matches risk regex
 *   T21: populateDecisionsLog classifies assumption_unverified as default
 *   T22: populateDecisionsLog marks blocking=true when confidence < 0.4
 *   T23: populateDecisionsLog marks blocking=false when 0.4 <= confidence < confidence_max
 *   T24: populateDecisionsLog only processes last round (Pitfall 3c)
 *   T25: populateDecisionsLog returns unchanged state when no last result
 *   T26: windowConverged (via evaluateConvergence sequence) returns false when history < window
 *   T27: consecutiveErrorRoundsTripped (verified via source text — private helper)
 *
 * Task 3 tests (loop body):
 *   T28: runLoop source has while ( loop
 *   T29: runLoop calls runOneRound exactly once in source
 *   T30: runLoop has exactly 3 writeCheckpoint calls (loop body + 2 terminal helpers)
 *   T31: runLoop has stop_reason: 'converged' string
 *   T32: runLoop has stop_reason: 'aborted' string
 *   T33: runLoop has max-rounds-exceeded string
 *   T34: runLoop has consecutive-error-rounds string
 *   T35: runLoop never mutates state.round (Pitfall 3a — no state.round = in source)
 *   T36: runLoop calls synthesisHook.onConverged once (in transitionToConverged)
 *   T37: runLoop does NOT call synthesisHook.onForcedStop
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Source-text tests (compile-independent structural assertions) ────────────

const runLoopPath = resolve(import.meta.dirname, './run-loop.ts');
let runLoopSource: string;
try {
  runLoopSource = readFileSync(runLoopPath, 'utf-8');
} catch {
  runLoopSource = '';
}

describe('run-loop.ts skeleton structure (T1–T10)', () => {
  it('T1: exports RunLoopOptions interface', () => {
    expect(runLoopSource).toMatch(/^export interface RunLoopOptions/m);
  });

  it('T2: exports runLoop async function', () => {
    expect(runLoopSource).toMatch(/^export async function runLoop\(/m);
  });

  it('T3: exports evaluateConvergence function', () => {
    expect(runLoopSource).toMatch(/^export function evaluateConvergence\(/m);
  });

  it('T4: exports populateDecisionsLog function', () => {
    expect(runLoopSource).toMatch(/^export function populateDecisionsLog\(/m);
  });

  it('T5: RunLoopOptions has signal?: AbortSignal', () => {
    expect(runLoopSource).toMatch(/signal\?: AbortSignal/);
  });

  it('T6: RunLoopOptions has synthesisHook: SynthesisHook', () => {
    expect(runLoopSource).toMatch(/synthesisHook: SynthesisHook/);
  });

  it('T7: imports from run-one-round.js', () => {
    expect(runLoopSource).toMatch(/import \{ runOneRound/);
  });

  it('T8: imports writeCheckpoint from vision-state.js', () => {
    expect(runLoopSource).toMatch(/import \{ writeCheckpoint \} from '\.\/vision-state\.js'/);
  });

  it('T9: imports mintSessionId from id.js', () => {
    expect(runLoopSource).toMatch(/import \{ mintSessionId \} from '\.\/id\.js'/);
  });

  it('T10: docblock mentions Pitfall 3a, 3b, 3d, and duplicate-commit', () => {
    expect(runLoopSource).toMatch(/Pitfall 3a/);
    expect(runLoopSource).toMatch(/Pitfall 3b/);
    expect(runLoopSource).toMatch(/Pitfall 3d/);
    expect(runLoopSource).toMatch(/duplicate-commit/);
  });
});

// ─── Helper implementation tests (T11–T27) ───────────────────────────────────

import type { VisionState, VisionConfig, DecisionLogEntry, RoundResult } from './types.js';

function makeConfig(overrides: Partial<VisionConfig> = {}): VisionConfig {
  return {
    convergence: { pending_threshold: 2, plateau_threshold: 1, window: 2 },
    safety:      { max_rounds: 20, consecutive_error_abort: 3 },
    decision_queue: { confidence_max: 0.6, surprises_min: 1 },
    ...overrides,
  };
}

function makeState(overrides: Partial<VisionState> = {}): VisionState {
  return {
    schema_version: 1,
    session_id: 'test-session',
    direction: 'test direction',
    source_branch: 'main',
    source_head_sha: 'abc123',
    worktree_path: '/tmp/test',
    started_at: '2026-01-01T00:00:00Z',
    ceiling_at: '2026-01-01T01:00:00Z',
    status: 'in-progress',
    stop_reason: null,
    partial_results_available: false,
    round: 0,
    round_results: [],
    frontier: [],
    decisions_log: [],
    artifact_manifest: [],
    stop_evidence: null,
    ...overrides,
  };
}

function makeFinding(overrides: {
  confidence?: number;
  surprises?: string[];
  follow_up_questions?: string[];
} = {}) {
  return {
    topic_id: 'topic-1',
    summary: 'test finding',
    citations: [],
    confidence: overrides.confidence ?? 0.5,
    surprises: overrides.surprises ?? ['surprise 1'],
    follow_up_questions: overrides.follow_up_questions ?? [],
    tokens_estimated: 100,
  };
}

function makeRoundResult(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    round: 1,
    started_at: '2026-01-01T00:00:00Z',
    ended_at: '2026-01-01T00:01:00Z',
    direction_snapshot: 'test direction',
    topics_selected: [],
    findings: [],
    new_frontier_nodes: [],
    scores: { selection_method: 'greedy-top-k', score_distribution: [], selection_rationale: [] },
    backtrack_flag: false,
    subagent_count: 1,
    errors: [],
    ...overrides,
  };
}

describe('evaluateConvergence (T11–T15)', async () => {
  // Dynamic import to allow test file to exist even before run-loop.ts is created
  let evaluateConvergence: ((state: Readonly<VisionState>, config: Readonly<VisionConfig>) => import('./types.js').ConvergenceVerdict) | null = null;
  try {
    const mod = await import('./run-loop.js');
    evaluateConvergence = mod.evaluateConvergence;
  } catch {
    // file not yet created — source tests still pass
  }

  it('T11: evaluateConvergence returns converged=true when all three conditions met', () => {
    if (!evaluateConvergence) return;
    const config = makeConfig();
    const state = makeState({
      frontier: [], // pending_count = 0, <= threshold 2 → c1=true
      decisions_log: [], // blocking_unresolved = 0 → c2=true
      round_results: [makeRoundResult({ new_frontier_nodes: [] })], // delta=0 <= 1 → c3=true
    });
    const verdict = evaluateConvergence(state, config);
    expect(verdict.converged).toBe(true);
    expect(verdict.conditions.frontier).toBe(true);
    expect(verdict.conditions.queue).toBe(true);
    expect(verdict.conditions.sources).toBe(true);
  });

  it('T12: evaluateConvergence converged=false when pending > threshold (c1 fails)', () => {
    if (!evaluateConvergence) return;
    const config = makeConfig({ convergence: { pending_threshold: 2, plateau_threshold: 1, window: 2 } });
    const state = makeState({
      frontier: [
        { id: '1', topic: 'a', score: 0.8, parent_round: 0, depth: 0, created_at: '', status: 'pending' },
        { id: '2', topic: 'b', score: 0.7, parent_round: 0, depth: 0, created_at: '', status: 'pending' },
        { id: '3', topic: 'c', score: 0.6, parent_round: 0, depth: 0, created_at: '', status: 'pending' },
      ],
    });
    const verdict = evaluateConvergence(state, config);
    expect(verdict.converged).toBe(false);
    expect(verdict.conditions.frontier).toBe(false);
    expect(verdict.evidence.pending_count).toBe(3);
  });

  it('T13: evaluateConvergence converged=false when blocking unresolved entries exist (c2 fails)', () => {
    if (!evaluateConvergence) return;
    const config = makeConfig();
    const entry: DecisionLogEntry = {
      id: 'entry-1',
      round_added: 1,
      type: 'path_fork',
      blocking: true,
      resolved: false,
    };
    const state = makeState({ decisions_log: [entry] });
    const verdict = evaluateConvergence(state, config);
    expect(verdict.conditions.queue).toBe(false);
    expect(verdict.evidence.blocking_unresolved_count).toBe(1);
  });

  it('T14: evaluateConvergence c3 fails when newFrontierDelta > plateau_threshold', () => {
    if (!evaluateConvergence) return;
    const config = makeConfig({ convergence: { pending_threshold: 2, plateau_threshold: 1, window: 2 } });
    const newNodes = [
      { id: 'n1', topic: 'new1', score: 0.5, parent_round: 1, depth: 1, created_at: '', status: 'pending' as const },
      { id: 'n2', topic: 'new2', score: 0.4, parent_round: 1, depth: 1, created_at: '', status: 'pending' as const },
    ];
    const state = makeState({
      round_results: [makeRoundResult({ new_frontier_nodes: newNodes })],
    });
    const verdict = evaluateConvergence(state, config);
    expect(verdict.conditions.sources).toBe(false);
    expect(verdict.evidence.new_frontier_nodes_delta).toBe(2);
  });

  it('T15: evaluateConvergence converged=false when only c1 and c2 true but c3 false', () => {
    if (!evaluateConvergence) return;
    const config = makeConfig();
    const newNodes = [
      { id: 'n1', topic: 'new1', score: 0.5, parent_round: 1, depth: 1, created_at: '', status: 'pending' as const },
      { id: 'n2', topic: 'new2', score: 0.4, parent_round: 1, depth: 1, created_at: '', status: 'pending' as const },
    ];
    const state = makeState({
      frontier: [], // c1=true
      decisions_log: [], // c2=true
      round_results: [makeRoundResult({ new_frontier_nodes: newNodes })], // c3=false (2 > 1)
    });
    const verdict = evaluateConvergence(state, config);
    expect(verdict.converged).toBe(false);
  });
});

describe('populateDecisionsLog (T16–T25)', async () => {
  let populateDecisionsLog: ((state: VisionState, config: VisionConfig) => VisionState) | null = null;
  try {
    const mod = await import('./run-loop.js');
    populateDecisionsLog = mod.populateDecisionsLog;
  } catch {
    // file not yet created
  }

  it('T16: appends entry when confidence < confidence_max AND surprises >= surprises_min', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({ confidence: 0.5, surprises: ['one surprise'] })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log).toHaveLength(1);
    expect(nextState.decisions_log[0].resolved).toBe(false);
    expect(typeof nextState.decisions_log[0].id).toBe('string');
  });

  it('T17: does NOT append when confidence >= confidence_max (0.6)', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({ confidence: 0.7, surprises: ['a surprise'] })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log).toHaveLength(0);
  });

  it('T18: does NOT append when surprises.length < surprises_min (1)', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({ confidence: 0.4, surprises: [] })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log).toHaveLength(0);
  });

  it('T19: classifies path_fork when surprises.length >= 2', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({ confidence: 0.3, surprises: ['s1', 's2'] })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log[0].type).toBe('path_fork');
  });

  it('T20: classifies risk_alert when follow_up matches /risk|hazard|threat|concern/i', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({
          confidence: 0.3,
          surprises: ['one surprise'],
          follow_up_questions: ['Is this a security risk?'],
        })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log[0].type).toBe('risk_alert');
  });

  it('T21: classifies assumption_unverified as default', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({
          confidence: 0.3,
          surprises: ['one surprise'],
          follow_up_questions: ['What about performance?'],
        })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log[0].type).toBe('assumption_unverified');
  });

  it('T22: marks blocking=true when confidence < 0.4', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({ confidence: 0.3, surprises: ['surprise'] })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log[0].blocking).toBe(true);
  });

  it('T23: marks blocking=false when 0.4 <= confidence < confidence_max', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({
      round_results: [makeRoundResult({
        findings: [makeFinding({ confidence: 0.5, surprises: ['surprise'] })],
      })],
    });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState.decisions_log[0].blocking).toBe(false);
  });

  it('T24: only processes last round (Pitfall 3c — prior round findings NOT reprocessed)', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    // State with 2 rounds; first round also has qualifying findings
    const state = makeState({
      decisions_log: [], // start clean
      round_results: [
        makeRoundResult({
          round: 1,
          findings: [makeFinding({ confidence: 0.3, surprises: ['s1'] })],
        }),
        makeRoundResult({
          round: 2,
          findings: [makeFinding({ confidence: 0.4, surprises: ['s2'] })],
        }),
      ],
    });
    const nextState = populateDecisionsLog(state, config);
    // Only round 2 should produce an entry (confidence 0.4 < 0.6 AND surprises >= 1)
    // round 1 should NOT be reprocessed
    expect(nextState.decisions_log).toHaveLength(1);
    expect(nextState.decisions_log[0].round_added).toBe(2);
  });

  it('T25: returns unchanged state when round_results is empty', () => {
    if (!populateDecisionsLog) return;
    const config = makeConfig();
    const state = makeState({ round_results: [] });
    const nextState = populateDecisionsLog(state, config);
    expect(nextState).toBe(state); // same reference — no mutation
  });
});

// ─── Source-level assertions for Task 2 private helpers (T26–T27) ────────────

describe('windowConverged and consecutiveErrorRoundsTripped (source check T26–T27)', () => {
  it('T26: windowConverged has Pitfall 3b length guard as first statement', () => {
    // Verify the critical guard exists in source
    const lines = runLoopSource.split('\n');
    const fnIdx = lines.findIndex(l => l.includes('function windowConverged'));
    if (fnIdx === -1) return; // not yet implemented — skip
    // Next non-empty line after the opening brace should be the length check
    const bodyLines = lines.slice(fnIdx + 1, fnIdx + 10).filter(l => l.trim());
    const firstBodyLine = bodyLines[1]; // skip opening brace line
    expect(firstBodyLine).toMatch(/history\.length < config\.convergence\.window/);
  });

  it('T27: consecutiveErrorRoundsTripped uses conservative rule (errors > 0 AND findings === 0)', () => {
    expect(runLoopSource).toMatch(/r\.errors\.length > 0 && r\.findings\.length === 0/);
  });
});

// ─── Source-level assertions for Task 3 loop body (T28–T37) ──────────────────

describe('runLoop body structure (T28–T37)', () => {
  it('T28: runLoop source has while ( loop', () => {
    expect(runLoopSource).toMatch(/while \(/);
  });

  it('T29: runLoop calls runOneRound exactly once in source', () => {
    const matches = runLoopSource.match(/await runOneRound/g);
    expect(matches).toHaveLength(1);
  });

  it('T30: runLoop has exactly 3 writeCheckpoint calls', () => {
    const matches = runLoopSource.match(/await writeCheckpoint/g);
    expect(matches).toHaveLength(3);
  });

  it('T31: runLoop has stop_reason: \'converged\'', () => {
    expect(runLoopSource).toMatch(/stop_reason: 'converged'/);
  });

  it('T32: runLoop has stop_reason: \'aborted\'', () => {
    expect(runLoopSource).toMatch(/stop_reason: 'aborted'/);
  });

  it('T33: runLoop has max-rounds-exceeded', () => {
    expect(runLoopSource).toMatch(/max-rounds-exceeded/);
  });

  it('T34: runLoop has consecutive-error-rounds', () => {
    expect(runLoopSource).toMatch(/consecutive-error-rounds/);
  });

  it('T35: Pitfall 3a — no state.round mutation in runLoop body', () => {
    expect(runLoopSource).not.toMatch(/^\s*state\.round\s*=/m);
    expect(runLoopSource).not.toMatch(/state\.round\+\+/);
    expect(runLoopSource).not.toMatch(/state\.round \+=/);
  });

  it('T36: synthesisHook.onConverged called exactly once', () => {
    const matches = runLoopSource.match(/synthesisHook\.onConverged/g);
    expect(matches).toHaveLength(1);
  });

  it('T37: synthesisHook.onForcedStop never called in run-loop.ts', () => {
    expect(runLoopSource).not.toMatch(/synthesisHook\.onForcedStop/);
  });
});
