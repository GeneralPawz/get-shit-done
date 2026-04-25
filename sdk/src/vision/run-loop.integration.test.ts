/**
 * Integration test for run-loop.ts (Phase 3 D-22) — ONE bwrap-gated multi-round test.
 *
 * Test ID:
 *   SC1-INT: runLoop with max_rounds=2 + window=99 produces ≥2 distinct
 *            `checkpoint round` commits in the worktree git log (ROADMAP SC1).
 *
 * Skips cleanly when bwrap is not installed (host without bubblewrap).
 * Per RESEARCH Risk Note 10: with runOneRound + runLoop both writing per round,
 * expect 4 checkpoint commits at 2 rounds (≥2 still passes the assertion).
 *
 * The duplicate-commit pattern (RESEARCH Risk Note 7 + option (c) in run-loop.ts):
 *   - runOneRound writes `checkpoint round N` at end of its body
 *   - runLoop writes `checkpoint round N` again after post-processing
 *   - Result: 2 commits per round → 4 total at max_rounds=2 (plus terminal write = 5)
 *   - ROADMAP SC1 contract: `>= 2` distinct checkpoint commits is the explicit minimum
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { VisionState, FrontierNode, VisionConfig, DecisionLogEntry } from './types.js';

// ─── Bwrap availability gate ──────────────────────────────────────────────────

const BWRAP_OK = spawnSync('bwrap', ['--version']).status === 0;
const skipIfNoBwrap = BWRAP_OK ? it : it.skip;

// ─── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir: string;
let worktreePath: string;
let visionStatePath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-run-loop-'));
  worktreePath = join(tmpDir, 'wt');
  // D-02 HOME/XDG directories the bwrap jail mounts
  await mkdir(join(worktreePath, '.home'), { recursive: true });
  await mkdir(join(worktreePath, '.cache'), { recursive: true });
  await mkdir(join(worktreePath, '.config'), { recursive: true });
  await mkdir(join(worktreePath, '.local', 'share'), { recursive: true });
  await mkdir(join(worktreePath, '.planning'), { recursive: true });
  visionStatePath = join(worktreePath, 'vision-state.json');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Helpers (verbatim from run-one-round.integration.test.ts) ───────────────

/** Init a git repo in worktreePath so writeCheckpoint's D-13 secondary commit can succeed. */
async function initGitWorktree(): Promise<void> {
  spawnSync('git', ['init', worktreePath], { stdio: 'pipe' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: worktreePath, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: worktreePath, stdio: 'pipe' });
  await writeFile(join(worktreePath, 'README.md'), 'init');
  spawnSync('git', ['add', 'README.md'], { cwd: worktreePath, stdio: 'pipe' });
  spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: worktreePath, stdio: 'pipe' });
}

/** Build a minimal VisionState (schema_version: 1) with the seeded frontier and persist it. */
async function seedVisionState(direction: string, frontier: FrontierNode[]): Promise<VisionState> {
  const state: VisionState = {
    schema_version: 1,
    session_id: 'INT-RUN-LOOP-01',
    direction,
    source_branch: 'main',
    source_head_sha: 'abc',
    worktree_path: worktreePath,
    started_at: new Date().toISOString(),
    ceiling_at: new Date(Date.now() + 600_000).toISOString(),
    status: 'starting',
    stop_reason: null,
    partial_results_available: false,
    round: 0,
    round_results: [],
    frontier,
    decisions_log: [] as DecisionLogEntry[],
    artifact_manifest: [],
    stop_evidence: null,                                // Phase 3 D-11 lazy init
  };
  await writeFile(visionStatePath, JSON.stringify(state, null, 2));
  return state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runLoop integration (multi-round)', () => {
  skipIfNoBwrap(
    'SC1-INT: runLoop with max_rounds=2 + window=99 produces ≥2 distinct `checkpoint round` commits (ROADMAP SC1)',
    async () => {
      await initGitWorktree();
      const { seedFromDirection } = await import('./seed-frontier.js');
      const { runLoop } = await import('./run-loop.js');
      const { ForcedStopStub } = await import('./forced-stop.js');

      const direction = 'how should the umbrella routing layer work in GSD v2';
      const frontier = await seedFromDirection({ direction, useLLM: false });
      // sanity: deterministic fallback always returns ≥3 nodes
      expect(frontier.length).toBeGreaterThanOrEqual(3);

      await seedVisionState(direction, frontier);

      // Re-load the seeded state so `runLoop` sees the on-disk seed.
      const { readFile } = await import('node:fs/promises');
      const initialState: VisionState = JSON.parse(
        await readFile(visionStatePath, 'utf-8'),
      );

      const config: VisionConfig = {
        convergence: {
          pending_threshold: 2,
          plateau_threshold: 1,
          window: 99,                                   // unreachable — forces max-rounds path
        },
        safety: {
          max_rounds: 2,
          consecutive_error_abort: 99,                  // unreachable — don't abort on errors
        },
        decision_queue: { confidence_max: 0.6, surprises_min: 1 },
      };

      const finalState = await runLoop(
        initialState,
        {
          visionStatePath,
          worktreeRoot: worktreePath,
          synthesisHook: new ForcedStopStub({ visionStatePath }),
        },
        config,
      );

      // Terminal status: max-rounds-exceeded (since window=99 is unreachable)
      expect(finalState.status).toBe('aborted');
      expect(finalState.stop_reason).toBe('aborted');
      expect(finalState.stop_evidence).not.toBeNull();
      expect(finalState.stop_evidence!.reason).toBe('max-rounds-exceeded');
      expect(finalState.stop_evidence!.convergence_history.length).toBe(2);
      expect(finalState.round).toBe(2);

      // ROADMAP SC1: count `checkpoint round` commits in the worktree git log.
      // Per RESEARCH Risk Note 10: runOneRound + runLoop both write per round →
      // 4 `checkpoint round N` commits at max_rounds=2; transitionToAborted may add a 5th.
      // The contract is >= 2 (CONTEXT D-22 + Specifics §"unmistakable test").
      const log = spawnSync('git', ['log', '--oneline'], {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
      expect(log.status).toBe(0);
      const checkpointCommits = (log.stdout.match(/checkpoint round/g) ?? []).length;
      expect(checkpointCommits).toBeGreaterThanOrEqual(2);
      // Per RESEARCH Risk Note 10: at 2 rounds with both runOneRound + runLoop writing,
      // expect 4 commits; >= 2 is the explicit contract from ROADMAP SC1 + CONTEXT Specifics.
    },
    120_000,
  );
});

// ─── Visible skip notice when bwrap is not installed ─────────────────────────

if (!BWRAP_OK) {
  describe('run-loop integration (SKIPPED — bwrap not installed)', () => {
    it.skip(
      'install bubblewrap per Phase 1 preflight (sudo apt-get install bubblewrap)',
      () => {
        // No-op skip — visible in vitest output so CI maintainers know why
      },
    );
  });
}
