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
