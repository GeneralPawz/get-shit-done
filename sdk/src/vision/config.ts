/**
 * Vision-domain config reader — extracts and defaults workflow.vision.* from
 * the project config.json. Delegates to ../config.js loadConfig() for file
 * I/O and three-level deep-merge of the outer GSDConfig.
 *
 * Loaded once at session kickoff in supervisor.ts (Phase 3 PLAN 05);
 * the resulting VisionConfig is passed to runLoop() (Phase 3 PLAN 03).
 *
 * Per RESEARCH Open Question 4 (recommendation): keep vision/* self-contained;
 * do not pollute WorkflowConfig with vision-specific keys.
 */

import { loadConfig as loadProjectConfig } from '../config.js';
import type { VisionConfig } from './types.js';

// ─── Defaults (D-01/03/04/08/18/20/21) ──────────────────────────────────────

/** D-21 default values. CONTEXT D-01/03/04 define convergence; D-18/20 define safety; D-08 defines decision_queue. */
export const VISION_CONFIG_DEFAULTS: VisionConfig = {
  convergence: {
    pending_threshold: 2,            // D-01
    plateau_threshold: 1,            // D-03
    window: 2,                       // D-04
  },
  safety: {
    max_rounds: 20,                  // D-18
    consecutive_error_abort: 3,      // D-20
  },
  decision_queue: {
    confidence_max: 0.6,             // D-08
    surprises_min: 1,                // D-08
  },
};

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load vision-domain config from `.planning/config.json > workflow.vision.*`,
 * merging against VISION_CONFIG_DEFAULTS. Returns full defaults when the file
 * is missing, empty, or has no `workflow.vision` key — never throws on the
 * missing-file path (loadProjectConfig owns that contract).
 *
 * @param projectDir Absolute path to the project root (the dir that contains .planning/).
 */
export async function loadVisionConfig(projectDir: string): Promise<VisionConfig> {
  const cfg = await loadProjectConfig(projectDir);
  // workflow.vision is not declared on WorkflowConfig (we keep it out by design —
  // RESEARCH Open Q4); read it via an unsafe cast and treat missing as {}.
  const v =
    ((cfg.workflow as { vision?: Partial<VisionConfig> } | undefined)?.vision) ?? {};

  return {
    convergence: {
      ...VISION_CONFIG_DEFAULTS.convergence,
      ...(v.convergence ?? {}),
    },
    safety: {
      ...VISION_CONFIG_DEFAULTS.safety,
      ...(v.safety ?? {}),
    },
    decision_queue: {
      ...VISION_CONFIG_DEFAULTS.decision_queue,
      ...(v.decision_queue ?? {}),
    },
  };
}
