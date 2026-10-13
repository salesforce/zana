import { join } from 'node:path';
import { openExecutionDatabase } from '@zana-ai/zcc-db';
import { readExecutionStoreSqliteState } from '@zana-ai/zcc-server/services/execution/storage/sqlite-state';
import { executionStoreCreationBackend, sqliteExecutionStoreWarning } from '@zana-ai/zcc-server/services/execution/storage/backend-policy';

type Database = ReturnType<typeof openExecutionDatabase>;

export interface ExecutionStorageDeps {
  userDataDir: string;
  backendEnv: string | undefined;
  warn(message: string): void;
  openDatabase?: (path: string) => Database;
  readState?: (database: Database) => Array<{ id: string; state: string; timeoutReason?: string }>;
}

/**
 * Opens the execution SQLite database and resolves which backend new records use.
 * Close is idempotent so shutdown can call it from every exit path.
 */
export function openExecutionStorage(deps: ExecutionStorageDeps) {
  const backend = executionStoreCreationBackend(deps.backendEnv);
  const database = (deps.openDatabase ?? openExecutionDatabase)(join(deps.userDataDir, 'squad-executions.sqlite'));
  let closed = false;
  const readRecords = deps.readState ?? ((db: Database) => readExecutionStoreSqliteState<{
    version: 1;
    revision: number;
    records: Array<{ id: string; state: string; timeoutReason?: string }>;
    events: Array<{ id: string; executionId: string; sequence: number }>;
  }>(db, 'execution-store')?.value.records ?? []);
  return {
    database,
    createInJson: backend === 'json',
    /** Call after the execution store is created: store construction may migrate records into SQLite. */
    warnIfSqliteSuperseded(): void {
      const warning = sqliteExecutionStoreWarning(backend === 'json', readRecords(database));
      if (warning) deps.warn(`[main] ${warning}`);
    },
    close(): void {
      if (!database || closed) return;
      closed = true;
      database.close();
    }
  };
}
