/**
 * STOP-01 Node supervisor — lives OUTSIDE the bwrap jail.
 *
 * Owns:
 *   - setTimeout(ceilingMs) ceiling timer
 *   - SIGTERM → 60s grace → SIGKILL signal ladder (STOP-01/STOP-02)
 *   - Final vision-state.json write on ceiling fire (belt-and-suspenders for
 *     SIGKILL path where ForcedStopStub did not complete — D-07 idempotent)
 *   - process.on('SIGINT'/'SIGTERM') forwarding to child
 *   - uncaughtException hardening (Pitfall A mitigation)
 *
 * Per D-05: this process must survive the child's SIGKILL so it can commit
 * the final checkpoint. Per Pitfall A (bubblewrap issue #529), --unshare-pid
 * + --die-with-parent (set by bwrap-compose.ts) propagate SIGKILL into the
 * jail if the supervisor dies unexpectedly.
 *
 * Signal ladder on ceiling fire:
 *   1. setTimeout(ceilingMs) fires  → child.kill('SIGTERM'), record sigtermSentAt
 *   2. setTimeout(GRACE_MS) starts  → if child not dead: child.kill('SIGKILL'), record sigkillSentAt
 *   3. child 'exit' event fires     → clearTimeout both timers
 *   4. If ceilingFired:             → read checkpoint; belt-write if stub did not complete
 *   5. Return SessionResult
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { composeBwrapArgv } from './bwrap-compose.js';
import { readCheckpoint } from './vision-state.js';
import { atomicWriteJson } from './atomic-write.js';
import { GSDError, ErrorClassification } from '../errors.js';
import type { JailPolicy, VisionState, StopEvidence } from './types.js';

// ─── Re-entrancy guard ────────────────────────────────────────────────────────
//
// superviseSession registers process-level SIGINT/SIGTERM/uncaughtException
// handlers. Concurrent calls from the same process would stack handlers,
// causing the second call's forwardTerm to fire on signals intended only for
// the first session's child. Reject concurrent calls at the entry point.
let _activeSession = false;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SessionResult {
  exit_code: number;
  ceiling_fired: boolean;
  sigterm_sent_at: string | null;
  sigkill_sent_at: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** D-06: 60 seconds between SIGTERM and SIGKILL. */
const GRACE_MS = 60_000;

// ─── Supervisor ───────────────────────────────────────────────────────────────

/**
 * Run a jailed session under bwrap and supervise it with the STOP-01 signal
 * ladder. Resolves when the child exits (either naturally or via signal).
 *
 * @param policy              JailPolicy describing the bwrap invocation
 * @param ceilingMs           Wall-clock ceiling in milliseconds (D-08)
 * @param visionStatePath     Absolute path to vision-state.json for belt state write
 * @param sessionProvenance   Optional: session identity fields used in the fallback
 *                            minimal state when vision-state.json is absent or corrupt
 *                            at ceiling time. Without this the fallback uses 'UNKNOWN'
 *                            for session_id and empty strings for branch/sha, making the
 *                            wake-up flow unable to correlate the result with any session.
 */
export async function superviseSession(
  policy: JailPolicy,
  ceilingMs: number,
  visionStatePath: string,
  sessionProvenance?: { sid: string; sourceBranch: string; sourceHeadSha: string },
): Promise<SessionResult> {
  // Re-entrancy guard: process-level signal handlers must not be stacked.
  // Two concurrent superviseSession calls would each register forwardTerm,
  // causing the second session's Ctrl-C to also signal the first session's
  // child (or an already-exited child). Reject concurrent entry.
  if (_activeSession) {
    throw new GSDError(
      'superviseSession: re-entrant call detected — only one vision session may run per process',
      ErrorClassification.Execution,
    );
  }
  _activeSession = true;

  // Build argv from the pure composer and spawn the child.
  // NOT detached — supervisor owns the process group for signal delivery.
  const argv = composeBwrapArgv(policy);
  const child: ChildProcess = spawn('bwrap', argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: policy.envOverrides,
    // NOT detached — supervisor owns the process group per RESEARCH.md §Code Examples
  });

  let ceilingFired = false;
  let sigtermSentAt: string | null = null;
  let sigkillSentAt: string | null = null;
  let graceTimer: NodeJS.Timeout | null = null;

  // ─── Ceiling timer (STOP-01) ──────────────────────────────────────────────

  const ceilingTimer = setTimeout(() => {
    ceilingFired = true;
    sigtermSentAt = new Date().toISOString();
    try {
      child.kill('SIGTERM');
    } catch {
      /* child already exited — no-op */
    }

    // Arm 60s grace → SIGKILL (STOP-02, D-06)
    graceTimer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        sigkillSentAt = new Date().toISOString();
        try {
          child.kill('SIGKILL');
        } catch {
          /* child already exited — no-op */
        }
      }
    }, GRACE_MS);
  }, ceilingMs);

  // ─── Signal forwarding (SIGINT/SIGTERM → child SIGTERM) ───────────────────

  const forwardTerm = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* child already exited — no-op */
    }
  };
  process.on('SIGINT', forwardTerm);
  process.on('SIGTERM', forwardTerm);

  // ─── uncaughtException hardening (Pitfall A mitigation) ──────────────────
  //
  // If the supervisor crashes, send SIGTERM to the child before the process
  // exits. The --die-with-parent + --unshare-pid flags in the jail propagate
  // SIGKILL into the bwrap namespace, so the child cannot outlive us.

  const crashHandler = (err: Error) => {
    console.error('VISION_SUPERVISOR_CRASH', err);
    try {
      child.kill('SIGTERM');
    } catch {
      /* best effort — child may already be gone */
    }

    // Phase 3 D-17 (crashed terminal path): best-effort write of stop_evidence.last_caught_error.
    // Fire-and-forget — Node's default uncaughtException behavior terminates the process
    // after this handler returns, which races with the I/O completing. Best-effort by design.
    // ALL file I/O wrapped in .catch(() => {}) so the handler never throws.
    (async () => {
      try {
        const prev = await readCheckpoint(visionStatePath);
        if (!prev) return;                              // no source state — nothing meaningful to write
        const crashedState: VisionState = {
          ...prev,
          status: 'crashed',
          stop_reason: 'crashed',
          partial_results_available: prev.round > 0 || prev.round_results.length > 0,
          stop_evidence: {
            ...reconstructStopEvidenceFromState(prev, null),
            reason: 'uncaught-exception',
            last_caught_error: { message: err.message, stack: err.stack },
          },
        };
        await atomicWriteJson(visionStatePath, crashedState);
      } catch {
        /* best effort — never throw inside uncaughtException; --die-with-parent
           propagates SIGKILL into the jail anyway, so we won't leak processes */
      }
    })().catch(() => {});

    // After this handler returns, Node's default uncaughtException behavior
    // terminates the process, which triggers --die-with-parent in the jail.
  };
  process.on('uncaughtException', crashHandler);

  // ─── Await child exit ─────────────────────────────────────────────────────

  const exitCode: number = await new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      // signal-terminated child reports code === null; map to conventional exit codes:
      //   SIGTERM (15) → 128 + 15 = 143
      //   SIGKILL  (9) → 128 +  9 = 137
      //   other signal → 1 (generic error)
      if (code !== null) {
        resolve(code);
      } else if (signal === 'SIGTERM') {
        resolve(143);
      } else if (signal === 'SIGKILL') {
        resolve(137);
      } else {
        resolve(1);
      }
    });
  });

  // ─── Clean up timers and handlers ────────────────────────────────────────

  clearTimeout(ceilingTimer);
  if (graceTimer !== null) clearTimeout(graceTimer);
  process.off('SIGINT', forwardTerm);
  process.off('SIGTERM', forwardTerm);
  process.off('uncaughtException', crashHandler);
  _activeSession = false; // clear re-entrancy guard — next call may proceed

  // ─── Ceiling-hit belt state write (D-07 belt-and-suspenders) ─────────────
  //
  // Per D-07: Phase 1 ForcedStopStub (forced-stop.ts) ALREADY wrote
  // status='ceiling-hit' + stop_reason='wall-clock-ceiling' during the SIGTERM
  // grace window (from inside the jail). This post-exit write is BELT-AND-
  // SUSPENDERS for the SIGKILL path where the stub never ran (child was
  // unresponsive to SIGTERM).
  //
  // Idempotent: read current state first. If stub already wrote 'ceiling-hit',
  // skip the write (no-op). If not, write the ceiling-hit state from outside
  // the jail via atomicWriteJson (not writeCheckpoint — the worktree git
  // secondary is owned by the session, not the supervisor).

  if (ceilingFired) {
    const prev = await readCheckpoint(visionStatePath);

    // D-13 stub-completeness contract (RESEARCH Risk Note 4): skip ONLY when the
    // stub wrote BOTH status='ceiling-hit' AND a populated stop_evidence. The
    // presence of stop_evidence is the marker that the stub completed its richer
    // write (PLAN 04). If somehow status was set without stop_evidence (defense in
    // depth — atomic-write should make this impossible), the supervisor still does
    // its fallback write to fill the evidence.
    if (prev?.status === 'ceiling-hit' && prev.stop_evidence != null) {
      // ForcedStopStub succeeded during the grace window. State is already durable
      // and complete. Supervisor is a no-op on this path.
    } else {
      // Stub did not complete (SIGKILL path) or file is absent/corrupt or stop_evidence missing.
      // Write belt state from outside the jail.
      const ceilingHitState: VisionState = prev
        ? {
            ...prev,
            status: 'ceiling-hit',
            stop_reason: 'ceiling',
            partial_results_available: prev.round > 0 || prev.round_results.length > 0,
            // Phase 3 D-13: minimal stop_evidence reconstructed from supervisor-side state.
            // Prefer whatever the stub may have partially written; else reconstruct.
            stop_evidence: prev.stop_evidence ?? reconstructStopEvidenceFromState(prev, ceilingMs),
          }
        : ({
            // Fallback minimal state when vision-state.json is absent or corrupt.
            schema_version: 1,
            session_id: sessionProvenance?.sid ?? 'UNKNOWN',
            direction: '',
            source_branch: sessionProvenance?.sourceBranch ?? '',
            source_head_sha: sessionProvenance?.sourceHeadSha ?? '',
            worktree_path: policy.worktreePath,
            started_at: new Date().toISOString(),
            ceiling_at: new Date().toISOString(),
            status: 'ceiling-hit',
            stop_reason: 'ceiling',
            partial_results_available: false,
            round: 0,
            round_results: [],
            frontier: [],
            decisions_log: [],
            artifact_manifest: [],
            stop_evidence: null,                                  // no source state to reconstruct from
          } as VisionState);

      // Write via atomicWriteJson directly — the supervisor is OUTSIDE the jail
      // so it cannot rely on writeCheckpoint's worktreeRoot git-commit secondary.
      // The JSON primary write is the durable artifact; git secondary is owned
      // by the session process inside the jail.
      await atomicWriteJson(visionStatePath, ceilingHitState);
    }
  }

  return {
    exit_code: exitCode,
    ceiling_fired: ceilingFired,
    sigterm_sent_at: sigtermSentAt,
    sigkill_sent_at: sigkillSentAt,
  };
}

// ─── Stop-evidence reconstruction (D-13 supervisor fallback) ─────────────────

/**
 * Reconstruct a minimal StopEvidence from outside the jail when the
 * ForcedStopStub did not complete its inside-jail write (SIGKILL fast path).
 *
 * Best-effort: convergence_history may be empty if prev had no stop_evidence
 * (pre-Phase-3 state files, or sessions that died before the loop wrote any
 * verdict). RESEARCH Open Q5 — initial stop_evidence is null until first
 * verdict; older state files may legitimately have no history at ceiling time.
 *
 * `ceilingMs` is `number | null` so Task 2 (crashed path) can pass `null` —
 * a crash is not ceiling-related.
 */
function reconstructStopEvidenceFromState(prev: VisionState, ceilingMs: number | null): StopEvidence {
  return {
    stopped_at: new Date().toISOString(),
    final_round: prev.round,
    final_frontier_pending_count: prev.frontier.filter(n => n.status === 'pending').length,
    convergence_history: prev.stop_evidence?.convergence_history ?? [],
    convergence_snapshot: prev.stop_evidence?.convergence_snapshot ?? null,
    ceiling_ms_elapsed: ceilingMs,
    drift_error_count: prev.round_results
      .flatMap(r => r.errors)
      .filter(e => e.reason === 'direction-snapshot-drift').length,
    reason: null,
    last_caught_error: null,
  };
}
