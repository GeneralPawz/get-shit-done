import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';

// Repo root is three directories up from sdk/src/vision/
// sdk/src/vision -> sdk/src -> sdk -> repo-root
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-settings-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('writeSettingsLocal', () => {
  it('creates .claude/settings.local.json with worktree token substituted', async () => {
    const { writeSettingsLocal } = await import('./settings-local.js');
    const result = await writeSettingsLocal(tmpDir, '/repo-root', REPO_ROOT);

    // Check the returned settingsPath is within the worktree
    expect(result.settingsPath).toBe(join(tmpDir, '.claude', 'settings.local.json'));

    // Read and parse the written file
    const raw = await readFile(result.settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // The worktree allow entry should be substituted
    const allowList: string[] = parsed.permissions.allow;
    expect(allowList.some((a: string) => a.includes(`${tmpDir}/.planning/drafts/**`))).toBe(true);

    // No literal <WORKTREE> token should remain
    expect(raw).not.toContain('<WORKTREE>');

    // Returned SHA256 is a 64-char lowercase hex string
    expect(result.settingsSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('substitutes new path on second call (no stale cache)', async () => {
    const { writeSettingsLocal } = await import('./settings-local.js');

    const dir1 = await mkdtemp(join(tmpdir(), 'gsd-vision-settings-1-'));
    const dir2 = await mkdtemp(join(tmpdir(), 'gsd-vision-settings-2-'));

    try {
      const r1 = await writeSettingsLocal(dir1, '/repo-root', REPO_ROOT);
      const r2 = await writeSettingsLocal(dir2, '/repo-root', REPO_ROOT);

      const content1 = await readFile(r1.settingsPath, 'utf-8');
      const content2 = await readFile(r2.settingsPath, 'utf-8');

      // Each file should have its own worktree path, not the other's
      expect(content1).toContain(dir1);
      expect(content1).not.toContain(dir2);
      expect(content2).toContain(dir2);
      expect(content2).not.toContain(dir1);
    } finally {
      await rm(dir1, { recursive: true, force: true });
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it('throws GSDError with "template missing" when template file does not exist', async () => {
    const { writeSettingsLocal } = await import('./settings-local.js');
    const badRepoRoot = join(tmpDir, 'nonexistent-repo');

    await expect(
      writeSettingsLocal(tmpDir, '/repo-root', badRepoRoot),
    ).rejects.toThrow(GSDError);

    await expect(
      writeSettingsLocal(tmpDir, '/repo-root', badRepoRoot),
    ).rejects.toThrow(/template missing/);
  });
});
