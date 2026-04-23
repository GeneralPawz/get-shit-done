/**
 * Unit tests for atomicWriteJson.
 *
 * Tests: valid JSON with trailing newline, overwrite, no tmp file leftover.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-atomic-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── atomicWriteJson ─────────────────────────────────────────────────────────

describe('atomicWriteJson', () => {
  it('writes valid JSON with trailing newline', async () => {
    const { atomicWriteJson } = await import('./atomic-write.js');
    const p = join(tmpDir, 'state.json');
    await atomicWriteJson(p, { a: 1, b: 'two' });
    const raw = await readFile(p, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ a: 1, b: 'two' });
  });

  it('overwrites cleanly on repeat write', async () => {
    const { atomicWriteJson } = await import('./atomic-write.js');
    const p = join(tmpDir, 'state.json');
    await atomicWriteJson(p, { version: 1 });
    await atomicWriteJson(p, { version: 2, extra: 'data' });
    const raw = await readFile(p, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ version: 2, extra: 'data' });
  });

  it('leaves no tmp file on disk after success', async () => {
    const { atomicWriteJson } = await import('./atomic-write.js');
    await atomicWriteJson(join(tmpDir, 'x.json'), { k: 'v' });
    const files = await readdir(tmpDir);
    expect(files.filter(f => f.includes('.tmp.'))).toEqual([]);
  });

  it('concurrent writes from different logic paths do not corrupt', async () => {
    const { atomicWriteJson } = await import('./atomic-write.js');
    const p = join(tmpDir, 'concurrent.json');
    // Two concurrent writes — last-write-wins, but content should not be corrupt
    await Promise.all([
      atomicWriteJson(p, { writer: 'A', value: 1 }),
      atomicWriteJson(p, { writer: 'B', value: 2 }),
    ]);
    const raw = await readFile(p, 'utf-8');
    // File must be valid JSON (not corrupted)
    const parsed = JSON.parse(raw);
    expect(['A', 'B']).toContain(parsed.writer);
  });
});
