# Fork Extensions

Custom features this fork adds on top of `upstream/main` (`gsd-build/get-shit-done`).

**How to use this file**

- One `## Feature:` section per extension. Keep it additive — every new custom feature gets a new section.
- `scripts/sync-upstream.sh` fetches upstream, offers a rebase, and then runs `scripts/check-absorbed.sh`.
- `scripts/check-absorbed.sh` parses the `<!-- absorbed-check:begin -->` blocks below and runs each one against `upstream/main`. Non-empty output = upstream may now cover this feature → review manually and decide whether to drop the fork-local version.

**Status vocabulary**

- `still-unique` — upstream has no equivalent.
- `partial` — upstream has overlapping pieces but not the full feature; absorb selectively.
- `absorbed` — upstream has an equivalent; candidate to drop from the fork.

---

## Feature: vision-workflow

**Intent.** A new workflow lane for unattended, multi-hour, *planning-only* sessions ("vision mode"). Feeds a rough end-of-day direction into an overnight run that reads, researches, reasons, and produces layered planning artifacts (catch-up digest, draft roadmap, phase-draft pack, far-future seeds). No code execution; safety comes from a Tier 2 read-only sandbox + worktree isolation + bwrap jail.

**Entry points (planned).** `/gsd-envision`, `/gsd-envision-wake` (not yet implemented — only infra + agents shipped so far).

**Components on this fork**

| Component | Path |
|---|---|
| Vision SDK module (supervisor, bwrap-compose, worktree-lifecycle, vision-lock, session-spawn, forced-stop, read-gate, atomic-write, sha-manifest, settings-local, allowlist, round-result, seed-frontier, run-one-round, scoring-rubric, normalize-topic, vision-state, types) | `sdk/src/vision/**` |
| Vision agents | `agents/gsd-vision-explorer.md`, `agents/gsd-vision-researcher.md` |
| Vision references | `get-shit-done/references/vision-*.md`, `get-shit-done/references/vision-bash-allowlist.json` |
| Vision settings template (WebFetch allow/deny) | `get-shit-done/templates/vision-settings.local.json` |
| Phase-1 bwrap/diff test harness | `scripts/test-phase1/**` |
| Session-runner extension | `sdk/src/session-runner.ts` (partial) |

**Upstream touchpoints to watch.** `sdk/src/session-runner.ts` is shared with upstream — rebase conflicts likely live here. Everything else is new files and should rebase cleanly unless upstream introduces a `vision/` or `envision/` namespace.

**Status:** still-unique (as of 2026-04-24)

<!-- absorbed-check:begin id=vision-workflow -->
```sh
UP="${UPSTREAM_REMOTE:-upstream}/${UPSTREAM_BRANCH:-main}"

# 1. Any upstream files under a vision/ or envision/ namespace?
#    Word-boundary-ish: matches /vision/, /vision-, -vision/, vision$ — not "revision".
git ls-tree -r "$UP" --name-only | grep -iE '(^|/|-)(vision|envision)([/-]|\.|$)' || true

# 2. Any upstream agent / skill / command named vision / envision / overnight / unattended?
git ls-tree -r "$UP" --name-only | grep -iE '(agents|skills|commands)/.*(vision|envision|overnight|unattended)' || true

# 3. Upstream commit messages mentioning the concept.
#    Extended regex + word boundaries so "revision" / "decision" do not match.
git log "$UP" --oneline -i -E --grep='\b(envision|overnight[- ]?(plan|think|research)|unattended[- ]?(plan|session)|vision[- ]mode)\b' | head -20

# 4. Upstream safety-substrate infra (bwrap jail, worktree lifecycle, read-gate).
git ls-tree -r "$UP" --name-only | grep -iE '(^|/)(bwrap|worktree-lifecycle|read-gate)(\.|/|-|$)' || true
```
<!-- absorbed-check:end -->

---

## Adding a new extension

Copy the schema below as a new `## Feature:` section above this one.

Each feature section has four required parts:

1. `## Feature: <kebab-id>` heading — the id is also used inside the check marker.
2. An **Intent** paragraph, a **Components** table (or list) with repo paths, and an **Upstream touchpoints to watch** note.
3. A **Status** line: `still-unique`, `partial`, or `absorbed`, with an `(as of YYYY-MM-DD)` timestamp.
4. A single absorbed-check block. The begin marker includes the id and is followed by exactly one fenced `sh` block, then the end marker. The script runs the body in bash with `UPSTREAM_REMOTE` and `UPSTREAM_BRANCH` in the environment. Print matches to stdout; empty output means "still unique".

The marker syntax is `absorbed-check` `:` `begin`/`end`. The parser only recognises those literal strings, so this prose describing them is safe.

