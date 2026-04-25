/**
 * TDD tests for Phase 3 type surface additions to sdk/src/vision/types.ts
 *
 * T1: DecisionLogEntry interface is exported with the exact five fields (D-02)
 * T2: ConvergenceVerdict interface is exported with required shape (D-06)
 * T3: StopEvidence interface is exported with mandatory and optional fields (D-11/D-17)
 * T4: VisionConfig interface is exported with three configuration groups (D-21)
 * T5: Phase 3 banner comment present in types.ts (section separator)
 * T6: VisionState.decisions_log is narrowed to DecisionLogEntry[] (D-02)
 * T7: VisionState.stop_evidence field is present and typed StopEvidence | null (D-11)
 * T8: SynthesisHook.onConverged additive method present with (state, verdict) signature (D-07)
 * T9: SynthesisHook.onForcedStop signature unchanged (D-16 frozen)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const typesPath = resolve(import.meta.dirname, './types.ts');
const typesSource = readFileSync(typesPath, 'utf-8');

describe('Phase 3 type surface — types.ts', () => {
  it('T1: exports DecisionLogEntry with exactly five required fields (D-02)', () => {
    expect(typesSource).toMatch(/^export interface DecisionLogEntry \{/m);
    expect(typesSource).toMatch(/id: string/);
    expect(typesSource).toMatch(/round_added: number/);
    expect(typesSource).toMatch(/type: 'path_fork' \| 'assumption_unverified' \| 'risk_alert'/);
    expect(typesSource).toMatch(/blocking: boolean/);
    expect(typesSource).toMatch(/resolved: boolean/);
  });

  it('T2: exports ConvergenceVerdict with required shape (D-06)', () => {
    expect(typesSource).toMatch(/^export interface ConvergenceVerdict \{/m);
    expect(typesSource).toMatch(/converged: boolean/);
    expect(typesSource).toMatch(/conditions: \{ frontier: boolean; queue: boolean; sources: boolean \}/);
    expect(typesSource).toMatch(/evaluated_at: string/);
    expect(typesSource).toMatch(/evidence: \{/);
    expect(typesSource).toMatch(/pending_count: number/);
    expect(typesSource).toMatch(/blocking_unresolved_count: number/);
    expect(typesSource).toMatch(/new_frontier_nodes_delta: number/);
  });

  it('T3: exports StopEvidence with mandatory and optional fields (D-11/D-17)', () => {
    expect(typesSource).toMatch(/^export interface StopEvidence \{/m);
    expect(typesSource).toMatch(/stopped_at: string/);
    expect(typesSource).toMatch(/final_round: number/);
    expect(typesSource).toMatch(/final_frontier_pending_count: number/);
    expect(typesSource).toMatch(/convergence_history: ConvergenceVerdict\[\]/);
    expect(typesSource).toMatch(/max-rounds-exceeded/);
    expect(typesSource).toMatch(/consecutive-error-rounds/);
    expect(typesSource).toMatch(/uncaught-exception/);
  });

  it('T4: exports VisionConfig with three config groups (D-21)', () => {
    expect(typesSource).toMatch(/^export interface VisionConfig \{/m);
    expect(typesSource).toMatch(/pending_threshold: number/);
    expect(typesSource).toMatch(/plateau_threshold: number/);
    expect(typesSource).toMatch(/max_rounds: number/);
    expect(typesSource).toMatch(/consecutive_error_abort: number/);
    expect(typesSource).toMatch(/confidence_max: number/);
    expect(typesSource).toMatch(/surprises_min: number/);
  });

  it('T5: Phase 3 banner comment present', () => {
    expect(typesSource).toMatch(/Phase 3: Convergence \+ Decision Queue \+ Stop Evidence \+ Config/);
  });

  it('T6: VisionState.decisions_log narrowed to DecisionLogEntry[] (D-02)', () => {
    expect(typesSource).toMatch(/decisions_log: DecisionLogEntry\[\]/);
    expect(typesSource).not.toMatch(/decisions_log: unknown\[\]/);
  });

  it('T7: VisionState.stop_evidence typed StopEvidence | null (D-11)', () => {
    expect(typesSource).toMatch(/stop_evidence: StopEvidence \| null/);
  });

  it('T8: SynthesisHook.onConverged additive method present (D-07)', () => {
    expect(typesSource).toMatch(/onConverged\(/);
    expect(typesSource).toMatch(/verdict: Readonly<ConvergenceVerdict>/);
  });

  it('T9: SynthesisHook.onForcedStop signature unchanged (D-16 frozen)', () => {
    expect(typesSource).toMatch(/onForcedStop\(state: Readonly<VisionState>\): Promise<void>/);
  });
});
