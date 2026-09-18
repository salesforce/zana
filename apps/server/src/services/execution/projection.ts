import type { ExecutionBoardProjection, TerminalSession } from '@zana-ai/zcc-domain/product';
import { MAX_DELIVERY_ATTEMPTS, type ExecutionRecord } from './store.js';
import { usageRollup } from './contracts.js';

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

function workProjection(record: ExecutionRecord): WorkProjection {
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
      ...(unit.leaseExpiresAt !== undefined ? { leaseExpiresAt: unit.leaseExpiresAt } : {})
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
  const deliveryStateByBlocker = new Map<string, NonNullable<ExecutionBoardProjection['blockers']>[number]['deliveryState']>();
  for (const delivery of [...(record.deliveries ?? [])].sort((left, right) => left.updatedAt - right.updatedAt)) {
    deliveryStateByBlocker.set(delivery.blockerId, delivery.state);
  }
  return {
    ...(currentBlocker ? { currentBlocker: {
      id: currentBlocker.id, workUnitId: currentBlocker.workUnitId, slotId: currentBlocker.slotId,
      question: currentBlocker.question, ...(currentBlocker.options ? { options: currentBlocker.options } : {}),
      ...(currentBlocker.response ? { response: currentBlocker.response } : {}),
      ...(currentDelivery ? { delivery: {
        id: currentDelivery.id, state: currentDelivery.state, attempt: currentDelivery.attempt,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        retryEligible: currentDelivery.state === 'FAILED' && (currentDelivery.manualRetryCount ?? 0) < 1,
        ...(currentDelivery.lastError ? { error: firstErrorLine(currentDelivery.lastError) } : {})
      } } : {})
    } } : {}),
    blockers: (record.blockers ?? []).map((blocker) => ({
      id: blocker.id, resolved: blocker.resolved,
      ...(deliveryStateByBlocker.has(blocker.id) ? { deliveryState: deliveryStateByBlocker.get(blocker.id) } : {})
    }))
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

export function executionBoardProjection(record: ExecutionRecord, orchestratorSessionId?: string): ExecutionBoardProjection {
  const work = workProjection(record);
  const terminal = record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED';
  const terminalDuration = terminal && Number.isFinite(record.createdAt) && Number.isFinite(record.updatedAt) && record.updatedAt >= record.createdAt
    ? record.updatedAt - record.createdAt
    : undefined;
  const usage = publicUsage(usageRollup(record.usageObservations ?? [], record.usageBaseline));
  const assembledResult = assembledResultProjection(record);
  return {
    executionId: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    launchKind: record.request.launchKind ?? record.launchKind ?? 'team',
    ...(record.request.launchDisplay ?? record.launchDisplay ? { launchDisplay: record.request.launchDisplay ?? record.launchDisplay } : {}),
    jobTitle: record.jobTitle,
    ...(record.coordinationMode ? { coordinationMode: record.coordinationMode } : {}),
    ...(record.origin ? { origin: record.origin } : {}),
    state: record.state,
    attempt: record.attempt,
    stateVersion: record.stateVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.request.objective ? { objective: record.request.objective } : {}),
    ...(record.summary ? { summary: record.summary } : {}),
    sources: (record.request.sourceBundle?.sources ?? []).map((source) => ({
      id: source.id, name: source.name, mediaType: source.mediaType, byteSize: source.byteSize,
      contentDigest: source.contentDigest, extractionWarnings: source.extractionWarnings
    })),
    work,
    baselineMetrics: baselineMetrics(record, work.counts, terminalDuration),
    usage,
    ...blockerProjection(record),
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
    recovery: {
      status: terminal ? 'terminal' : (record.recoveryDeadlineAt ?? 0) > Date.now() ? 'available' : 'expired',
      ...(record.recoveryDeadlineAt === undefined ? {} : { deadlineAt: record.recoveryDeadlineAt })
    }
  };
}
