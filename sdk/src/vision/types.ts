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
  stop_reason: 'ceiling' | 'wall-clock-ceiling' | 'converged' | 'aborted' | 'crashed' | null;
  partial_results_available: boolean;
  round: number;
  round_results: RoundResult[];
  frontier: FrontierNode[];
  decisions_log: unknown[];
  artifact_manifest: SHAManifestEntry[];
}

// ─── Phase 2: Frontier and Round types ───────────────────────────────────────

/** D-01 FrontierNode status lifecycle. v1 greedy path only writes 'pending'→'explored'. */
export type FrontierNodeStatus = 'pending' | 'explored' | 'pruned';

/** D-01 — Frontier node shape. Greedy v1 actively writes topic/score; other fields are carry-along metadata for Phase 3 (multi-round) and Phase 4 (novelty). */
export interface FrontierNode {
  id: string;                   // ULID via mintSessionId() from ./id.ts
  topic: string;
  score: number;                // 0–1 rubric-weighted
  parent_round: number;         // round that generated this node; 0 = seed
  depth: number;                // 0 = seed tier, increments per round
  created_at: string;           // ISO 8601
  status: FrontierNodeStatus;
}

/** D-02 — Citation kinds emitted by researcher subagent; ties to grounding (Pitfall 4). */
export interface Citation {
  kind: 'file' | 'url' | 'doc-ref';
  ref: string;
  line?: number;
}

/** D-02 — Finding shape returned by each gsd-vision-researcher subagent. */
export interface Finding {
  topic_id: string;             // ULID — matches FrontierNode.id
  summary: string;
  citations: Citation[];
  confidence: number;           // 0–1
  surprises: string[];          // feeds Phase 4 NOVEL tagging (D-03)
  follow_up_questions: string[]; // source for next-round new_frontier_nodes
  tokens_estimated: number;
}

/** D-04 — per-round scoring metadata. selection_method is literal so schema stays forward-compat with Phase 3 multi-method selection. */
export interface RoundScores {
  selection_method: 'greedy-top-k';
  score_distribution: Array<{ id: string; score: number }>;
  selection_rationale: string[];  // D-16: one short sentence per pick
}

/** D-04 — per-topic error record; round still completes when a single researcher fails. */
export interface RoundError {
  topic_id: string;
  reason: string;
}

/** D-04 — full round record appended to VisionState.round_results[] after each round. */
export interface RoundResult {
  round: number;
  started_at: string;           // ISO 8601
  ended_at: string;             // ISO 8601
  direction_snapshot: string;   // verbatim VisionState.direction at round start (Pitfall 5 anchor)
  topics_selected: string[];    // FrontierNode ids picked this round
  findings: Finding[];
  new_frontier_nodes: FrontierNode[];  // may be empty — D-07 valid outcome
  scores: RoundScores;
  backtrack_flag: false;        // LITERAL false — LOOP-04 greedy invariant enforced at type level
  subagent_count: number;
  errors: RoundError[];
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
