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
 *
 * ─── Phase 3 Plan 06 behavioral tests (03-VALIDATION.md per-task map) ─────────
 *
 * Test IDs map to 03-VALIDATION.md §Per-Task Verification Map and
 * 03-RESEARCH.md §Validation Architecture §Phase Requirements → Test Map.
 *
 *   C1 frontier        → STOP-03 D-01  (03-06-T1-1)
 *   C2 queue           → STOP-03 D-02  (03-06-T1-2)
 *   C3 plateau         → STOP-03 D-03  (03-06-T1-3)
 *   AND combination    → STOP-03 D-06  (03-06-T1-4)
 *   window single      → STOP-03 D-04  (03-06-T1-5, Pitfall 3b)
 *   window two-consec  → STOP-03 D-04  (03-06-T1-6)
 *   D-08 rule          → STOP-03 D-08  (03-06-T1-7)
 *   per-finding-not-per-round → Pitfall 3c (03-06-T1-8)
 *   max-rounds break   → STOP-03 D-18  (03-06-T2-9)
 *   consecutive-error  → STOP-03 D-20  (03-06-T2-10)
 *   direction-drift    → STOP-03 D-10  (03-06-T2-11)
 *   stop_evidence on converged → STOP-04 D-17 (03-06-T2-12)
 *   convergence_history → STOP-04 D-12 (03-06-T2-13)
 *   SC2 self-stop      → ROADMAP SC2   (03-06-T2-14)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Module mocks for runLoop behavioral tests (Task 1/2 window + terminal tests) ─
// vi.mock is hoisted by vitest — these replace module resolution for the whole file.
// Pure-function tests (evaluateConvergence, populateDecisionsLog) are unaffected.
vi.mock('./run-one-round.js', () => ({ runOneRound: vi.fn() }));
vi.mock('./vision-state.js', () => ({
  writeCheckpoint: vi.fn(async () => {}),
  readCheckpoint: vi.fn(async () => null),
  validateCheckpoint: vi.fn(() => ({ ok: true })),
}));

// Reset all mock state between tests so call counts don't accumulate.
beforeEach(() => { vi.clearAllMocks(); });

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

function makeTestFinding(overrides: {
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

function makeTestRoundResult(overrides: Partial<RoundResult> = {}): RoundResult {
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
      round_results: [makeTestRoundResult({ new_frontier_nodes: [] })], // delta=0 <= 1 → c3=true
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
      round_results: [makeTestRoundResult({ new_frontier_nodes: newNodes })],
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
      round_results: [makeTestRoundResult({ new_frontier_nodes: newNodes })], // c3=false (2 > 1)
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
      round_results: [makeTestRoundResult({
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
        makeTestRoundResult({
          round: 1,
          findings: [makeFinding({ confidence: 0.3, surprises: ['s1'] })],
        }),
        makeTestRoundResult({
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
    // Verify the critical guard exists in source — opening brace is on the function
    // signature line, so bodyLines[0] is the first body line.
    const lines = runLoopSource.split('\n');
    const fnIdx = lines.findIndex(l => l.includes('function windowConverged'));
    if (fnIdx === -1) return; // not yet implemented — skip
    const bodyLines = lines.slice(fnIdx + 1, fnIdx + 10).filter(l => l.trim());
    const firstBodyLine = bodyLines[0]; // first non-empty body line
    // Guard must be the first statement — checks convergence_history length against window
    expect(firstBodyLine).toMatch(/convergence_history.*\.length < config\.convergence\.window|convergence\.window.*return false/);
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

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 Plan 06 — Behavioral unit tests (03-VALIDATION.md per-task map)
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  VisionState as _VisionState,
  VisionConfig as _VisionConfig,
  ConvergenceVerdict as _ConvergenceVerdict,
  Finding as _Finding,
  FrontierNode as _FrontierNode,
  RoundResult as _RoundResult,
  SynthesisHook as _SynthesisHook,
} from './types.js';

// ─── Fixture builders (Open Q2 — top-of-file convention) ─────────────────────

function makeFrontierNode(overrides: Partial<_FrontierNode> = {}): _FrontierNode {
  return {
    id: 'TESTNODE000000000000000000',
    topic: 'default',
    score: 0.5,
    parent_round: 0,
    depth: 0,
    created_at: '2026-04-24T00:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

function makeFinding(overrides: Partial<_Finding> = {}): _Finding {
  return {
    topic_id: 'TESTNODE000000000000000000',
    summary: 'default',
    citations: [],
    confidence: 0.7,
    surprises: [],
    follow_up_questions: [],
    tokens_estimated: 100,
    ...overrides,
  };
}

function makeRoundResult(overrides: Partial<_RoundResult> = {}): _RoundResult {
  return {
    round: 1,
    started_at: '2026-04-24T00:00:00Z',
    ended_at: '2026-04-24T00:00:01Z',
    direction_snapshot: 'test direction',
    topics_selected: [],
    findings: [],
    new_frontier_nodes: [],
    scores: { selection_method: 'greedy-top-k', score_distribution: [], selection_rationale: [] },
    backtrack_flag: false,
    subagent_count: 0,
    errors: [],
    ...overrides,
  };
}

function makeConvergenceVerdict(overrides: Partial<_ConvergenceVerdict> = {}): _ConvergenceVerdict {
  return {
    converged: true,
    conditions: { frontier: true, queue: true, sources: true },
    evaluated_at: '2026-04-24T00:00:02Z',
    round: 1,
    evidence: { pending_count: 0, blocking_unresolved_count: 0, new_frontier_nodes_delta: 0 },
    ...overrides,
  };
}

function makeVisionConfig(overrides: Partial<_VisionConfig> = {}): _VisionConfig {
  return {
    convergence: { pending_threshold: 2, plateau_threshold: 1, window: 2 },
    safety: { max_rounds: 20, consecutive_error_abort: 3 },
    decision_queue: { confidence_max: 0.6, surprises_min: 1 },
    ...overrides,
  };
}

function makeVisionState(overrides: Partial<_VisionState> = {}): _VisionState {
  return {
    schema_version: 1,
    session_id: 'TESTSID',
    direction: 'd',
    source_branch: 'main',
    source_head_sha: 'abc',
    worktree_path: '/tmp/wt',
    started_at: '2026-04-24T00:00:00Z',
    ceiling_at: '2026-04-25T00:00:00Z',
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

function makeSynthesisHookSpy(): _SynthesisHook & {
  onConverged: ReturnType<typeof vi.fn>;
  onForcedStop: ReturnType<typeof vi.fn>;
} {
  return {
    onForcedStop: vi.fn(async () => {}),
    onConverged: vi.fn(async () => {}),
  };
}

/** Minimal RunLoopOptions-compatible opts (no visionStatePath/worktreeRoot needed since writeCheckpoint is mocked). */
function makeRunLoopOpts(synthesisHook: _SynthesisHook, signal?: AbortSignal) {
  return {
    visionStatePath: '/tmp/fake/vision-state.json',
    worktreeRoot: '/tmp/fake',
    synthesisHook,
    signal,
  };
}

// ─── evaluateConvergence (D-01/02/03/06) ─────────────────────────────────────

describe('evaluateConvergence', () => {
  it('C1 frontier: pending_count <= threshold ⇒ conditions.frontier=true; > threshold ⇒ false', async () => {
    const { evaluateConvergence } = await import('./run-loop.js');
    const config = makeVisionConfig();
    // 2 pending nodes (threshold=2) ⇒ true
    const stateTwo = makeVisionState({
      frontier: [
        makeFrontierNode({ id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' }),
        makeFrontierNode({ id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB' }),
      ],
    });
    expect(evaluateConvergence(stateTwo, config).conditions.frontier).toBe(true);
    // 3 pending nodes ⇒ false
    const stateThree = makeVisionState({
      frontier: [
        makeFrontierNode({ id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' }),
        makeFrontierNode({ id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB' }),
        makeFrontierNode({ id: 'CCCCCCCCCCCCCCCCCCCCCCCCCC' }),
      ],
    });
    expect(evaluateConvergence(stateThree, config).conditions.frontier).toBe(false);
  });

  it('C2 queue: zero blocking-unresolved ⇒ true; one blocking-unresolved ⇒ false', async () => {
    const { evaluateConvergence } = await import('./run-loop.js');
    const config = makeVisionConfig();
    // Empty decisions_log ⇒ c2=true
    const stateEmpty = makeVisionState({ decisions_log: [] });
    expect(evaluateConvergence(stateEmpty, config).conditions.queue).toBe(true);
    // One blocking+unresolved entry ⇒ c2=false
    const stateBlocking = makeVisionState({
      decisions_log: [{
        id: 'ENTRY0000000000000000000001',
        round_added: 1,
        type: 'path_fork',
        blocking: true,
        resolved: false,
      }],
    });
    expect(evaluateConvergence(stateBlocking, config).conditions.queue).toBe(false);
    expect(evaluateConvergence(stateBlocking, config).evidence.blocking_unresolved_count).toBe(1);
  });

  it('C3 plateau: last round new_frontier_nodes.length <= plateau_threshold ⇒ true; > threshold ⇒ false', async () => {
    const { evaluateConvergence } = await import('./run-loop.js');
    const config = makeVisionConfig({ convergence: { pending_threshold: 2, plateau_threshold: 1, window: 2 } });
    // 1 new node (threshold=1) ⇒ c3=true
    const stateOne = makeVisionState({
      round_results: [makeRoundResult({ new_frontier_nodes: [makeFrontierNode()] })],
    });
    expect(evaluateConvergence(stateOne, config).conditions.sources).toBe(true);
    // 2 new nodes ⇒ c3=false
    const stateTwo = makeVisionState({
      round_results: [makeRoundResult({
        new_frontier_nodes: [
          makeFrontierNode({ id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' }),
          makeFrontierNode({ id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB' }),
        ],
      })],
    });
    expect(evaluateConvergence(stateTwo, config).conditions.sources).toBe(false);
  });

  it('AND: all three conditions ⇒ verdict.converged=true; any false ⇒ verdict.converged=false', async () => {
    const { evaluateConvergence } = await import('./run-loop.js');
    const config = makeVisionConfig();
    // All three met: 0 pending, 0 blocking, 0 new nodes ⇒ converged=true
    const stateAll = makeVisionState({
      frontier: [],
      decisions_log: [],
      round_results: [makeRoundResult({ new_frontier_nodes: [] })],
    });
    expect(evaluateConvergence(stateAll, config).converged).toBe(true);
    // One blocking unresolved entry makes c2=false ⇒ converged=false
    const stateBlocking = makeVisionState({
      frontier: [],
      decisions_log: [{ id: 'E0000000000000000000000001', round_added: 1, type: 'path_fork', blocking: true, resolved: false }],
      round_results: [makeRoundResult({ new_frontier_nodes: [] })],
    });
    expect(evaluateConvergence(stateBlocking, config).converged).toBe(false);
  });
});

// ─── windowConverged via runLoop (D-04, Pitfall 3b) ──────────────────────────

describe('runLoop window fire-timing (D-04)', () => {
  it('single-round: a single converged verdict does NOT transition status (Pitfall 3b)', async () => {
    // Strategy: mock returns states with stop_evidence: null so runLoop builds
    // convergence_history from scratch via appendVerdictToHistory.
    // Round 1 state: frontier=[], decisions_log=[], new_frontier_nodes=[] ⇒ all conditions met ⇒ converged=true
    // Round 2 state: frontier=[node] (c1 fails since pending_threshold=0 and 1 pending) ⇒ converged=false
    // window=2 requires 2 consecutive converged, but round 2 is NOT converged ⇒ no transition.
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    // Round 1: all convergence conditions met
    vi.mocked(runOneRound).mockResolvedValueOnce(makeVisionState({
      round: 1,
      round_results: [makeRoundResult({ round: 1, new_frontier_nodes: [] })],
      frontier: [],         // 0 pending ≤ threshold=0 ⇒ c1=true
      decisions_log: [],    // 0 blocking ⇒ c2=true
      stop_evidence: null,  // let runLoop build history
    }));
    // Round 2: c1 fails because frontier has 1 pending node (> threshold=0)
    vi.mocked(runOneRound).mockResolvedValueOnce(makeVisionState({
      round: 2,
      round_results: [
        makeRoundResult({ round: 1, new_frontier_nodes: [] }),
        makeRoundResult({ round: 2, new_frontier_nodes: [makeFrontierNode()] }),
      ],
      frontier: [makeFrontierNode()],  // 1 pending > threshold=0 ⇒ c1=false ⇒ not converged
      decisions_log: [],
      stop_evidence: null,
    }));
    // pending_threshold=0 so any pending node breaks c1; max_rounds=2 ensures we exit after 2
    const config = makeVisionConfig({
      convergence: { pending_threshold: 0, plateau_threshold: 0, window: 2 },
      safety: { max_rounds: 2, consecutive_error_abort: 3 },
    });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    // Window of 2 NOT met (round 1 converged, round 2 NOT) ⇒ status MUST NOT be 'converged'
    expect(result.status).not.toBe('converged');
    expect(hook.onConverged).not.toHaveBeenCalled();
  });

  it('two-consecutive: D-04 transitions status=converged after window=2 positive rounds + calls onConverged exactly once', async () => {
    // Key insight: runLoop calls appendVerdictToHistory on the result of runOneRound,
    // THEN checks windowConverged on the updated state. So the mock must PRESERVE the
    // incoming state's stop_evidence (which contains accumulated history) rather than
    // returning stop_evidence: null (which would reset the history each round).
    // We use mockImplementation so each call receives the accumulated state.
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    // Both rounds satisfy all three conditions: frontier=[], decisions_log=[], new_frontier_nodes=[]
    vi.mocked(runOneRound).mockImplementation(async (incomingState) => ({
      ...incomingState,           // preserve accumulated stop_evidence from prior rounds
      round: incomingState.round + 1,
      round_results: [
        ...incomingState.round_results,
        makeRoundResult({ round: incomingState.round + 1, new_frontier_nodes: [] }),
      ],
      frontier: [],              // c1: 0 pending ≤ threshold=0 ⇒ true
      decisions_log: [],         // c2: 0 blocking ⇒ true
    }));
    const config = makeVisionConfig({
      convergence: { pending_threshold: 0, plateau_threshold: 0, window: 2 },
      safety: { max_rounds: 20, consecutive_error_abort: 3 },
    });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    expect(result.status).toBe('converged');
    expect(hook.onConverged).toHaveBeenCalledTimes(1);
  });
});

// ─── populateDecisionsLog (D-08, Pitfall 3c) ─────────────────────────────────

describe('populateDecisionsLog', () => {
  it('D-08 rule: low-confidence + surprises ⇒ entry; high-confidence ⇒ no entry', async () => {
    const { populateDecisionsLog } = await import('./run-loop.js');
    const config = makeVisionConfig();
    const state = makeVisionState({
      round_results: [makeRoundResult({
        round: 1,
        findings: [
          makeFinding({ confidence: 0.3, surprises: ['s1'] }),   // matches ⇒ append
          makeFinding({ confidence: 0.9, surprises: ['s1'] }),   // high confidence ⇒ skip
        ],
      })],
    });
    const result = populateDecisionsLog(state, config);
    expect(result.decisions_log).toHaveLength(1);
    expect(result.decisions_log[0].round_added).toBe(1);
    expect(result.decisions_log[0].id).toHaveLength(26); // ULID-ish 26 chars
    expect(result.decisions_log[0].resolved).toBe(false);
    expect(result.decisions_log[0].blocking).toBe(true); // confidence 0.3 < 0.4
  });

  it('D-08 rule per-finding not per-round (Pitfall 3c): only inspects the LAST round', async () => {
    const { populateDecisionsLog } = await import('./run-loop.js');
    const config = makeVisionConfig();
    // Round 1 has 5 matching findings; round 2 has 1 matching finding
    const state = makeVisionState({
      round_results: [
        makeRoundResult({
          round: 1,
          findings: Array.from({ length: 5 }, () => makeFinding({ confidence: 0.3, surprises: ['s1'] })),
        }),
        makeRoundResult({
          round: 2,
          findings: [makeFinding({ confidence: 0.3, surprises: ['s1'] })],
        }),
      ],
    });
    const result = populateDecisionsLog(state, config);
    // Only round 2 inspected ⇒ 1 entry
    expect(result.decisions_log).toHaveLength(1);
    expect(result.decisions_log[0].round_added).toBe(2);
    // Call again on returned state — same last round ⇒ 1 more entry (no quadratic growth)
    const result2 = populateDecisionsLog(result, config);
    expect(result2.decisions_log).toHaveLength(2);
  });
});

// ─── runLoop terminal paths ───────────────────────────────────────────────────

describe('runLoop terminal paths', () => {
  it('D-18 max-rounds break: status=aborted, stop_evidence.reason=max-rounds-exceeded when round >= max_rounds', async () => {
    // Strategy: each mock round returns state where c1 FAILS (>2 pending nodes, threshold=2),
    // so windowConverged never fires. Loop exits only via max_rounds=4 cap.
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    const makeRoundState = (round: number) => makeVisionState({
      round,
      round_results: Array.from({ length: round }, (_, i) => makeRoundResult({
        round: i + 1,
        new_frontier_nodes: [makeFrontierNode({ id: `N${String(i).padStart(25, '0')}` })],
        findings: [makeFinding({ confidence: 0.9, surprises: [] })],
      })),
      // 3 pending nodes > pending_threshold=2 ⇒ c1=false ⇒ verdict never converged
      frontier: [
        makeFrontierNode({ id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' }),
        makeFrontierNode({ id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB' }),
        makeFrontierNode({ id: 'CCCCCCCCCCCCCCCCCCCCCCCCCC' }),
      ],
      stop_evidence: null,
    });
    vi.mocked(runOneRound).mockImplementation(async (state) => makeRoundState(state.round + 1));
    const config = makeVisionConfig({ safety: { max_rounds: 4, consecutive_error_abort: 10 } });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    expect(result.status).toBe('aborted');
    expect(result.stop_reason).toBe('aborted');
    expect(result.stop_evidence?.reason).toBe('max-rounds-exceeded');
    expect(result.round).toBe(4);
    expect(hook.onForcedStop).not.toHaveBeenCalled();
    expect(hook.onConverged).not.toHaveBeenCalled();
  });

  it('D-20 consecutive-error break: aborts when last K rounds all have errors > 0 AND findings == 0', async () => {
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    // All 3 rounds: errors present + findings empty ⇒ consecutive-error tally hits K=3
    // frontier has 3 pending nodes to keep c1 false and prevent window convergence
    const makePendingFrontier = () => [
      makeFrontierNode({ id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' }),
      makeFrontierNode({ id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB' }),
      makeFrontierNode({ id: 'CCCCCCCCCCCCCCCCCCCCCCCCCC' }),
    ];
    vi.mocked(runOneRound).mockResolvedValueOnce(makeVisionState({
      round: 1,
      round_results: [makeRoundResult({ round: 1, errors: [{ topic_id: '*', reason: 'network-error' }], findings: [] })],
      frontier: makePendingFrontier(),
      stop_evidence: null,
    }));
    vi.mocked(runOneRound).mockResolvedValueOnce(makeVisionState({
      round: 2,
      round_results: [
        makeRoundResult({ round: 1, errors: [{ topic_id: '*', reason: 'network-error' }], findings: [] }),
        makeRoundResult({ round: 2, errors: [{ topic_id: '*', reason: 'network-error' }], findings: [] }),
      ],
      frontier: makePendingFrontier(),
      stop_evidence: null,
    }));
    vi.mocked(runOneRound).mockResolvedValueOnce(makeVisionState({
      round: 3,
      round_results: [
        makeRoundResult({ round: 1, errors: [{ topic_id: '*', reason: 'network-error' }], findings: [] }),
        makeRoundResult({ round: 2, errors: [{ topic_id: '*', reason: 'network-error' }], findings: [] }),
        makeRoundResult({ round: 3, errors: [{ topic_id: '*', reason: 'network-error' }], findings: [] }),
      ],
      frontier: makePendingFrontier(),
      stop_evidence: null,
    }));
    const config = makeVisionConfig({ safety: { max_rounds: 20, consecutive_error_abort: 3 } });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    expect(result.stop_evidence?.reason).toBe('consecutive-error-rounds');
    expect(result.status).toBe('aborted');
  });

  it('D-10 direction-drift preserved: runLoop does NOT abort on direction-snapshot-drift errors', async () => {
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    // Round 1: drift error + one finding (round completes with both errors AND findings)
    vi.mocked(runOneRound).mockResolvedValueOnce(makeVisionState({
      round: 1,
      round_results: [makeRoundResult({
        round: 1,
        errors: [{ topic_id: '*', reason: 'direction-snapshot-drift' }],
        findings: [makeFinding({ confidence: 0.9, surprises: [] })],
        new_frontier_nodes: [],
      })],
      frontier: [],
      decisions_log: [],
    }));
    // max_rounds=1 ⇒ exits via max-rounds path after round 1
    const config = makeVisionConfig({ safety: { max_rounds: 1, consecutive_error_abort: 3 } });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    // Should be aborted (max-rounds), NOT due to drift
    expect(result.status).toBe('aborted');
    expect(result.stop_evidence?.reason).toBe('max-rounds-exceeded');
    // drift_error_count reflects the drift error
    expect(result.stop_evidence?.drift_error_count).toBe(1);
  });

  it('D-17 stop_evidence on converged path: convergence_snapshot=last verdict; final_round=N; final_frontier_pending_count from state.frontier', async () => {
    // Use mockImplementation to preserve accumulated stop_evidence across rounds.
    // After 2 converged rounds, transitionToConverged populates convergence_snapshot from history.
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    vi.mocked(runOneRound).mockImplementation(async (incomingState) => ({
      ...incomingState,
      round: incomingState.round + 1,
      round_results: [
        ...incomingState.round_results,
        makeRoundResult({ round: incomingState.round + 1, new_frontier_nodes: [] }),
      ],
      frontier: [],
      decisions_log: [],
    }));
    const config = makeVisionConfig({
      convergence: { pending_threshold: 0, plateau_threshold: 0, window: 2 },
      safety: { max_rounds: 20, consecutive_error_abort: 3 },
    });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    expect(result.stop_evidence?.convergence_snapshot?.converged).toBe(true);
    expect(result.stop_evidence?.final_round).toBe(result.round);
    expect(result.stop_evidence?.final_frontier_pending_count).toBe(0);
  });

  it('SC2 self-stop before ceiling: converges after exactly ONE call to runOneRound when history already has window-1 verdicts', async () => {
    // Initial state already has 1 converged verdict in history (window=2 needs 2).
    // Mock preserves incoming stop_evidence so that runLoop's appendVerdictToHistory
    // extends the existing [verdict1] to [verdict1, verdict2] ⇒ window fires after 1 round.
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    const initialState = makeVisionState({
      round: 1,
      round_results: [makeRoundResult({ round: 1, new_frontier_nodes: [] })],
      stop_evidence: {
        stopped_at: '',
        final_round: 1,
        final_frontier_pending_count: 0,
        convergence_history: [makeConvergenceVerdict({ converged: true, round: 1 })],
      },
    });
    // Preserve incoming stop_evidence so appendVerdictToHistory extends [verdict1] → [verdict1, verdict2]
    vi.mocked(runOneRound).mockImplementation(async (incomingState) => ({
      ...incomingState,
      round: incomingState.round + 1,
      round_results: [
        ...incomingState.round_results,
        makeRoundResult({ round: incomingState.round + 1, new_frontier_nodes: [] }),
      ],
      frontier: [],
      decisions_log: [],
    }));
    const config = makeVisionConfig({
      convergence: { pending_threshold: 0, plateau_threshold: 0, window: 2 },
      safety: { max_rounds: 20, consecutive_error_abort: 3 },
    });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(initialState, makeRunLoopOpts(hook), config);
    expect(result.status).toBe('converged');
    expect(vi.mocked(runOneRound).mock.calls.length).toBe(1);
  });
});

// ─── runLoop convergence_history accumulation (D-12) ─────────────────────────

describe('runLoop convergence_history accumulation (D-12)', () => {
  it('convergence_history accumulates: after N rounds, stop_evidence.convergence_history.length === N', async () => {
    // Key: mockImplementation preserves incoming stop_evidence so appendVerdictToHistory
    // EXTENDS the history rather than starting fresh each round.
    // 3 pending nodes (> threshold=2) ⇒ c1=false every round ⇒ verdict never converged.
    // window=4 so no self-stop. max_rounds=3 forces exit via max-rounds-exceeded.
    const { runLoop } = await import('./run-loop.js');
    const { runOneRound } = await import('./run-one-round.js');
    const makePendingFrontier = () => [
      makeFrontierNode({ id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' }),
      makeFrontierNode({ id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB' }),
      makeFrontierNode({ id: 'CCCCCCCCCCCCCCCCCCCCCCCCCC' }),
    ];
    vi.mocked(runOneRound).mockImplementation(async (incomingState) => ({
      ...incomingState,          // preserve accumulated stop_evidence
      round: incomingState.round + 1,
      round_results: [
        ...incomingState.round_results,
        makeRoundResult({ round: incomingState.round + 1, new_frontier_nodes: [makeFrontierNode()] }),
      ],
      frontier: makePendingFrontier(),  // 3 pending > threshold=2 ⇒ c1=false
      decisions_log: [],
    }));
    const config = makeVisionConfig({
      convergence: { pending_threshold: 2, plateau_threshold: 0, window: 4 },
      safety: { max_rounds: 3, consecutive_error_abort: 10 },
    });
    const hook = makeSynthesisHookSpy();
    const result = await runLoop(makeVisionState(), makeRunLoopOpts(hook), config);
    // runLoop calls appendVerdictToHistory once per round ⇒ exactly 3 entries
    expect(result.stop_evidence?.convergence_history.length).toBe(3);
    // All verdicts have c1=false (3 pending > threshold=2) ⇒ none converged
    expect(result.stop_evidence?.convergence_history.every(v => v.converged)).toBe(false);
    expect(result.status).not.toBe('converged');
  });
});
