import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { randomUUID } from 'node:crypto';
import { launchDigest } from '@zana-ai/zcc-server/services/launch/digest';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import { hasPortablePlanStep } from '@zana-ai/zcc-server/services/execution/portable-plan';
import {
  correctionProseRelPath,
  correctionDiffRelPath,
  correctedPlanRelPath,
  authoredPlanRelPath,
  readHandoffArtifact,
  type AuthoredPlanRead,
  type CoordinatorHandoffContext
} from '../team-plan-handoff.js';
import { type PlanCorrectionRecord } from './store.js';

export const PLAN_CORRECTION_ACTION = 'plan-correction';
export const PLAN_CORRECTION_MAX_RETRIES = 3;

const correctionArtifactPaths = (executionId: string) => new Set([
  authoredPlanRelPath(executionId),
  correctionProseRelPath(executionId),
  correctedPlanRelPath(executionId),
  correctionDiffRelPath(executionId)
]);

interface PlanCorrectionActionRef {
  executionId: string;
  offerId: string;
  digest: string;
}

export function parsePlanCorrectionActionRef(ref: string): PlanCorrectionActionRef | undefined {
  try {
    const value = JSON.parse(ref) as Partial<PlanCorrectionActionRef>;
    return typeof value.executionId === 'string' && typeof value.offerId === 'string' && typeof value.digest === 'string'
      ? value as PlanCorrectionActionRef
      : undefined;
  } catch {
    return undefined;
  }
}

export async function runPlanCorrectionHostAction(
  service: PlanCorrectionService,
  ref: string,
  input?: string
): Promise<void> {
  const action = parsePlanCorrectionActionRef(ref);
  if (!action) throw new Error('invalid plan correction action');
  if (await service.respond(action.executionId, input, action) === 'reject') {
    throw new Error('plan correction action was rejected or superseded');
  }
}

export interface PlanCorrectionDeps {
  appendInbox(input: Omit<InboxEntry, 'id' | 'ts'>): Promise<InboxEntry>;
  bindInboxAction(entry: InboxEntry, action: { kind: string; ref: string }): boolean;
  nudge(sessionId: string, text: string): void;
  readCorrectedPlan(projectRoot: string, executionId: string): Promise<AuthoredPlanRead>;
  store: {
    get(executionId: string): Promise<PlanCorrectionRecord | undefined>;
    listCancelled?(): Promise<PlanCorrectionRecord[]>;
    put(record: PlanCorrectionRecord): Promise<PlanCorrectionRecord>;
  };
  resume(ctx: CoordinatorHandoffContext): Promise<void>;
  stopExecution(executionId: string): Promise<void>;
  logRecoveryError?(executionId: string, error: unknown): void;
}

export interface PlanCorrectionRecoveryFailure {
  executionId: string;
  error: unknown;
}

export class PlanCorrectionService {
  private readonly responseTails = new Map<string, Promise<void>>();
  /** Bound offers need no duplicate Inbox entry until process state is lost. */
  private readonly publishedOfferIds = new Set<string>();

  constructor(private readonly deps: PlanCorrectionDeps) {}

  async begin(executionId: string, reason: string, unattended: boolean): Promise<void> {
    await this.deps.store.put({
      ctx: { sessionId: '', projectId: '', projectRoot: '', executionId, slotId: '' },
      retries: unattended ? PLAN_CORRECTION_MAX_RETRIES : 0,
      reason,
      executionId,
      status: 'correction-required'
    });
  }

  async review(ctx: CoordinatorHandoffContext, source: Extract<AuthoredPlanRead, { status: 'ok' }>): Promise<Extract<AuthoredPlanRead, { status: 'ok' }> | 'wait' | 'reject'> {
    return this.serialize(ctx.executionId, async () => {
      const current = await this.deps.store.get(ctx.executionId);
      if (!current) return source;
      if (current.status === 'cancelled') return this.rejectCancelled(current);
      current.ctx = ctx;
      const corrected = await this.deps.readCorrectedPlan(ctx.projectRoot, ctx.executionId);
      return this.reviewCorrected(current, corrected);
    });
  }

  async reviewInvalid(ctx: CoordinatorHandoffContext, reason: string): Promise<Extract<AuthoredPlanRead, { status: 'ok' }> | 'wait' | 'reject' | undefined> {
    return this.serialize(ctx.executionId, async () => {
      const current = await this.deps.store.get(ctx.executionId);
      // This invalid plan is not a rejected provided plan. Let normal handoff
      // nudges recover inferred or coordinator-authored plans.
      if (!current) return undefined;
      current.ctx = ctx;
      current.reason = reason;
      const corrected = await this.deps.readCorrectedPlan(ctx.projectRoot, ctx.executionId);
      return this.reviewCorrected(current, corrected);
    });
  }

  private async reviewCorrected(current: PlanCorrectionRecord, corrected: AuthoredPlanRead): Promise<Extract<AuthoredPlanRead, { status: 'ok' }> | 'wait' | 'reject'> {
    if (current.status === 'cancelled') return this.rejectCancelled(current);
    if (current.status === 'approved') {
      // Approval authorizes one captured plan. A later file edit starts another review.
      if (corrected.status === 'ok' && current.approvedDigest === planDigest(corrected.units)) return this.approvedSnapshot(current);
      this.clearApproval(current);
      current.offeredDigest = undefined;
      current.offeredUnits = undefined;
      current.status = 'correction-required';
      if (!await this.persistActive(current)) return this.rejectCancelled(current);
    }
    if (corrected.status !== 'ok') {
      this.clearApproval(current);
      // A source-plan parse failure does not invalidate an already presented
      // corrected-plan offer or spend another human-review attempt.
      if (current.status === 'pending' && current.offeredDigest) {
        if (!await this.persistActive(current)) return this.rejectCancelled(current);
        return 'wait';
      }
      if (current.retries >= PLAN_CORRECTION_MAX_RETRIES) return 'reject';
      return this.request(current);
    }
    const digest = planDigest(corrected.units);
    if (current.offeredDigest !== digest) {
      this.clearApproval(current);
      current.offeredDigest = digest;
      current.offeredUnits = cloneUnits(corrected.units);
      current.status = 'correction-required';
    }
    // Final offered correction remains actionable until user answers. Do not turn
    // a pending third request into an implicit rejection on later idle edges.
    if (current.status === 'pending') {
      return current.offeredActionId && this.publishedOfferIds.has(current.offeredActionId)
        ? 'wait'
        : this.publishPendingOffer(current);
    }
    if (current.retries >= PLAN_CORRECTION_MAX_RETRIES) return 'reject';
    return this.request(current);
  }

  private async request(current: PlanCorrectionRecord): Promise<'wait' | 'reject'> {
    if (current.retries >= PLAN_CORRECTION_MAX_RETRIES) return 'reject';
    current.retries += 1;
    current.status = 'pending';
    current.offeredActionId = randomUUID();
    // Persist complete offer before appendInbox exposes its approval action.
    if (!await this.persistActive(current)) return this.rejectCancelled(current);
    return this.publishPendingOffer(current);
  }

  /** Re-publish a durable offer after an inbox append/bind failure or restart. */
  private async publishPendingOffer(current: PlanCorrectionRecord): Promise<'wait' | 'reject'> {
    const ctx = current.ctx;
    const entry = await this.deps.appendInbox({
      projectId: ctx.projectId,
      projectLabel: undefined,
      sessionId: ctx.sessionId,
      hostActionRequired: true,
      subject: 'Plan correction required',
      comments: 'A submitted plan needs your review before work can continue. A revised plan has been prepared when available.\n\nApprove uses this exact revised plan and starts work. Request changes sends it back for revision. Cancel stops this run.',
      decisionGuidance: {
        kind: 'plan-correction',
        diagnostic: current.reason,
        correctedPlanPath: correctedPlanRelPath(ctx.executionId)
      },
      questions: [{
        prompt: current.offeredDigest ? 'Approve corrected plan, request changes, or cancel?' : 'Request a corrected plan or cancel?',
        options: [
          ...(current.offeredDigest ? [{ id: 'approve', label: 'Approve' }] : []),
          { id: 'changes', label: 'Request changes' },
          { id: 'cancel', label: 'Cancel' }
        ]
      }]
    });
    if (!current.offeredActionId || !this.deps.bindInboxAction(entry, {
      kind: PLAN_CORRECTION_ACTION,
      ref: JSON.stringify({ executionId: ctx.executionId, offerId: current.offeredActionId, digest: current.offeredDigest ?? '' })
    })) return 'wait';
    this.publishedOfferIds.add(current.offeredActionId);
    return 'wait';
  }

  async respond(executionId: string, input: string | undefined, offer: PlanCorrectionActionRef | undefined): Promise<'approve' | 'cancelled' | 'wait' | 'reject'> {
    const result = await this.serialize(executionId, () => this.respondSerialized(executionId, input, offer));
    if (result !== 'approve' || !offer) return result;

    // Release the approval transaction before re-entering the coordinator's idle
    // handoff. A queued cancel gets the serialization turn before this recheck.
    const resume = await this.serialize(executionId, async () => {
      const current = await this.deps.store.get(executionId);
      if (current?.status === 'cancelled') return 'cancelled' as const;
      if (current?.status !== 'approved'
        || current.offeredActionId !== offer.offerId
        || current.approvedDigest !== offer.digest) return 'reject' as const;
      return current.ctx;
    });
    if (resume === 'cancelled' || resume === 'reject') return resume;
    await this.deps.resume(resume);
    return 'approve';
  }

  private async respondSerialized(executionId: string, input: string | undefined, offer: PlanCorrectionActionRef | undefined): Promise<'approve' | 'cancelled' | 'wait' | 'reject'> {
    const pending = await this.deps.store.get(executionId);
    if (!pending) throw new Error('plan correction is no longer pending');
    const choice = input?.trim().toLowerCase();
    if (pending.status === 'cancelled') {
      await this.retryCancelledCleanup(pending);
      return choice === 'cancel' ? 'cancelled' : 'reject';
    }
    if (!offer || offer.executionId !== executionId || offer.offerId !== pending.offeredActionId) return 'reject';
    // An approval write commits before its callback re-enters the handoff. Keep
    // this exact offer cancellable across that release so queued cancellation wins
    // before registration or dispatch can begin.
    if (pending.status === 'approved' && choice === 'cancel' && offer.digest === pending.approvedDigest) {
      pending.status = 'cancelled';
      await this.deps.store.put(pending);
      await this.deps.stopExecution(executionId);
      return 'cancelled';
    }
    if (pending.status !== 'pending') return 'reject';
    // Changes and cancellation apply to this inbox offer even before a valid
    // corrected plan exists. Approval additionally binds its immutable digest.
    if (choice === 'approve' && (!pending.offeredDigest || offer.digest !== pending.offeredDigest)) return 'reject';
    if (choice !== 'approve' && offer.digest !== (pending.offeredDigest ?? '')) return 'reject';
    if (choice === 'approve') {
      const corrected = await this.deps.readCorrectedPlan(pending.ctx.projectRoot, executionId);
      if (corrected.status !== 'ok' || !pending.offeredDigest || planDigest(corrected.units) !== pending.offeredDigest) {
        pending.status = 'correction-required';
        pending.offeredActionId = undefined;
        pending.offeredDigest = undefined;
        pending.offeredUnits = undefined;
        if (!await this.persistActive(pending)) return this.rejectCancelled(pending);
        this.deps.nudge(pending.ctx.sessionId, `Corrected plan is not valid. Write a complete portable plan to \`${correctedPlanRelPath(executionId)}\`, then end your turn.`);
        return 'wait';
      }
      pending.status = 'approved';
      pending.approvedDigest = pending.offeredDigest;
      pending.approvedUnits = cloneUnits(pending.offeredUnits!);
      if (!await this.persistActive(pending)) return this.rejectCancelled(pending);
      return 'approve';
    }
    if (choice === 'cancel') {
      pending.status = 'cancelled';
      await this.deps.store.put(pending);
      await this.deps.stopExecution(executionId);
      return 'cancelled';
    }
    this.deps.nudge(
      pending.ctx.sessionId,
      `Revise the correction prose at \`${correctionProseRelPath(executionId)}\` and write the complete corrected portable plan to \`${correctedPlanRelPath(executionId)}\`. Keep the provided source plan unchanged.`
    );
    pending.status = 'correction-required';
    if (!await this.persistActive(pending)) return this.rejectCancelled(pending);
    return 'wait';
  }

  private async serialize<T>(executionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.responseTails.get(executionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.responseTails.set(executionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.responseTails.get(executionId) === tail) this.responseTails.delete(executionId);
    }
  }

  async isPending(executionId: string): Promise<boolean> {
    const record = await this.deps.store.get(executionId);
    return record?.status === 'correction-required' || record?.status === 'pending';
  }

  async hasApproval(executionId: string): Promise<boolean> {
    return (await this.deps.store.get(executionId))?.status === 'approved';
  }

  /**
   * Re-drive terminal execution effects after boot. Cancellation remains final in
   * this ledger; only idempotent execution/team cleanup is retried.
   */
  async recoverCancelledExecutions(): Promise<PlanCorrectionRecoveryFailure[]> {
    const cancelled = this.deps.store.listCancelled ? await this.deps.store.listCancelled() : [];
    const failures: PlanCorrectionRecoveryFailure[] = [];
    for (const record of cancelled) {
      try {
        await this.serialize(record.executionId, () => this.retryCancelledCleanup(record));
      } catch (error) {
        failures.push({ executionId: record.executionId, error });
        this.deps.logRecoveryError?.(record.executionId, error);
      }
    }
    return failures;
  }

  private async rejectCancelled(record: PlanCorrectionRecord): Promise<'reject'> {
    // Correction cancellation is irreversible, but a prior stop can have written
    // the ledger before Team/worktree terminal effects finish. Every later touch
    // retries only that idempotent cleanup.
    await this.retryCancelledCleanup(record);
    return 'reject';
  }

  private async retryCancelledCleanup(record: PlanCorrectionRecord): Promise<void> {
    await this.deps.stopExecution(record.executionId);
  }

  private async persistActive(record: PlanCorrectionRecord): Promise<boolean> {
    const persisted = await this.deps.store.put(record);
    if (persisted.status !== 'cancelled') return true;
    Object.assign(record, persisted);
    return false;
  }

  async readArtifact(ref: string, path: string): Promise<string | undefined> {
    const action = parsePlanCorrectionActionRef(ref);
    if (!action || !correctionArtifactPaths(action.executionId).has(path)) return undefined;
    const record = await this.deps.store.get(action.executionId);
    if (!record || record.ctx.executionId !== action.executionId) return undefined;
    return readHandoffArtifact(record.ctx.projectRoot, path);
  }

  async approvedPlan(executionId: string): Promise<Extract<AuthoredPlanRead, { status: 'ok' }> | undefined> {
    const record = await this.deps.store.get(executionId);
    return record?.status === 'approved' ? this.approvedSnapshot(record) : undefined;
  }

  /** Shared service gate: correction state applies equally to host and MCP paths. */
  async authorizeRegistration(executionId: string, units: readonly ExecutionWorkUnitInput[]): Promise<{ ok: true } | { ok: false; message: string }> {
    const pending = await this.deps.store.get(executionId);
    if (!pending) return { ok: true };
    if (pending.status === 'cancelled') return { ok: false, message: 'plan correction was cancelled' };
    if (pending.status !== 'approved' || !pending.approvedDigest) return { ok: false, message: 'plan correction approval is pending' };
    if (pending.approvedDigest !== planDigest(units)) return { ok: false, message: 'corrected plan changed after approval; renewed approval is required' };
    return { ok: true };
  }

  static correctionPrompt(reason: string): string {
    return `Provided structured plan is invalid: ${reason}. Wait for human correction review. Do not modify the provided source plan.`;
  }

  static sourcePlanPresent(text: string): boolean {
    return hasPortablePlanStep(text);
  }

  private clearApproval(record: PlanCorrectionRecord): void {
    record.approvedDigest = undefined;
    record.approvedUnits = undefined;
  }

  private approvedSnapshot(record: PlanCorrectionRecord): Extract<AuthoredPlanRead, { status: 'ok' }> {
    if (!record.approvedUnits || !record.approvedDigest) throw new Error('approved plan correction snapshot is missing');
    return { status: 'ok', units: cloneUnits(record.approvedUnits), realPath: correctedPlanRelPath(record.executionId) };
  }

}

function planDigest(units: readonly ExecutionWorkUnitInput[]): string {
  return launchDigest(units);
}

function cloneUnits(units: readonly ExecutionWorkUnitInput[]): ExecutionWorkUnitInput[] {
  return JSON.parse(JSON.stringify(units)) as ExecutionWorkUnitInput[];
}
