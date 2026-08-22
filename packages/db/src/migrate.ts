import type { SqliteDatabase } from './connection.js';

const CREATE_TABLES_V1 = [
  `CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'persistent',
        host_key_hash TEXT NOT NULL,
        destroyed_at INTEGER,
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE TABLE host_sessions (
        id TEXT PRIMARY KEY,
        host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        instance_id TEXT NOT NULL,
        host_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
        close_reason TEXT,
        closed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE INDEX host_sessions_host_status_idx ON host_sessions(host_id, status)`,
  `CREATE TABLE environments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        path TEXT,
        workspace_provision_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE INDEX environments_host_idx ON environments(host_id)`,
  `CREATE INDEX environments_project_idx ON environments(project_id)`,
  `CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
        provider_id TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE INDEX threads_host_idx ON threads(host_id)`,
  `CREATE INDEX threads_project_idx ON threads(project_id, updated_at)`,
  `CREATE INDEX threads_environment_idx ON threads(environment_id)`,
  `CREATE TABLE thread_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        UNIQUE (thread_id, sequence)
      )`,
  `CREATE INDEX thread_events_thread_seq_idx ON thread_events(thread_id, sequence)`
];

const MIGRATE_V2 = [
  `ALTER TABLE environments ADD COLUMN name TEXT`,
  `ALTER TABLE environments ADD COLUMN managed INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE environments ADD COLUMN is_git_repo INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE environments ADD COLUMN is_worktree INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE environments ADD COLUMN branch_name TEXT`,
  `ALTER TABLE environments ADD COLUMN base_branch TEXT`,
  `ALTER TABLE environments ADD COLUMN default_branch TEXT`,
  `ALTER TABLE environments ADD COLUMN merge_base_branch TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS environments_project_host_path_idx
     ON environments(project_id, host_id, path)
     WHERE path IS NOT NULL`
];

function applyVersion(database: SqliteDatabase, version: number, statements: readonly string[]): void {
  database.transaction(() => {
    for (const statement of statements) {
      database.exec(statement);
    }
    database.prepare('INSERT INTO runtime_schema_migrations (version, applied_at) VALUES (?, ?)').run(
      version,
      Date.now()
    );
  })();
}

export function migrate(database: SqliteDatabase): void {
  const bootstrap = 'CREATE TABLE IF NOT EXISTS runtime_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)';
  database.exec(bootstrap);
  const applied = new Set(
    (database.prepare('SELECT version FROM runtime_schema_migrations').all() as Array<{ version: number }>)
      .map((row) => row.version)
  );
  if (!applied.has(1)) applyVersion(database, 1, CREATE_TABLES_V1);
  if (!applied.has(2)) applyVersion(database, 2, MIGRATE_V2);
}
