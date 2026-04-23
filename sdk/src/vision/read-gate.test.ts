/**
 * Unit tests for read-gate: gateReadPath + VisionPathEscapeError.
 *
 * D-09 layer (f) — Node-runtime symlink realpath gate.
 * Four canonical cases + edge cases per 01-08-PLAN.md §behavior.
 *
 * TDD: tests written RED-first before implementation exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, symlink, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;       // the worktree root for the test
let tmpReal: string;      // its realpath (macOS/WSL may introduce /private/var etc.)

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-gate-'));
  tmpReal = await realpath(tmpDir);
  // Seed a file and an inside-symlink for T2/T3
  await writeFile(join(tmpDir, 'seed.txt'), 'seed\n');
  await symlink(join(tmpReal, 'seed.txt'), join(tmpDir, 'inside-link'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── gateReadPath ─────────────────────────────────────────────────────────────

describe('gateReadPath', () => {
  it('T1: allows a dangling path inside the worktree', async () => {
    const { gateReadPath } = await import('./read-gate.js');
    const result = await gateReadPath('.planning/drafts/x.md', tmpDir);
    expect(result.startsWith(tmpReal)).toBe(true);
  });

  it('T2: returns realpath for an existing file inside the worktree', async () => {
    const { gateReadPath } = await import('./read-gate.js');
    const result = await gateReadPath('seed.txt', tmpDir);
    expect(result).toBe(join(tmpReal, 'seed.txt'));
  });

  it('T3: allows a symlink that resolves INSIDE the worktree', async () => {
    const { gateReadPath } = await import('./read-gate.js');
    const result = await gateReadPath('inside-link', tmpDir);
    expect(result).toBe(join(tmpReal, 'seed.txt'));
  });

  it('T4: refuses a symlink pointing OUTSIDE the worktree', async () => {
    const { gateReadPath, VisionPathEscapeError } = await import('./read-gate.js');
    await symlink('/etc/hostname', join(tmpDir, 'bad-link'));
    let caught: unknown;
    try {
      await gateReadPath('bad-link', tmpDir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VisionPathEscapeError);
    if (caught instanceof VisionPathEscapeError) {
      expect(caught.attempted).toBe('bad-link');
      expect(caught.worktreeReal).toBe(tmpReal);
      expect(caught.name).toBe('VisionPathEscapeError');
    }
  });

  it('T5: refuses `..`-escape from a relative path', async () => {
    const { gateReadPath, VisionPathEscapeError } = await import('./read-gate.js');
    await expect(gateReadPath('../outside-file', tmpDir)).rejects.toBeInstanceOf(VisionPathEscapeError);
  });

  it('T6: refuses an absolute path outside the worktree', async () => {
    const { gateReadPath, VisionPathEscapeError } = await import('./read-gate.js');
    await expect(gateReadPath('/etc/hostname', tmpDir)).rejects.toBeInstanceOf(VisionPathEscapeError);
  });

  it('T7: allows an absolute path inside the worktree', async () => {
    const { gateReadPath } = await import('./read-gate.js');
    await mkdir(join(tmpDir, '.planning/drafts'), { recursive: true });
    const abs = join(tmpDir, '.planning/drafts/x.md');
    const result = await gateReadPath(abs, tmpDir);
    expect(result.startsWith(tmpReal)).toBe(true);
  });

  it('T8: refuses when worktree root itself is missing', async () => {
    const { gateReadPath, VisionPathEscapeError } = await import('./read-gate.js');
    await expect(
      gateReadPath('x.md', '/nonexistent/worktree-doesnt-exist-xyz'),
    ).rejects.toBeInstanceOf(VisionPathEscapeError);
  });

  it('T9: error has stable name for session-spawn dispatch', async () => {
    const { gateReadPath, VisionPathEscapeError } = await import('./read-gate.js');
    let caught: unknown;
    try {
      await gateReadPath('/etc/hostname', tmpDir);
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof VisionPathEscapeError).toBe(true);
    expect((caught as Error).name).toBe('VisionPathEscapeError');
  });
});
