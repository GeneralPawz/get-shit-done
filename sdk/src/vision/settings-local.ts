/**
 * SAFE-02 session-scoped settings.local.json generator.
 *
 * Reads the committed template `get-shit-done/templates/vision-settings.local.json`,
 * substitutes `<WORKTREE>` and `<REPO_RO>` tokens with actual absolute paths,
 * writes the result to `<worktreePath>/.claude/settings.local.json` via atomicWriteJson,
 * and returns the file path + SHA-256 of the written file for audit recording.
 *
 * The returned SHA-256 is recorded by the caller (supervisor) in vision-state.json
 * under the audit field — this module does NOT write vision-state, it only provides
 * the hash.
 *
 * The generated settings.local.json enforces:
 *  - Deny: Write(/**) and Bash(*) — default-deny all writes and Bash
 *  - Allow: Explicit write targets under .planning/drafts/, .planning/seeds/,
 *           .planning/VISION-CATCHUP.md, and vision-state.json
 */

import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { atomicWriteJson } from './atomic-write.js';
import { hashFile } from './sha-manifest.js';

// Template ships with the repo; resolved relative to repo root at runtime.
const TEMPLATE_REL_PATH = 'get-shit-done/templates/vision-settings.local.json';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SettingsLocalResult {
  /** Absolute path to the written settings.local.json */
  settingsPath: string;
  /** SHA-256 hex digest of the written file (for audit recording in vision-state.json) */
  settingsSha256: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Materialise `settings.local.json` from the committed template.
 *
 * Steps (per SAFE-02 four-step approach):
 * 1. Read template from `<repoRoot>/get-shit-done/templates/vision-settings.local.json`
 * 2. Substitute `<WORKTREE>` → `worktreePath` and `<REPO_RO>` → `repoReadOnlyRoot`
 * 3. Write result to `<worktreePath>/.claude/settings.local.json` via atomicWriteJson
 * 4. Hash the written file via sha-manifest.hashFile; return path + SHA-256
 *
 * Throws GSDError on:
 *  - Template file missing or unreadable
 *  - Post-substitution content is not valid JSON (template corruption guard)
 *
 * @param worktreePath     - Absolute path to the throwaway git worktree
 * @param repoReadOnlyRoot - Absolute path to the read-only source repo root
 * @param repoRoot         - Absolute path to the GSD repo root (where template lives)
 */
export async function writeSettingsLocal(
  worktreePath: string,
  repoReadOnlyRoot: string,
  repoRoot: string,
): Promise<SettingsLocalResult> {
  // Step 1: Read template
  const templatePath = join(repoRoot, TEMPLATE_REL_PATH);
  let raw: string;
  try {
    raw = await readFile(templatePath, 'utf-8');
  } catch (e) {
    throw new GSDError(
      `settings template missing: ${templatePath}`,
      ErrorClassification.Execution,
    );
  }

  // Step 2: Substitute tokens
  const substituted = raw
    .replaceAll('<WORKTREE>', worktreePath)
    .replaceAll('<REPO_RO>', repoReadOnlyRoot);

  // Validate post-substitution is still valid JSON (template corruption guard)
  let template: unknown;
  try {
    template = JSON.parse(substituted);
  } catch (e) {
    throw new GSDError(
      `settings template produced invalid JSON after substitution: ${(e as Error).message}`,
      ErrorClassification.Execution,
    );
  }

  // Step 3: Write via atomicWriteJson (never raw writeFile for JSON)
  const settingsDir = join(worktreePath, '.claude');
  await mkdir(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, 'settings.local.json');
  await atomicWriteJson(settingsPath, template);

  // Step 4: Hash for audit
  const entry = await hashFile(settingsPath, 'settings.local.json');

  return { settingsPath, settingsSha256: entry.sha256 };
}
