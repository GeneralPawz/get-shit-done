#!/usr/bin/env bash
# SAFE-04 diff-assertion integration harness.
#
# Creates a throwaway repo, makes a vision worktree, writes an OUT-OF-BOUNDS file
# inside the worktree, then asserts teardown aborts with quarantine + VISION-ABORT-{sid}.md.
# Also tests the clean path: in-bounds changes are promoted and the worktree is removed.
#
# Usage: bash scripts/test-phase1/diff-assertion-fires.sh
# Expected exit: 0 on success (the assertion correctly fired); non-zero means the gate leaked.
#
# Section markers used by acceptance-criteria grep:
#--- CASE 1: dirty diff (should quarantine) ---
#--- CASE 2: clean diff (should promote) ---
#
# Requirements:
#   - node (>= 18)
#   - git
#   - sdk must be buildable via: cd sdk && npm run build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Pre-flight: verify required tools
command -v node >/dev/null 2>&1 || { echo "FAIL: node not found in PATH"; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "FAIL: git not found in PATH"; exit 1; }

# Build sdk/dist/ — driver.mjs imports from compiled JS
echo "--- Building sdk ---"
(cd "$REPO_ROOT/sdk" && npm run build --silent) || { echo "FAIL: sdk build failed"; exit 1; }
echo "--- sdk build OK ---"

TMP_PARENT=$(mktemp -d /tmp/gsd-vision-harness-XXXX)
trap 'rm -rf "$TMP_PARENT"' EXIT

REPO="$TMP_PARENT/repo"
mkdir -p "$REPO"
cd "$REPO"
git init -q -b main
git config user.email 'harness@test'
git config user.name 'Harness'
echo seed > seed.txt
git add . && git commit -q --no-verify -m seed

REPO_ABS=$(pwd)
cd "$TMP_PARENT"

# ─── Node driver — thin wrapper around worktree-lifecycle exports ─────────────
# Writes driver.mjs into $TMP_PARENT; imports from sdk/dist/ in the real repo tree.
cat > driver.mjs <<DRIVER_EOF
import { createVisionWorktree, assertWorktreeDiffClean, teardownWorktreeAbort, teardownWorktreeClean } from '${REPO_ROOT}/sdk/dist/vision/worktree-lifecycle.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = process.argv[2];
const mode = process.argv[3]; // 'dirty' or 'clean'

const { sid, worktreePath, sourceHeadSha } = await createVisionWorktree(repoRoot, 'harness', 60000);

if (mode === 'dirty') {
  // Out-of-bounds file — should trigger SAFE-04 gate
  const dirtyPath = join(worktreePath, 'src-foo.ts');
  await writeFile(dirtyPath, 'leaked\n');
  execSync('git add . && git commit -q --no-verify -m leak', { cwd: worktreePath });
} else {
  // In-bounds file under .planning/drafts/ — must mkdir -p before writeFile
  // (freshly-created detached-HEAD worktree does not auto-create nested dirs)
  const okPath = join(worktreePath, '.planning/drafts/ok.md');
  await mkdir(dirname(okPath), { recursive: true });
  await writeFile(okPath, '# in-bounds\n');
  execSync('git add . && git commit -q --no-verify -m ok', { cwd: worktreePath });
}

const assertion = await assertWorktreeDiffClean(worktreePath, sourceHeadSha);

if (!assertion.ok) {
  const { quarantinePath, abortReportPath } = await teardownWorktreeAbort(
    repoRoot, worktreePath, sid, assertion, 'harness'
  );
  console.log('ABORTED', quarantinePath, abortReportPath);
  process.exit(0);
} else {
  await teardownWorktreeClean(repoRoot, worktreePath, sourceHeadSha);
  console.log('CLEAN');
  process.exit(0);
}
DRIVER_EOF

# ─── CASE 1: dirty diff must quarantine ──────────────────────────────────────
echo "--- CASE 1: dirty diff (should quarantine) ---"
cd "$TMP_PARENT"
OUTPUT=$(node driver.mjs "$REPO_ABS" dirty)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q '^ABORTED ' || { echo "FAIL: case 1 did not abort"; exit 1; }

# Parse the abort report path (third field)
ABORT_REPORT=$(echo "$OUTPUT" | awk '{print $3}')
test -f "$ABORT_REPORT" || { echo "FAIL: abort report not written to $ABORT_REPORT"; exit 1; }
grep -q 'src-foo.ts' "$ABORT_REPORT" || { echo "FAIL: abort report missing violator"; exit 1; }

# Verify quarantine dir exists (second field)
QUARANTINE=$(echo "$OUTPUT" | awk '{print $2}')
test -d "$QUARANTINE" || { echo "FAIL: quarantine dir missing at $QUARANTINE"; exit 1; }

# Verify the original worktree path is not advertised in git admin state.
# worktree repair + prune after rename should have cleaned up stale admin entries.
WT_LIST=$(git -C "$REPO_ABS" worktree list 2>&1)
echo "Worktree list after case 1 abort:"
echo "$WT_LIST"
# Key assertion: non-quarantined gsd-vision-<sid> must not appear as a non-prunable entry.
# ULID is Crockford base32 uppercase 26-chars; match 20+ uppercase alphanums to be safe.
if echo "$WT_LIST" | grep -v "ABORTED" | grep -q "gsd-vision-[A-Z0-9]"; then
  if echo "$WT_LIST" | grep -v "ABORTED" | grep "gsd-vision-[A-Z0-9]" | grep -qv "prunable"; then
    echo "FAIL: non-prunable stale vision worktree in admin state after abort"
    exit 1
  fi
fi

# ─── CASE 2: clean diff must promote and remove ───────────────────────────────
echo "--- CASE 2: clean diff (should promote) ---"
# Fresh repo for case 2
rm -rf "$REPO_ABS"
mkdir -p "$REPO_ABS"
cd "$REPO_ABS"
git init -q -b main
git config user.email 'harness@test'
git config user.name 'Harness'
echo seed > seed.txt
git add . && git commit -q --no-verify -m seed
cd "$TMP_PARENT"
OUTPUT=$(node driver.mjs "$REPO_ABS" clean)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q '^CLEAN' || { echo "FAIL: case 2 did not promote"; exit 1; }

# Verify promotion — .planning/drafts/ok.md must exist on source branch
test -f "$REPO_ABS/.planning/drafts/ok.md" || { echo "FAIL: ok.md not promoted to source branch"; exit 1; }

# Verify worktree was removed — no gsd-vision-{ULID} entry should appear.
# Match on ULID pattern (Crockford base32 uppercase, 20+ chars) to avoid false-positive
# matches on the harness tmpdir name (gsd-vision-harness-XXXX).
WT_LIST_CLEAN=$(git -C "$REPO_ABS" worktree list 2>&1)
echo "Worktree list after case 2 clean teardown:"
echo "$WT_LIST_CLEAN"
if echo "$WT_LIST_CLEAN" | grep -qE "gsd-vision-[A-Z0-9]{20}"; then
  echo "FAIL: worktree still in admin state after clean teardown"
  exit 1
fi

echo "--- ALL OK ---"
exit 0
