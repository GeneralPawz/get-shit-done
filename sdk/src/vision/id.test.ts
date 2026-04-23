/**
 * Unit tests for mintSessionId — ULID monotonic session ID minter.
 */

import { describe, it, expect } from 'vitest';

// ─── mintSessionId ────────────────────────────────────────────────────────────

describe('mintSessionId', () => {
  it('returns a 26-char Crockford-base32 string', async () => {
    const { mintSessionId } = await import('./id.js');
    const id = mintSessionId();
    expect(id).toHaveLength(26);
    // Crockford base32: digits 0-9 plus A-Z excluding I, L, O, U
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('produces strictly lex-increasing IDs in a tight loop', async () => {
    const { mintSessionId } = await import('./id.js');
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids.push(mintSessionId());
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
  });
});
