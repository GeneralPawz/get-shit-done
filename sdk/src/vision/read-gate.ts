/**
 * D-09 layer (f) symlink realpath gate on the Read-tool path.
 *
 * Adapted from sdk/src/query/helpers.ts:resolvePathUnderProject (L442-455).
 * Vision-scoped: operates on the session worktree root, throws a distinct
 * error class (VisionPathEscapeError) so session-spawn can catch it as a
 * SECURITY event (audit-logged, abort-triggering), not an IO failure.
 *
 * Per RESEARCH.md L88 Architectural Responsibility Map:
 *   Filesystem path gating | Primary: Node runtime (realpath check)
 *                          | Secondary: bwrap mount topology
 *
 * This module is the primary. bwrap (Plan 01-07) is the structural backstop.
 * Both layers must hold; D-09 ("All six. Partial safety is worse than no
 * safety.") forbids shipping without either one.
 *
 * Called by: sdk/src/vision/session-spawn.ts — wraps every fs read/write path
 * attempt so paths are canonicalised + verified BEFORE bwrap is invoked.
 */

import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';

// ─── Error class ─────────────────────────────────────────────────────────────

/**
 * Thrown when a session-supplied path resolves outside the session's worktree.
 *
 * Extends Error (not GSDError) so session-spawn can catch this class
 * specifically as a SECURITY event — distinct from ordinary IO failures —
 * and write an audit entry before re-throwing / aborting the session.
 *
 * The `name` field is stable ('VisionPathEscapeError') for catch-block
 * dispatch without importing the class.
 */
export class VisionPathEscapeError extends Error {
  readonly attempted: string;
  readonly resolvedUnder: string | null;
  readonly worktreeReal: string;

  constructor(opts: {
    attempted: string;
    resolvedUnder: string | null;
    worktreeReal: string;
    cause?: unknown;
  }) {
    super(
      `vision path escape: attempted='${opts.attempted}' resolvedUnder='${opts.resolvedUnder ?? '<unresolvable>'}' worktree='${opts.worktreeReal}'`,
    );
    this.name = 'VisionPathEscapeError';
    this.attempted = opts.attempted;
    this.resolvedUnder = opts.resolvedUnder;
    this.worktreeReal = opts.worktreeReal;
    if (opts.cause !== undefined) {
      // Preserve the original cause for forensic logging in session-spawn
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

// ─── Gate function ───────────────────────────────────────────────────────────

/**
 * Realpath the worktree root and the candidate path; refuse if the candidate
 * resolves outside the worktree. Dangling paths (ENOENT during realpath) are
 * allowed — caller may be about to create the file. The `..`-traversal check
 * still fires because we compute `relative(worktreeReal, normalizedCandidate)`.
 *
 * Three-step algorithm (mirrors resolvePathUnderProject in helpers.ts):
 *   1. realpath(worktreeRoot) → worktreeReal (fail-closed: missing worktree throws)
 *   2. realpath(candidate) → realCandidate (ENOENT: fall through to raw normalized candidate)
 *   3. relative(worktreeReal, realCandidate).startsWith('..') || isAbsolute(rel) → refuse
 *
 * @param rawPath Absolute or relative path the session wants to access
 * @param worktreeRoot The session's worktree root (must exist)
 * @returns The canonical resolved path, guaranteed to be under worktreeRoot
 * @throws VisionPathEscapeError if the path escapes or worktreeRoot is missing
 */
export async function gateReadPath(rawPath: string, worktreeRoot: string): Promise<string> {
  // Step 1: realpath the worktree root. If the worktree is missing, fail closed.
  let worktreeReal: string;
  try {
    worktreeReal = await realpath(worktreeRoot);
  } catch (err) {
    throw new VisionPathEscapeError({
      attempted: rawPath,
      resolvedUnder: null,
      worktreeReal: worktreeRoot,
      cause: err,
    });
  }

  // Step 2: Construct the candidate path, then realpath it.
  const candidate = isAbsolute(rawPath) ? normalize(rawPath) : resolve(worktreeReal, rawPath);
  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch {
    // Dangling or not-yet-created path — fall through to the raw normalized candidate.
    // The relative-path check below still catches `..`-escapes via resolve().
    // Additionally, walk up to the nearest existing ancestor and verify it is
    // inside the worktree. This closes the gap where a symlink *parent directory*
    // (e.g., worktree/.planning/ → /tmp/outside/) would pass the relative check
    // on the dangling candidate string but write outside the worktree on creation.
    let ancestor = candidate;
    let ancestorReal: string | null = null;
    while (ancestor !== dirname(ancestor)) {
      ancestor = dirname(ancestor);
      try {
        ancestorReal = await realpath(ancestor);
        break;
      } catch {
        /* continue walking up */
      }
    }
    if (ancestorReal !== null) {
      const ancestorRel = relative(worktreeReal, ancestorReal);
      if (ancestorRel.startsWith('..') || isAbsolute(ancestorRel)) {
        throw new VisionPathEscapeError({
          attempted: rawPath,
          resolvedUnder: candidate,
          worktreeReal,
        });
      }
    }
    realCandidate = candidate;
  }

  // Step 3: Relative check. If the path escapes the worktree, refuse it.
  const rel = relative(worktreeReal, realCandidate);
  if (rel.startsWith('..') || (isAbsolute(rel) && rel.length > 0)) {
    throw new VisionPathEscapeError({
      attempted: rawPath,
      resolvedUnder: realCandidate,
      worktreeReal,
    });
  }

  return realCandidate;
}
