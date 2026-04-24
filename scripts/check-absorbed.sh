#!/usr/bin/env bash
# Parse EXTENSIONS.md for `<!-- absorbed-check:begin id=<id> -->` ... `<!-- absorbed-check:end -->`
# blocks, extract the enclosed ```sh ... ``` body, and run each against upstream.
#
# Non-empty output = upstream may now cover the feature. Review manually; the
# script never changes state, it only reports.
#
# Usage: scripts/check-absorbed.sh [feature-id ...]
#   with no args, runs every check block found
#
# Env:
#   UPSTREAM_REMOTE  default: upstream
#   UPSTREAM_BRANCH  default: main
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
EXT_FILE="$REPO_ROOT/EXTENSIONS.md"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
hit()  { printf '\033[35m%s\033[0m\n' "$*"; }

[[ -f "$EXT_FILE" ]] || { warn "no EXTENSIONS.md at repo root — nothing to check."; exit 0; }
git rev-parse --verify --quiet "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" >/dev/null \
  || { warn "upstream ref '$UPSTREAM_REMOTE/$UPSTREAM_BRANCH' not found. Run: git fetch $UPSTREAM_REMOTE"; exit 0; }

# Extract (id, body) pairs. awk state machine: find BEGIN marker, capture id,
# then capture the body of the first ```sh fenced block until END marker.
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

awk '
  BEGIN { state = 0 }
  state == 0 && match($0, /<!--[[:space:]]*absorbed-check:begin[[:space:]]+id=([^[:space:]]+)[[:space:]]*-->/, m) {
    id = m[1]; state = 1; next
  }
  state == 1 && /^```sh$/            { state = 2; next }
  state == 2 && /^```$/              { state = 3; next }
  state == 2                         { print id "\t" $0 >> "'"$TMPDIR"'/blocks.tsv"; next }
  state == 3 && /absorbed-check:end/ { state = 0; next }
' "$EXT_FILE"

if [[ ! -s "$TMPDIR/blocks.tsv" ]]; then
  warn "no absorbed-check blocks found in EXTENSIONS.md"
  exit 0
fi

# Group blocks.tsv into per-id script files.
awk -F'\t' '{ print $2 >> "'"$TMPDIR"'/body__" $1 ".sh" }' "$TMPDIR/blocks.tsv"

# Filter ids by positional args if provided.
WANTED=("$@")
is_wanted() {
  [[ ${#WANTED[@]} -eq 0 ]] && return 0
  local id="$1" w
  for w in "${WANTED[@]}"; do [[ "$w" == "$id" ]] && return 0; done
  return 1
}

ANY_HITS=0
for f in "$TMPDIR"/body__*.sh; do
  [[ -e "$f" ]] || continue
  id="${f##*/body__}"; id="${id%.sh}"
  is_wanted "$id" || continue

  bold "==> [$id]"
  # Run the extracted body in a subshell. Capture stdout and stderr separately
  # so query errors don't masquerade as "hits".
  out_file="$TMPDIR/out__$id"
  err_file="$TMPDIR/err__$id"
  UPSTREAM_REMOTE="$UPSTREAM_REMOTE" UPSTREAM_BRANCH="$UPSTREAM_BRANCH" \
    bash "$f" >"$out_file" 2>"$err_file" || true
  out="$(cat "$out_file")"
  err="$(cat "$err_file")"
  if [[ -n "${out//[[:space:]]/}" ]]; then
    hit "    hits — upstream may now cover part of this feature:"
    printf '%s\n' "$out" | sed 's/^/      /'
    ANY_HITS=1
  else
    ok  "    no hits — still unique to this fork."
  fi
  if [[ -n "${err//[[:space:]]/}" ]]; then
    warn "    query errors (stderr):"
    printf '%s\n' "$err" | sed 's/^/      /' >&2
  fi
  echo
done

if [[ "$ANY_HITS" -eq 1 ]]; then
  bold "review hits above and update EXTENSIONS.md status (still-unique / partial / absorbed)."
else
  bold "all fork features still unique to this fork."
fi
