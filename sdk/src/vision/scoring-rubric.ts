/**
 * Shared scoring rubric — single source of truth for D-13 rubric weights.
 *
 * Imported by:
 *   - agents/gsd-vision-explorer.md (embedded as prose via Plan 04 template injection)
 *   - sdk/src/vision/seed-frontier.ts (Plan 03 — injected into the one-shot LLM prompt)
 *
 * No runtime deps. Single source of truth — any weight change requires editing ONLY this file.
 */

/** Rubric prose block — injected verbatim into any prompt that needs scoring. */
export const SCORING_RUBRIC_PROSE = `
Score each follow_up_question from 0.0 to 1.0 by computing:
  score = (0.4 × relevance) + (0.3 × novelty) + (0.2 × specificity) + (0.1 × tractability)

- Relevance (0.4): How directly does this question advance the stated direction?
- Novelty (0.3): Does the parent finding's surprises[] suggest genuinely new territory?
- Specificity (0.2): Is the question narrow enough for one subagent pass?
- Tractability (0.1): Can a single researcher answer this from codebase + docs?

Output score as a float with 2 decimal places.
`.trim();

/** Rubric weights as numeric constants for seed-frontier.ts deterministic fallback. */
export const RUBRIC_WEIGHTS = {
  relevance: 0.4,
  novelty: 0.3,
  specificity: 0.2,
  tractability: 0.1,
} as const;
