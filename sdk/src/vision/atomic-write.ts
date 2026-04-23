/**
 * Atomic JSON writer for vision state artifacts.
 *
 * Uses tmp+rename pattern (same directory → same filesystem → no EXDEV)
 * with D5 direct-write fallback on rename failure.
 * Prevents partial state on mid-write crash.
 */

import { writeFile, rename, unlink } from 'node:fs/promises';

/**
 * Atomic JSON write via tmp + rename, with D5 fallback.
 * Tmp file lives in the same directory as target (same-fs → no EXDEV).
 *
 * @param targetPath - Absolute path to the destination JSON file
 * @param payload    - Any JSON-serializable value
 */
export async function atomicWriteJson<T>(targetPath: string, payload: T): Promise<void> {
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  const content = JSON.stringify(payload, null, 2) + '\n';
  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, targetPath);
  } catch {
    // D5: Rename-failure fallback — clean up temp, fall back to direct write
    try { await unlink(tmpPath); } catch { /* already gone */ }
    await writeFile(targetPath, content, 'utf-8');
  }
}
