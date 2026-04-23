/**
 * Vision session state persistence — writer, reader, and SHA-manifest validator
 * for vision-state.json at the worktree root.
 *
 * Sole writer is the session process; no intra-session lock. Per D-04/D-16,
 * .planning/.vision.lock handles inter-session contention (SAFE-06), NOT this module.
 *
 * D-13 secondary recovery path: after successful atomic JSON write,
 * writeCheckpoint ALSO runs `git add .planning/ vision-state.json && git commit
 * --allow-empty -m 'checkpoint round N'` inside the worktree. This is the WRITE
 * side; the READ side (walking git log as fallback on JSON corruption) is
 * Phase 2 per D-16 — writing the commits in Phase 1 is mandatory so Phase 2 has
 * commits to walk. Git errors are non-fatal: JSON primary has already succeeded.
 */

import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from './atomic-write.js';
import { validateManifest } from './sha-manifest.js';
import { execGit } from '../query/commit.js';
import type { VisionState, ValidationResult } from './types.js';

/**
 * Write the vision state via atomic JSON rename + optional secondary git commit.
 * @param statePath Absolute path to vision-state.json
 * @param state The complete VisionState payload to persist
 * @param worktreeRoot Optional worktree root; when provided, writeCheckpoint
 *   runs `git add` + `git commit --allow-empty` after the JSON write as the
 *   D-13 secondary recovery path. Pass `undefined` from call sites that cannot
 *   `git commit` (e.g., supervisor's ceiling-hit write from outside the jail).
 */
export async function writeCheckpoint(
  statePath: string,
  state: VisionState,
  worktreeRoot?: string,
): Promise<void> {
  // PRIMARY: atomic JSON write (D-13 primary recovery path)
  await atomicWriteJson(statePath, state);

  // SECONDARY: git commit inside worktree (D-13 secondary recovery path, WRITE side)
  // The READ side (walking git log as fallback) is Phase 2 per D-16.
  if (worktreeRoot) {
    try {
      const add = execGit(worktreeRoot, ['add', '.planning/', 'vision-state.json']);
      if (add.exitCode !== 0) {
        console.error(`writeCheckpoint: git add failed (non-fatal): ${add.stderr}`);
        return;
      }
      const commit = execGit(worktreeRoot, [
        'commit',
        '--allow-empty',
        '-m',
        `checkpoint round ${state.round}`,
      ]);
      if (commit.exitCode !== 0) {
        console.error(`writeCheckpoint: git commit failed (non-fatal): ${commit.stderr}`);
      }
    } catch (err) {
      console.error(
        `writeCheckpoint: git secondary write threw (non-fatal): ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Read vision-state.json from disk, parse JSON, validate schema_version.
 * Returns null on file-missing, parse-failure, or schema_version !== 1.
 * Never throws — caller handles fallback to D-13 secondary (git log) path.
 */
export async function readCheckpoint(statePath: string): Promise<VisionState | null> {
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as { schema_version?: unknown };
  if (p.schema_version !== 1) return null;
  return parsed as VisionState;
}

/**
 * Validate the artifact manifest embedded in the state against on-disk files.
 * Delegates to validateManifest — pass-through of the structured mismatch result.
 *
 * @param state The VisionState containing artifact_manifest to validate
 * @param planningRoot Absolute path to the .planning/ directory
 */
export async function validateCheckpoint(
  state: VisionState,
  planningRoot: string,
): Promise<ValidationResult> {
  return validateManifest(planningRoot, state.artifact_manifest);
}
