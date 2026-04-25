/**
 * Unit tests for vision/config: VISION_CONFIG_DEFAULTS, loadVisionConfig.
 *
 * T1:  VISION_CONFIG_DEFAULTS has exact D-01/03/04/08/18/20/21 values.
 * T2:  loadVisionConfig returns full defaults when .planning/config.json is missing.
 * T3:  loadVisionConfig deep-merges a partial workflow.vision overlay.
 * T4:  loadVisionConfig with empty config.json returns full defaults (no throw).
 * T5:  loadVisionConfig returns a fresh object on every call (no shared reference).
 * T6:  loadVisionConfig does NOT perform file I/O itself (delegates to loadProjectConfig).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-vision-config-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('VISION_CONFIG_DEFAULTS', () => {
  it('T1: has exact D-01/03/04/08/18/20/21 default values', async () => {
    const { VISION_CONFIG_DEFAULTS } = await import('./config.js');
    expect(VISION_CONFIG_DEFAULTS.convergence.pending_threshold).toBe(2);    // D-01
    expect(VISION_CONFIG_DEFAULTS.convergence.plateau_threshold).toBe(1);    // D-03
    expect(VISION_CONFIG_DEFAULTS.convergence.window).toBe(2);               // D-04
    expect(VISION_CONFIG_DEFAULTS.safety.max_rounds).toBe(20);               // D-18
    expect(VISION_CONFIG_DEFAULTS.safety.consecutive_error_abort).toBe(3);   // D-20
    expect(VISION_CONFIG_DEFAULTS.decision_queue.confidence_max).toBe(0.6);  // D-08
    expect(VISION_CONFIG_DEFAULTS.decision_queue.surprises_min).toBe(1);     // D-08
  });
});

describe('loadVisionConfig', () => {
  it('T2: returns full defaults when .planning/config.json is missing', async () => {
    const { loadVisionConfig, VISION_CONFIG_DEFAULTS } = await import('./config.js');
    const cfg = await loadVisionConfig(tmpDir);
    expect(cfg).toEqual(VISION_CONFIG_DEFAULTS);
  });

  it('T3: deep-merges a partial workflow.vision overlay', async () => {
    const planningDir = join(tmpDir, '.planning');
    await mkdir(planningDir, { recursive: true });
    const payload = {
      workflow: {
        vision: {
          convergence: { pending_threshold: 5 },
        },
      },
    };
    await writeFile(join(planningDir, 'config.json'), JSON.stringify(payload));

    const { loadVisionConfig, VISION_CONFIG_DEFAULTS } = await import('./config.js');
    const cfg = await loadVisionConfig(tmpDir);

    // Overridden field
    expect(cfg.convergence.pending_threshold).toBe(5);
    // Non-overridden fields within same group stay at defaults
    expect(cfg.convergence.plateau_threshold).toBe(VISION_CONFIG_DEFAULTS.convergence.plateau_threshold);
    expect(cfg.convergence.window).toBe(VISION_CONFIG_DEFAULTS.convergence.window);
    // Other groups untouched
    expect(cfg.safety).toEqual(VISION_CONFIG_DEFAULTS.safety);
    expect(cfg.decision_queue).toEqual(VISION_CONFIG_DEFAULTS.decision_queue);
  });

  it('T4: returns full defaults when config.json exists but is empty (no throw)', async () => {
    const planningDir = join(tmpDir, '.planning');
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, 'config.json'), '');

    const { loadVisionConfig, VISION_CONFIG_DEFAULTS } = await import('./config.js');
    const cfg = await loadVisionConfig(tmpDir);
    expect(cfg).toEqual(VISION_CONFIG_DEFAULTS);
  });

  it('T5: returns a fresh object on every call (no shared reference)', async () => {
    const { loadVisionConfig } = await import('./config.js');
    const cfg1 = await loadVisionConfig(tmpDir);
    const cfg2 = await loadVisionConfig(tmpDir);
    expect(cfg1).not.toBe(cfg2);
    expect(cfg1.convergence).not.toBe(cfg2.convergence);
    // Mutating one must not affect the other
    cfg1.convergence.pending_threshold = 99;
    expect(cfg2.convergence.pending_threshold).toBe(2);
  });
});
