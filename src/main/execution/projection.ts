import type { ExecutionBoardProjection, TerminalSession } from '../../shared/types.js';
import { MAX_DELIVERY_ATTEMPTS, type ExecutionRecord } from './store.js';

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
  return {
    executionId: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    launchKind: record.request.launchKind ?? record.launchKind ?? 'team',
    ...(record.request.launchDisplay ?? record.launchDisplay ? { launchDisplay: record.request.launchDisplay ?? record.launchDisplay } : {}),
    jobTitle: record.jobTitle,
    ...(record.coordinationMode ? { coordinationMode: record.coordinationMode } : {}),
    state: record.state,
    attempt: record.attempt,
    stateVersion: record.stateVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.request.goal ? { goal: record.request.goal } : {}),
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
        workUnitId: unit.id, title: unit.title, ...(unit.assignedSlotId ? { slotId: unit.assignedSlotId } : {}), state: unit.state
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
        ...(currentDelivery.lastError ? { error: currentDelivery.lastError.slice(0, 1_024) } : {})
      } } : {})
    } } : {}),
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
