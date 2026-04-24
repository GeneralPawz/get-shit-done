#!/usr/bin/env bash
# Sync the current fork branch with upstream and check whether any fork-local
# features have been absorbed upstream.
#
# Usage: scripts/sync-upstream.sh [--no-rebase] [--yes]
#
# --no-rebase : skip the rebase step (only fetch + report + absorbed-check)
# --yes       : non-interactive; auto-confirm the rebase prompt
#
# Env:
#   UPSTREAM_REMOTE  remote name for upstream (default: upstream)
#   UPSTREAM_BRANCH  branch on upstream to rebase onto (default: main)
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

DO_REBASE=1
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --no-rebase) DO_REBASE=0 ;;
    --yes|-y)    ASSUME_YES=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1 \
  || fail "remote '$UPSTREAM_REMOTE' not configured. Add it with: git remote add $UPSTREAM_REMOTE <url>"

CURRENT_BRANCH="$(git branch --show-current || true)"
[[ -n "$CURRENT_BRANCH" ]] || fail "HEAD is detached — check out a branch first."

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "working tree is dirty. Commit or stash before syncing."
fi

bold "==> fetching $UPSTREAM_REMOTE"
git fetch "$UPSTREAM_REMOTE" --prune --tags

UPSTREAM_REF="$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
git rev-parse --verify --quiet "$UPSTREAM_REF" >/dev/null \
  || fail "upstream ref '$UPSTREAM_REF' not found after fetch."

AHEAD="$(git rev-list --count "$UPSTREAM_REF"..HEAD)"
BEHIND="$(git rev-list --count HEAD.."$UPSTREAM_REF")"

bold "==> branch status"
printf "  current branch : %s\n" "$CURRENT_BRANCH"
printf "  ahead of %-6s : %s commits\n" "$UPSTREAM_REF" "$AHEAD"
printf "  behind %-8s : %s commits\n" "$UPSTREAM_REF" "$BEHIND"
echo

if [[ "$BEHIND" -eq 0 ]]; then
  bold "already up to date with $UPSTREAM_REF — nothing to rebase."
else
  if [[ "$DO_REBASE" -eq 1 ]]; then
    if [[ "$ASSUME_YES" -ne 1 ]]; then
      read -r -p "Rebase $CURRENT_BRANCH onto $UPSTREAM_REF? [y/N] " ans
      [[ "$ans" =~ ^[Yy]$ ]] || { warn "rebase skipped."; DO_REBASE=0; }
    fi
    if [[ "$DO_REBASE" -eq 1 ]]; then
      bold "==> rebasing $CURRENT_BRANCH onto $UPSTREAM_REF"
      if ! git rebase "$UPSTREAM_REF"; then
        warn "rebase stopped with conflicts. Resolve, then: git rebase --continue"
        warn "or abort with: git rebase --abort"
        exit 1
      fi
      warn "rebase complete. Your branch history has been rewritten."
      warn "If this branch is pushed to a remote, you will need a force-push:"
      warn "  git push --force-with-lease origin $CURRENT_BRANCH"
    fi
  else
    warn "--no-rebase: skipping rebase step."
  fi
fi

echo
bold "==> running absorbed-check against $UPSTREAM_REF"
if [[ -x "$REPO_ROOT/scripts/check-absorbed.sh" ]]; then
  UPSTREAM_REMOTE="$UPSTREAM_REMOTE" UPSTREAM_BRANCH="$UPSTREAM_BRANCH" \
    "$REPO_ROOT/scripts/check-absorbed.sh" || true
else
  warn "scripts/check-absorbed.sh missing or not executable — skipping."
fi

echo
bold "done."
