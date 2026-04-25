/**
 * Integration tests for supervisor.ts — STOP-01 ceiling timer, STOP-02 state
 * write, signal forwarding, and uncaughtException hardening (Pitfall A).
 *
 * Requires bwrap to be installed (Plan 01-01 preflight). Tests skip cleanly
 * with a descriptive message if bwrap is absent — skip, not fail.
 *
 * NOTE: These tests use `it.skip` / `it.skipIf` — not `it.only`. They run
 * inside the `integration` vitest project (*.integration.test.ts suffix).
 * Each test has an explicit timeout (second arg to `it`) to guard against the
 * 60s SIGKILL grace timer accidentally dominating CI run time on regression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { JailPolicy, VisionState } from './types.js';
import { buildJailEnvOverrides } from './bwrap-compose.js';

// ─── Bwrap availability gate ──────────────────────────────────────────────────

const BWRAP_OK = spawnSync('bwrap', ['--version']).status === 0;
const skipIfNoBwrap = BWRAP_OK ? it : it.skip;

// ─── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir: string;
let worktreePath: string;
let visionStatePath: string;

/**
 * Seed a 'starting' state so the supervisor has a valid file to read/update
 * on ceiling-hit. Mirrors the state written by the session kickoff in Phase 5.
 */
async function seedStartingState(): Promise<VisionState> {
  const v0: VisionState = {
    schema_version: 1,
    session_id: 'SUPTEST',
    direction: 'test direction',
    source_branch: 'main',
    source_head_sha: 'abc123',
    worktree_path: worktreePath,
    started_at: new Date().toISOString(),
    ceiling_at: new Date(Date.now() + 60_000).toISOString(),
    status: 'starting',
    stop_reason: null,
    partial_results_available: false,
    round: 0,
    round_results: [],
    frontier: [],
    decisions_log: [],
    artifact_manifest: [],
  };
  await writeFile(visionStatePath, JSON.stringify(v0, null, 2));
  return v0;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-sup-'));
  worktreePath = join(tmpDir, 'wt');
  // Create the D-02 HOME/XDG directory structure inside the worktree
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

const makePolicy = (binary: string, args: string[]): JailPolicy => ({
  worktreePath,
  repoReadOnlyRoot: tmpDir,
  sessionBinary: binary,
  sessionArgs: args,
  ceilingMs: 60_000,
  envOverrides: buildJailEnvOverrides(worktreePath),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('superviseSession', () => {
  /**
   * T1 — STOP-01 ceiling timer accuracy.
   *
   * Uses /usr/bin/node -e 'setTimeout(()=>{},30000)' so the child responds
   * to SIGTERM via Node's default handler (exits immediately), which means
   * the promise should resolve well within [1.8s, 4s] — not 2s + 60s grace.
   *
   * Widened to [1.8s, 4s] per info I9 (flake margin for WSL2 scheduling).
   * Vision-state.json on disk must show status: 'ceiling-hit' after resolve.
   */
  skipIfNoBwrap(
    'T1 (STOP-01): 2s ceiling on node setTimeout(30s) fires SIGTERM and supervisor writes ceiling-hit',
    async () => {
      const { superviseSession } = await import('./supervisor.js');
      await seedStartingState();

      const policy = makePolicy('/usr/bin/node', ['-e', 'setTimeout(()=>{},30000)']);
      const t0 = performance.now();
      const res = await superviseSession(policy, 2000, visionStatePath);
      const elapsed = performance.now() - t0;

      expect(res.ceiling_fired).toBe(true);
      expect(elapsed).toBeGreaterThan(1800);
      expect(elapsed).toBeLessThan(4000);
      expect(res.sigterm_sent_at).not.toBeNull();

      const raw = await readFile(visionStatePath, 'utf-8');
      const parsed: VisionState = JSON.parse(raw);
      expect(parsed.status).toBe('ceiling-hit');
      // stop_reason may be 'ceiling' (supervisor belt write) OR 'wall-clock-ceiling'
      // (ForcedStopStub literal from forced-stop.ts — D-07). Both satisfy the contract;
      // canonical assertion for the stub's exact literal lives in 01-04's test suite.
      expect(['ceiling', 'wall-clock-ceiling']).toContain(parsed.stop_reason);

      // Phase 3 D-13 + ROADMAP SC4 supervisor-fallback assertions:
      // The child does NOT instantiate ForcedStopStub, so the supervisor's belt-write
      // (PLAN 05) is the writer. It reconstructs stop_evidence from outside the jail.
      expect(parsed.stop_evidence).not.toBeNull();
      expect(parsed.stop_evidence!.ceiling_ms_elapsed).toBeGreaterThanOrEqual(2000);
      expect(parsed.stop_evidence!.final_round).toBe(0);                       // seedStartingState seeds round=0
      expect(typeof parsed.stop_evidence!.stopped_at).toBe('string');
      expect(parsed.stop_evidence!.reason).toBeNull();                         // ceiling-hit path uses no reason discriminator
      expect(parsed.stop_evidence!.last_caught_error).toBeNull();              // not a crashed path
      expect(parsed.stop_evidence!.convergence_history).toEqual([]);           // seedStartingState had no prior history
    },
    10_000, // test timeout: 10s — prevents 60s grace from dominating CI
  );

  /**
   * T2 — Happy path: fast-exit command resolves without ceiling fire.
   */
  skipIfNoBwrap(
    'T2: command that exits 0 immediately resolves with ceiling_fired=false and exit_code=0',
    async () => {
      const { superviseSession } = await import('./supervisor.js');
      await seedStartingState();

      const policy = makePolicy('/bin/sh', ['-c', 'exit 0']);
      const res = await superviseSession(policy, 60_000, visionStatePath);

      expect(res.ceiling_fired).toBe(false);
      expect(res.exit_code).toBe(0);
      expect(res.sigterm_sent_at).toBeNull();
    },
    10_000,
  );

  /**
   * T3 — Signal forwarding: process.emit('SIGINT') forwards SIGTERM to child.
   *
   * After 500ms the test simulates Ctrl-C by emitting SIGINT on the supervisor
   * process. The supervisor's forwardTerm handler should send SIGTERM to the
   * child (which is sleeping 30s). Child terminates, promise resolves with
   * ceiling_fired=false (the ceiling did NOT fire — user interrupt did).
   */
  skipIfNoBwrap(
    'T3: process SIGINT is forwarded as SIGTERM to child (not ceiling_fired)',
    async () => {
      const { superviseSession } = await import('./supervisor.js');
      await seedStartingState();

      const policy = makePolicy('/bin/sh', ['-c', 'sleep 30']);
      const p = superviseSession(policy, 60_000, visionStatePath);

      // Simulate user Ctrl-C after 500ms
      setTimeout(() => {
        process.kill(process.pid, 'SIGINT');
      }, 500);

      const res = await p;

      // Child was terminated by forwarded SIGTERM (not ceiling), so ceiling_fired === false
      expect(res.ceiling_fired).toBe(false);
      // Signal-terminated exit code is non-zero (143 = 128 + SIGTERM(15))
      expect(res.exit_code).not.toBe(0);
    },
    10_000,
  );
});

// ─── Visible skip notice when bwrap is not installed ─────────────────────────

if (!BWRAP_OK) {
  describe('supervisor integration (SKIPPED — bwrap not installed)', () => {
    it.skip(
      'install bubblewrap per Plan 01-01 preflight (sudo apt-get install bubblewrap)',
      () => {
        // No-op skip — visible in vitest output so CI maintainers know why
      },
    );
  });
}
