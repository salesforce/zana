import { formatSquadPlanFinding, type SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';
import type { TeamSummary } from '@zana-ai/zcc-domain/product';
import { inferredPlanCorrectionMessage } from '../team-coordinator-prompt.js';
import type { PortablePlanFinding } from '@zana-ai/zcc-server/services/execution/portable-plan';

/** Parser findings carry no roster, so they become the shared shape with no candidate slots. */
export function parserFindingsToSquadFindings(findings: readonly PortablePlanFinding[] | undefined): SquadPlanFinding[] {
  return (findings ?? []).map((finding) => ({
    ...(finding.stepId ? { stepId: finding.stepId } : {}),
    requirement: finding.requirement,
    severity: finding.severity,
    candidateSlots: [],
    suggestion: '',
    detail: finding.message
  }));
}

/**
 * The reason a Plan correction card shows: the parse error, plus one plain sentence per blocking finding
 * (requirement 23). Only `blocking` findings raise the card; `repair` and `warning` never appear here.
 */
export function planCorrectionReason(planError: string, findings?: readonly PortablePlanFinding[]): string {
  const base = planError.replace(/\.$/, '');
  const lines = parserFindingsToSquadFindings(findings)
    .filter((finding) => finding.severity === 'blocking' && !(finding.detail && base.includes(finding.detail)))
    .map(formatSquadPlanFinding);
  return lines.length ? `${base}. ${lines.join(' ')}` : planError;
}

export type PlanIntakeDisposition = 'proceed' | 'card' | 'infer';

/**
 * Intake decision for a plan the launcher judged. No error proceeds. Prose with no steps on an attended
 * launch of a Squad that can write a plan falls back to infer-plan with the prose as the goal; every other
 * error (including schedules and triggers, which are unattended) keeps the card.
 */
export function planIntakeDisposition(args: { planError: string | undefined; attended: boolean; canInfer: boolean; hasSteps: boolean }): PlanIntakeDisposition {
  if (!args.planError) return 'proceed';
  return args.attended && args.canInfer && !args.hasSteps ? 'infer' : 'card';
}

/** A corrected plan is offered only for an exact single match, which the finding phrases as `Use "<name>" ...`. */
export function findingOffersFix(finding: Pick<SquadPlanFinding, 'requirement' | 'suggestion'>): boolean {
  return finding.requirement === 'required-role' && /^Use "[^"]+" as the required role\.$/.test(finding.suggestion);
}

export interface InferredPlanJudgeDeps {
  /** The execution's Squad and coordination mode; undefined when the record is gone. */
  execution(projectId: string, executionId: string): Promise<{ teamId: string; coordinationMode?: string } | undefined>;
  /** Shared Squad check (host `judgePlanFindings`) plus the Squad summary the correction message lists. */
  judge(projectId: string, teamId: string, units: readonly unknown[]): Promise<{ findings: SquadPlanFinding[]; summary: Pick<TeamSummary, 'slots'> } | undefined>;
}

/**
 * Runs the shared Squad check on a coordinator-authored (inferred) plan. Returns the one correction message and
 * the human reason when blocking findings exist; undefined for provided plans, a missing Squad, or no blocking finding.
 */
export async function judgeInferredPlan(
  deps: InferredPlanJudgeDeps,
  ctx: { projectId: string; executionId: string },
  units: readonly unknown[]
): Promise<{ message: string; reason: string } | undefined> {
  const record = await deps.execution(ctx.projectId, ctx.executionId);
  if (!record || record.coordinationMode !== 'freeform') return undefined;
  const judged = await deps.judge(ctx.projectId, record.teamId, units);
  const blocking = judged?.findings.filter((finding) => finding.severity === 'blocking') ?? [];
  if (!judged || !blocking.length) return undefined;
  return {
    message: inferredPlanCorrectionMessage(judged.findings, judged.summary),
    reason: `The plan does not fit this Squad. ${blocking.slice(0, 5).map(formatSquadPlanFinding).join(' ')}`
  };
}
