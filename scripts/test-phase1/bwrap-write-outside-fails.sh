#!/usr/bin/env bash
# SAFE-02 layer (a) + SAFE-03 bwrap structural boundary harness.
#
# Spawns bwrap with the canonical Phase 1 flag set and asserts:
#   CASE 1: write to /etc/hostname (outside the RW-bound worktree) fails
#   CASE 2: HOME inside the jail is the overridden path, not the user's real home
#   CASE 3: write to worktree SUCCEEDS (positive control — boundary allows RW in WT)
#
# This is a falsifiable proof of SAFE-02 layer (a) and SAFE-03 backstop at
# the kernel level, independent of prompt-layer settings.json Deny rules.
#
# Exit codes:
#   0  — all cases pass
#   1  — a boundary assertion failed (SECURITY: investigate immediately)
#   2  — bwrap not installed (run Plan 01-01 preflight)

set -euo pipefail

command -v bwrap >/dev/null 2>&1 || {
  echo "bwrap not installed — run Plan 01-01 preflight to install bubblewrap"
  exit 2
}

TMP=$(mktemp -d /tmp/gsd-bwrap-harness-XXXX)
trap 'rm -rf "$TMP"' EXIT

WT="$TMP/wt"
REPO="$TMP/repo"
mkdir -p "$WT/.home" "$WT/.cache" "$WT/.config" "$WT/.local/share" "$REPO"

# ─── CASE 1: write to /etc must fail (RO mount) ───────────────────────────────
echo "--- CASE 1: write to /etc/hostname must be rejected by kernel ---"
set +e
bwrap \
  --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup \
  --share-net \
  --clearenv \
  --setenv HOME "$WT/.home" \
  --setenv XDG_CACHE_HOME "$WT/.cache" \
  --setenv XDG_CONFIG_HOME "$WT/.config" \
  --setenv XDG_DATA_HOME "$WT/.local/share" \
  --setenv PATH '/usr/local/bin:/usr/bin:/bin' \
  --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /bin /bin --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --ro-bind "$REPO" "$REPO" \
  --bind "$WT" "$WT" \
  --proc /proc --dev /dev --tmpfs /tmp \
  --die-with-parent --new-session \
  --chdir "$WT" \
  /bin/sh -c 'echo pwned > /etc/hostname 2>&1'
RC=$?
set -e

if [ "$RC" -eq 0 ]; then
  echo "FAIL: write to /etc/hostname succeeded inside jail (BOUNDARY BROKEN)"
  exit 1
fi
echo "OK: write to /etc/hostname blocked (rc=$RC)"

# ─── CASE 2: HOME is the overridden path (D-02 HOME/XDG scoping) ─────────────
echo "--- CASE 2: HOME inside jail must be the overridden worktree path ---"
HOME_SEEN=$(bwrap \
  --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup \
  --share-net --clearenv \
  --setenv HOME "$WT/.home" \
  --setenv PATH '/usr/local/bin:/usr/bin:/bin' \
  --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /bin /bin --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --bind "$WT" "$WT" \
  --proc /proc --dev /dev --tmpfs /tmp \
  --die-with-parent --new-session --chdir "$WT" \
  /bin/sh -c 'echo $HOME')

if [ "$HOME_SEEN" != "$WT/.home" ]; then
  echo "FAIL: HOME inside jail is '$HOME_SEEN', expected '$WT/.home'"
  exit 1
fi
echo "OK: HOME inside jail is '$HOME_SEEN'"

# ─── CASE 3: write to worktree SUCCEEDS (positive control) ───────────────────
echo "--- CASE 3: write to worktree must succeed (RW bind) ---"
bwrap \
  --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup \
  --share-net --clearenv \
  --setenv HOME "$WT/.home" \
  --setenv PATH '/usr/local/bin:/usr/bin:/bin' \
  --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /bin /bin --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --bind "$WT" "$WT" \
  --proc /proc --dev /dev --tmpfs /tmp \
  --die-with-parent --new-session --chdir "$WT" \
  /bin/sh -c "echo written > '$WT/probe.txt'"

if ! test -f "$WT/probe.txt"; then
  echo "FAIL: probe.txt was not created in worktree"
  exit 1
fi
if ! grep -q '^written$' "$WT/probe.txt"; then
  echo "FAIL: probe.txt does not contain expected content"
  exit 1
fi
echo "OK: write to worktree succeeded (content verified)"

echo "--- ALL JAIL BOUNDARY TESTS PASS ---"
exit 0
