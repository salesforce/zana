import type { ExecutionBoardProjection, TerminalSession } from '../../shared/types.js';
import type { ExecutionRecord } from './store.js';

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
      liveOrchestrators.set(cohort.executionId, session.id);
    }
  }
  return records.map((record) => ({
    executionId: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    jobTitle: record.jobTitle,
    state: record.state,
    attempt: record.attempt,
    stateVersion: record.stateVersion,
    updatedAt: record.updatedAt,
    ...(liveOrchestrators.has(record.id)
      ? { orchestratorSessionId: liveOrchestrators.get(record.id) }
      : {})
  }));
}
