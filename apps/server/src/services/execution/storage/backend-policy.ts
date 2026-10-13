import { statSync } from 'node:fs';
import { readRawFile } from '../../harness-routing/storage.js';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import { executionStoreHasRecord } from './sqlite-state.js';

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
  // Without SQLite there is only one possible owner; skip the ledger read.
  if (!input.database) return 'json';
  if (executionStoreHasRecord(input.database, 'execution-store', input.executionId)) return 'sqlite';
  if (jsonLedgerHasExecution(input.filePath, input.executionId)) return 'json';
  // Unclaimed executions default to SQLite. Normal execution side effects
  // always find an existing owner.
  return 'sqlite';
}

interface JsonIdCacheEntry { signature: string; ids: ReadonlySet<string>; }
const JSON_ID_CACHE_MAX = 16;
const jsonIdCache = new Map<string, JsonIdCacheEntry>();

/**
 * The legacy JSON ledger is re-parsed only when its file changes. The signature
 * includes inode and ctime because atomic writes rename a new file into place.
 */
function jsonLedgerHasExecution(filePath: string, executionId: string): boolean {
  let signature: string;
  try {
    const stat = statSync(filePath);
    signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      jsonIdCache.delete(filePath);
      return false;
    }
    throw error;
  }
  const cached = jsonIdCache.get(filePath);
  if (cached?.signature === signature) return cached.ids.has(executionId);
  const bytes = readRawFile(filePath);
  if (!bytes) return false;
  try {
    const state = JSON.parse(bytes.toString('utf8')) as { records?: Array<{ id?: unknown }> };
    const ids = new Set<string>();
    for (const record of state.records ?? []) if (typeof record.id === 'string') ids.add(record.id);
    jsonIdCache.delete(filePath);
    jsonIdCache.set(filePath, { signature, ids });
    if (jsonIdCache.size > JSON_ID_CACHE_MAX) jsonIdCache.delete(jsonIdCache.keys().next().value as string);
    return ids.has(executionId);
  } catch {
    // Execution-store validation reports corrupt JSON on its own access path.
    jsonIdCache.delete(filePath);
    return false;
  }
}

/**
 * Side stores either run JSON-only, or are SQLite-capable and must name the
 * execution ledger JSON path so ownership lookup can never guess a wrong file.
 */
export type ExecutionSideStoreStorage =
  | { executionFilePath?: undefined; database?: undefined }
  | { executionFilePath: string; database: ExecutionDatabase };

export function assertSideStoreStorage(options: { executionFilePath?: string; database?: ExecutionDatabase }, label: string): void {
  if (options.database && !options.executionFilePath) {
    throw new Error(`${label} requires executionFilePath when a SQLite database is provided`);
  }
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
