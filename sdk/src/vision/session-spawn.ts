/**
 * Thin child_process.spawn wrapper that launches bwrap with the composed
 * argv and the D-02 env map. The supervisor (supervisor.ts) wires timers
 * and signal forwarders on top of the returned ChildProcess.
 *
 * NOT detached — supervisor must own the process group for signal delivery.
 * stdio: ['ignore', 'pipe', 'pipe'] — stdin closed, stdout/stderr piped for
 * audit log capture.
 *
 * D-09 layer (f) integration: this module wraps gateReadPath (from read-gate.ts,
 * Plan 01-08) into readInSession — the canonical fs-read entry point for the
 * session's Node runtime. Any symlink or `..`-escape is caught BEFORE bwrap is
 * invoked. VisionPathEscapeError is re-thrown so the supervisor can dispatch
 * it as a security event (abort + audit log) rather than an ordinary IO error.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import type { JailPolicy } from './types.js';
import { composeBwrapArgv } from './bwrap-compose.js';
import { gateReadPath, VisionPathEscapeError } from './read-gate.js';

// Re-export for downstream ergonomic imports (D-09 layer (f) single entry point)
export { gateReadPath, VisionPathEscapeError } from './read-gate.js';

/**
 * Spawn bwrap with the composed argv from composeBwrapArgv(policy).
 *
 * Returns the ChildProcess handle. Supervisor wires its own:
 *   - setTimeout(ceilingMs) → SIGTERM ladder
 *   - process.on('SIGINT'/'SIGTERM') forwarding
 *   - uncaughtException handler
 *
 * NOT detached — supervisor owns the process group per RESEARCH.md §Code Examples.
 * env is set explicitly to policy.envOverrides (full override, not overlay, per
 * claude-agent-sdk 0.2.113+ env-replacement semantics — RESEARCH.md §Resolved Blocker 2).
 */
export function spawnJailedSession(policy: JailPolicy): ChildProcess {
  const argv = composeBwrapArgv(policy);
  return spawn('bwrap', argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: policy.envOverrides,
    // NOT detached — supervisor owns the process group for signal delivery
  });
}

/**
 * Canonical fs-read entry point for the session runtime (D-09 layer (f)).
 *
 * Gates the path via read-gate.ts BEFORE reading from disk:
 *   1. realpath(worktreeRoot) — fail-closed if worktree missing
 *   2. realpath(rawPath) — ENOENT falls through to raw normalized candidate
 *   3. relative(worktreeReal, realCandidate).startsWith('..') → refuse
 *
 * VisionPathEscapeError is re-thrown — caller (supervisor) catches and treats
 * it as a SECURITY event: writes audit log entry, aborts session.
 *
 * @param rawPath     Absolute or relative path the session wants to read
 * @param worktreeRoot The session's worktree root (must exist)
 * @throws VisionPathEscapeError if rawPath escapes the worktree boundary
 */
export async function readInSession(rawPath: string, worktreeRoot: string): Promise<string> {
  // May throw VisionPathEscapeError — re-thrown to caller for security dispatch
  const canonicalPath = await gateReadPath(rawPath, worktreeRoot);

  // Open the file and re-verify via fd-level realpath to close the TOCTOU window.
  // /proc/self/fd/<fd> gives the kernel-resolved path for the open file descriptor
  // (Linux / WSL2 specific — documented dependency per CR-02 fix).
  const fh = await open(canonicalPath, 'r');
  try {
    const fdPath = `/proc/self/fd/${fh.fd}`;
    const fdResolved = await realpath(fdPath);
    const worktreeReal = await realpath(worktreeRoot);
    const rel = relative(worktreeReal, fdResolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new VisionPathEscapeError({
        attempted: rawPath,
        resolvedUnder: fdResolved,
        worktreeReal,
      });
    }
    return await fh.readFile('utf-8');
  } finally {
    await fh.close();
  }
}
