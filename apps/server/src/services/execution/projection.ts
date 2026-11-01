import type { ExecutionBoardProjection, TerminalSession } from '@zana-ai/zcc-domain/product';
import { isWorkerRecoveryLive, MAX_DELIVERY_ATTEMPTS, type ExecutionRecord, type ExecutionWorkUnit } from './store.js';
import { usageRollup } from './contracts.js';
import type { TeamLifecycleRecord } from '../launch/team-lifecycle-store.js';

/**
 * Surface a delivery error as a human-readable message, never a stack trace:
 * the first non-empty line only, internal whitespace collapsed, bounded to the
 * projection's 1 KiB budget. Workers control the ack `error` string, so this is
 * the single sanitizer that keeps a multi-line stack out of Job Details.
 */
function firstErrorLine(raw: string): string {
  const line = raw.split('\n').map((part) => part.trim()).find((part) => part.length > 0) ?? '';
  return line.replace(/\s+/g, ' ').slice(0, 1_024);
}

/**
 * Per-unit completed `result` surfaced on the board + read by a dependent unit's
 * worker via `execution.snapshot` (so a downstream unit can inherit an upstream
 * answer instead of re-asking the human). Bounded to a 2 KiB char budget (Rule 5)
 * so a verbose result can't bloat the projection; newlines preserved (a result
 * can be structured, unlike a single-line error).
 */
const MAX_UNIT_RESULT_CHARS = 2_048;
const MAX_METRIC_ID_CHARS = 256;
const MAX_METRIC_RESOLVED_MODELS = 100;
function resultPreview(raw: string): string {
  return raw.slice(0, MAX_UNIT_RESULT_CHARS);
}

function publicUsage<T extends NonNullable<ExecutionBoardProjection['usage']>>(usage: T): Omit<T, 'cursors'> {
  const { cursors: _cursors, ...safe } = usage as T & { cursors?: unknown };
  return safe;
}

type WorkProjection = NonNullable<ExecutionBoardProjection['work']>;

/** The unit's API-error recovery, only while Zana is still working through the ladder. */
function recoveryProjection(unit: ExecutionWorkUnit, now: number): Pick<WorkProjection['assignments'][number], 'recovery'> {
  const recovery = unit.apiErrorRecovery;
  if (!recovery || !isWorkerRecoveryLive(unit, now)) return {};
  return { recovery: { step: recovery.step, ...(recovery.errorKind ? { errorKind: recovery.errorKind } : {}), since: recovery.startedAt } };
}

function workProjection(record: ExecutionRecord, now: number): WorkProjection {
  const counts: WorkProjection['counts'] = {
    PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0
  };
  for (const unit of record.workUnits ?? []) counts[unit.state] += 1;
  return {
    total: record.workUnits?.length ?? 0,
    completed: counts.COMPLETED,
    counts,
    assignments: (record.workUnits ?? []).map((unit) => ({
      workUnitId: unit.id, title: unit.title, dependencies: [...unit.dependencies],
      ...(unit.assignedSlotId ? { slotId: unit.assignedSlotId } : {}), state: unit.state,
      ...(unit.failureCode ? { failureCode: unit.failureCode } : {}),
      ...(unit.result !== undefined ? { result: resultPreview(unit.result) } : {}),
      ...(unit.claimedAt !== undefined ? { claimedAt: unit.claimedAt } : {}),
      ...(unit.heartbeatAt !== undefined ? { heartbeatAt: unit.heartbeatAt } : {}),
      ...(unit.progressAt !== undefined ? { progressAt: unit.progressAt } : {}),
      ...(unit.leaseExpiresAt !== undefined ? { leaseExpiresAt: unit.leaseExpiresAt } : {}),
      ...(unit.attempt !== undefined ? { attempt: unit.attempt } : {}),
      ...(unit.turnCount !== undefined ? { turnCount: unit.turnCount } : {}),
      ...(unit.claimId !== undefined ? { claimId: unit.claimId } : {}),
      ...(unit.claimGeneration !== undefined ? { claimGeneration: unit.claimGeneration } : {})
      , ...recoveryProjection(unit, now)
      , healthState: (unit.noProgressSlots?.some((entry) => entry.executionAttempt === record.attempt) ? 'NO_PROGRESS' : 'HEALTHY') as 'NO_PROGRESS' | 'HEALTHY'
      , reclaimCount: (unit.noProgressSlots ?? []).filter((entry) => entry.executionAttempt === record.attempt).length
      , attemptedSlots: [...new Set(unit.history.filter((entry) => entry.action === 'claimed' && entry.slotId).map((entry) => entry.slotId!))]
      , quarantinedSlots: [...new Set((unit.noProgressSlots ?? []).filter((entry) => entry.executionAttempt === record.attempt).map((entry) => entry.slotId))]
    })),
    rosterSlotIds: record.authorizationContext?.slots.map((slot) => slot.slotId) ?? []
  };
}

function baselineMetrics(
  record: ExecutionRecord,
  counts: WorkProjection['counts'],
  terminalDuration: number | undefined
): ExecutionBoardProjection['baselineMetrics'] {
  return {
    version: 1,
    ...(terminalDuration === undefined ? {} : { terminalAt: record.updatedAt, wallDurationMs: terminalDuration }),
    workUnitCount: record.workUnits?.length ?? 0,
    completedWorkUnitCount: counts.COMPLETED,
    failedWorkUnitCount: counts.FAILED,
    skippedWorkUnitCount: counts.SKIPPED,
    workAttemptCount: (record.workUnits ?? []).reduce((total, unit) => total + unit.attempt, 0),
    blockerCount: record.blockers?.length ?? 0,
    resolvedBlockerCount: (record.blockers ?? []).filter((blocker) => blocker.resolved).length,
    resolvedModels: (record.resolvedModels ?? []).filter((model) => model.model !== undefined).slice(0, MAX_METRIC_RESOLVED_MODELS).map(({ slotId, provider, model }) => ({
      slotId: slotId.slice(0, MAX_METRIC_ID_CHARS),
      provider: provider.slice(0, MAX_METRIC_ID_CHARS),
      model: model!.slice(0, MAX_METRIC_ID_CHARS)
    }))
  };
}

function blockerProjection(record: ExecutionRecord): Pick<ExecutionBoardProjection, 'blockers'>
  & Partial<Pick<ExecutionBoardProjection, 'currentBlocker'>> {
  const currentBlocker = [...(record.blockers ?? [])]
    .filter((blocker) => !blocker.resolved)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  const currentDelivery = currentBlocker ? [...(record.deliveries ?? [])]
    .filter((delivery) => delivery.blockerId === currentBlocker.id)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] : undefined;
  const currentNotice = currentBlocker ? (record.noticeIntents ?? []).find((notice) => notice.blockerId === currentBlocker.id) : undefined;
  const deliveryStateByBlocker = new Map<string, NonNullable<ExecutionBoardProjection['blockers']>[number]['deliveryState']>();
  for (const delivery of [...(record.deliveries ?? [])].sort((left, right) => left.updatedAt - right.updatedAt)) {
    deliveryStateByBlocker.set(delivery.blockerId, delivery.state);
  }
  return {
    ...(currentBlocker ? { currentBlocker: {
      id: currentBlocker.id, workUnitId: currentBlocker.workUnitId, slotId: currentBlocker.slotId,
      question: currentBlocker.question, ...(currentBlocker.options ? { options: currentBlocker.options } : {}),
      ...(currentBlocker.audience ? { audience: currentBlocker.audience } : {}),
      ...(currentBlocker.response ? { response: currentBlocker.response } : {}),
      ...(currentDelivery ? { delivery: {
        id: currentDelivery.id, state: currentDelivery.state, attempt: currentDelivery.attempt,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        retryEligible: currentDelivery.state === 'FAILED' && (currentDelivery.manualRetryCount ?? 0) < 1,
        ...(currentDelivery.lastError ? { error: firstErrorLine(currentDelivery.lastError) } : {})
      } } : {}),
      ...(currentNotice ? { notice: {
        status: currentNotice.status,
        attempts: currentNotice.attempts,
        ...(currentNotice.inboxItemId ? { inboxItemId: currentNotice.inboxItemId } : {})
      } } : {})
    } } : {}),
    blockers: (record.blockers ?? []).map((blocker) => ({
      id: blocker.id, resolved: blocker.resolved,
      ...(deliveryStateByBlocker.has(blocker.id) ? { deliveryState: deliveryStateByBlocker.get(blocker.id) } : {})
    }))
  };
}

/** Newest-first tail caps so a churny job can't unbound the projection (Rule 5). */
const MAX_DELIVERIES_PROJECTED = 50;
const MAX_COORDINATOR_WAKES_PROJECTED = 25;

/**
 * Delivery-strand diagnostics: METADATA ONLY. `payload.text` (worker/coordinator
 * answer body) is deliberately dropped — it must never reach the renderer (Rule 1);
 * only the id/state/attempt/error-line survive. Newest-first, bounded tail (Rule 5).
 */
function deliveriesProjection(record: ExecutionRecord): ExecutionBoardProjection['deliveries'] {
  const deliveries = record.deliveries ?? [];
  if (deliveries.length === 0) return undefined;
  return [...deliveries]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_DELIVERIES_PROJECTED)
    .map((delivery) => ({
      id: delivery.id, blockerId: delivery.blockerId, workUnitId: delivery.workUnitId,
      slotId: delivery.slotId, state: delivery.state, attempt: delivery.attempt,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
      ...(delivery.manualRetryCount !== undefined ? { manualRetryCount: delivery.manualRetryCount } : {}),
      updatedAt: delivery.updatedAt,
      ...(delivery.lastError ? { error: firstErrorLine(delivery.lastError) } : {})
    }));
}

/**
 * Coordinator-wake diagnostics: a total plus a newest-first bounded tail (Rule 5).
 * `message` is intentionally omitted — the tail carries only cause/unit/fence/time,
 * enough to spot a repeated same-cause wake without projecting a free-text body.
 */
function coordinatorWakesProjection(record: ExecutionRecord): ExecutionBoardProjection['coordinatorWakes'] {
  const wakes = record.coordinatorWakes ?? [];
  if (wakes.length === 0) return undefined;
  return {
    total: wakes.length,
    recent: [...wakes]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_COORDINATOR_WAKES_PROJECTED)
      .map((wake) => ({
        id: wake.id, cause: wake.cause,
        ...(wake.workUnitId !== undefined ? { workUnitId: wake.workUnitId } : {}),
        stateOrClaimGeneration: wake.stateOrClaimGeneration, createdAt: wake.createdAt
      }))
  };
}

function retainedRecoveryActions(record: ExecutionRecord): NonNullable<ExecutionBoardProjection['recovery']>['actions'] {
  const eligible = !record.successorExecutionId && (record.state === 'FAILED' || record.state === 'STOPPED')
    && !(record.state === 'STOPPED' && (record.timeoutReason === 'unresolved-blocker' || record.timeoutReason === 'plan-correction-cancelled'));
  // Exact-native recovery accepts every retained snapshot. A failed replacement
  // increments attempt without invalidating a snapshot from its source attempt.
  const restorableSlots = (record.nativeRecoverySnapshots ?? []).length;
  return {
    freshPlan: eligible ? { available: true } : { available: false, reason: 'RECOVERY_NOT_ALLOWED' },
    exactNative: !eligible ? { available: false, restorableSlots, reason: 'RECOVERY_NOT_ALLOWED' }
      : restorableSlots === 0 ? { available: false, restorableSlots, reason: 'NO_RESTORABLE_SLOTS' }
      : { available: false, restorableSlots, reason: 'NATIVE_RESTORE_UNAVAILABLE' }
  };
}

export function assembledResultProjection(record: ExecutionRecord): ExecutionBoardProjection['assembledResult'] {
  if (!record.assembledResult) return undefined;
  return {
    version: record.assembledResult.version, outcome: record.assembledResult.outcome, summary: record.assembledResult.summary,
    units: record.assembledResult.units.map(({ id, title, state, result, failureCode }) => ({
      id, title, state,
      ...(result === undefined ? {} : { result: resultPreview(result) }),
      ...(failureCode === undefined ? {} : { failureCode })
    })),
    failures: record.assembledResult.failures.map(({ workUnitId, code }) => ({ workUnitId, code })),
    artifacts: record.assembledResult.artifacts.map(({ name, mediaType, contentDigest }) => ({ name, mediaType, contentDigest })),
    ...(record.assembledResult.policy ? { policy: { status: record.assembledResult.policy.status, summary: record.assembledResult.policy.summary } } : {}),
    verification: record.assembledResult.verification.map(({ workUnitId, checks }) => ({ workUnitId, checks: [...checks] })),
    usage: publicUsage(record.assembledResult.usage), digest: record.assembledResult.digest
  };
}

/** Build bounded project-local board data from durable records and live tabs. */
export function projectExecutionProjection(
  records: readonly ExecutionRecord[],
  sessions: readonly TerminalSession[]
): ExecutionBoardProjection[] {
  const liveOrchestrators = new Map<string, string>();
  for (const session of sessions) {
    const cohort = session.cohort;
    if (
      cohort?.executionId &&
      cohort.role === 'orchestrator' &&
      session.status !== 'exited' &&
      !liveOrchestrators.has(cohort.executionId)
    ) {
      const record = records.find((candidate) => candidate.id === cohort.executionId);
      const isRecovery = cohort.slotId === 'orchestrator:recovery';
      if (!isRecovery || record?.effectiveOwnerPrincipalIds?.includes(session.id)) {
        liveOrchestrators.set(cohort.executionId, session.id);
      }
    }
  }
  return records.map((record) => executionBoardProjection(record, liveOrchestrators.get(record.id)));
}

type ModernExecutionMember = NonNullable<ExecutionBoardProjection['modernMembers']>[number];
const MAX_MODERN_MEMBERS_PER_EXECUTION = 32;

/**
 * Modern squad members per execution, from main's team-launch lifecycle. A
 * Modern member is an ACP thread with no PTY cohort stamp, so this is the only
 * way the board can group it under its squad. Live = bound, running and still
 * holding capacity; everything else renders as an exited member.
 */
export function modernExecutionMembers(
  records: readonly TeamLifecycleRecord[],
  projectId: string
): Map<string, ModernExecutionMember[]> {
  const latest = new Map<string, ModernExecutionMember>();
  const executionOf = new Map<string, string>();
  const seenThreads = new Set<string>();
  // Newest record first: a relaunch supersedes the stale entry for the same slot.
  const newestFirst = [...records].sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt));
  for (const record of newestFirst) {
    for (const worker of record.workers) {
      const executionId = worker.modernContext?.executionId;
      if (worker.transport !== 'MODERN' || !worker.threadId || !executionId || worker.projectId !== projectId) continue;
      if (seenThreads.has(worker.threadId)) continue;
      const key = `${executionId}\u0000${worker.slotId}`;
      if (latest.has(key)) continue;
      seenThreads.add(worker.threadId);
      executionOf.set(key, executionId);
      latest.set(key, {
        threadId: worker.threadId, slotId: worker.slotId, personaId: worker.personaId, role: worker.modernContext!.role,
        live: worker.bindingState === 'BOUND' && worker.process === 'running' && !worker.capacityReleased
      });
    }
  }
  const byExecution = new Map<string, ModernExecutionMember[]>();
  for (const [key, member] of latest) {
    const executionId = executionOf.get(key)!;
    byExecution.set(executionId, [...(byExecution.get(executionId) ?? []), member]);
  }
  for (const [executionId, members] of byExecution) {
    byExecution.set(executionId, members.sort((a, b) => Number(b.live) - Number(a.live)).slice(0, MAX_MODERN_MEMBERS_PER_EXECUTION));
  }
  return byExecution;
}

export function executionBoardProjection(record: ExecutionRecord, orchestratorSessionId?: string): ExecutionBoardProjection {
  const now = Date.now();
  const work = workProjection(record, now);
  const terminal = record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED';
  const terminalDuration = terminal && Number.isFinite(record.createdAt) && Number.isFinite(record.updatedAt) && record.updatedAt >= record.createdAt
    ? record.updatedAt - record.createdAt
    : undefined;
  const usage = publicUsage(usageRollup(record.usageObservations ?? [], record.usageBaseline));
  const assembledResult = assembledResultProjection(record);
  const deliveries = deliveriesProjection(record);
  const coordinatorWakes = coordinatorWakesProjection(record);
  return {
    executionId: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    launchKind: record.request.launchKind ?? record.launchKind ?? 'team',
    ...(record.request.launchDisplay ?? record.launchDisplay ? { launchDisplay: record.request.launchDisplay ?? record.launchDisplay } : {}),
    jobTitle: record.jobTitle,
    ...(record.coordinationMode ? { coordinationMode: record.coordinationMode } : {}),
    ...(record.origin ? { origin: record.origin } : {}),
    ...(record.proposal ? { startedFrom: {
      kind: record.proposal.proposerKind,
      id: record.proposal.proposerId,
      ...(record.proposal.proposerTitle === undefined ? {} : { title: record.proposal.proposerTitle })
    } } : {}),
    state: record.state,
    attempt: record.attempt,
    stateVersion: record.stateVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.request.objective ? { objective: record.request.objective } : {}),
    ...(record.summary ? { summary: record.summary } : {}),
    ...(terminal && record.squadWorktree ? { retainedWorktree: { ...record.squadWorktree, ...(record.squadWorktreeDisposition ? { disposition: record.squadWorktreeDisposition } : {}) } } : {}),
    sources: (record.request.sourceBundle?.sources ?? []).map((source) => ({
      id: source.id, name: source.name, mediaType: source.mediaType, byteSize: source.byteSize,
      contentDigest: source.contentDigest, extractionWarnings: source.extractionWarnings
    })),
    work,
    baselineMetrics: baselineMetrics(record, work.counts, terminalDuration),
    usage,
    ...blockerProjection(record),
    ...(deliveries ? { deliveries } : {}),
    ...(coordinatorWakes ? { coordinatorWakes } : {}),
    ...(record.finalSummary ? { finalSummary: record.finalSummary } : {}),
    ...(assembledResult ? { assembledResult } : {}),
    ...(record.resourceBlock ? { resourceBlock: record.resourceBlock } : {}),
    ...(record.routeFitProposal ? { routeFitProposal: record.routeFitProposal } : {}),
    eventCursor: record.lastEventSequence ?? 0,
    ...(orchestratorSessionId ? { orchestratorSessionId } : {}),
    coordinator: terminal ? { status: 'complete' } : record.coordinatorState === 'PARKED' && orchestratorSessionId
      ? { status: 'parked', sessionId: orchestratorSessionId }
      : orchestratorSessionId
      ? { status: 'live', sessionId: orchestratorSessionId }
      : { status: 'lost' },
    recoveryAttention: !terminal && !orchestratorSessionId,
    ...(record.timeoutReason ? { timeoutReason: record.timeoutReason } : {}),
    ...(record.successorExecutionId ? { successorExecutionId: record.successorExecutionId } : {}),
    recovery: {
      status: terminal ? 'terminal' : (record.recoveryDeadlineAt ?? 0) > now ? 'available' : 'expired',
      ...(record.recoveryDeadlineAt === undefined ? {} : { deadlineAt: record.recoveryDeadlineAt }),
      actions: retainedRecoveryActions(record)
    }
  };
}
