/**
 * Streaming SHA-256 manifest builder and validator for vision artifacts.
 *
 * hashFile:       streams a file through createHash('sha256'), returns SHAManifestEntry.
 * buildManifest:  walks a planning root recursively, returns sorted SHAManifestEntry[].
 * validateManifest: rehashes expected entries, returns ValidationResult with
 *                  'missing' | 'size-mismatch' | 'sha-mismatch' reasons in that priority order.
 */

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { join, relative } from 'node:path';
import type { SHAManifestEntry, ValidationResult } from './types.js';

/**
 * Hash a single file via streaming SHA-256.
 * Throws on any failure — manifest integrity is load-bearing.
 *
 * @param fullPath    - Absolute path to the file
 * @param repoRelPath - Path relative to the planning root (stored in manifest)
 */
export async function hashFile(fullPath: string, repoRelPath: string): Promise<SHAManifestEntry> {
  const hash = createHash('sha256');
  const st = await stat(fullPath);
  await pipeline(createReadStream(fullPath), hash);
  return { path: repoRelPath, sha256: hash.digest('hex'), bytes: st.size };
}

/**
 * Walk planningRoot recursively, hash every file except selfExcludeName,
 * return entries sorted by path (deterministic order for reproducible manifests).
 *
 * @param planningRoot     - Absolute path to the .planning/ directory
 * @param selfExcludeName  - Filename to skip at any depth (default: 'vision-state.json')
 */
export async function buildManifest(
  planningRoot: string,
  selfExcludeName = 'vision-state.json',
): Promise<SHAManifestEntry[]> {
  const entries: SHAManifestEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const full = join(dir, it.name);
      if (it.isDirectory()) { await walk(full); continue; }
      if (it.isFile() && it.name !== selfExcludeName) {
        entries.push(await hashFile(full, relative(planningRoot, full)));
      }
    }
  }

  await walk(planningRoot);
  entries.sort((a, b) => a.path.localeCompare(b.path));  // deterministic order
  return entries;
}

/**
 * Rehash each expected entry, compare against on-disk state.
 * Priority order: missing → size-mismatch → sha-mismatch.
 * Returns {ok: true} if all match, {ok: false, mismatches: [...]} otherwise.
 *
 * @param planningRoot - Absolute path to the .planning/ directory
 * @param expected     - Previously recorded manifest entries
 */
export async function validateManifest(
  planningRoot: string,
  expected: SHAManifestEntry[],
): Promise<ValidationResult> {
  const mismatches: Array<{
    path: string;
    reason: 'missing' | 'sha-mismatch' | 'size-mismatch';
    expected?: SHAManifestEntry;
    actual?: SHAManifestEntry;
  }> = [];

  for (const exp of expected) {
    const full = join(planningRoot, exp.path);
    let st;
    try {
      st = await stat(full);
    } catch {
      mismatches.push({ path: exp.path, reason: 'missing', expected: exp });
      continue;
    }

    // Size check runs first — enables "truncated" diagnostic distinct from "overwritten"
    if (st.size !== exp.bytes) {
      mismatches.push({
        path: exp.path,
        reason: 'size-mismatch',
        expected: exp,
        actual: { path: exp.path, sha256: 'not-computed', bytes: st.size },
      });
      continue;
    }

    const actual = await hashFile(full, exp.path);
    if (actual.sha256 !== exp.sha256) {
      mismatches.push({ path: exp.path, reason: 'sha-mismatch', expected: exp, actual });
    }
  }

  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}
