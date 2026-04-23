import { describe, it, expect } from 'vitest';
import { composeBwrapArgv, buildJailEnvOverrides } from './bwrap-compose.js';
import type { JailPolicy } from './types.js';

const samplePolicy = (): JailPolicy => ({
  worktreePath: '/tmp/wt',
  repoReadOnlyRoot: '/tmp/repo',
  sessionBinary: '/usr/bin/node',
  sessionArgs: ['session-entry.js'],
  ceilingMs: 60_000,
  envOverrides: buildJailEnvOverrides('/tmp/wt'),
});

describe('composeBwrapArgv', () => {
  it('T1: contains --unshare-pid AND --die-with-parent (Pitfall A mitigation)', () => {
    const a = composeBwrapArgv(samplePolicy());
    expect(a).toContain('--unshare-pid');
    expect(a).toContain('--die-with-parent');
  });

  it('T2: contains the other namespace flags', () => {
    const a = composeBwrapArgv(samplePolicy());
    for (const f of ['--unshare-user', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup']) {
      expect(a).toContain(f);
    }
  });

  it('T3: shares network (not unshared) — --share-net present, --unshare-net absent', () => {
    const a = composeBwrapArgv(samplePolicy());
    expect(a).toContain('--share-net');
    expect(a).not.toContain('--unshare-net');
  });

  it('T4: contains --clearenv and --new-session', () => {
    const a = composeBwrapArgv(samplePolicy());
    expect(a).toContain('--clearenv');
    expect(a).toContain('--new-session');
  });

  it('T5: ro-binds the repo root as three consecutive items', () => {
    const p = samplePolicy();
    const a = composeBwrapArgv(p);
    let found = false;
    for (let j = 0; j < a.length - 2; j++) {
      if (a[j] === '--ro-bind' && a[j + 1] === p.repoReadOnlyRoot && a[j + 2] === p.repoReadOnlyRoot) {
        found = true;
        break;
      }
    }
    expect(found, '--ro-bind for repo root not found as three consecutive items').toBe(true);
  });

  it('T6: rw-binds the worktree as three consecutive items', () => {
    const p = samplePolicy();
    const a = composeBwrapArgv(p);
    let found = false;
    for (let j = 0; j < a.length - 2; j++) {
      if (a[j] === '--bind' && a[j + 1] === p.worktreePath && a[j + 2] === p.worktreePath) {
        found = true;
        break;
      }
    }
    expect(found, '--bind for worktree not found as three consecutive items').toBe(true);
  });

  it('T7: --chdir followed by worktreePath as two consecutive items', () => {
    const p = samplePolicy();
    const a = composeBwrapArgv(p);
    const i = a.indexOf('--chdir');
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe(p.worktreePath);
  });

  it('T8: sets HOME via --setenv as three consecutive items', () => {
    const p = samplePolicy();
    const a = composeBwrapArgv(p);
    let found = false;
    for (let j = 0; j < a.length - 2; j++) {
      if (a[j] === '--setenv' && a[j + 1] === 'HOME' && a[j + 2] === '/tmp/wt/.home') {
        found = true;
        break;
      }
    }
    expect(found, '--setenv HOME /tmp/wt/.home not found as three consecutive items').toBe(true);
  });

  it('T9: command elements are the last items in argv', () => {
    const p = samplePolicy();
    const a = composeBwrapArgv(p);
    // sessionBinary is second-to-last, sessionArgs[0] is last
    expect(a[a.length - 2]).toBe(p.sessionBinary);
    expect(a[a.length - 1]).toBe(p.sessionArgs[0]);
  });

  it('T10: contains --new-session', () => {
    const a = composeBwrapArgv(samplePolicy());
    expect(a).toContain('--new-session');
  });

  it('T11 (smoke): multiple sessionArgs appear in order at end of argv', () => {
    const p = samplePolicy();
    // Override sessionArgs with multiple items
    const p2: JailPolicy = { ...p, sessionArgs: ['--require', 'ts-node/register', 'entry.ts'] };
    const a = composeBwrapArgv(p2);
    const lastIdx = a.length - 1;
    expect(a[lastIdx]).toBe('entry.ts');
    expect(a[lastIdx - 1]).toBe('ts-node/register');
    expect(a[lastIdx - 2]).toBe('--require');
    expect(a[lastIdx - 3]).toBe(p2.sessionBinary);
  });
});

describe('buildJailEnvOverrides', () => {
  it('T11: sets HOME and XDG_* under worktree/.home/.cache/.config/.local/share plus PATH', () => {
    const e = buildJailEnvOverrides('/tmp/wt');
    expect(e.HOME).toBe('/tmp/wt/.home');
    expect(e.XDG_CACHE_HOME).toBe('/tmp/wt/.cache');
    expect(e.XDG_CONFIG_HOME).toBe('/tmp/wt/.config');
    expect(e.XDG_DATA_HOME).toBe('/tmp/wt/.local/share');
    expect(e.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
  });
});
