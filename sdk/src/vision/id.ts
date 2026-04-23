/**
 * ULID-monotonic session ID minter.
 *
 * Uses ulidx.monotonicFactory() to guarantee lexicographic ordering
 * even for IDs minted within the same millisecond. 26-char Crockford-base32
 * — filesystem-safe, no ambiguous characters.
 */

import { monotonicFactory } from 'ulidx';

const ulidMonotonic = monotonicFactory();

/**
 * Mint a 26-char Crockford-base32 ULID — monotonic within ms, filesystem-safe.
 *
 * Subsequent calls in the same millisecond return lex-ordered strings.
 * Used as {sid} in gsd-vision-{sid} worktree paths and vision-state.json.
 */
export function mintSessionId(): string {
  return ulidMonotonic();
}
