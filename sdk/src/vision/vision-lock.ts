/**
 * SAFE-06 PID-liveness concurrency lock for vision sessions.
 *
 * Enforces a single concurrent vision session per repo by using an
 * O_CREAT|O_EXCL atomic lockfile at `.planning/.vision.lock`.
 *
 * Key differences from acquireStateLock (state-mutation.ts):
 *  - Payload is JSON (VisionLockPayload), not a bare PID string — enables
 *    rich refuse message identifying holder (pid/sid/worktree).
 *  - Return type is 'acquired' | { refused: VisionLockPayload } — caller
 *    must handle both branches.
 *  - Held-set is _heldVisionLocks (separate from _heldStateLocks).
 *  - NO mtime-staleness fallback — vision sessions legitimately idle for
 *    hours (D-04 adaptation #5); rely on PID-liveness only.
 *  - Max 2 attempts total (one initial + one after auto-break on ESRCH).
 */

import { open, unlink, readFile } from 'node:fs/promises';
import { constants, unlinkSync } from 'node:fs';
import { GSDError, ErrorClassification } from '../errors.js';
import type { VisionLockPayload } from './types.js';

// ─── Held-lock registry + exit cleanup ───────────────────────────────────────

/**
 * Module-level set tracking held vision locks for process.on('exit') cleanup.
 * Exported for test access only.
 */
export const _heldVisionLocks = new Set<string>();

process.on('exit', () => {
  for (const lockPath of _heldVisionLocks) {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Check whether the process that holds the vision lock is dead.
 *
 * Returns:
 *  - `true`  — lock holder is dead (safe to auto-break)
 *  - `false` — lock holder is alive (must refuse)
 *  - `null`  — could not read lock file (caller treats as "can't determine")
 */
async function isHolderDead(lockPath: string): Promise<boolean | null> {
  try {
    const raw = await readFile(lockPath, 'utf-8');
    const payload: VisionLockPayload = JSON.parse(raw);
    if (!Number.isFinite(payload.pid) || payload.pid <= 0) return true;
    try {
      process.kill(payload.pid, 0);
      return false;
    } catch {
      // ESRCH — process does not exist
      return true;
    }
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Acquire the vision session lock at `lockPath`.
 *
 * Uses O_CREAT | constants.O_EXCL | constants.O_WRONLY for atomic creation.
 * On EEXIST: reads the existing lock's payload, checks PID liveness via
 * `process.kill(payload.pid, 0)`:
 *  - Alive → return `{ refused: existing }` immediately. Do NOT retry.
 *  - Dead (ESRCH) → unlink stale lock and retry once (max 2 attempts total).
 *
 * Throws GSDError on:
 *  - Non-EEXIST open error
 *  - Corrupt lock file (not valid JSON)
 *  - Unable to acquire after dead-PID auto-break retry
 *
 * @param lockPath - Absolute path to the lock file (e.g. `.planning/.vision.lock`)
 * @param payload  - Session metadata written into the lock file
 */
export async function acquireVisionLock(
  lockPath: string,
  payload: VisionLockPayload,
): Promise<'acquired' | { refused: VisionLockPayload }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await fd.writeFile(JSON.stringify(payload, null, 2));
      await fd.close();
      _heldVisionLocks.add(lockPath);
      return 'acquired';
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'EEXIST') {
        throw new GSDError(
          `vision lock open failed: ${(err as Error).message}`,
          ErrorClassification.Execution,
        );
      }

      // Lock file exists — read the holder's payload
      let existing: VisionLockPayload;
      try {
        existing = JSON.parse(await readFile(lockPath, 'utf-8'));
      } catch {
        throw new GSDError(
          'vision lock file corrupt — manually inspect ' + lockPath,
          ErrorClassification.Execution,
        );
      }

      const dead = await isHolderDead(lockPath);
      if (dead === true) {
        // Auto-break: holder is dead — remove stale lock and retry
        await unlink(lockPath).catch(() => {});
        continue;
      }

      // Belt check: PID alive but lock is impossibly old (> 10h hard cap).
      // Guards against PID recycling where a crashed session's PID was reused
      // by an unrelated process — the PID appears alive but the session is gone.
      // No vision session legitimately runs longer than MAX_SESSION_LIFETIME_MS.
      const MAX_SESSION_LIFETIME_MS = 10 * 60 * 60 * 1000; // 10h hard cap
      const lockAge = Date.now() - new Date(existing.started_at).getTime();
      if (dead === false && lockAge > MAX_SESSION_LIFETIME_MS) {
        // PID alive but session is impossibly old — treat as stale
        await unlink(lockPath).catch(() => {});
        continue;
      }

      // Holder is alive (or we can't determine) — refuse
      return { refused: existing };
    }
  }

  throw new GSDError(
    'vision lock: could not acquire after auto-break retry',
    ErrorClassification.Execution,
  );
}

/**
 * Release the vision session lock at `lockPath`.
 *
 * Removes the lock from the held-set and deletes the lockfile.
 * Errors from unlink are silently ignored (idempotent release).
 *
 * @param lockPath - Path to the lockfile (as returned by acquireVisionLock)
 */
export async function releaseVisionLock(lockPath: string): Promise<void> {
  _heldVisionLocks.delete(lockPath);
  await unlink(lockPath).catch(() => {});
}
