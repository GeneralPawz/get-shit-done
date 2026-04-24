/**
 * Topic normalizer for D-15 dedup.
 *
 * Pure transform — no I/O, no external dependencies.
 * Exported for use by:
 *   - sdk/src/vision/round-result.ts (Plan 02 deduplicateFrontier)
 *   - sdk/src/vision/seed-frontier.ts (Plan 03 — for dedup of initial frontier nodes)
 *
 * Algorithm: lowercase + trim + strip non-alphanumeric (keep hyphen) → collapse whitespace →
 * drop single-char tokens + stopwords → join with single space.
 */

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','about','how',
  'what','why','when','where','which','who',
]);

/** Normalize a topic string for dedup comparison. Deterministic; never throws. */
export function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}
