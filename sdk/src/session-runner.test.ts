/**
 * Unit tests for session-runner.ts
 *
 * Regression test for #2194: runPhaseStepSession was passing the full prompt
 * string as both the user-visible prompt: message and systemPrompt.append,
 * doubling the token cost on every phase step invocation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaseStepType } from './types.js';
import { CONFIG_DEFAULTS } from './config.js';
import type { GSDConfig } from './config.js';

// ─── Mock the Agent SDK ───────────────────────────────────────────────────────

// Capture the query call options so we can assert on them without making real API calls.
const mockQueryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  async function* fakeQueryStream() {
    // Yield a minimal success result message so processQueryStream completes.
    yield {
      type: 'result',
      subtype: 'success',
      session_id: 'test-session',
      total_cost_usd: 0,
      duration_ms: 1,
      num_turns: 1,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  }

  return {
    query: vi.fn((args: { prompt: string; options: Record<string, unknown> }) => {
      mockQueryCalls.push({ prompt: args.prompt, options: args.options });
      return fakeQueryStream();
    }),
  };
});

// ─── Import SUT after mock is hoisted ────────────────────────────────────────

import { runPhaseStepSession, resolveClaudeCodeExecutable, resetClaudeCodeExecutableCacheForTests } from './session-runner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<GSDConfig> = {}): GSDConfig {
  return { ...CONFIG_DEFAULTS, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runPhaseStepSession', () => {
  beforeEach(() => {
    mockQueryCalls.length = 0;
  });

  it('does not duplicate the prompt in both the user message and systemPrompt.append', async () => {
    const fullPrompt = 'You are a researcher. Investigate the topic thoroughly.\n\n## Context\nDetailed instructions here...';

    await runPhaseStepSession(fullPrompt, PhaseStepType.Research, makeConfig());

    expect(mockQueryCalls).toHaveLength(1);

    const call = mockQueryCalls[0];
    const appendValue = (call.options.systemPrompt as { append?: string })?.append;

    // The full prompt must appear in systemPrompt.append (that is its correct location).
    expect(appendValue).toBe(fullPrompt);

    // The user-visible prompt: must NOT be the full prompt — it should be a short directive.
    expect(call.prompt).not.toBe(fullPrompt);
    expect(call.prompt.length).toBeLessThan(fullPrompt.length);
  });

  it('passes the full prompt in systemPrompt.append', async () => {
    const fullPrompt = 'Complex multi-line\nprompt with $VARIABLES and $(command) patterns.';

    await runPhaseStepSession(fullPrompt, PhaseStepType.Execute, makeConfig());

    const call = mockQueryCalls[0];
    const appendValue = (call.options.systemPrompt as { append?: string })?.append;

    expect(appendValue).toBe(fullPrompt);
  });

  it('returns a successful PlanResult', async () => {
    const result = await runPhaseStepSession('Test prompt', PhaseStepType.Verify, makeConfig());

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('test-session');
  });

  it('threads pathToClaudeCodeExecutable into query() options when resolvable', async () => {
    resetClaudeCodeExecutableCacheForTests();
    const original = process.env.CLAUDE_CODE_EXECUTABLE;
    process.env.CLAUDE_CODE_EXECUTABLE = '/tmp/fake-claude-bin';
    try {
      await runPhaseStepSession('Test prompt', PhaseStepType.Execute, makeConfig());
      const call = mockQueryCalls[mockQueryCalls.length - 1];
      expect(call.options.pathToClaudeCodeExecutable).toBe('/tmp/fake-claude-bin');
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CODE_EXECUTABLE;
      else process.env.CLAUDE_CODE_EXECUTABLE = original;
      resetClaudeCodeExecutableCacheForTests();
    }
  });
});

describe('resolveClaudeCodeExecutable', () => {
  it('respects CLAUDE_CODE_EXECUTABLE env override', () => {
    resetClaudeCodeExecutableCacheForTests();
    const original = process.env.CLAUDE_CODE_EXECUTABLE;
    process.env.CLAUDE_CODE_EXECUTABLE = '/opt/claude/bin/claude';
    try {
      expect(resolveClaudeCodeExecutable()).toBe('/opt/claude/bin/claude');
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CODE_EXECUTABLE;
      else process.env.CLAUDE_CODE_EXECUTABLE = original;
      resetClaudeCodeExecutableCacheForTests();
    }
  });

  it('memoizes the resolved path across calls', () => {
    resetClaudeCodeExecutableCacheForTests();
    const original = process.env.CLAUDE_CODE_EXECUTABLE;
    process.env.CLAUDE_CODE_EXECUTABLE = '/cached/path/claude';
    try {
      const first = resolveClaudeCodeExecutable();
      process.env.CLAUDE_CODE_EXECUTABLE = '/different/path/claude';
      const second = resolveClaudeCodeExecutable();
      expect(second).toBe(first);
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CODE_EXECUTABLE;
      else process.env.CLAUDE_CODE_EXECUTABLE = original;
      resetClaudeCodeExecutableCacheForTests();
    }
  });
});
