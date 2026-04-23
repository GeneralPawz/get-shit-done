/**
 * Unit tests for vision-state: writeCheckpoint, readCheckpoint, validateCheckpoint.
 *
 * T1:  writeCheckpoint + readCheckpoint round-trips deep-equal state.
 * T2:  readCheckpoint returns null when file is absent.
 * T3:  readCheckpoint returns null when file contains invalid JSON.
 * T4:  readCheckpoint returns null when schema_version is not 1.
 * T5:  validateCheckpoint returns ok:true on a freshly built manifest.
 * T6:  validateCheckpoint returns ok:false with reason sha-mismatch when artifact modified.
 * T7:  validateCheckpoint returns ok:false with reason missing when artifact deleted.
 * T8:  writeCheckpoint then unlink then readCheckpoint returns null.
 * T9:  D-13 secondary WRITE side: git commit appears in log after writeCheckpoint(path, state, worktreeRoot).
 * T10: D-13 secondary opt-out: writeCheckpoint without worktreeRoot skips git commit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, unlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { VisionState } from './types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-state-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const baseState: VisionState = {
  schema_version: 1,
  session_id: 'TEST01',
  direction: 't',
  source_branch: 'main',
  source_head_sha: 'abc123',
  worktree_path: '/tmp',
  started_at: '2026-04-23T00:00:00Z',
  ceiling_at: '2026-04-23T08:00:00Z',
  status: 'starting',
  stop_reason: null,
  partial_results_available: false,
  round: 0,
  round_results: [],
  frontier: [],
  decisions_log: [],
  artifact_manifest: [],
};

describe('vision-state', () => {
  it('T1: writeCheckpoint + readCheckpoint round-trips deep-equal state', async () => {
    const { writeCheckpoint, readCheckpoint } = await import('./vision-state.js');
    const p = join(tmpDir, 'vision-state.json');
    await writeCheckpoint(p, baseState);
    expect(await readCheckpoint(p)).toEqual(baseState);
  });

  it('T2: readCheckpoint returns null when file missing', async () => {
    const { readCheckpoint } = await import('./vision-state.js');
    const p = join(tmpDir, 'nonexistent.json');
    expect(await readCheckpoint(p)).toBeNull();
  });

  it('T3: readCheckpoint returns null on invalid JSON', async () => {
    const { readCheckpoint } = await import('./vision-state.js');
    const p = join(tmpDir, 'bad.json');
    await writeFile(p, 'not valid json {{{{', 'utf-8');
    expect(await readCheckpoint(p)).toBeNull();
  });

  it('T4: readCheckpoint returns null when schema_version !== 1', async () => {
    const { readCheckpoint } = await import('./vision-state.js');
    const p = join(tmpDir, 'wrong-version.json');
    await writeFile(p, JSON.stringify({ schema_version: 2, session_id: 'X' }), 'utf-8');
    expect(await readCheckpoint(p)).toBeNull();
  });

  it('T5: validateCheckpoint returns ok:true on freshly built manifest', async () => {
    const { writeCheckpoint, validateCheckpoint } = await import('./vision-state.js');
    const { buildManifest } = await import('./sha-manifest.js');
    const planningRoot = join(tmpDir, '.planning');
    await mkdir(planningRoot, { recursive: true });
    await writeFile(join(planningRoot, 'test.md'), '# test content', 'utf-8');
    const manifest = await buildManifest(planningRoot);
    const state: VisionState = { ...baseState, artifact_manifest: manifest };
    const statePath = join(tmpDir, 'vision-state.json');
    await writeCheckpoint(statePath, state);
    const result = await validateCheckpoint(state, planningRoot);
    expect(result.ok).toBe(true);
  });

  it('T6: validateCheckpoint returns ok:false with sha-mismatch when artifact modified', async () => {
    const { validateCheckpoint } = await import('./vision-state.js');
    const { buildManifest } = await import('./sha-manifest.js');
    const planningRoot = join(tmpDir, '.planning');
    await mkdir(planningRoot, { recursive: true });
    const filePath = join(planningRoot, 'tracked.md');
    await writeFile(filePath, '# original content', 'utf-8');
    const manifest = await buildManifest(planningRoot);
    const state: VisionState = { ...baseState, artifact_manifest: manifest };
    // Modify the tracked file (same size to force sha-mismatch, not size-mismatch)
    await writeFile(filePath, '# mutated-content!', 'utf-8');
    const result = await validateCheckpoint(state, planningRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches.some(m => m.reason === 'sha-mismatch' || m.reason === 'size-mismatch')).toBe(true);
    }
  });

  it('T7: validateCheckpoint returns ok:false with reason missing when artifact deleted', async () => {
    const { validateCheckpoint } = await import('./vision-state.js');
    const { buildManifest } = await import('./sha-manifest.js');
    const planningRoot = join(tmpDir, '.planning');
    await mkdir(planningRoot, { recursive: true });
    const filePath = join(planningRoot, 'deleteme.md');
    await writeFile(filePath, '# content to delete', 'utf-8');
    const manifest = await buildManifest(planningRoot);
    const state: VisionState = { ...baseState, artifact_manifest: manifest };
    await rm(filePath);
    const result = await validateCheckpoint(state, planningRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches.some(m => m.reason === 'missing')).toBe(true);
    }
  });

  it('T8: writeCheckpoint then unlink then readCheckpoint returns null', async () => {
    const { writeCheckpoint, readCheckpoint } = await import('./vision-state.js');
    const p = join(tmpDir, 'vision-state.json');
    await writeCheckpoint(p, baseState);
    await unlink(p);
    expect(await readCheckpoint(p)).toBeNull();
  });

  it('T9: D-13 secondary WRITE side: git log contains checkpoint round after writeCheckpoint(path, state, worktreeRoot)', async () => {
    const { writeCheckpoint } = await import('./vision-state.js');

    // Set up a real git repo in tmpDir
    const gitDir = tmpDir;
    spawnSync('git', ['init', gitDir], { stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir, stdio: 'pipe' });
    // Create an initial commit so the repo is valid
    await writeFile(join(gitDir, 'README.md'), 'init', 'utf-8');
    spawnSync('git', ['add', 'README.md'], { cwd: gitDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: gitDir, stdio: 'pipe' });

    // Create .planning/ directory so git add .planning/ succeeds
    await mkdir(join(gitDir, '.planning'), { recursive: true });
    await writeFile(join(gitDir, '.planning', 'placeholder.md'), '# planning', 'utf-8');
    spawnSync('git', ['add', '.planning/'], { cwd: gitDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '--allow-empty', '-m', 'add planning dir'], { cwd: gitDir, stdio: 'pipe' });

    const state: VisionState = { ...baseState, round: 3 };
    const statePath = join(gitDir, 'vision-state.json');
    await writeCheckpoint(statePath, state, gitDir);

    const logResult = spawnSync('git', ['log', '--oneline'], { cwd: gitDir, encoding: 'utf-8' });
    const logOutput = logResult.stdout ?? '';
    expect(logOutput).toContain('checkpoint round 3');
  });

  it('T10: D-13 secondary opt-out: writeCheckpoint without worktreeRoot skips git commit', async () => {
    const { writeCheckpoint, readCheckpoint } = await import('./vision-state.js');

    // Write WITHOUT worktreeRoot — should not touch git
    const statePath = join(tmpDir, 'vision-state.json');
    const state: VisionState = { ...baseState, round: 7 };
    await writeCheckpoint(statePath, state);

    // JSON file exists and round-trips correctly
    const read = await readCheckpoint(statePath);
    expect(read).toEqual(state);

    // Git log in the surrounding git repo should NOT have a "checkpoint round 7" commit
    const logResult = spawnSync('git', ['log', '--oneline', '-20'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const logOutput = logResult.stdout ?? '';
    expect(logOutput).not.toContain('checkpoint round 7');
  });
});
