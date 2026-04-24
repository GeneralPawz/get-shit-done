/**
 * Unit tests for round-result helpers.
 *
 * Test IDs map to 02-RESEARCH.md §Validation Architecture:
 *   SC1-UNIT-03  — buildRoundResult returns matching RoundResult shape
 *   SC1-UNIT-04  — deduplicateFrontier keeps higher-scored duplicate
 *   SC4-UNIT-01  — selectTopK top-K with ties stable-FIFO
 *   SC4-UNIT-02  — backtrack_flag === false (type-level + runtime assertion)
 *   SCHEMA-01    — parseRoundResult rejects missing backtrack_flag
 *   SCHEMA-02    — parseRoundResult rejects empty direction_snapshot
 *   SCHEMA-03    — parseRoundResult accepts empty findings / new_frontier_nodes (D-07)
 *   CAP-01       — selectTopK(frontier, 5) with 10 pending returns exactly 5
 *   CAP-02       — selectTopK caps at k, never exceeds
 *   PARSE-FENCE  — parseRoundResult strips ```json``` markdown fences (Pitfall 5)
 *   DEDUP-MERGE  — deduplicateFrontier sets parent_round to Math.min of the two (D-15)
 *   MARK-EXPL    — markExplored flips status 'pending'→'explored' only for picked ids
 */

import { describe, it, expect } from 'vitest';
import type { FrontierNode } from './types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<FrontierNode> = {}): FrontierNode {
  return {
    id: 'TESTID000000000000000000A',
    topic: 'default topic',
    score: 0.5,
    parent_round: 0,
    depth: 0,
    created_at: '2026-04-24T00:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

function validRoundResultJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    round: 1,
    started_at: '2026-04-24T00:00:00Z',
    ended_at: '2026-04-24T00:01:00Z',
    direction_snapshot: 'test direction',
    topics_selected: ['TESTID000000000000000000A'],
    findings: [],
    new_frontier_nodes: [],
    scores: {
      selection_method: 'greedy-top-k',
      score_distribution: [{ id: 'TESTID000000000000000000A', score: 0.8 }],
      selection_rationale: ["picked 'x' because score 0.80, top of 1 pending"],
    },
    backtrack_flag: false,
    subagent_count: 1,
    errors: [],
    ...overrides,
  });
}

// ─── parseRoundResult ─────────────────────────────────────────────────────────

describe('parseRoundResult', () => {
  it('SC1-UNIT-03 / SCHEMA-03: accepts valid JSON with empty findings and new_frontier_nodes (D-07 valid empty round)', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    const r = parseRoundResult(validRoundResultJson());
    expect(r).not.toBeNull();
    expect(r!.backtrack_flag).toBe(false);
    expect(r!.findings).toEqual([]);
    expect(r!.new_frontier_nodes).toEqual([]);
  });

  it('PARSE-FENCE: strips ```json markdown fences (Pitfall 5)', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    const fenced = '```json\n' + validRoundResultJson() + '\n```';
    expect(parseRoundResult(fenced)).not.toBeNull();
  });

  it('PARSE-FENCE: strips bare ``` markdown fences', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    const fenced = '```\n' + validRoundResultJson() + '\n```';
    expect(parseRoundResult(fenced)).not.toBeNull();
  });

  it('SCHEMA-01: returns null on missing backtrack_flag', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    const parsed = JSON.parse(validRoundResultJson());
    delete parsed.backtrack_flag;
    expect(parseRoundResult(JSON.stringify(parsed))).toBeNull();
  });

  it('SCHEMA-02: returns null on empty direction_snapshot', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    expect(parseRoundResult(validRoundResultJson({ direction_snapshot: '' }))).toBeNull();
  });

  it('SCHEMA-02b: returns null on non-string direction_snapshot', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    expect(parseRoundResult(validRoundResultJson({ direction_snapshot: 42 }))).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    const { parseRoundResult } = await import('./round-result.js');
    expect(parseRoundResult('{ not json')).toBeNull();
    expect(parseRoundResult('')).toBeNull();
    expect(parseRoundResult('null')).toBeNull();
    expect(parseRoundResult('"a string"')).toBeNull();
  });
});

// ─── selectTopK ───────────────────────────────────────────────────────────────

describe('selectTopK', () => {
  it('SC4-UNIT-01 / CAP-01: returns exactly 5 highest-scored pending nodes from 10', async () => {
    const { selectTopK } = await import('./round-result.js');
    const nodes: FrontierNode[] = Array.from({ length: 10 }, (_, i) =>
      makeNode({ id: `N${String(i).padStart(25, '0')}`, topic: `t${i}`, score: i / 10 }),
    );
    const picked = selectTopK(nodes, 5);
    expect(picked).toHaveLength(5);
    const scores = picked.map(n => n.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a)); // descending
    expect(scores[0]).toBe(0.9);
    expect(scores[4]).toBe(0.5);
  });

  it('CAP-02: never returns more than k', async () => {
    const { selectTopK } = await import('./round-result.js');
    const nodes: FrontierNode[] = Array.from({ length: 3 }, (_, i) =>
      makeNode({ id: `N${String(i).padStart(25, '0')}`, score: 0.5 }),
    );
    expect(selectTopK(nodes, 5)).toHaveLength(3); // all 3 returned; k=5 not exceeded
    expect(selectTopK(nodes, 2)).toHaveLength(2); // capped at k=2
    expect(selectTopK(nodes, 0)).toHaveLength(0);
  });

  it('skips non-pending nodes (explored / pruned)', async () => {
    const { selectTopK } = await import('./round-result.js');
    const nodes: FrontierNode[] = [
      makeNode({ id: 'P0000000000000000000000000', score: 0.9, status: 'pending' }),
      makeNode({ id: 'E0000000000000000000000000', score: 1.0, status: 'explored' }),
      makeNode({ id: 'X0000000000000000000000000', score: 0.99, status: 'pruned' }),
    ];
    const picked = selectTopK(nodes, 5);
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe('P0000000000000000000000000');
  });

  it('ties broken stable-FIFO (LOOP-04 greedy invariant)', async () => {
    const { selectTopK } = await import('./round-result.js');
    const nodes: FrontierNode[] = [
      makeNode({ id: 'A0000000000000000000000000', score: 0.5, topic: 'first' }),
      makeNode({ id: 'B0000000000000000000000000', score: 0.5, topic: 'second' }),
      makeNode({ id: 'C0000000000000000000000000', score: 0.5, topic: 'third' }),
    ];
    const picked = selectTopK(nodes, 2);
    expect(picked.map(n => n.id)).toEqual([
      'A0000000000000000000000000',
      'B0000000000000000000000000',
    ]);
  });

  it('does not mutate input array', async () => {
    const { selectTopK } = await import('./round-result.js');
    const nodes: FrontierNode[] = [
      makeNode({ id: 'A0000000000000000000000000', score: 0.2 }),
      makeNode({ id: 'B0000000000000000000000000', score: 0.9 }),
    ];
    const order = nodes.map(n => n.id).join(',');
    selectTopK(nodes, 2);
    expect(nodes.map(n => n.id).join(',')).toBe(order);
  });
});

// ─── deduplicateFrontier ──────────────────────────────────────────────────────

describe('deduplicateFrontier', () => {
  it('SC1-UNIT-04: keeps the higher-scored duplicate when normalized topics match', async () => {
    const { deduplicateFrontier } = await import('./round-result.js');
    const existing = [makeNode({ id: 'OLD000000000000000000000AA', topic: 'how does caching work?', score: 0.5, parent_round: 1 })];
    const incoming = [makeNode({ id: 'NEW000000000000000000000BB', topic: 'How Does CACHING Work??', score: 0.9, parent_round: 2 })];
    const merged = deduplicateFrontier(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
  });

  it('DEDUP-MERGE (D-15): parent_round on merged entry is Math.min of the two', async () => {
    const { deduplicateFrontier } = await import('./round-result.js');
    const existing = [makeNode({ id: 'OLD000000000000000000000AA', topic: 'x', score: 0.5, parent_round: 3 })];
    const incoming = [makeNode({ id: 'NEW000000000000000000000BB', topic: 'x', score: 0.9, parent_round: 1 })];
    const merged = deduplicateFrontier(existing, incoming);
    expect(merged[0].parent_round).toBe(1); // earliest wins even though higher-score is the incoming
  });

  it('appends non-matching topics as new entries', async () => {
    const { deduplicateFrontier } = await import('./round-result.js');
    const existing = [makeNode({ id: 'A0000000000000000000000000', topic: 'caching' })];
    const incoming = [makeNode({ id: 'B0000000000000000000000000', topic: 'rate limiting' })];
    const merged = deduplicateFrontier(existing, incoming);
    expect(merged).toHaveLength(2);
  });

  it('idempotent on empty incoming', async () => {
    const { deduplicateFrontier } = await import('./round-result.js');
    const existing = [makeNode({ id: 'A0000000000000000000000000', topic: 'x' })];
    expect(deduplicateFrontier(existing, [])).toEqual(existing);
  });

  it('does not mutate input arrays', async () => {
    const { deduplicateFrontier } = await import('./round-result.js');
    const existing = [makeNode({ id: 'A0000000000000000000000000', topic: 'x', score: 0.5 })];
    const incoming = [makeNode({ id: 'B0000000000000000000000000', topic: 'x', score: 0.9 })];
    const existingCopy = JSON.parse(JSON.stringify(existing));
    const incomingCopy = JSON.parse(JSON.stringify(incoming));
    deduplicateFrontier(existing, incoming);
    expect(existing).toEqual(existingCopy);
    expect(incoming).toEqual(incomingCopy);
  });
});

// ─── buildRoundResult ─────────────────────────────────────────────────────────

describe('buildRoundResult', () => {
  it('SC4-UNIT-02: backtrack_flag is hard-coded false (LOOP-04 invariant)', async () => {
    const { buildRoundResult } = await import('./round-result.js');
    const r = buildRoundResult({
      round: 1, startedAt: 's', endedAt: 'e', directionSnapshot: 'd',
      topicsSelected: [], findings: [], newFrontierNodes: [],
      scores: { score_distribution: [], selection_rationale: [] },
      subagentCount: 0, errors: [],
    });
    expect(r.backtrack_flag).toBe(false);
  });

  it('hard-codes scores.selection_method to greedy-top-k', async () => {
    const { buildRoundResult } = await import('./round-result.js');
    const r = buildRoundResult({
      round: 1, startedAt: 's', endedAt: 'e', directionSnapshot: 'd',
      topicsSelected: [], findings: [], newFrontierNodes: [],
      scores: { score_distribution: [], selection_rationale: [] },
      subagentCount: 0, errors: [],
    });
    expect(r.scores.selection_method).toBe('greedy-top-k');
  });
});

// ─── markExplored ─────────────────────────────────────────────────────────────

describe('markExplored', () => {
  it('MARK-EXPL: flips picked pending nodes to explored; leaves others unchanged', async () => {
    const { markExplored } = await import('./round-result.js');
    const frontier: FrontierNode[] = [
      makeNode({ id: 'A0000000000000000000000000', status: 'pending' }),
      makeNode({ id: 'B0000000000000000000000000', status: 'pending' }),
      makeNode({ id: 'C0000000000000000000000000', status: 'pending' }),
    ];
    const next = markExplored(frontier, ['A0000000000000000000000000', 'C0000000000000000000000000']);
    expect(next.find(n => n.id === 'A0000000000000000000000000')!.status).toBe('explored');
    expect(next.find(n => n.id === 'B0000000000000000000000000')!.status).toBe('pending');
    expect(next.find(n => n.id === 'C0000000000000000000000000')!.status).toBe('explored');
  });

  it('does not mutate input array', async () => {
    const { markExplored } = await import('./round-result.js');
    const frontier: FrontierNode[] = [makeNode({ id: 'A0000000000000000000000000', status: 'pending' })];
    markExplored(frontier, ['A0000000000000000000000000']);
    expect(frontier[0].status).toBe('pending');
  });
});
