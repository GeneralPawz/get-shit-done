/**
 * SAFE-03 Tier 2 Bash allowlist — regex-based allow/deny evaluator.
 *
 * Loads the versioned allowlist file at get-shit-done/references/vision-bash-allowlist.json,
 * compiles every pattern into a RegExp, and evaluates full command strings
 * (not prefixes) against the compiled set. Emits a structured audit log entry
 * per evaluation via an optional callback — the supervisor wires this to the
 * session audit log file.
 *
 * Per D-10, this is the LAST prompt-layer gate: structural realpath → bwrap
 * mount topology → allowlist (this module) → settings.local.json Deny rules (belt).
 */

import { readFile } from 'node:fs/promises';
import { GSDError, ErrorClassification } from '../errors.js';

// ─── Public interfaces ───────────────────────────────────────────────────────

export interface AllowlistEntry {
  pattern: string;
  description: string;
  source?: string;
}

export interface AllowlistFile {
  schema_version: 1;
  patterns: AllowlistEntry[];
}

export interface CompiledAllowlist {
  entries: Array<{ re: RegExp; source: AllowlistEntry }>;
}

export interface AllowlistDecision {
  decision: 'allow' | 'deny';
  matched_pattern: string | null;
  ts: string;        // ISO 8601
  command: string;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load and compile the allowlist JSON from `path`.
 *
 * Validates schema_version === 1 (rejects anything else to prevent silent
 * acceptance of an incompatible future format — T-05-02 mitigation).
 *
 * Compiles every pattern into a RegExp at load time, not per-evaluation.
 * Any SyntaxError in a pattern throws GSDError(Validation) with the offending
 * pattern string in the message (T-05-03 mitigation).
 *
 * @throws GSDError(IO) if the file cannot be read
 * @throws GSDError(Validation) if JSON is invalid, schema_version != 1,
 *         patterns is not an array, or any pattern is an invalid regex
 */
export async function loadAllowlist(path: string): Promise<CompiledAllowlist> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    throw new GSDError(
      `allowlist file not readable: ${path}`,
      ErrorClassification.Execution,
    );
  }

  let parsed: AllowlistFile;
  try {
    parsed = JSON.parse(raw) as AllowlistFile;
  } catch {
    throw new GSDError(
      `allowlist file is not valid JSON: ${path}`,
      ErrorClassification.Validation,
    );
  }

  if (parsed.schema_version !== 1) {
    throw new GSDError(
      `unsupported allowlist schema version ${parsed.schema_version} (expected 1)`,
      ErrorClassification.Validation,
    );
  }

  if (!Array.isArray(parsed.patterns)) {
    throw new GSDError('allowlist.patterns must be an array', ErrorClassification.Validation);
  }

  const entries = parsed.patterns.map((p) => {
    if (!p.pattern.startsWith('^') || !p.pattern.endsWith('$')) {
      throw new GSDError(
        `allowlist pattern must be fully anchored (^…$): ${p.pattern}`,
        ErrorClassification.Validation,
      );
    }
    let re: RegExp;
    try {
      re = new RegExp(p.pattern);
    } catch (e) {
      throw new GSDError(
        `allowlist pattern is invalid regex: ${p.pattern} — ${(e as Error).message}`,
        ErrorClassification.Validation,
      );
    }
    return { re, source: p };
  });

  return { entries };
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Evaluate a full Bash command string against the compiled allowlist.
 *
 * Every pattern in the allowlist JSON is already anchored (^…$), so
 * re.test() tests the full command string — not a prefix — which prevents
 * semicolon-injection bypasses (T-05-01 mitigation, T6 asserts this).
 *
 * If `auditLog` is provided it is invoked exactly once, after the decision
 * is computed but before the function returns, with the AllowlistDecision
 * object that will be returned (T-05-04 mitigation, T9 asserts this).
 *
 * @param compiled - Compiled allowlist from loadAllowlist
 * @param command  - Full Bash command string to evaluate
 * @param auditLog - Optional callback; supervisor wires this to the append-only
 *                   session audit file under the worktree
 * @returns AllowlistDecision with decision, matched_pattern (or null), ts, command
 */
export function evaluateBashCommand(
  compiled: CompiledAllowlist,
  command: string,
  auditLog?: (entry: AllowlistDecision) => void,
): AllowlistDecision {
  const ts = new Date().toISOString();

  for (const { re, source } of compiled.entries) {
    if (re.test(command)) {
      const entry: AllowlistDecision = {
        decision: 'allow',
        matched_pattern: source.pattern,
        ts,
        command,
      };
      if (auditLog) auditLog(entry);
      return entry;
    }
  }

  const entry: AllowlistDecision = {
    decision: 'deny',
    matched_pattern: null,
    ts,
    command,
  };
  if (auditLog) auditLog(entry);
  return entry;
}
