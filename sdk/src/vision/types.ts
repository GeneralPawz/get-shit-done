/**
 * Canonical type definitions for the vision module.
 *
 * All downstream vision modules import interfaces from this single file.
 * No runtime code — interfaces and type unions only.
 * JSON-facing field names use snake_case.
 */

// ─── Session state ───────────────────────────────────────────────────────────

export type SessionStatus =
  | 'starting'
  | 'in-progress'
  | 'ceiling-hit'
  | 'converged'
  | 'aborted'
  | 'crashed'
  | 'complete';

export interface VisionState {
  schema_version: 1;
  session_id: string;
  direction: string;
  source_branch: string;
  source_head_sha: string;
  worktree_path: string;
  started_at: string;              // ISO 8601
  ceiling_at: string;              // ISO 8601
  status: SessionStatus;
  stop_reason: 'ceiling' | 'converged' | 'aborted' | 'crashed' | null;
  partial_results_available: boolean;
  round: number;
  round_results: unknown[];
  frontier: unknown[];
  decisions_log: unknown[];
  artifact_manifest: SHAManifestEntry[];
}

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface SHAManifestEntry {
  path: string;      // relative to <worktree>/.planning/
  sha256: string;    // 64-char lowercase hex
  bytes: number;
}

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      mismatches: Array<{
        path: string;
        reason: 'missing' | 'sha-mismatch' | 'size-mismatch';
        expected?: SHAManifestEntry;
        actual?: SHAManifestEntry;
      }>;
    };

// ─── Lock ────────────────────────────────────────────────────────────────────

export interface VisionLockPayload {
  pid: number;
  sid: string;
  started_at: string;
  worktree_path: string;
  direction: string;
}

// ─── Jail ────────────────────────────────────────────────────────────────────

export interface JailPolicy {
  worktreePath: string;            // absolute
  repoReadOnlyRoot: string;        // absolute
  sessionBinary: string;
  sessionArgs: string[];
  ceilingMs: number;
  envOverrides: Record<string, string>;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface SynthesisHook {
  onForcedStop(state: Readonly<VisionState>): Promise<void>;
}
