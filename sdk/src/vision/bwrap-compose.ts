/**
 * Pure bwrap argv composition + HOME/XDG env override builder.
 *
 * Composition rules (per RESEARCH.md §Pattern 2 + bwrap(1) manpage):
 *   - Namespaces unshared: user, pid, ipc, uts, cgroup.
 *   - Network shared (WebFetch/WebSearch needed — --share-net, NOT --unshare-net).
 *   - Env cleared + per-var setenv (D-02 HOME/XDG override).
 *   - /usr /etc /bin /lib read-only; /lib64 try; repo root read-only;
 *     worktree read-write; /proc /dev /tmpfs /tmp standard.
 *   - --unshare-pid MUST accompany --die-with-parent (Pitfall A:
 *     bubblewrap issue #529 — death propagation requires pid ns).
 *   - --new-session: clean terminal signal delivery.
 *
 * No runtime I/O here — function is a pure transform. Unit-testable without
 * a filesystem or spawned process.
 */

import type { JailPolicy } from './types.js';

/**
 * Build the HOME/XDG env override map for D-02.
 *
 * Keys: HOME, XDG_CACHE_HOME, XDG_CONFIG_HOME, XDG_DATA_HOME (all under
 * the worktree), PATH (minimal shell path), and ANTHROPIC_API_KEY if present
 * in the host environment (session needs API access per RESEARCH.md Security
 * Domain: "ANTHROPIC_API_KEY injected by Claude Code runtime post-spawn").
 *
 * Exported so session-spawn.ts can call it independently.
 */
export function buildJailEnvOverrides(worktreePath: string): Record<string, string> {
  const env: Record<string, string> = {
    HOME: `${worktreePath}/.home`,
    XDG_CACHE_HOME: `${worktreePath}/.cache`,
    XDG_CONFIG_HOME: `${worktreePath}/.config`,
    XDG_DATA_HOME: `${worktreePath}/.local/share`,
    PATH: '/usr/local/bin:/usr/bin:/bin',
  };
  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  return env;
}

/**
 * Pure bwrap argv builder. Returns the full argv array in canonical order.
 *
 * CRITICAL (Pitfall A — bubblewrap issue #529):
 *   --unshare-pid AND --die-with-parent MUST appear together, unconditionally.
 *   Without --unshare-pid, --die-with-parent's death propagation does not work.
 *
 * Network:
 *   --share-net is explicit for auditability. DO NOT add --unshare-net —
 *   network access is required for WebFetch/WebSearch inside the session.
 *
 * @param p JailPolicy — worktreePath, repoReadOnlyRoot, sessionBinary,
 *           sessionArgs, ceilingMs, envOverrides
 * @returns Full argv array for `spawn('bwrap', argv, ...)`
 */
export function composeBwrapArgv(p: JailPolicy): string[] {
  // Build --setenv entries from the env override map (D-02)
  const envPairs = Object.entries(p.envOverrides).flatMap(([k, v]) => ['--setenv', k, v]);

  return [
    // --- Namespace isolation (Pitfall A: --unshare-pid MUST accompany --die-with-parent) ---
    '--unshare-user',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup',
    '--share-net',             // explicit for auditability; NOT --unshare-net

    // --- Env scoping (D-02 full HOME/XDG override) ---
    '--clearenv',
    ...envPairs,

    // --- Filesystem mounts ---
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',   // optional on ARM/some distros
    '--ro-bind', p.repoReadOnlyRoot, p.repoReadOnlyRoot,
    '--bind', p.worktreePath, p.worktreePath,
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',

    // --- Lifecycle flags ---
    '--die-with-parent',       // propagates SIGKILL into jail on supervisor exit
    '--new-session',           // clean terminal signal delivery
    '--chdir', p.worktreePath, // working directory inside the jail

    // --- Command (MUST be last) ---
    p.sessionBinary,
    ...p.sessionArgs,
  ];
}
