/**
 * Unit tests for seedFromDirection — deterministic-fallback path only.
 * The LLM path is exercised at Plan 05 integration-test time (real SDK + network).
 *
 * Test IDs map to 02-RESEARCH.md §Validation Architecture:
 *   SC1-UNIT-02  — seedFromDirection with useLLM:false returns 3–5 FrontierNodes with ULID ids + score 0.5
 */

import { describe, it, expect } from 'vitest';
import type { FrontierNode } from './types.js';

// 26-char Crockford base32 (digits + uppercase letters minus I, L, O, U)
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('seedFromDirection (deterministic fallback)', () => {
  it('SC1-UNIT-02: returns 3–5 FrontierNodes with valid ULID ids and score 0.5', async () => {
    const { seedFromDirection } = await import('./seed-frontier.js');
    const nodes = await seedFromDirection({
      direction: 'how should the umbrella routing layer work in GSD v2',
      useLLM: false,
    });
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.length).toBeLessThanOrEqual(5);
    for (const n of nodes) {
      expect(n.id).toMatch(ULID_RE);
      expect(n.score).toBe(0.5);
      expect(n.status).toBe('pending');
      expect(n.parent_round).toBe(0);
      expect(n.depth).toBe(0);
      expect(typeof n.topic).toBe('string');
      expect(n.topic.length).toBeGreaterThan(0);
      expect(typeof n.created_at).toBe('string');
      expect(() => new Date(n.created_at)).not.toThrow();
    }
  });

  it('handles empty direction (pads from GENERIC list to ≥3 nodes)', async () => {
    const { seedFromDirection } = await import('./seed-frontier.js');
    const nodes = await seedFromDirection({ direction: '', useLLM: false });
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.length).toBeLessThanOrEqual(5);
    for (const n of nodes) {
      expect(n.id).toMatch(ULID_RE);
      expect(n.score).toBe(0.5);
    }
  });

  it('handles very short direction (single word)', async () => {
    const { seedFromDirection } = await import('./seed-frontier.js');
    const nodes = await seedFromDirection({ direction: 'caching', useLLM: false });
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.length).toBeLessThanOrEqual(5);
  });

  it('deterministic topics: same input produces same topics array', async () => {
    const { seedFromDirection } = await import('./seed-frontier.js');
    const a = await seedFromDirection({ direction: 'test direction alpha beta', useLLM: false });
    const b = await seedFromDirection({ direction: 'test direction alpha beta', useLLM: false });
    // IDs and created_at may differ (ULID monotonic, clock moves) — topics MUST be identical.
    expect(a.map(n => n.topic)).toEqual(b.map(n => n.topic));
    expect(a.map(n => n.score)).toEqual(b.map(n => n.score));
  });

  it('no-LLM path never invokes network (deterministic signature)', async () => {
    // Behavioral proxy: completes in well under 100ms for typical inputs. The deterministic
    // path is a few string ops; a network call would take >100ms on any real machine.
    const { seedFromDirection } = await import('./seed-frontier.js');
    const t0 = performance.now();
    await seedFromDirection({ direction: 'any direction string', useLLM: false });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });

  it('returns unique topics (dedup within fallback output)', async () => {
    const { seedFromDirection } = await import('./seed-frontier.js');
    const nodes: FrontierNode[] = await seedFromDirection({
      direction: 'caching caching caching strategy strategy',
      useLLM: false,
    });
    const topics = nodes.map(n => n.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });
});
