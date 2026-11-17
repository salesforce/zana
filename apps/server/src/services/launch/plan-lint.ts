/**
 * Pure plan lint (no I/O): parallelism width, mixed contract-and-UI steps and mechanical contradictions,
 * reported as Check findings in the shared finding shape. Called from `buildPlanFindings`.
 */
import type { SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';

/** The fields lint reads from a plan step (a structural subset of `ExecutionWorkUnitInput`). */
export interface LintUnit {
  id: string;
  dependencies: readonly string[];
  files?: readonly string[];
  readOnly?: boolean;
}

/** Largest set of steps with no dependency path between any two; undefined when the check is skipped. */
export function planParallelWidth(units: readonly LintUnit[]): number | undefined {
  void units;
  throw new Error('not implemented: planParallelWidth');
}

/** Check findings for a plan; `workerCount` is undefined when no Squad judges the plan. */
export function lintPlan(input: { units: readonly LintUnit[]; workerCount: number | undefined }): SquadPlanFinding[] {
  void input;
  throw new Error('not implemented: lintPlan');
}

/** For each step, the ids of the steps that will not run if it fails (transitive, in plan order). */
export function skipImpact(units: readonly LintUnit[]): Map<string, string[]> {
  void units;
  throw new Error('not implemented: skipImpact');
}
