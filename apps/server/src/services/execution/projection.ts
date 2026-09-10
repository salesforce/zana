import type { ExecutionBoardProjection, TerminalSession } from '@zana-ai/zcc-domain/product';
import { MAX_DELIVERY_ATTEMPTS, type ExecutionRecord } from './store.js';

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
function resultPreview(raw: string): string {
  return raw.slice(0, MAX_UNIT_RESULT_CHARS);
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
  const counts: NonNullable<ExecutionBoardProjection['work']>['counts'] = {
    PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 0, FAILED: 0
  };
  for (const unit of record.workUnits ?? []) counts[unit.state] += 1;
  const currentBlocker = [...(record.blockers ?? [])]
    .filter((blocker) => !blocker.resolved)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  const currentDelivery = currentBlocker ? [...(record.deliveries ?? [])]
    .filter((delivery) => delivery.blockerId === currentBlocker.id)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] : undefined;
  const terminal = record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED';
  const deliveryStateByBlocker = new Map<string, NonNullable<ExecutionBoardProjection['blockers']>[number]['deliveryState']>();
  for (const delivery of [...(record.deliveries ?? [])].sort((left, right) => left.updatedAt - right.updatedAt)) {
    deliveryStateByBlocker.set(delivery.blockerId, delivery.state);
  }
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
    work: {
      total: record.workUnits?.length ?? 0,
      completed: counts.COMPLETED,
      counts,
      assignments: (record.workUnits ?? []).map((unit) => ({
        workUnitId: unit.id, title: unit.title, ...(unit.assignedSlotId ? { slotId: unit.assignedSlotId } : {}), state: unit.state,
        ...(unit.result !== undefined ? { result: resultPreview(unit.result) } : {})
      })),
      rosterSlotIds: record.authorizationContext?.slots.map((slot) => slot.slotId) ?? []
    },
    ...(currentBlocker ? { currentBlocker: {
      id: currentBlocker.id, workUnitId: currentBlocker.workUnitId, slotId: currentBlocker.slotId,
      question: currentBlocker.question, ...(currentBlocker.options ? { options: currentBlocker.options } : {}),
      ...(currentBlocker.response ? { response: currentBlocker.response } : {}),
      ...(currentDelivery ? { delivery: {
        id: currentDelivery.id,
        state: currentDelivery.state,
        attempt: currentDelivery.attempt,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        retryEligible: currentDelivery.state === 'FAILED' && (currentDelivery.manualRetryCount ?? 0) < 1,
        ...(currentDelivery.lastError ? { error: firstErrorLine(currentDelivery.lastError) } : {})
      } } : {})
    } } : {}),
    blockers: (record.blockers ?? []).map((blocker) => ({
      id: blocker.id,
      resolved: blocker.resolved,
      ...(deliveryStateByBlocker.has(blocker.id)
        ? { deliveryState: deliveryStateByBlocker.get(blocker.id) }
        : {})
    })),
    ...(record.finalSummary ? { finalSummary: record.finalSummary } : {}),
    eventCursor: record.lastEventSequence ?? 0,
    ...(orchestratorSessionId ? { orchestratorSessionId } : {}),
    coordinator: terminal ? { status: 'complete' } : orchestratorSessionId
      ? { status: 'live', sessionId: orchestratorSessionId }
      : { status: 'lost' },
    recoveryAttention: !terminal && !orchestratorSessionId,
    recovery: {
      status: terminal ? 'terminal' : (record.recoveryDeadlineAt ?? 0) > Date.now() ? 'available' : 'expired',
      ...(record.recoveryDeadlineAt === undefined ? {} : { deadlineAt: record.recoveryDeadlineAt })
    }
  };
}
