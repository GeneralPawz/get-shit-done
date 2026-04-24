/**
 * Integration tests for run-one-round.ts — seeded frontier → runOneRound → checkpoint commit.
 *
 * Requires bwrap installed (Phase 1 preflight). Also makes real Claude SDK calls to spawn the
 * Explorer. Tests skip cleanly if bwrap is absent.
 *
 * Test IDs (from 02-RESEARCH.md §Validation Architecture):
 *   SC1-INT-01 — seeded frontier → RoundResult with topics_selected + backtrack_flag:false
 *   SC3-INT-01 — `git log --oneline` contains /checkpoint round 1/ (the "unmistakable test")
 *   SC4-INT-01 — round_results[0].backtrack_flag === false after runOneRound
 *   CAP-03     — frontier of 8 → topics_selected.length ≤ 5
 *
 * Each test has explicit 120_000ms timeout matching sdk/vitest.config.ts integration project
 * testTimeout. Do NOT rely on the default 5_000ms — these tests spawn real Claude sessions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { VisionState, FrontierNode } from './types.js';

// ─── bwrap availability gate ──────────────────────────────────────────────────

const BWRAP_OK = spawnSync('bwrap', ['--version']).status === 0;
const skipIfNoBwrap = BWRAP_OK ? it : it.skip;

// ─── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir: string;
let worktreePath: string;
let visionStatePath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-run-round-'));
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    session_id: 'INTTEST0000000000000000A00',
    direction,
    source_branch: 'main',
    source_head_sha: 'abc123',
    worktree_path: worktreePath,
    started_at: new Date().toISOString(),
    ceiling_at: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'in-progress',
    stop_reason: null,
    partial_results_available: false,
    round: 0,
    round_results: [],
    frontier,
    decisions_log: [],
    artifact_manifest: [],
  };
  await writeFile(visionStatePath, JSON.stringify(state, null, 2));
  return state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runOneRound', () => {
  skipIfNoBwrap(
    'SC1-INT-01: seeded frontier → round_results[0] with topics_selected, backtrack_flag:false, direction_snapshot preserved',
    async () => {
      await initGitWorktree();
      const { seedFromDirection } = await import('./seed-frontier.js');
      const { runOneRound } = await import('./run-one-round.js');

      const direction = 'understand how the GSD vision exploration SDK works';
      const frontier = await seedFromDirection({ direction, useLLM: false });
      // sanity: deterministic fallback always returns ≥3 nodes
      expect(frontier.length).toBeGreaterThanOrEqual(3);

      const state = await seedVisionState(direction, frontier);
      const next = await runOneRound(state, {
        visionStatePath,
        worktreeRoot: worktreePath,
      });

      // SC-1: round_results has exactly one entry
      expect(next.round_results).toHaveLength(1);
      const rr = next.round_results[0];
      // LOOP-04 invariant
      expect(rr.backtrack_flag).toBe(false);
      // topics_selected non-empty (we seeded at least 3 pending nodes)
      expect(rr.topics_selected.length).toBeGreaterThanOrEqual(1);
      // Pitfall 5 anchor: direction_snapshot preserved
      expect(rr.direction_snapshot).toBe(direction);
      // round incremented
      expect(next.round).toBe(1);
      // vision-state.json on disk matches (D-13 primary)
      const disk = JSON.parse(await readFile(visionStatePath, 'utf-8'));
      expect(disk.round).toBe(1);
      expect(disk.round_results).toHaveLength(1);
    },
    120_000,
  );

  skipIfNoBwrap(
    'SC3-INT-01: git log --oneline in the worktree contains a commit matching /checkpoint round 1/ (the unmistakable test)',
    async () => {
      await initGitWorktree();
      const { seedFromDirection } = await import('./seed-frontier.js');
      const { runOneRound } = await import('./run-one-round.js');

      const direction = 'test direction for checkpoint commit';
      const frontier = await seedFromDirection({ direction, useLLM: false });
      const state = await seedVisionState(direction, frontier);

      await runOneRound(state, { visionStatePath, worktreeRoot: worktreePath });

      const log = spawnSync('git', ['log', '--oneline'], {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
      expect(log.status).toBe(0);
      expect(log.stdout).toMatch(/checkpoint round 1/);
    },
    120_000,
  );

  skipIfNoBwrap(
    'SC4-INT-01: round_results[0].backtrack_flag is strictly false after runOneRound (LOOP-04 greedy invariant)',
    async () => {
      await initGitWorktree();
      const { seedFromDirection } = await import('./seed-frontier.js');
      const { runOneRound } = await import('./run-one-round.js');

      const direction = 'LOOP-04 greedy path must record backtrack_flag:false';
      const frontier = await seedFromDirection({ direction, useLLM: false });
      const state = await seedVisionState(direction, frontier);

      const next = await runOneRound(state, { visionStatePath, worktreeRoot: worktreePath });

      // strict literal comparison (not truthy/falsy)
      expect(next.round_results[0].backtrack_flag).toBe(false);
      expect(next.round_results[0].scores.selection_method).toBe('greedy-top-k');
    },
    120_000,
  );

  skipIfNoBwrap(
    'CAP-03: frontier of 8 pending nodes → topics_selected.length ≤ 5 (D-12 concurrency cap at supervisor trust boundary)',
    async () => {
      await initGitWorktree();
      const { runOneRound } = await import('./run-one-round.js');

      const direction = 'cap test';
      // Build 8 pending FrontierNodes with descending scores so selectTopK has a clear ordering
      const frontier: FrontierNode[] = Array.from({ length: 8 }, (_, i) => ({
        id: `CAP${String(i).padStart(23, '0')}`,
        topic: `topic ${i}`,
        score: 1 - i * 0.1,
        parent_round: 0,
        depth: 0,
        created_at: new Date().toISOString(),
        status: 'pending' as const,
      }));
      const state = await seedVisionState(direction, frontier);

      const next = await runOneRound(state, { visionStatePath, worktreeRoot: worktreePath });

      expect(next.round_results[0].topics_selected.length).toBeLessThanOrEqual(5);
    },
    120_000,
  );
});

// ─── Visible skip notice when bwrap is not installed ─────────────────────────

if (!BWRAP_OK) {
  describe('run-one-round integration (SKIPPED — bwrap not installed)', () => {
    it.skip(
      'install bubblewrap per Phase 1 preflight (sudo apt-get install bubblewrap)',
      () => {
        // visible skip message for CI maintainers
      },
    );
  });
}
