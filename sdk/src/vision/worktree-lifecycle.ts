/**
 * SAFE-01 / SAFE-04 / SAFE-05 worktree lifecycle — create, diff-assert, teardown.
 *
 * Teardown NEVER uses git merge or cherry-pick — per Pitfall E, those leak
 * round-checkpoint commits into the source branch. Clean teardown extracts
 * file contents via `git show HEAD:<path>` and writes them directly to the
 * source tree. Abort teardown renames the worktree to a quarantine path and
 * writes VISION-ABORT-{sid}.md to the source branch for forensic inspection.
 *
 * Diff regex (SAFE-04) — what counts as an "in-bounds" change:
 *   ^\.planning/(drafts|seeds)/   — any artifact under .planning/drafts/ or .planning/seeds/
 *   ^\.planning/VISION-CATCHUP\.md$  — the catch-up digest exactly
 *   ^vision-state\.json$           — the session state file at worktree root
 *
 * Everything else is a VIOLATOR and triggers the D-03 quarantine pathway.
 */

import { writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { execGit } from '../query/commit.js';
import { mintSessionId } from './id.js';
import { writeCheckpoint } from './vision-state.js';
import type { VisionState } from './types.js';

// ─── SAFE-04 allowed-paths regex ─────────────────────────────────────────────
//
// The four path shapes that may cross from the vision worktree to the source branch:
//   1. .planning/drafts/<anything>   — draft roadmap, phase-draft packs, etc.
//   2. .planning/seeds/<anything>    — far-future seed files
//   3. .planning/VISION-CATCHUP.md  — the morning catch-up digest (exactly this filename)
//   4. vision-state.json            — session checkpoint at worktree root (not promoted, but not a violator)
//
// What is NOT allowed (violators):
//   - Any src/, scripts/, sdk/, get-shit-done/, skills/ path
//   - Any .planning/ file outside drafts/, seeds/, and VISION-CATCHUP.md
//   - Any root-level file except vision-state.json
//   - Path-traversal attempts (../ — git diff --name-only never emits these, but the anchor ^ blocks them anyway)

const ALLOWED = /^\.planning\/(drafts|seeds)\/|^\.planning\/VISION-CATCHUP\.md$|^vision-state\.json$/;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreateResult {
  sid: string;
  worktreePath: string;
  sourceBranch: string;
  sourceHeadSha: string;
}

export interface DiffAssertResult {
  ok: boolean;
  violators: string[];
  rawDiffStat: string;
  rawDiff: string;
}

// ─── createVisionWorktree (SAFE-01) ──────────────────────────────────────────

/**
 * Mint a new session ID, create a detached-HEAD git worktree at
 * `<repoRoot>/../gsd-vision-{sid}/`, write v0 vision-state.json, and
 * return the worktree path plus source-branch provenance.
 *
 * @param repoRoot   Absolute path to the source repository root
 * @param direction  User's overnight direction text (stored in state)
 * @param ceilingMs  Wall-clock ceiling in milliseconds
 */
export async function createVisionWorktree(
  repoRoot: string,
  direction: string,
  ceilingMs: number,
): Promise<CreateResult> {
  const sid = mintSessionId();
  const worktreePath = resolve(repoRoot, '..', `gsd-vision-${sid}`);

  const branchRes = execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branchRes.exitCode !== 0) {
    throw new GSDError(`rev-parse branch failed: ${branchRes.stderr}`, ErrorClassification.Execution);
  }
  const shaRes = execGit(repoRoot, ['rev-parse', 'HEAD']);
  if (shaRes.exitCode !== 0) {
    throw new GSDError(`rev-parse HEAD SHA failed: ${shaRes.stderr}`, ErrorClassification.Execution);
  }

  const addRes = execGit(repoRoot, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
  if (addRes.exitCode !== 0) {
    throw new GSDError(`git worktree add failed: ${addRes.stderr}`, ErrorClassification.Execution);
  }

  const now = new Date();
  const state: VisionState = {
    schema_version: 1,
    session_id: sid,
    direction,
    source_branch: branchRes.stdout,
    source_head_sha: shaRes.stdout,
    worktree_path: worktreePath,
    started_at: now.toISOString(),
    ceiling_at: new Date(now.getTime() + ceilingMs).toISOString(),
    status: 'starting',
    stop_reason: null,
    partial_results_available: false,
    round: 0,
    round_results: [],
    frontier: [],
    decisions_log: [],
    artifact_manifest: [],
  };

  await writeCheckpoint(join(worktreePath, 'vision-state.json'), state);

  return {
    sid,
    worktreePath,
    sourceBranch: branchRes.stdout,
    sourceHeadSha: shaRes.stdout,
  };
}

// ─── assertWorktreeDiffClean (SAFE-04) ───────────────────────────────────────

/**
 * Check that every file changed in the worktree since `sourceHeadSha`
 * matches the SAFE-04 ALLOWED regex. Returns { ok: true } when clean,
 * or { ok: false, violators, rawDiffStat, rawDiff } when dirty.
 *
 * NEVER modifies the worktree or the source branch — read-only.
 *
 * @param worktreePath  Absolute path to the vision worktree
 * @param sourceHeadSha SHA of the source branch HEAD at session-create time
 */
export async function assertWorktreeDiffClean(
  worktreePath: string,
  sourceHeadSha: string,
): Promise<DiffAssertResult> {
  const namesRes = execGit(worktreePath, ['diff', '--name-only', sourceHeadSha]);
  if (namesRes.exitCode !== 0) {
    throw new GSDError(`git diff --name-only failed: ${namesRes.stderr}`, ErrorClassification.Execution);
  }

  const changed = namesRes.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Invariant: git diff --name-only never emits paths with embedded '..' components.
  // If it ever does (e.g., a future git version, a custom diff driver, or a crafted
  // repo object), bail immediately — the ALLOWED regex relies on '^' anchoring to
  // block leading traversal only, not embedded '..' sequences.
  const hasEmbeddedTraversal = changed.some((p) => p.includes('..'));
  if (hasEmbeddedTraversal) {
    throw new GSDError(
      'git diff --name-only emitted a path with embedded ".." — unexpected, aborting for safety',
      ErrorClassification.Execution,
    );
  }

  const violators = changed.filter((p) => !ALLOWED.test(p));

  // Always capture stat + full diff for the quarantine report (cheap; also available on ok:true for callers)
  const statRes = execGit(worktreePath, ['diff', '--stat', sourceHeadSha]);
  const fullRes = execGit(worktreePath, ['diff', sourceHeadSha]);

  return {
    ok: violators.length === 0,
    violators,
    rawDiffStat: statRes.stdout,
    rawDiff: fullRes.stdout,
  };
}

// ─── teardownWorktreeClean (SAFE-05 clean path) ──────────────────────────────

/**
 * Promote allowed artifacts from the worktree to the source branch via
 * `git show HEAD:<path>` + writeFile (NEVER merge/cherry-pick — Pitfall E),
 * then remove the worktree from git's admin state.
 *
 * The caller MUST have verified the diff is clean before calling this function.
 * This function re-checks and throws GSDError(Validation) if the diff is dirty
 * (belt-and-suspenders).
 *
 * @param repoRoot      Absolute path to the source repository root
 * @param worktreePath  Absolute path to the vision worktree
 * @param sourceHeadSha SHA used as the diff base
 */
export async function teardownWorktreeClean(
  repoRoot: string,
  worktreePath: string,
  sourceHeadSha: string,
): Promise<{ extracted: string[] }> {
  const assertion = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);
  if (!assertion.ok) {
    throw new GSDError(
      `teardownWorktreeClean called on dirty diff — violators: ${assertion.violators.join(', ')}. Use teardownWorktreeAbort.`,
      ErrorClassification.Validation,
    );
  }

  // Re-list changed paths to extract
  const namesRes = execGit(worktreePath, ['diff', '--name-only', sourceHeadSha]);
  const changed = namesRes.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const extracted: string[] = [];

  for (const p of changed) {
    if (!ALLOWED.test(p)) continue; // defensive: should not happen (assertion passed)
    if (p === 'vision-state.json') continue; // session metadata — NOT promoted to source branch

    // Extract file content from git's blob store — immune to symlink swap attacks (T-06-05)
    const showRes = execGit(worktreePath, ['show', `HEAD:${p}`]);
    if (showRes.exitCode !== 0) {
      throw new GSDError(`git show HEAD:${p} failed: ${showRes.stderr}`, ErrorClassification.Execution);
    }

    const dest = join(repoRoot, p);
    await mkdir(dirname(dest), { recursive: true });
    // git show stdout is already the file content (trimmed by execGit); restore trailing newline
    await writeFile(dest, showRes.stdout + '\n', 'utf-8');
    extracted.push(p);
  }

  // Remove the worktree from git's admin state
  const removeRes = execGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  if (removeRes.exitCode !== 0) {
    // Defensive fallback: git worktree remove failed (e.g., detached HEAD quirk) — rm manually
    await rm(worktreePath, { recursive: true, force: true });
  }

  return { extracted };
}

// ─── teardownWorktreeAbort (SAFE-05 abort / D-03 quarantine) ─────────────────

/**
 * D-03 quarantine pathway: move the worktree to `gsd-vision-ABORTED-{sid}`,
 * invoke `git worktree repair` so `git worktree list` stops advertising the
 * stale path, and write VISION-ABORT-{sid}.md to the SOURCE BRANCH's .planning/
 * for forensic inspection.
 *
 * NEVER deletes the quarantined worktree — the user inspects it manually.
 *
 * @param repoRoot      Absolute path to the source repository root
 * @param worktreePath  Absolute path to the vision worktree (to be renamed)
 * @param sid           Session ID (used in the quarantine path + report filename)
 * @param assertion     Result from assertWorktreeDiffClean (ok must be false)
 * @param direction     User's overnight direction text (stored in the report)
 */
export async function teardownWorktreeAbort(
  repoRoot: string,
  worktreePath: string,
  sid: string,
  assertion: DiffAssertResult,
  direction: string,
): Promise<{ quarantinePath: string; abortReportPath: string }> {
  const quarantinePath = resolve(repoRoot, '..', `gsd-vision-ABORTED-${sid}`);

  // D-03: rename to quarantine — do NOT delete; user inspects manually
  await rename(worktreePath, quarantinePath);

  // Clean up stale admin state so `git worktree list` reflects reality and
  // future `git worktree add` calls succeed without "already registered" errors (T-06-04).
  // repair: reconcile admin state with the renamed path.
  // prune: remove entries that reference non-existent paths (the original gsd-vision-{sid}/ path).
  execGit(repoRoot, ['worktree', 'repair']);
  execGit(repoRoot, ['worktree', 'prune']);

  // Write abort report to the SOURCE BRANCH (repoRoot), NOT to the quarantined worktree
  const abortReportPath = join(repoRoot, '.planning', `VISION-ABORT-${sid}.md`);
  await mkdir(dirname(abortReportPath), { recursive: true });

  // Use four-backtick fences so any triple-backtick sequence in the diff or
  // direction text cannot break the fenced code block structure of the report.
  // Escape backticks in direction (user-supplied) to prevent fence injection.
  const FENCE = '````';
  const safeDirection = direction.replace(/`/g, '\\`');

  const body = [
    '---',
    `session_id: ${sid}`,
    `aborted_at: ${new Date().toISOString()}`,
    `quarantine_path: ${quarantinePath}`,
    '---',
    '',
    '# Vision Session Aborted — SAFE-04 Diff-Assertion Failure',
    '',
    `**Direction:** ${safeDirection}`,
    '',
    '## Violating Paths',
    '',
    ...assertion.violators.map((v) => `- \`${v}\``),
    '',
    '## Diff Stat',
    '',
    FENCE,
    assertion.rawDiffStat || '(empty)',
    FENCE,
    '',
    '## Full Diff',
    '',
    `${FENCE}diff`,
    assertion.rawDiff || '(empty)',
    FENCE,
    '',
    `Worktree quarantined at: \`${quarantinePath}\``,
    'Inspect manually and \`rm -rf\` when satisfied (D-03).',
    '',
  ].join('\n');

  await writeFile(abortReportPath, body, 'utf-8');

  return { quarantinePath, abortReportPath };
}
