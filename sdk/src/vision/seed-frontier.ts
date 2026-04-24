/**
 * Seed-frontier generator (D-08) — produces initial FrontierNode[] from a direction string.
 *
 * Preferred path: one-shot query() call with outputFormat JSON schema.
 * Fallback: deterministic noun-phrase extraction — no LLM, no network.
 *
 * The fallback path exists so Phase 2 integration tests (Plan 05) can run without network.
 * Phase 5 /gsd-envision will reuse this SAME module with useLLM: true for the production path.
 *
 * WSL2 musl fix: every query() call passes pathToClaudeCodeExecutable: resolveClaudeCodeExecutable()
 * (02-RESEARCH.md Pitfall 1). Never skip this field — SDK 0.2.117's bundled binary
 * picker fails on WSL2 aarch64 glibc hosts.
 *
 * Shared rubric: SCORING_RUBRIC_PROSE from scoring-rubric.ts is injected verbatim into the
 * LLM prompt so seed scoring uses the SAME weights as the Explorer agent (D-13 single source of truth).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultMessage, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { FrontierNode } from './types.js';
import { mintSessionId } from './id.js';
import { SCORING_RUBRIC_PROSE } from './scoring-rubric.js';
import { resolveClaudeCodeExecutable } from '../session-runner.js';
import { normalizeTopic } from './normalize-topic.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SeedFrontierOptions {
  direction: string;
  /** default true; set false to skip the LLM call entirely (test path, D-08). */
  useLLM?: boolean;
}

/**
 * Decompose a direction string into 3–5 initial FrontierNode[] for round 0.
 * Never fails silently and never propagates errors. On any LLM failure, falls back to deterministic noun-phrase extraction.
 */
export async function seedFromDirection(opts: SeedFrontierOptions): Promise<FrontierNode[]> {
  const direction = opts.direction;
  const useLLM = opts.useLLM !== false;

  if (useLLM) {
    try {
      const fromLlm = await seedViaLlm(direction);
      if (fromLlm.length >= 3) return dedupeSeedList(fromLlm);
    } catch {
      // Fall through to deterministic fallback — never propagate.
    }
  }

  return dedupeSeedList(extractNounPhrasesFallback(direction));
}

// ─── LLM one-shot path ───────────────────────────────────────────────────────

/** JSON schema for outputFormat — small and fixed so schema-retry failure is rare. */
const FRONTIER_SEED_SCHEMA = {
  type: 'object',
  required: ['nodes'],
  properties: {
    nodes: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['topic', 'score'],
        properties: {
          topic: { type: 'string', minLength: 3 },
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

async function seedViaLlm(direction: string): Promise<FrontierNode[]> {
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable();

  const stream = query({
    prompt:
      `Decompose this direction into 3–5 concrete research sub-questions:\n` +
      `"${direction}"\n\n` +
      `${SCORING_RUBRIC_PROSE}\n\n` +
      `Return ONLY a JSON object { "nodes": [ { "topic": "...", "score": 0.00 }, ... ] } ` +
      `with 3–5 entries; each topic is a question, each score is a 2-decimal float.`,
    options: {
      maxTurns: 1,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      outputFormat: { type: 'json_schema', schema: FRONTIER_SEED_SCHEMA },
      ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    },
  });

  let resultMsg: SDKResultMessage | undefined;
  for await (const msg of stream as AsyncIterable<SDKMessage>) {
    if (msg.type === 'result') resultMsg = msg;
  }
  if (!resultMsg || resultMsg.subtype !== 'success') {
    // Covers: error_max_turns, error_during_execution, error_max_structured_output_retries (Pitfall 7)
    return [];
  }
  const structured = (resultMsg as SDKResultSuccess).structured_output;
  if (typeof structured !== 'object' || structured === null) return [];

  const parsed = structured as { nodes?: Array<{ topic?: unknown; score?: unknown }> };
  if (!Array.isArray(parsed.nodes)) return [];

  const now = new Date().toISOString();
  const nodes: FrontierNode[] = [];
  for (const n of parsed.nodes) {
    if (typeof n.topic !== 'string' || n.topic.length < 3) continue;
    const score = typeof n.score === 'number' ? clamp01(n.score) : 0.5;
    nodes.push({
      id: mintSessionId(),
      topic: n.topic,
      score,
      parent_round: 0,
      depth: 0,
      created_at: now,
      status: 'pending',
    });
  }
  return nodes;
}

// ─── Deterministic fallback ──────────────────────────────────────────────────

/** Extract 3–5 noun-phrase-style questions from direction. No LLM; no network. Nodes get score: 0.5. */
function extractNounPhrasesFallback(direction: string): FrontierNode[] {
  const now = new Date().toISOString();
  const normalized = normalizeTopic(direction); // strip stopwords + punctuation + case
  const tokens = normalized.split(' ').filter(t => t.length > 1);

  // Build 2–3-word sliding-window phrases from the normalized tokens.
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i + 1 < tokens.length) phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i + 2 < tokens.length) phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  // If the direction has too few tokens, use generic decomposition seeds so we always
  // return ≥ 3 nodes and the integration test can always proceed.
  const GENERIC = [
    'core requirements',
    'existing patterns',
    'integration risks',
    'testing approach',
    'key constraints',
  ];
  const combined = phrases.length > 0 ? phrases : GENERIC;

  // Deduplicate, take up to 5, shape as questions.
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const p of combined) {
    const key = normalizeTopic(p);
    if (seen.has(key) || key.length === 0) continue;
    seen.add(key);
    picked.push(p);
    if (picked.length >= 5) break;
  }
  // Ensure at least 3 items (pad from GENERIC if needed).
  for (const g of GENERIC) {
    if (picked.length >= 3) break;
    const key = normalizeTopic(g);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(g);
  }

  return picked.slice(0, 5).map<FrontierNode>(p => ({
    id: mintSessionId(),
    topic: questionForm(p),
    score: 0.5,
    parent_round: 0,
    depth: 0,
    created_at: now,
    status: 'pending',
  }));
}

function questionForm(phrase: string): string {
  // Cheap: turn "caching strategies" into "What is relevant about caching strategies?"
  // Aesthetic is fine — fallback text is only read when the LLM path failed.
  return `What is relevant about ${phrase}?`;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Collapse normalized-topic duplicates from the LLM output. Keeps the higher-scored entry. */
function dedupeSeedList(nodes: FrontierNode[]): FrontierNode[] {
  const byKey = new Map<string, FrontierNode>();
  for (const n of nodes) {
    const key = normalizeTopic(n.topic);
    if (key.length === 0) continue;
    const existing = byKey.get(key);
    if (!existing || n.score > existing.score) byKey.set(key, n);
  }
  const out = Array.from(byKey.values());
  return out.slice(0, 5);
}
