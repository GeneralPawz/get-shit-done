/**
 * Unit tests for sha-manifest: hashFile, buildManifest, validateManifest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-manifest-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── hashFile ─────────────────────────────────────────────────────────────────

describe('hashFile', () => {
  it('returns correct SHA-256 for a known file', async () => {
    const { hashFile } = await import('./sha-manifest.js');
    const content = 'hello';
    const filePath = join(tmpDir, 'test.txt');
    await writeFile(filePath, content, 'utf-8');
    const expected = createHash('sha256').update(content).digest('hex');
    const entry = await hashFile(filePath, 'test.txt');
    expect(entry.sha256).toBe(expected);
    expect(entry.path).toBe('test.txt');
    expect(entry.bytes).toBe(Buffer.byteLength(content));
  });
});

// ─── buildManifest ────────────────────────────────────────────────────────────

describe('buildManifest', () => {
  it('returns entries for files and excludes selfExcludeName', async () => {
    const { buildManifest } = await import('./sha-manifest.js');
    await writeFile(join(tmpDir, 'file-a.txt'), 'aaa');
    await writeFile(join(tmpDir, 'file-b.txt'), 'bbb');
    await writeFile(join(tmpDir, 'file-c.txt'), 'ccc');
    // excluded
    await writeFile(join(tmpDir, 'vision-state.json'), '{}');

    const entries = await buildManifest(tmpDir, 'vision-state.json');
    const names = entries.map(e => e.path);
    expect(names).toContain('file-a.txt');
    expect(names).toContain('file-b.txt');
    expect(names).toContain('file-c.txt');
    expect(names).not.toContain('vision-state.json');
    expect(entries).toHaveLength(3);
  });
});

// ─── validateManifest ────────────────────────────────────────────────────────

describe('validateManifest', () => {
  it('returns ok:true on a freshly built manifest', async () => {
    const { buildManifest, validateManifest } = await import('./sha-manifest.js');
    await writeFile(join(tmpDir, 'a.txt'), 'alpha');
    await writeFile(join(tmpDir, 'b.txt'), 'beta');
    const manifest = await buildManifest(tmpDir);
    const result = await validateManifest(tmpDir, manifest);
    expect(result.ok).toBe(true);
  });

  it('detects sha-mismatch when a byte is flipped', async () => {
    const { buildManifest, validateManifest } = await import('./sha-manifest.js');
    const filePath = join(tmpDir, 'tampered.txt');
    await writeFile(filePath, 'original content');
    const manifest = await buildManifest(tmpDir);

    // Flip content without changing size
    const originalContent = await readFile(filePath, 'utf-8');
    const flipped = originalContent.replace('o', 'O');
    await writeFile(filePath, flipped, 'utf-8');

    const result = await validateManifest(tmpDir, manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0].reason).toBe('sha-mismatch');
      expect(result.mismatches[0].expected).toBeDefined();
      expect(result.mismatches[0].actual).toBeDefined();
    }
  });

  it('detects size-mismatch when file is truncated to 0 bytes', async () => {
    const { buildManifest, validateManifest } = await import('./sha-manifest.js');
    const filePath = join(tmpDir, 'truncated.txt');
    await writeFile(filePath, 'some content here');
    const manifest = await buildManifest(tmpDir);

    // Truncate to 0 bytes
    await truncate(filePath, 0);

    const result = await validateManifest(tmpDir, manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches).toHaveLength(1);
      // Must report size-mismatch, not sha-mismatch (size check runs first)
      expect(result.mismatches[0].reason).toBe('size-mismatch');
    }
  });

  it('detects missing file', async () => {
    const { buildManifest, validateManifest } = await import('./sha-manifest.js');
    const filePath = join(tmpDir, 'will-be-deleted.txt');
    await writeFile(filePath, 'some data');
    const manifest = await buildManifest(tmpDir);

    // Delete the file
    await rm(filePath);

    const result = await validateManifest(tmpDir, manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0].reason).toBe('missing');
    }
  });
});
