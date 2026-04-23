/**
 * Unit tests for the SAFE-01 / SAFE-04 / SAFE-05 worktree lifecycle.
 *
 * Tests: create-worktree, diff-assert (clean + dirty), teardown-clean
 * (extraction + removal), and teardown-abort (quarantine + abort report).
 *
 * Each test spins up a real throwaway git repo under /tmp so that git
 * operations are exercised end-to-end — no mocking of execGit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execGit } from '../query/commit.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let repoRoot: string;
let tmpParent: string;

/** Bootstrap a single-commit git repo at repoRoot. */
async function initRepo(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  execGit(root, ['init', '-b', 'main']);
  execGit(root, ['config', 'user.email', 'test@test']);
  execGit(root, ['config', 'user.name', 'Test']);
  await writeFile(join(root, 'seed.txt'), 'seed\n');
  execGit(root, ['add', '.']);
  execGit(root, ['commit', '--no-verify', '-m', 'seed']);
  return execGit(root, ['rev-parse', 'HEAD']).stdout;
}

beforeEach(async () => {
  tmpParent = await mkdtemp(join(tmpdir(), 'gsd-vision-wt-parent-'));
  repoRoot = join(tmpParent, 'repo');
  await initRepo(repoRoot);
});

afterEach(async () => {
  // Clean up any worktrees first (avoids "worktree is linked" errors on rm)
  try {
    const list = execGit(repoRoot, ['worktree', 'list', '--porcelain']);
    // prune stale admin entries
    execGit(repoRoot, ['worktree', 'prune']);
  } catch { /* best-effort */ }
  await rm(tmpParent, { recursive: true, force: true });
});

// ─── Import under test ───────────────────────────────────────────────────────

// Dynamic import so tests can be written before the module exists (TDD RED).
const mod = () => import('./worktree-lifecycle.js');

// ─── T1: createVisionWorktree creates the worktree dir and records source state ──

describe('createVisionWorktree', () => {
  it('T1: creates gsd-vision-<sid>/ directory, records source_branch and source_head_sha in vision-state.json', async () => {
    const { createVisionWorktree } = await mod();
    const expectedBranch = execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    const expectedSha = execGit(repoRoot, ['rev-parse', 'HEAD']).stdout;

    const result = await createVisionWorktree(repoRoot, 'test direction', 3_600_000);

    // worktreePath must live at ../gsd-vision-<sid> relative to repoRoot
    expect(result.worktreePath).toBe(resolve(repoRoot, '..', `gsd-vision-${result.sid}`));
    expect(result.sourceBranch).toBe(expectedBranch);
    expect(result.sourceHeadSha).toBe(expectedSha);
    expect(existsSync(result.worktreePath)).toBe(true);

    // vision-state.json must exist inside the worktree
    const statePath = join(result.worktreePath, 'vision-state.json');
    expect(existsSync(statePath)).toBe(true);

    const state = JSON.parse(await readFile(statePath, 'utf-8'));
    expect(state.source_branch).toBe(expectedBranch);
    expect(state.source_head_sha).toBe(expectedSha);
    expect(state.session_id).toBe(result.sid);
  });

  it('T2: v0 vision-state.json has status: "starting" and a parseable ceiling_at ISO string in the future', async () => {
    const { createVisionWorktree } = await mod();
    const before = Date.now();
    const CEILING_MS = 3_600_000; // 1 hour
    const result = await createVisionWorktree(repoRoot, 'direction', CEILING_MS);
    const after = Date.now();

    const state = JSON.parse(await readFile(join(result.worktreePath, 'vision-state.json'), 'utf-8'));
    expect(state.status).toBe('starting');

    const ceilingTs = new Date(state.ceiling_at).getTime();
    expect(Number.isFinite(ceilingTs)).toBe(true);
    // ceiling_at must be in the future relative to when createVisionWorktree was called
    expect(ceilingTs).toBeGreaterThan(before + CEILING_MS - 1000);
    expect(ceilingTs).toBeLessThan(after + CEILING_MS + 1000);
  });
});

// ─── T3–T5: assertWorktreeDiffClean ──────────────────────────────────────────

describe('assertWorktreeDiffClean', () => {
  it('T3: returns ok:true when only .planning/drafts/foo.md changed', async () => {
    const { createVisionWorktree, assertWorktreeDiffClean } = await mod();
    const { worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'dir', 3_600_000);

    // Write an in-bounds file and commit it inside the worktree
    const draftsDir = join(worktreePath, '.planning', 'drafts');
    await mkdir(draftsDir, { recursive: true });
    await writeFile(join(draftsDir, 'foo.md'), '# in-bounds\n');
    execGit(worktreePath, ['add', '.']);
    execGit(worktreePath, ['commit', '--no-verify', '-m', 'in-bounds']);

    const result = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);
    expect(result.ok).toBe(true);
    expect(result.violators).toHaveLength(0);
  });

  it('T4: returns ok:true when only .planning/VISION-CATCHUP.md changed', async () => {
    const { createVisionWorktree, assertWorktreeDiffClean } = await mod();
    const { worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'dir', 3_600_000);

    const planningDir = join(worktreePath, '.planning');
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, 'VISION-CATCHUP.md'), '# catchup\n');
    execGit(worktreePath, ['add', '.']);
    execGit(worktreePath, ['commit', '--no-verify', '-m', 'catchup']);

    const result = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);
    expect(result.ok).toBe(true);
    expect(result.violators).toHaveLength(0);
  });

  it('T5: returns ok:false with violators containing src/foo.ts when an out-of-bounds file changed', async () => {
    const { createVisionWorktree, assertWorktreeDiffClean } = await mod();
    const { worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'dir', 3_600_000);

    // Write an OUT-OF-BOUNDS file
    const srcDir = join(worktreePath, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'foo.ts'), 'export const x = 1;\n');
    execGit(worktreePath, ['add', '.']);
    execGit(worktreePath, ['commit', '--no-verify', '-m', 'out-of-bounds']);

    const result = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);
    expect(result.ok).toBe(false);
    expect(result.violators).toContain('src/foo.ts');
  });
});

// ─── T6–T7: teardownWorktreeClean ────────────────────────────────────────────

describe('teardownWorktreeClean', () => {
  it('T6: removes worktree from git admin state (git worktree list shows nothing for vision path)', async () => {
    const { createVisionWorktree, teardownWorktreeClean } = await mod();
    const { worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'dir', 3_600_000);

    // No changes — diff is clean (only vision-state.json which is allowed)
    await teardownWorktreeClean(repoRoot, worktreePath, sourceHeadSha);

    const listOutput = execGit(repoRoot, ['worktree', 'list']).stdout;
    // After teardown, the vision worktree path must NOT appear
    expect(listOutput).not.toContain(worktreePath);
    // Directory itself must be gone
    expect(existsSync(worktreePath)).toBe(false);
  });

  it('T7: extracts .planning/drafts/out.md to source branch with identical content', async () => {
    const { createVisionWorktree, teardownWorktreeClean } = await mod();
    const { worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'dir', 3_600_000);

    // Write an in-bounds file inside the worktree and commit it
    const draftsDir = join(worktreePath, '.planning', 'drafts');
    await mkdir(draftsDir, { recursive: true });
    const content = '# extracted artifact\n\nHello from vision.\n';
    await writeFile(join(draftsDir, 'out.md'), content);
    execGit(worktreePath, ['add', '.']);
    execGit(worktreePath, ['commit', '--no-verify', '-m', 'artifact']);

    await teardownWorktreeClean(repoRoot, worktreePath, sourceHeadSha);

    // File must now exist in the source branch (repoRoot)
    const promoted = join(repoRoot, '.planning', 'drafts', 'out.md');
    expect(existsSync(promoted)).toBe(true);
    const promotedContent = await readFile(promoted, 'utf-8');
    // Content must match (trailing newline may differ by one — git show adds trailing \n)
    expect(promotedContent.trim()).toBe(content.trim());
  });
});

// ─── T8–T9: teardownWorktreeAbort ────────────────────────────────────────────

describe('teardownWorktreeAbort', () => {
  it('T8: renames worktree to gsd-vision-ABORTED-<sid> and writes VISION-ABORT-<sid>.md to SOURCE branch', async () => {
    const { createVisionWorktree, assertWorktreeDiffClean, teardownWorktreeAbort } = await mod();
    const { sid, worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'test direction', 3_600_000);

    // Write out-of-bounds file and commit to trigger a dirty diff
    const srcDir = join(worktreePath, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'bad.ts'), 'leaked\n');
    execGit(worktreePath, ['add', '.']);
    execGit(worktreePath, ['commit', '--no-verify', '-m', 'dirty']);

    const assertion = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);
    expect(assertion.ok).toBe(false);

    const { quarantinePath, abortReportPath } = await teardownWorktreeAbort(
      repoRoot,
      worktreePath,
      sid,
      assertion,
      'test direction',
    );

    // Quarantine directory must exist (gsd-vision-ABORTED-<sid>)
    const expectedQuarantine = resolve(repoRoot, '..', `gsd-vision-ABORTED-${sid}`);
    expect(quarantinePath).toBe(expectedQuarantine);
    expect(existsSync(quarantinePath)).toBe(true);
    // Original worktree path must be gone
    expect(existsSync(worktreePath)).toBe(false);

    // Abort report must be written to SOURCE branch (.planning/ of repoRoot)
    const expectedReport = join(repoRoot, '.planning', `VISION-ABORT-${sid}.md`);
    expect(abortReportPath).toBe(expectedReport);
    expect(existsSync(abortReportPath)).toBe(true);

    // Report must mention the violating path
    const reportContent = await readFile(abortReportPath, 'utf-8');
    expect(reportContent).toContain('src/bad.ts');
    expect(reportContent).toContain(sid);
  });

  it('T9: after teardownWorktreeAbort, git worktree list does NOT advertise the old worktree path', async () => {
    const { createVisionWorktree, assertWorktreeDiffClean, teardownWorktreeAbort } = await mod();
    const { sid, worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'direction', 3_600_000);

    // Create out-of-bounds change
    await writeFile(join(worktreePath, 'leaked.ts'), 'bad\n');
    execGit(worktreePath, ['add', '.']);
    execGit(worktreePath, ['commit', '--no-verify', '-m', 'leak']);

    const assertion = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);
    expect(assertion.ok).toBe(false);

    await teardownWorktreeAbort(repoRoot, worktreePath, sid, assertion, 'direction');

    // git worktree list must NOT contain the original (un-quarantined) path
    const listOutput = execGit(repoRoot, ['worktree', 'list']).stdout;
    expect(listOutput).not.toContain(worktreePath);
  });
});
