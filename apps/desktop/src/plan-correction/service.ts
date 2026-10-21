import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { randomUUID } from 'node:crypto';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
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
/** Coordinator idle edges after a correction request with no artifact before the operator is told it stalled. */
export const PLAN_CORRECTION_STALL_IDLE_EDGES = 2;
const SOURCE_PLAN_PROMPT_CAP = 8_000;

const correctionArtifactPaths = (executionId: string) => new Set([
  authoredPlanRelPath(executionId),
  correctionProseRelPath(executionId),
  correctedPlanRelPath(executionId),
  correctionDiffRelPath(executionId)
]);

function planReviewSummary(reason: string, units: ExecutionWorkUnitInput[], normalizations: readonly string[] = []): string {
  const steps = units.map((unit, index) => {
    const dependencies = unit.dependencies.length ? ` after ${unit.dependencies.map((id) => `\`${id}\``).join(', ')}` : '';
    const writes = unit.files?.length ? ` Writes ${unit.files.map((path) => `\`${path}\``).join(', ')}.` : ' No declared file writes.';
    const verification = unit.verification?.length ? ` Verification: ${unit.verification.join(' ')}` : '';
    return `${index + 1}. **${unit.title}** (\`${unit.id}\`)${dependencies}.${writes}${verification}`;
  });
  const repaired = normalizations.length
    ? `\n\nAutomatically normalized in the proposed plan:\n${normalizations.map((note) => `- ${note}`).join('\n')}`
    : '';
  return `Problem with the supplied plan: ${reason}\n\nProposed corrected plan: ${units.length} step${units.length === 1 ? '' : 's'}.\n\n${steps.join('\n')}${repaired}`;
}

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
    const why = service.takeRejectionReason(action.executionId);
    throw new InboxActionOperatorError(why ? `plan correction action was rejected or superseded: ${why}` : 'plan correction action was rejected or superseded');
  }
}

export interface PlanCorrectionDeps {
  appendInbox(input: Omit<InboxEntry, 'id' | 'ts'>): Promise<InboxEntry>;
  bindInboxAction(entry: InboxEntry, action: { kind: string; ref: string }): boolean;
  nudge(sessionId: string, text: string): void;
  wakeCoordinator?(executionId: string, text: string): Promise<void>;
  /** Original supplied plan text, so a held coordinator can author a correction from it. */
  readSourcePlan?(executionId: string): Promise<string | undefined>;
  readCorrectedPlan(projectRoot: string, executionId: string): Promise<AuthoredPlanRead>;
  store: {
    get(executionId: string): Promise<PlanCorrectionRecord | undefined>;
    listCancelled?(): Promise<PlanCorrectionRecord[]>;
    put(record: PlanCorrectionRecord): Promise<PlanCorrectionRecord>;
  };
  /** Persist an approved corrected plan back to its recurring schedule before resume. */
  updateScheduledPrompt?(ctx: CoordinatorHandoffContext, units: ExecutionWorkUnitInput[]): Promise<void>;
  resume(ctx: CoordinatorHandoffContext): Promise<void>;
  stopExecution(executionId: string): Promise<void>;
  logRecoveryError?(executionId: string, error: unknown): void;
  /** Diagnostics for failures the service deliberately absorbs (write-back, source-plan read). */
  logWarning?(executionId: string, message: string, error: unknown): void;
}

export interface PlanCorrectionRecoveryFailure {
  executionId: string;
  error: unknown;
}

export class PlanCorrectionService {
  /** Latest approve-rejection cause per execution, surfaced once to the Inbox action error. */
  private readonly rejectionReasons = new Map<string, string>();

  takeRejectionReason(executionId: string): string | undefined {
    const reason = this.rejectionReasons.get(executionId);
    this.rejectionReasons.delete(executionId);
    return reason;
  }

  private readonly responseTails = new Map<string, Promise<void>>();
  /** Bound offers need no duplicate Inbox entry until process state is lost. */
  private readonly publishedOfferIds = new Set<string>();
  /** Coordinator idle edges seen since the last correction request without a usable artifact. */
  private readonly missingArtifactIdles = new Map<string, number>();

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

  /**
   * Review a corrected plan for a run parked by begin(). The handoff's own invalid-plan reason is
   * not taken: it only says no authored plan was found (a parked coordinator never writes one),
   * and the card must keep naming the launch defect begin() recorded.
   */
  async reviewInvalid(ctx: CoordinatorHandoffContext): Promise<Extract<AuthoredPlanRead, { status: 'ok' }> | 'wait' | 'reject' | undefined> {
    return this.serialize(ctx.executionId, async () => {
      const current = await this.deps.store.get(ctx.executionId);
      // This invalid plan is not a rejected provided plan. Let normal handoff
      // nudges recover inferred or coordinator-authored plans.
      if (!current) return undefined;
      current.ctx = ctx;
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
      if (current.status === 'pending') {
        if (!await this.persistActive(current)) return this.rejectCancelled(current);
        return 'wait';
      }
      // Initial decision asks whether to request a correction. After that request
      // consumes the card, wait for the artifact rather than duplicating the card.
      if (current.status === 'correction-required' && current.retries > 0) {
        const idles = (this.missingArtifactIdles.get(current.executionId) ?? 0) + 1;
        if (idles < PLAN_CORRECTION_STALL_IDLE_EDGES) {
          this.missingArtifactIdles.set(current.executionId, idles);
          return 'wait';
        }
        // The coordinator ended its turn(s) without writing a plan. Surface that
        // to the operator instead of waiting silently forever.
        this.missingArtifactIdles.delete(current.executionId);
        return this.request(current, true);
      }
      if (current.retries >= PLAN_CORRECTION_MAX_RETRIES) return 'reject';
      return this.request(current);
    }
    this.missingArtifactIdles.delete(current.executionId);
    const digest = planDigest(corrected.units);
    if (current.offeredDigest !== digest) {
      this.clearApproval(current);
      current.offeredDigest = digest;
      current.offeredUnits = cloneUnits(corrected.units);
      current.status = 'correction-required';
    }
    // Normalization notes come from the fresh read, so a republished offer after
    // restart carries them without persisting anything beyond the digest.
    const notes = corrected.normalizations ?? [];
    // Final offered correction remains actionable until user answers. Do not turn
    // a pending third request into an implicit rejection on later idle edges.
    if (current.status === 'pending') {
      return current.offeredActionId && this.publishedOfferIds.has(current.offeredActionId)
        ? 'wait'
        : this.publishPendingOffer(current, false, notes);
    }
    if (current.retries >= PLAN_CORRECTION_MAX_RETRIES) return 'reject';
    return this.request(current, false, notes);
  }

  private async request(current: PlanCorrectionRecord, stalled = false, notes: readonly string[] = []): Promise<'wait' | 'reject'> {
    if (current.retries >= PLAN_CORRECTION_MAX_RETRIES) return 'reject';
    current.retries += 1;
    current.status = 'pending';
    if (current.offeredActionId) this.publishedOfferIds.delete(current.offeredActionId);
    current.offeredActionId = randomUUID();
    // Persist complete offer before appendInbox exposes its approval action.
    if (!await this.persistActive(current)) return this.rejectCancelled(current);
    return this.publishPendingOffer(current, stalled, notes);
  }

  /** Re-publish a durable offer after an inbox append/bind failure or restart. */
  private async publishPendingOffer(current: PlanCorrectionRecord, stalled = false, notes: readonly string[] = []): Promise<'wait' | 'reject'> {
    const ctx = current.ctx;
    const reviewReady = !!current.offeredDigest;
    const entry = await this.deps.appendInbox({
      projectId: ctx.projectId,
      projectLabel: undefined,
      sessionId: ctx.sessionId,
      executionId: ctx.executionId,
      hostActionRequired: true,
      // Coordinator idle and process recovery may retry this exact offer. Keep
      // one actionable inbox card until the operator chooses an option.
      dedupeKey: `plan-correction:${ctx.executionId}:${current.offeredActionId ?? 'pending'}`,
      subject: 'Plan correction required',
      comments: reviewReady
        ? `${planReviewSummary(current.reason, current.offeredUnits ?? [], notes)}\n\nReview the proposed corrected plan below before work can continue. Approve starts work using this exact revision. Request changes sends it back for revision. Cancel stops this run.`
        : `${stalled ? 'The coordinator finished its turn without writing a corrected plan. ' : ''}Plan requires revisions to proceed. Problem with the supplied plan: ${current.reason.replace(/\.$/, '')}. Select Request changes, then Continue, to ask the coordinator to write a complete corrected plan. Select Cancel, then Continue, to stop this run.`,
      decisionGuidance: {
        kind: 'plan-correction',
        diagnostic: current.reason,
        ...(reviewReady ? {
          originalPlanPath: authoredPlanRelPath(ctx.executionId),
          correctedPlanPath: correctedPlanRelPath(ctx.executionId)
        } : {})
      },
      questions: [{
        prompt: reviewReady ? 'Review the proposed plan, then approve, request changes, or cancel.' : 'Request a corrected plan or cancel.',
        options: [
          ...(reviewReady ? [{ id: 'approve', label: 'Approve' }] : []),
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
    // A consumed offer can never be republished; a rejected response leaves it live.
    if (offer && result !== 'reject') this.publishedOfferIds.delete(offer.offerId);
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
        await this.nudgeCoordinator(pending, await this.correctionInstruction(pending, 'The corrected plan on disk is missing or changed since it was offered.'));
        return 'wait';
      }
      pending.status = 'approved';
      pending.approvedDigest = pending.offeredDigest;
      pending.approvedUnits = cloneUnits(pending.offeredUnits!);
      try {
        await this.deps.updateScheduledPrompt?.(pending.ctx, pending.approvedUnits);
      } catch (error) {
        this.deps.logWarning?.(executionId, 'scheduled plan write-back failed; approval rejected', error);
        // Only deliberate operator-facing causes are shown; incidental failures (I/O, paths) stay generic.
        // A definition edit conflict is deliberate even when it arrives unwrapped.
        if (error instanceof InboxActionOperatorError) this.rejectionReasons.set(executionId, error.message);
        else if (isDefinitionConflict(error)) this.rejectionReasons.set(executionId, error instanceof Error ? error.message : 'the schedule or goal was edited since this run launched');
        // Schedule persistence is part of scheduled-run approval. Do not allow a
        // one-off correction to resume when future occurrences would remain bad.
        pending.status = 'pending';
        pending.approvedDigest = undefined;
        pending.approvedUnits = undefined;
        return 'reject';
      }
      if (!await this.persistActive(pending)) return this.rejectCancelled(pending);
      return 'approve';
    }
    if (choice === 'cancel') {
      pending.status = 'cancelled';
      await this.deps.store.put(pending);
      await this.deps.stopExecution(executionId);
      return 'cancelled';
    }
    // Persist first: a nudge for a request that was not durably recorded (or that
    // lost to a concurrent cancellation) would wake the coordinator for nothing.
    const instruction = await this.correctionInstruction(pending);
    pending.status = 'correction-required';
    if (!await this.persistActive(pending)) return this.rejectCancelled(pending);
    await this.nudgeCoordinator(pending, instruction);
    return 'wait';
  }

  /**
   * A parked coordinator never saw the supplied plan, so the request carries the
   * validation error, the source, the grammar and permission to resolve gaps.
   */
  private async correctionInstruction(record: PlanCorrectionRecord, lead?: string): Promise<string> {
    let source: string | undefined;
    try {
      source = await this.deps.readSourcePlan?.(record.executionId);
    } catch (error) {
      source = undefined;
      this.deps.logWarning?.(record.executionId, 'could not read the supplied plan for the correction request', error);
    }
    const excerpt = source && source.length > SOURCE_PLAN_PROMPT_CAP ? `${source.slice(0, SOURCE_PLAN_PROMPT_CAP)}\n[truncated]` : source;
    return [
      lead,
      `The supplied execution plan was rejected: ${record.reason}`,
      excerpt ? `Supplied plan:\n\`\`\`md\n${excerpt}\n\`\`\`` : undefined,
      `Write the complete corrected portable plan to \`${correctedPlanRelPath(record.executionId)}\` using your file-write tool (H3 \`id: Title <!-- executable-step -->\` headings, each with the fixed label bullets Mode, Work and Verification; every Mutating step must list its Write scope). ` +
        `Keep the supplied plan unchanged. If a required detail such as a file path or write scope is missing, choose the most conservative reasonable value, record that assumption in \`${correctionProseRelPath(record.executionId)}\`, and still write the plan; the operator reviews it before any work starts. Do not stop to ask the operator. Then end your turn.`
    ].filter(Boolean).join('\n\n');
  }

  private async nudgeCoordinator(record: PlanCorrectionRecord, text: string): Promise<void> {
    this.missingArtifactIdles.delete(record.executionId);
    if (this.deps.wakeCoordinator) await this.deps.wakeCoordinator(record.executionId, text);
    else this.deps.nudge(record.ctx.sessionId, text);
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

/** ScheduleConflictError / GoalConflictError, matched structurally across the package seam. */
function isDefinitionConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'DEFINITION_CONFLICT';
}

function planDigest(units: readonly ExecutionWorkUnitInput[]): string {
  return launchDigest(units);
}

function cloneUnits(units: readonly ExecutionWorkUnitInput[]): ExecutionWorkUnitInput[] {
  return JSON.parse(JSON.stringify(units)) as ExecutionWorkUnitInput[];
}
