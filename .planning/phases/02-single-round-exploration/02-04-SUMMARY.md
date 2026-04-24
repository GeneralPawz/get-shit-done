---
phase: 02-single-round-exploration
plan: 04
subsystem: vision
tags: [vision, agents, webfetch-allowlist, ssrf, claude-subagent, json-contract]

# Dependency graph
requires:
  - phase: 01-safety-foundation
    provides: bwrap jail, settings-local.ts template infrastructure, vision types base
  - phase: 02-single-round-exploration/02-01
    provides: scoring-rubric.ts SCORING_RUBRIC_PROSE constant, FrontierNode/Finding/RoundResult types
  - phase: 02-single-round-exploration/02-02
    provides: round-result.ts parseRoundResult/selectTopK helpers

provides:
  - "agents/gsd-vision-researcher.md — leaf researcher agent: Read/Grep/Glob/WebSearch/WebFetch tool surface, D-02 Finding JSON contract"
  - "agents/gsd-vision-explorer.md — round orchestrator agent: Read/Task tools only, D-04 RoundResult JSON contract with embedded D-13 scoring rubric"
  - "get-shit-done/templates/vision-settings.local.json — extended with WebFetch allow (5 domains) + deny (RFC-1918, link-local, loopback) rules"

affects:
  - 02-05-run-one-round (spawns gsd-vision-explorer by agent name)
  - 02-03-seed-frontier (uses SCORING_RUBRIC_PROSE — same rubric as embedded in Explorer)
  - phase-04-synthesis (reads RoundResult.findings, direction_snapshot, selection_rationale)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prompt-layer belt + structural suspenders: agent tools frontmatter removes dangerous tools; bwrap jail enforces structurally"
    - "Direction snapshot as immutable anchor: verbatim direction_snapshot injected into every Researcher Task() call (Pitfall 5 mitigation)"
    - "WebFetch domain allowlist via settings.local.json permissions.allow/deny (SSRF mitigation T-02-ssrf-webfetch)"
    - "Two-layer JSON return: Researcher→Finding JSON→Explorer→RoundResult JSON→supervisor parse"

key-files:
  created:
    - agents/gsd-vision-researcher.md
    - agents/gsd-vision-explorer.md
  modified:
    - get-shit-done/templates/vision-settings.local.json

key-decisions:
  - "Option A concurrency (D-12): supervisor pre-selects ≤5 topics; Explorer receives bounded list — eliminates prompt-level cap enforcement risk"
  - "Explorer writes NOTHING to disk (D-06): supervisor outside the jail owns vision-state.json merge and checkpoint commit"
  - "backtrack_flag: false is a literal in the RoundResult — not a computed field — enforces LOOP-04 greedy invariant at prompt layer"
  - "WebFetch RFC-1918 172.16.0.0/12 encoded as 16 explicit glob prefixes (172.16.* through 172.31.*) because Claude Code WebFetch rules use glob-style patterns, not CIDR"
  - "Deny-list entries take effect even when allow rules also match — RFC-1918/loopback stay blocked even if a future allow rule accidentally overlaps"

patterns-established:
  - "Agent markdown: name, description, tools, color frontmatter — no hooks block (commented out in analogs)"
  - "Researcher agents: tools frontmatter is the prompt-layer belt; bwrap jail is structural suspenders"
  - "Scoring rubric prose embedded in Explorer agent for prompt-time scoring; SCORING_RUBRIC_PROSE constant in scoring-rubric.ts for Node-level injection — same weights, two callers, one source of truth"

requirements-completed: [LOOP-01, LOOP-02, LOOP-04]

# Metrics
duration: 12min
completed: 2026-04-24
---

# Phase 02 Plan 04: Vision Agent Files + WebFetch Allowlist Summary

**Two Claude Code subagent definitions (researcher leaf + explorer orchestrator) encoding D-02/D-04 JSON contracts, D-10/D-11/D-12/D-16 constraints, and SSRF-mitigated WebFetch domain allowlist extension to the session-scoped settings.local.json template**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T09:51:00Z
- **Completed:** 2026-04-24T10:03:46Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Shipped `agents/gsd-vision-researcher.md` — read-only tool surface (D-10), D-02 Finding JSON return contract, direction_snapshot immutable anchor, maxTurns:15 compute cap, no-recursion instruction
- Shipped `agents/gsd-vision-explorer.md` — Read+Task only (D-06 no writes), embedded D-13 scoring rubric prose (0.4/0.3/0.2/0.1), full D-04 RoundResult JSON return contract with backtrack_flag:false literal, 5-cap concurrency (D-12), D-16 selection_rationale format
- Extended `vision-settings.local.json` template with WebFetch allow (5 domains) + deny (22 deny rules covering all RFC-1918 prefixes, link-local, loopback) — SSRF mitigation T-02-ssrf-webfetch

## Task Commits

Each task was committed atomically:

1. **Task 1: gsd-vision-researcher.md** - `7588079` (feat)
2. **Task 2: gsd-vision-explorer.md** - `3d628df` (feat)
3. **Task 3: vision-settings.local.json WebFetch rules** - `44c073b` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified

- `agents/gsd-vision-researcher.md` — Leaf researcher subagent: Read/Grep/Glob/WebSearch/WebFetch tools, returns D-02 Finding JSON, no Task() spawning allowed
- `agents/gsd-vision-explorer.md` — Round orchestrator subagent: Read/Task tools only, fans out ≤5 Researchers via Task(), scores follow_up_questions with embedded rubric, returns D-04 RoundResult JSON
- `get-shit-done/templates/vision-settings.local.json` — Extended from Phase 1 Write/Read rules with WebFetch domain allowlist (5 allowed) and RFC-1918/link-local/loopback deny rules (22 deny entries)

## Decisions Made

- **Option A concurrency enforcement (D-12):** Supervisor pre-selects ≤5 topics before spawning Explorer; Explorer prompt also instructs "never exceed 5 Task() calls" as defense in depth. Stronger than pure prompt-layer self-windowing.
- **RFC-1918 172.16.0.0/12 as 16 explicit deny entries:** Claude Code WebFetch domain rules use glob-style patterns, not CIDR notation. Expanded the /12 block to 16 individual `172.XX.*` entries (172.16 through 172.31) to cover the full range.
- **Scoring rubric prose embedded verbatim in Explorer agent:** Single source of truth is `sdk/src/vision/scoring-rubric.ts` SCORING_RUBRIC_PROSE constant (created in Plan 01). The Explorer agent embeds the same prose; acceptance criteria grep both files for the weight tokens (0.4/0.3/0.2/0.1) to detect drift.

## Deviations from Plan

None — plan executed exactly as written. The only noteworthy context item:

`sdk/src/vision/scoring-rubric.ts` is created by Plan 01 (wave 1), which runs in a parallel worktree. The acceptance criteria check `grep -q "0.4" sdk/src/vision/scoring-rubric.ts` will pass after the orchestrator merges Plan 01's work. The rubric weights in `agents/gsd-vision-explorer.md` (0.4/0.3/0.2/0.1) were authored to match the PATTERNS.md and CONTEXT.md specifications, which define the same values as the Plan 01 SCORING_RUBRIC_PROSE constant.

## Known Stubs

None — no hardcoded empty values or placeholder text. Agent files are prompt content, not data structures. Settings template uses live domain/CIDR values.

## Threat Flags

No new threat surface introduced beyond what the plan's threat model already documents:

| Flag | File | Description |
|------|------|-------------|
| T-02-ssrf-webfetch | get-shit-done/templates/vision-settings.local.json | Mitigated: WebFetch deny rules for RFC-1918, link-local, loopback added in this plan |
| T-02-jail-prompt-escape | agents/gsd-vision-researcher.md | Mitigated: tools frontmatter omits Bash/Write/Edit; bwrap jail enforces structurally |
| T-02-researcher-recursion | agents/gsd-vision-researcher.md | Mitigated: Task() not in tools frontmatter; prompt explicitly forbids it |
| T-02-goal-drift-prompt | Both agent files | Mitigated: direction_snapshot treated as immutable anchor in both prompts |
| T-02-explorer-json-drift | agents/gsd-vision-explorer.md | Mitigated: "ONLY final assistant message" + no preamble/fences instruction |

## Issues Encountered

- `pnpm vitest` and `npx vitest` not available in worktree context (node v18 / pnpm path issue); resolved by running `sdk/node_modules/.bin/vitest` from the main repo sdk directory. `settings-local.test.ts` passed (3/3).
- `tsc --noEmit` ran clean (no TypeScript regressions — all 3 modified files are markdown/JSON, not TypeScript).

## Next Phase Readiness

- `gsd-vision-explorer` is named and ready for Plan 05's `run-one-round.ts` to spawn via `query({ agentName: "gsd-vision-explorer", ... })`
- `gsd-vision-researcher` will be spawned by the Explorer's internal Task() calls — both agent names are stable
- `vision-settings.local.json` template is extended; `settings-local.ts` requires no changes (transparent to the template consumer)
- Cross-file rubric weight integrity: the Explorer embeds the 4 weight tokens; Plan 01 creates `scoring-rubric.ts` with the same values — after merge, grep-based cross-check will confirm no drift

---
*Phase: 02-single-round-exploration*
*Completed: 2026-04-24*
