/**
 * RoundResult and FrontierNode shape logic — parsing, building, selection.
 *
 * Owns (pure functions, zero I/O):
 *   - parseRoundResult()      — strip markdown fences, JSON.parse, shape-check (Pitfall 5)
 *   - selectTopK()            — greedy top-K from pending frontier (D-14 + D-12 cap)
 *   - deduplicateFrontier()   — D-15 dedup-at-append, keep higher score, merge parent_round
 *   - buildRoundResult()      — constructor that hard-codes backtrack_flag: false (LOOP-04)
 *   - markExplored()          — flip picked nodes' status to 'explored'
 *
 * No I/O — sdk/src/vision/vision-state.ts owns all persistence (D-06: supervisor-only writes).
 */

import type {
  FrontierNode,
  RoundResult,
  Finding,
  RoundScores,
  RoundError,
} from './types.js';
import { normalizeTopic } from './normalize-topic.js';

// ─── parseRoundResult ─────────────────────────────────────────────────────────

/**
 * Parse the Explorer's final assistant-message string into a RoundResult.
 *
 * Strips ```json / ``` markdown fences (Pitfall 5 — models frequently wrap JSON
 * in fences even when instructed not to). Returns null on any failure; never
 * throws. Caller records a minimal error round in vision-state.json.
 *
 * Shape check: requires `backtrack_flag: boolean` AND non-empty `direction_snapshot: string`.
 * Empty `findings: []` and `new_frontier_nodes: []` are accepted (D-07 empty-frontier outcome).
 */
export function parseRoundResult(raw: string): RoundResult | null {
  const jsonStr = raw
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (p.backtrack_flag !== false) return null;
  if (typeof p.direction_snapshot !== 'string' || p.direction_snapshot.length === 0) return null;
  return parsed as RoundResult;
}

// ─── selectTopK ───────────────────────────────────────────────────────────────

/**
 * Select up to K highest-scored PENDING frontier nodes (D-14 greedy top-K).
 * Ties stable-FIFO (Array.prototype.sort is stable in V8 / Node ≥ 20).
 * Caller must pass k ≤ 5 to honor D-12 concurrency cap.
 */
export function selectTopK(frontier: FrontierNode[], k: number): FrontierNode[] {
  if (k <= 0) return [];
  return frontier
    .filter(n => n.status === 'pending')
    .slice() // defensive copy before sort (sort mutates)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ─── deduplicateFrontier ──────────────────────────────────────────────────────

/**
 * D-15 dedup-at-append. Given the existing frontier and a batch of incoming
 * nodes, return a new frontier array where duplicates (same normalizeTopic(topic))
 * are resolved by keeping the HIGHER-scored entry and setting that entry's
 * parent_round to the EARLIER of the two (so Phase 3 backtrack can trace origin).
 *
 * Tie-break: when next.score === prev.score, the existing entry is kept (ULID/id
 * stability — the older ULID is preserved so callers can rely on id not changing
 * after a tie-scored re-discovery of the same topic).
 *
 * Non-matching incoming nodes are appended as-is.
 * Pure: neither input array is mutated.
 */
export function deduplicateFrontier(
  existing: FrontierNode[],
  incoming: FrontierNode[],
): FrontierNode[] {
  const result: FrontierNode[] = existing.map(n => ({ ...n }));
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    indexByKey.set(normalizeTopic(result[i].topic), i);
  }
  for (const next of incoming) {
    const key = normalizeTopic(next.topic);
    const existingIdx = indexByKey.get(key);
    if (existingIdx === undefined) {
      result.push({ ...next });
      indexByKey.set(key, result.length - 1);
      continue;
    }
    const prev = result[existingIdx];
    // Keep the higher score; merge parent_round to the earliest occurrence.
    const merged: FrontierNode = {
      ...(next.score > prev.score ? next : prev),
      parent_round: Math.min(prev.parent_round, next.parent_round),
    };
    result[existingIdx] = merged;
  }
  return result;
}

// ─── buildRoundResult ─────────────────────────────────────────────────────────

/**
 * Construct a RoundResult. backtrack_flag is HARD-CODED false (LOOP-04 invariant)
 * — no caller can forget or override. selection_method is HARD-CODED 'greedy-top-k'.
 */
export function buildRoundResult(fields: {
  round: number;
  startedAt: string;
  endedAt: string;
  directionSnapshot: string;
  topicsSelected: string[];
  findings: Finding[];
  newFrontierNodes: FrontierNode[];
  scores: Omit<RoundScores, 'selection_method'>;
  subagentCount: number;
  errors: RoundError[];
}): RoundResult {
  return {
    round: fields.round,
    started_at: fields.startedAt,
    ended_at: fields.endedAt,
    direction_snapshot: fields.directionSnapshot,
    topics_selected: fields.topicsSelected,
    findings: fields.findings,
    new_frontier_nodes: fields.newFrontierNodes,
    scores: {
      selection_method: 'greedy-top-k',
      score_distribution: fields.scores.score_distribution,
      selection_rationale: fields.scores.selection_rationale,
    },
    backtrack_flag: false,
    subagent_count: fields.subagentCount,
    errors: fields.errors,
  };
}

// ─── markExplored ─────────────────────────────────────────────────────────────

/**
 * Return a new frontier array with the status of nodes in pickedIds flipped
 * from 'pending' to 'explored'. Non-picked nodes are unchanged.
 * Pure — input array not mutated.
 */
export function markExplored(
  frontier: FrontierNode[],
  pickedIds: string[],
): FrontierNode[] {
  const pickedSet = new Set(pickedIds);
  return frontier.map(n =>
    pickedSet.has(n.id) && n.status === 'pending'
      ? { ...n, status: 'explored' as const }
      : n,
  );
}
