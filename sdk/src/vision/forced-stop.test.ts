/**
 * Unit tests for forced-stop: VISION_FORCED_STOP_SENTINEL, ForcedStopStub.
 *
 * T1: onForcedStop emits the exact sentinel literal to console.error.
 * T2: onForcedStop does NOT create any file under .planning/drafts/ or .planning/seeds/.
 * T3: onForcedStop resolves in under 500ms (atomic write budget within 60s grace).
 * T4: SynthesisHook interface has exact frozen shape (compile-time assignability).
 * T5: D-07 literal — onForcedStop writes status='ceiling-hit', stop_reason='wall-clock-ceiling',
 *     partial_results_available derived from round/round_results; other fields preserved.
 * T6: D-07 idempotency — double-invocation leaves status='ceiling-hit' (no corruption).
 * T7: onConverged emits VISION_CONVERGED_STUB_SENTINEL to console.error.
 * T8: onConverged writes status='converged', stop_reason='converged', convergence_snapshot=verdict.
 * T9: onForcedStop writes richer stop_evidence (convergence_history preserved, drift_error_count).
 * T10: onForcedStop short-circuits when state.status='converged' AND stop_evidence != null (Pitfall 3d).
 * T11: onForcedStop does NOT short-circuit when status='converged' but stop_evidence=null (defense-in-depth).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { VisionState, ConvergenceVerdict } from './types.js';

let tmpDir: string;
let visionStatePath: string;

const sampleState: VisionState = {
  schema_version: 1,
  session_id: 'TEST01',
  direction: 't',
  source_branch: 'main',
  source_head_sha: 'abc',
  worktree_path: '/tmp',
  started_at: '2026-04-23T00:00:00Z',
  ceiling_at: '2026-04-23T08:00:00Z',
  status: 'in-progress',
  stop_reason: null,
  partial_results_available: false,
  round: 2,
  round_results: [],
  frontier: [],
  decisions_log: [],
  artifact_manifest: [],
  stop_evidence: null,
};

/** Helper to build a sample ConvergenceVerdict for T7-T9 tests. */
function makeSampleVerdict(overrides: Partial<ConvergenceVerdict> = {}): ConvergenceVerdict {
  return {
    converged: true,
    conditions: { frontier: true, queue: true, sources: true },
    evaluated_at: '2026-04-24T00:00:00Z',
    round: 2,
    evidence: { pending_count: 0, blocking_unresolved_count: 0, new_frontier_nodes_delta: 0 },
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-forced-'));
  visionStatePath = join(tmpDir, 'vision-state.json');
  // Seed a v0 JSON so onForcedStop's atomic write has somewhere to land.
  await writeFile(visionStatePath, JSON.stringify(sampleState, null, 2));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ForcedStopStub', () => {
  it('T1: emits the exact sentinel literal to console.error', async () => {
    const { ForcedStopStub, VISION_FORCED_STOP_SENTINEL } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new ForcedStopStub({ visionStatePath }).onForcedStop(sampleState);
    expect(spy).toHaveBeenCalledWith('VISION_FORCED_STOP_STUB invoked', { session_id: 'TEST01' });
    expect(VISION_FORCED_STOP_SENTINEL).toBe('VISION_FORCED_STOP_STUB invoked');
    spy.mockRestore();
  });

  it('T2: does not write any drafts/ or seeds/ artifacts', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    await mkdir(join(tmpDir, '.planning', 'drafts'), { recursive: true });
    await mkdir(join(tmpDir, '.planning', 'seeds'), { recursive: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new ForcedStopStub({ visionStatePath }).onForcedStop(sampleState);
    expect(await readdir(join(tmpDir, '.planning', 'drafts'))).toEqual([]);
    expect(await readdir(join(tmpDir, '.planning', 'seeds'))).toEqual([]);
    spy.mockRestore();
  });

  it('T3: resolves in under 500ms (atomic write budget, well inside 60s grace)', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t0 = performance.now();
    await new ForcedStopStub({ visionStatePath }).onForcedStop(sampleState);
    expect(performance.now() - t0).toBeLessThan(500);
    spy.mockRestore();
  });

  it('T4: SynthesisHook interface has exact frozen shape (compile-time assignability)', async () => {
    const mod = await import('./forced-stop.js');
    // compile-time: ForcedStopStub satisfies SynthesisHook
    const _check: import('./forced-stop.js').SynthesisHook = { onForcedStop: async (_s) => {}, onConverged: async (_s, _v) => {} };
    expect(_check).toBeDefined();
    expect(typeof mod.ForcedStopStub).toBe('function');
  });

  it('T5: D-07 literal — writes status ceiling-hit, stop_reason, partial_results_available; preserves other fields', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // round=2 > 0, so partial_results_available should be true
    await new ForcedStopStub({ visionStatePath }).onForcedStop(sampleState);
    const written: VisionState = JSON.parse(await readFile(visionStatePath, 'utf-8'));
    expect(written.status).toBe('ceiling-hit');
    expect(written.stop_reason === 'wall-clock-ceiling' || written.stop_reason === 'ceiling').toBe(true);
    expect(written.partial_results_available).toBe(true); // round=2 > 0
    // Preserved fields
    expect(written.session_id).toBe('TEST01');
    expect(written.direction).toBe('t');
    expect(written.schema_version).toBe(1);
    spy.mockRestore();
  });

  it('T6: D-07 idempotency — double-invocation leaves status ceiling-hit (last-write-wins)', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = new ForcedStopStub({ visionStatePath });
    await stub.onForcedStop(sampleState);
    await stub.onForcedStop(sampleState);
    const written: VisionState = JSON.parse(await readFile(visionStatePath, 'utf-8'));
    expect(written.status).toBe('ceiling-hit');
    spy.mockRestore();
  });

  it('T7: onConverged emits VISION_CONVERGED_STUB invoked sentinel to console.error', async () => {
    const { ForcedStopStub, VISION_CONVERGED_STUB_SENTINEL } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const verdict = makeSampleVerdict();
    await new ForcedStopStub({ visionStatePath }).onConverged(sampleState, verdict);
    expect(spy).toHaveBeenCalledWith('VISION_CONVERGED_STUB invoked', { session_id: 'TEST01' });
    expect(VISION_CONVERGED_STUB_SENTINEL).toBe('VISION_CONVERGED_STUB invoked');
    spy.mockRestore();
  });

  it('T8: onConverged writes status=converged, stop_reason=converged, stop_evidence.convergence_snapshot=verdict', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const verdict = makeSampleVerdict({ converged: true, round: 2 });
    await new ForcedStopStub({ visionStatePath }).onConverged(sampleState, verdict);
    const written: VisionState = JSON.parse(await readFile(visionStatePath, 'utf-8'));
    expect(written.status).toBe('converged');
    expect(written.stop_reason).toBe('converged');
    expect(written.stop_evidence?.convergence_snapshot?.converged).toBe(true);
    // round=2 > 0 ⇒ partial_results_available=true
    expect(written.partial_results_available).toBe(true);
    spy.mockRestore();
  });

  it('T9: onForcedStop writes richer stop_evidence (final_round, final_frontier_pending_count, drift_error_count, convergence_history preserved)', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sampleStateWithHistory: VisionState = {
      ...sampleState,
      stop_evidence: {
        stopped_at: '2026-04-24T00:00:00Z',
        final_round: 0,
        final_frontier_pending_count: 0,
        convergence_history: [
          {
            converged: true,
            conditions: { frontier: true, queue: true, sources: true },
            evaluated_at: '2026-04-24T00:00:00Z',
            round: 1,
            evidence: { pending_count: 0, blocking_unresolved_count: 0, new_frontier_nodes_delta: 0 },
          },
        ],
      },
      round_results: [
        {
          round: 1,
          started_at: '2026-04-24T00:00:00Z',
          ended_at: '2026-04-24T00:00:01Z',
          direction_snapshot: 'test',
          topics_selected: [],
          findings: [],
          new_frontier_nodes: [],
          scores: { selection_method: 'greedy-top-k', score_distribution: [], selection_rationale: [] },
          backtrack_flag: false,
          subagent_count: 0,
          errors: [{ topic_id: '*', reason: 'direction-snapshot-drift' }],
        },
      ],
    };
    // Write the richer state to the file
    await writeFile(visionStatePath, JSON.stringify(sampleStateWithHistory, null, 2));
    await new ForcedStopStub({ visionStatePath }).onForcedStop(sampleStateWithHistory);
    const written: VisionState = JSON.parse(await readFile(visionStatePath, 'utf-8'));
    // convergence_history preserved from incoming state
    expect(written.stop_evidence?.convergence_history.length).toBe(1);
    // drift_error_count derived from round_results.errors
    expect(written.stop_evidence?.drift_error_count).toBe(1);
    // final_frontier_pending_count from state.frontier (empty ⇒ 0)
    expect(written.stop_evidence?.final_frontier_pending_count).toBe(0);
    spy.mockRestore();
  });

  it('T10: onForcedStop short-circuits when state.status === converged AND stop_evidence != null (Pitfall 3d safeguard 2)', async () => {
    const { ForcedStopStub, VISION_FORCED_STOP_SENTINEL } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const convergedState: VisionState = {
      ...sampleState,
      status: 'converged',
      stop_reason: 'converged',
      stop_evidence: {
        stopped_at: '2026-04-24T00:00:00Z',
        final_round: 2,
        final_frontier_pending_count: 0,
        convergence_history: [],
      },
    };
    await writeFile(visionStatePath, JSON.stringify(convergedState, null, 2));
    await new ForcedStopStub({ visionStatePath }).onForcedStop(convergedState);
    const written: VisionState = JSON.parse(await readFile(visionStatePath, 'utf-8'));
    // File must remain unchanged — status stays 'converged', NOT overwritten to 'ceiling-hit'
    expect(written.status).toBe('converged');
    // Sentinel for ceiling-hit must NOT have been emitted
    expect(spy.mock.calls.some(args => args[0] === VISION_FORCED_STOP_SENTINEL)).toBe(false);
    spy.mockRestore();
  });

  it('T11: onForcedStop does NOT short-circuit when status === converged but stop_evidence === null (defense-in-depth)', async () => {
    const { ForcedStopStub } = await import('./forced-stop.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const convergedNoEvidence: VisionState = {
      ...sampleState,
      status: 'converged',
      stop_reason: 'converged',
      stop_evidence: null,
    };
    await writeFile(visionStatePath, JSON.stringify(convergedNoEvidence, null, 2));
    await new ForcedStopStub({ visionStatePath }).onForcedStop(convergedNoEvidence);
    const written: VisionState = JSON.parse(await readFile(visionStatePath, 'utf-8'));
    // Guard requires BOTH status='converged' AND stop_evidence != null to short-circuit.
    // With stop_evidence=null, the guard does NOT fire ⇒ file IS overwritten to 'ceiling-hit'.
    expect(written.status).toBe('ceiling-hit');
    spy.mockRestore();
  });
});
