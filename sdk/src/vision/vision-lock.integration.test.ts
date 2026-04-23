import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-lock-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

const payloadOf = (pid: number, sid = 'TEST') => ({
  pid,
  sid,
  started_at: new Date().toISOString(),
  worktree_path: '/tmp/wt',
  direction: 'test',
});

describe('acquireVisionLock', () => {
  it('first acquire returns "acquired"', async () => {
    const { acquireVisionLock, releaseVisionLock } = await import('./vision-lock.js');
    const lockPath = join(tmpDir, '.vision.lock');
    const res = await acquireVisionLock(lockPath, payloadOf(process.pid));
    expect(res).toBe('acquired');
    await releaseVisionLock(lockPath);
  });

  it('second acquire while holder alive returns {refused}', async () => {
    const { acquireVisionLock, releaseVisionLock } = await import('./vision-lock.js');
    const lockPath = join(tmpDir, '.vision.lock');
    await acquireVisionLock(lockPath, payloadOf(process.pid, 'SID-A'));
    const res = await acquireVisionLock(lockPath, payloadOf(process.pid, 'SID-B'));
    expect(res).not.toBe('acquired');
    if (res !== 'acquired') expect(res.refused.sid).toBe('SID-A');
    await releaseVisionLock(lockPath);
  });

  it('auto-breaks lock held by dead pid', async () => {
    const { acquireVisionLock, releaseVisionLock } = await import('./vision-lock.js');
    const lockPath = join(tmpDir, '.vision.lock');
    // Write a lock file with a definitely-dead pid (99999999 — unlikely to be live)
    await writeFile(lockPath, JSON.stringify(payloadOf(99999999, 'DEAD'), null, 2));
    const res = await acquireVisionLock(lockPath, payloadOf(process.pid, 'LIVE'));
    expect(res).toBe('acquired');
    const raw = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(raw.sid).toBe('LIVE');
    await releaseVisionLock(lockPath);
  });

  it('throws GSDError on corrupted lock file', async () => {
    const { acquireVisionLock } = await import('./vision-lock.js');
    const lockPath = join(tmpDir, '.vision.lock');
    await writeFile(lockPath, '{not valid json');
    await expect(acquireVisionLock(lockPath, payloadOf(process.pid))).rejects.toThrow(/corrupt/);
  });
});
