import type { CoordinatorHandoffContext } from '../team-plan-handoff.js';
import { isResumableExecutionState } from '@zana-ai/zcc-server/services/execution/storage/backend-policy';

interface ExecutionStateRecord {
  state: string;
  timeoutReason?: string;
}

/**
 * True only when an execution can never consult its correction record again:
 * the record is gone, or it is terminal and not resumable. Anything else
 * (including an unknown state) must keep its record, since a missing record
 * authorizes plan registration.
 */
export function createExecutionRetiredCheck(
  getExecution: (executionId: string) => Promise<ExecutionStateRecord | undefined>
): (executionId: string) => Promise<boolean> {
  return async (executionId) => {
    const record = await getExecution(executionId);
    return !record || ((record.state === 'COMPLETED' || record.state === 'STOPPED') && !isResumableExecutionState(record));
  };
}

/** Adapts the host error logger to the service's absorbed-failure diagnostics. */
export function createPlanCorrectionWarningLogger(
  logError: (label: string, error: unknown) => void
): (executionId: string, message: string, error: unknown) => void {
  return (executionId, message, error) => logError(`planCorrection:${executionId}: ${message}`, error);
}

/**
 * Coordinator context for a bound `execution.plan.register` submission, so a
 * refused correction candidate can be offered for review (Modern has no PTY idle
 * reread). Only the execution's own coordinator binding qualifies, with the same
 * project root the CLI idle handoff uses; anything else yields no submitter.
 */
export function planCorrectionSubmitter(
  record: { id: string; projectId: string; squadWorktree?: { path: string } | null },
  binding: { role: string; slotId: string; executionId: string; projectId: string; principalId?: string } | undefined,
  projectPath: (projectId: string) => string | undefined
): CoordinatorHandoffContext | undefined {
  if (!binding || binding.role !== 'orchestrator' || !binding.principalId) return undefined;
  if (binding.executionId !== record.id || binding.projectId !== record.projectId) return undefined;
  const projectRoot = record.squadWorktree?.path ?? projectPath(record.projectId);
  if (!projectRoot) return undefined;
  return { sessionId: binding.principalId, projectId: record.projectId, projectRoot, executionId: record.id, slotId: binding.slotId };
}
