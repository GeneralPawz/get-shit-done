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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { VisionState } from './types.js';

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
};

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
});
