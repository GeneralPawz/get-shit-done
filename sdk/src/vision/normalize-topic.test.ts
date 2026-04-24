/**
 * Unit tests for normalizeTopic — D-15 dedup normalizer.
 *
 * T1: identical outputs for case/whitespace/punctuation variants (SC1-UNIT-01)
 * T2: stopwords stripped
 * T3: single-char tokens dropped
 * T4: already-normalized input preserved
 * T5: empty string handled — never throws
 * T6: two truly different topics remain different after normalization (no false-positive dedup)
 */

import { describe, it, expect } from 'vitest';

describe('normalizeTopic', () => {
  it('T1: collapses case/whitespace/punctuation variants (SC1-UNIT-01)', async () => {
    const { normalizeTopic } = await import('./normalize-topic.js');
    expect(normalizeTopic("  How does Node.js async  work?"))
      .toBe(normalizeTopic("HOW does Node.js async work??"));
  });

  it('T2: strips stopwords', async () => {
    const { normalizeTopic } = await import('./normalize-topic.js');
    expect(normalizeTopic("The quick brown fox")).not.toContain("the");
    expect(normalizeTopic("The quick brown fox")).toContain("quick");
  });

  it('T3: drops single-char tokens', async () => {
    const { normalizeTopic } = await import('./normalize-topic.js');
    expect(normalizeTopic("a b c investigate")).toBe("investigate");
  });

  it('T4: preserves already-normalized input', async () => {
    const { normalizeTopic } = await import('./normalize-topic.js');
    expect(normalizeTopic("investigate caching strategies"))
      .toBe("investigate caching strategies");
  });

  it('T5: empty string returns empty string without throwing', async () => {
    const { normalizeTopic } = await import('./normalize-topic.js');
    expect(normalizeTopic("")).toBe("");
  });

  it('T6 (SC1-UNIT-04 precursor): semantically different topics stay different after normalize', async () => {
    const { normalizeTopic } = await import('./normalize-topic.js');
    expect(normalizeTopic("investigate caching strategies"))
      .not.toBe(normalizeTopic("investigate rate limiting"));
  });
});
