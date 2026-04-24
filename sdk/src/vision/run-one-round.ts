/**
 * Single-round orchestration — runs one exploration round end-to-end.
 *
 * Called by:
 *   - Phase 3 multi-round loop (wraps this in a serial while-loop with convergence check)
 *   - Phase 2 integration tests directly (run-one-round.integration.test.ts)
 *
 * Owns (D-06 supervisor scope — all writes happen here, NOT in the Explorer):
 *   - Pre-select top-K (≤5) from state.frontier via selectTopK (D-12/D-14 cap)
 *   - Snapshot state.direction → directionSnapshot (Pitfall 5 anchor)
 *   - Spawn the Explorer session via query() with pre-selected topics injected in prompt
 *   - Parse the Explorer's final assistant message via parseRoundResult
 *   - On parse failure OR non-success subtype → append error RoundResult (round completes)
 *   - On success → merge new_frontier_nodes via deduplicateFrontier; mark picked nodes 'explored'
 *   - Append RoundResult to state.round_results[]; increment state.round
 *   - writeCheckpoint(path, newState, worktreeRoot) — D-13 primary JSON + secondary git commit
 *
 * Does NOT own: signal ladder (supervisor.ts — Phase 1 D-05/D-06), bwrap jail composition
 * (bwrap-compose.ts — Phase 1 D-09), wall-clock ceiling (superviseSession — Phase 1 STOP-01).
 *
 * WSL2 musl fix: every query() call passes pathToClaudeCodeExecutable (Pitfall 1).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { VisionState, FrontierNode, RoundResult } from './types.js';
import { writeCheckpoint } from './vision-state.js';
import {
  parseRoundResult,
  selectTopK,
  deduplicateFrontier,
  buildRoundResult,
  markExplored,
} from './round-result.js';
import { resolveClaudeCodeExecutable } from '../session-runner.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunOneRoundOptions {
  /** Absolute path to vision-state.json inside the worktree. */
  visionStatePath: string;
  /** Absolute path to the worktree root — required for D-13 secondary git commit. */
  worktreeRoot: string;
  /**
   * Override the Explorer agent name. Defaults to 'gsd-vision-explorer'.
   * Phase 2 integration tests may override to point at a test double.
   */
  explorerAgent?: string;
  /**
   * Override query() maxTurns for the Explorer. Defaults to 50 — the Explorer
   * orchestrates Task() fan-out and needs more turns than a Researcher (D-11).
   */
  explorerMaxTurns?: number;
}

/**
 * Run one exploration round. Returns the updated VisionState with:
 *   - round_results[] appended (always length +1 — success OR error RoundResult)
 *   - round incremented by 1
 *   - frontier updated (picked nodes marked 'explored'; new nodes deduped in)
 *
 * Phase 3 wraps this in a serial loop and adds the three-condition convergence gate.
 * This function does NOT check convergence — it always runs exactly one round.
 */
export async function runOneRound(
  state: VisionState,
  opts: RunOneRoundOptions,
): Promise<VisionState> {
  // ─── D-14/D-12: pre-select ≤5 topics from the frontier (Option A — trust-boundary cap)
  const topicsToExplore = selectTopK(state.frontier, 5);
  const topicsSelectedIds = topicsToExplore.map((n) => n.id);

  // ─── Pitfall 5 anchor: snapshot direction BEFORE any async work
  const directionSnapshot = state.direction;

  const startedAt = new Date().toISOString();
  const nextRound = state.round + 1;

  // ─── Build Explorer prompt — inject topics + direction_snapshot + round number
  const explorerPrompt = buildExplorerPrompt({
    topics: topicsToExplore,
    directionSnapshot,
    round: nextRound,
    frontierPendingCount: state.frontier.filter((n) => n.status === 'pending').length,
  });

  // ─── Spawn Explorer via query(); iterate stream to capture the result message
  const roundResult = await runExplorerSession(explorerPrompt, opts, {
    round: nextRound,
    startedAt,
    directionSnapshot,
    topicsSelectedIds,
  });

  // ─── Direction-drift defensive check (Pitfall 5 / T-02-direction-drift)
  const finalRound: RoundResult =
    roundResult.direction_snapshot === directionSnapshot
      ? roundResult
      : withError(roundResult, { topic_id: '*', reason: 'direction-snapshot-drift' });

  // ─── Merge into state
  const nextFrontier = deduplicateFrontier(
    markExplored(state.frontier, topicsSelectedIds),
    finalRound.new_frontier_nodes,
  );

  const nextState: VisionState = {
    ...state,
    round: nextRound,
    round_results: [...state.round_results, finalRound],
    frontier: nextFrontier,
  };

  // ─── D-06 + D-13 — supervisor writes checkpoint (atomic JSON + secondary git commit)
  await writeCheckpoint(opts.visionStatePath, nextState, opts.worktreeRoot);

  return nextState;
}

// ─── Explorer prompt builder ─────────────────────────────────────────────────

function buildExplorerPrompt(inputs: {
  topics: FrontierNode[];
  directionSnapshot: string;
  round: number;
  frontierPendingCount: number;
}): string {
  const { topics, directionSnapshot, round, frontierPendingCount } = inputs;
  const topicLines = topics
    .map(
      (t) =>
        `  - id: ${t.id}\n    topic: ${JSON.stringify(t.topic)}\n    score: ${t.score.toFixed(2)}`,
    )
    .join('\n');

  // The prompt is a YAML-ish block the Explorer can scan deterministically.
  // Explorer agent markdown (Plan 04) documents the expected input keys.
  return [
    `You are running exploration round ${round} of the vision session.`,
    ``,
    `direction_snapshot: ${JSON.stringify(directionSnapshot)}`,
    ``,
    `frontier_pending_count: ${frontierPendingCount}`,
    ``,
    `pre_selected_topics:`,
    topicLines ||
      '  (empty — frontier has no pending nodes; emit a RoundResult with empty findings/new_frontier_nodes per D-07)',
    ``,
    `Task(subagent_type="gsd-vision-researcher") for EACH topic above in parallel (max 5).`,
    `When all researchers return, build the RoundResult JSON per your <structured_returns> contract.`,
    `Return ONLY the RoundResult JSON as your final assistant message.`,
  ].join('\n');
}

// ─── Explorer session runner ─────────────────────────────────────────────────

interface ExplorerFallbackContext {
  round: number;
  startedAt: string;
  directionSnapshot: string;
  topicsSelectedIds: string[];
}

async function runExplorerSession(
  prompt: string,
  opts: RunOneRoundOptions,
  fallbackCtx: ExplorerFallbackContext,
): Promise<RoundResult> {
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable();
  const maxTurns = opts.explorerMaxTurns ?? 50;

  let resultMsg: SDKResultMessage | undefined;
  try {
    const stream = query({
      prompt,
      options: {
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        allowedTools: ['Read', 'Task'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns,
        cwd: opts.worktreeRoot,
        settingSources: ['project'],
        ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
      },
    });

    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      if (msg.type === 'result') resultMsg = msg as SDKResultMessage;
    }
  } catch (err) {
    return errorRoundResult(fallbackCtx, `explorer-crashed: ${(err as Error).message}`);
  }

  if (!resultMsg || resultMsg.subtype !== 'success') {
    return errorRoundResult(
      fallbackCtx,
      `non-success-subtype: ${resultMsg?.subtype ?? 'no-result'}`,
    );
  }

  // SDKResultSuccess.result is a string (verified from sdk.d.ts line 2964)
  const raw = (resultMsg as { result?: unknown }).result;
  if (typeof raw !== 'string') {
    return errorRoundResult(fallbackCtx, 'no-result-string');
  }

  const parsed = parseRoundResult(raw);
  if (!parsed) {
    return errorRoundResult(fallbackCtx, 'parse-failure');
  }
  return parsed;
}

// ─── Error round constructor ─────────────────────────────────────────────────

function errorRoundResult(ctx: ExplorerFallbackContext, reason: string): RoundResult {
  const endedAt = new Date().toISOString();
  return buildRoundResult({
    round: ctx.round,
    startedAt: ctx.startedAt,
    endedAt,
    directionSnapshot: ctx.directionSnapshot,
    topicsSelected: ctx.topicsSelectedIds,
    findings: [],
    newFrontierNodes: [],
    scores: {
      score_distribution: [],
      selection_rationale: [],
    },
    subagentCount: 0,
    errors: [{ topic_id: '*', reason }],
  });
}

function withError(
  result: RoundResult,
  error: { topic_id: string; reason: string },
): RoundResult {
  return { ...result, errors: [...result.errors, error] };
}
