/**
 * SAFE-03 Allowlist loader + evaluator — unit tests.
 *
 * TDD: tests written BEFORE the implementation (RED gate).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Repo-relative path to the real allowlist, resolved via import.meta.url so the
// test works regardless of cwd (sdk/ or repo root). The relative depth:
//   sdk/src/vision/allowlist.test.ts  →  ../../../ is sdk/  →  ../../../.. is repo root
const REAL_ALLOWLIST_PATH = fileURLToPath(
  new URL('../../../../get-shit-done/references/vision-bash-allowlist.json', import.meta.url),
);

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-allowlist-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('loadAllowlist', () => {
  it('T1: loads and compiles the real allowlist file with >= 20 entries', async () => {
    const { loadAllowlist } = await import('./allowlist.js');
    const compiled = await loadAllowlist(REAL_ALLOWLIST_PATH);
    expect(compiled.entries.length).toBeGreaterThanOrEqual(20);
    for (const e of compiled.entries) expect(e.re).toBeInstanceOf(RegExp);
  });

  it('T2: throws on schema_version !== 1', async () => {
    const p = join(tmpDir, 'bad.json');
    await writeFile(p, JSON.stringify({ schema_version: 2, patterns: [] }));
    const { loadAllowlist } = await import('./allowlist.js');
    await expect(loadAllowlist(p)).rejects.toThrow(/unsupported allowlist schema/);
  });

  it('T3: throws on invalid regex pattern, message includes the offending pattern', async () => {
    const p = join(tmpDir, 'bad.json');
    await writeFile(
      p,
      JSON.stringify({
        schema_version: 1,
        patterns: [{ pattern: '[unclosed', description: 'x' }],
      }),
    );
    const { loadAllowlist } = await import('./allowlist.js');
    await expect(loadAllowlist(p)).rejects.toThrow(/invalid regex/);
  });
});

describe('evaluateBashCommand', () => {
  it('T4: allows tsc --noEmit (exact SAFE-03 entry)', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    const r = evaluateBashCommand(c, 'tsc --noEmit');
    expect(r.decision).toBe('allow');
    expect(r.matched_pattern).toBe('^tsc --noEmit( --\\S+)*$');
  });

  it('T5: denies rm -rf / (not in allowlist)', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    const r = evaluateBashCommand(c, 'rm -rf /');
    expect(r.decision).toBe('deny');
    expect(r.matched_pattern).toBeNull();
  });

  it('T6: denies semicolon injection (full-string anchored match)', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    const r = evaluateBashCommand(c, 'git status; rm -rf /');
    expect(r.decision).toBe('deny');
    expect(r.matched_pattern).toBeNull();
  });

  it('T7: allows gsd-sdk query state.load (D-12 read-only)', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    expect(evaluateBashCommand(c, 'gsd-sdk query state.load').decision).toBe('allow');
  });

  it('T8: denies gsd-sdk query state.update (mutating, not in allowlist)', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    const r = evaluateBashCommand(c, 'gsd-sdk query state.update');
    expect(r.decision).toBe('deny');
    expect(r.matched_pattern).toBeNull();
  });

  it('T9: invokes auditLog callback exactly once per call with the returned decision', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    const log = vi.fn();
    const d = evaluateBashCommand(c, 'tsc --noEmit', log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(d);
  });

  it('T10: decision ts is a valid ISO 8601 timestamp', async () => {
    const { loadAllowlist, evaluateBashCommand } = await import('./allowlist.js');
    const c = await loadAllowlist(REAL_ALLOWLIST_PATH);
    const d = evaluateBashCommand(c, 'tsc --noEmit');
    expect(Number.isNaN(new Date(d.ts).getTime())).toBe(false);
  });
});
