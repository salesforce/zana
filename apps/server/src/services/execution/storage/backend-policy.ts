import { readRawFile } from '../../harness-routing/storage.js';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import { readExecutionStoreSqliteState } from './sqlite-state.js';

export type ExecutionStoreCreationBackend = 'json' | 'sqlite';
export type ExecutionStorageBackend = 'json' | 'sqlite';

/** JSON is an opt-in creation backend during the SQLite rollout. */
export function executionStoreCreationBackend(value: string | undefined): ExecutionStoreCreationBackend {
  return value === 'json' ? 'json' : 'sqlite';
}

/**
 * Finds an execution's durable owner without invoking the composite store. Side
 * stores use this before taking their own queue, avoiding recursive ownership
 * reads and queue/transaction deadlocks.
 */
export function executionStorageBackendForId(input: {
  filePath: string;
  database?: ExecutionDatabase;
  executionId: string;
}): ExecutionStorageBackend {
  const sqlite = readExecutionStoreSqliteState<{
    version: 1;
    revision: number;
    records: Array<{ id: string }>;
    events: Array<{ id: string; executionId: string; sequence: number }>;
  }>(input.database, 'execution-store');
  if (sqlite?.value.records.some((record) => record.id === input.executionId)) return 'sqlite';
  const bytes = readRawFile(input.filePath);
  if (bytes) {
    try {
      const state = JSON.parse(bytes.toString('utf8')) as { records?: Array<{ id?: unknown }> };
      if (state.records?.some((record) => record.id === input.executionId)) return 'json';
    } catch {
      // Execution-store validation reports corrupt JSON on its own access path.
    }
  }
  // Preserve standalone-store behavior for callers that have not yet claimed an
  // execution. Normal execution side effects always find an existing owner.
  return input.database ? 'sqlite' : 'json';
}

export function isResumableExecutionState(record: {
  state: string;
  timeoutReason?: string;
}): boolean {
  if (record.state !== 'COMPLETED' && record.state !== 'STOPPED') return true;
  return record.state === 'STOPPED'
    && record.timeoutReason !== 'unresolved-blocker'
    && record.timeoutReason !== 'plan-correction-cancelled';
}

export function sqliteExecutionStoreWarning(
  forceJson: boolean,
  records: readonly { state: string; timeoutReason?: string }[]
): string | undefined {
  if (!forceJson || !records.some(isResumableExecutionState)) return undefined;
  return 'ZCC_EXECUTION_STORE=json applies only to new executions; active or resumable SQLite executions remain SQLite-owned.';
}
