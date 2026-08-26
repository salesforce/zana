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

const MIGRATE_V3 = [
  `ALTER TABLE threads RENAME TO legacy_agent_sessions`,
  `ALTER TABLE thread_events RENAME TO legacy_agent_session_events`
];

const MIGRATE_V4 = [
  `CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
        provider_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('idle', 'starting', 'active', 'stopping', 'error')),
        origin_kind TEXT CHECK (origin_kind IS NULL OR origin_kind IN ('fork')),
        visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
        title TEXT,
        provider_thread_id TEXT,
        parent_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE INDEX conversation_threads_project_idx ON threads(project_id, updated_at)`,
  `CREATE INDEX conversation_threads_host_idx ON threads(host_id)`,
  `CREATE INDEX conversation_threads_environment_idx ON threads(environment_id)`,
  `CREATE TABLE thread_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        UNIQUE (thread_id, sequence)
      )`,
  `CREATE INDEX conversation_thread_events_thread_seq_idx ON thread_events(thread_id, sequence)`
];

const MIGRATE_V6 = [
  `ALTER TABLE hosts ADD COLUMN max_permission_mode TEXT NOT NULL DEFAULT 'full'`,
  `ALTER TABLE hosts ADD COLUMN last_rejected_protocol_version INTEGER`,
  `ALTER TABLE hosts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE hosts ADD COLUMN home_dir TEXT`,
  `UPDATE hosts SET is_primary = 1 WHERE id = (
        SELECT id FROM hosts WHERE destroyed_at IS NULL ORDER BY created_at ASC LIMIT 1
      )`
];

const MIGRATE_V7 = [
  `ALTER TABLE hosts ADD COLUMN ssh_host TEXT`,
  `ALTER TABLE hosts ADD COLUMN ssh_user TEXT`,
  `ALTER TABLE hosts ADD COLUMN ssh_proxy_jump TEXT`
];

const MIGRATE_V5 = [
  `CREATE TABLE pending_interactions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        origin_kind TEXT NOT NULL DEFAULT 'provider' CHECK (origin_kind IN ('provider', 'plugin')),
        turn_id TEXT,
        provider_id TEXT,
        provider_thread_id TEXT,
        provider_request_id TEXT,
        plugin_id TEXT,
        renderer_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'resolving', 'resolved', 'interrupted')),
        payload TEXT NOT NULL,
        resolution TEXT,
        status_reason TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        resolved_at INTEGER,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE UNIQUE INDEX pending_interactions_provider_request_idx
     ON pending_interactions(provider_id, provider_thread_id, provider_request_id)`,
  `CREATE INDEX pending_interactions_thread_created_idx
     ON pending_interactions(thread_id, created_at)`,
  `CREATE INDEX pending_interactions_thread_status_created_idx
     ON pending_interactions(thread_id, status, created_at)`,
  `CREATE INDEX pending_interactions_status_created_idx
     ON pending_interactions(status, created_at)`,
  `CREATE INDEX pending_interactions_plugin_status_created_idx
     ON pending_interactions(plugin_id, status, created_at)`
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

/** Keep one environments row per (project, host, path) so v2's unique index can apply. */
export function collapseDuplicateEnvironmentPaths(database: SqliteDatabase): void {
  const duplicates = database
    .prepare(
      `SELECT project_id AS projectId, host_id AS hostId, path
         FROM environments
        WHERE path IS NOT NULL
        GROUP BY project_id, host_id, path
       HAVING COUNT(*) > 1`
    )
    .all() as Array<{ projectId: string; hostId: string; path: string }>;
  const listIds = database.prepare(
    `SELECT id FROM environments
      WHERE project_id = ? AND host_id = ? AND path = ?
      ORDER BY updated_at DESC, id DESC`
  );
  const retargetThreads = database.prepare(
    'UPDATE threads SET environment_id = ? WHERE environment_id = ?'
  );
  const deleteEnvironment = database.prepare('DELETE FROM environments WHERE id = ?');
  for (const group of duplicates) {
    const ids = listIds.all(group.projectId, group.hostId, group.path) as Array<{ id: string }>;
    const keepId = ids[0]?.id;
    if (!keepId) continue;
    for (const extra of ids.slice(1)) {
      retargetThreads.run(keepId, extra.id);
      deleteEnvironment.run(extra.id);
    }
  }
}

export function migrate(database: SqliteDatabase): void {
  const bootstrap = 'CREATE TABLE IF NOT EXISTS runtime_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)';
  database.exec(bootstrap);
  const applied = new Set(
    (database.prepare('SELECT version FROM runtime_schema_migrations').all() as Array<{ version: number }>)
      .map((row) => row.version)
  );
  if (!applied.has(1)) applyVersion(database, 1, CREATE_TABLES_V1);
  if (!applied.has(2)) {
    database.transaction(() => {
      collapseDuplicateEnvironmentPaths(database);
      for (const statement of MIGRATE_V2) database.exec(statement);
      database.prepare('INSERT INTO runtime_schema_migrations (version, applied_at) VALUES (?, ?)').run(
        2,
        Date.now()
      );
    })();
  }
  if (!applied.has(3)) applyVersion(database, 3, MIGRATE_V3);
  if (!applied.has(4)) applyVersion(database, 4, MIGRATE_V4);
  if (!applied.has(5)) applyVersion(database, 5, MIGRATE_V5);
  if (!applied.has(6)) applyVersion(database, 6, MIGRATE_V6);
  if (!applied.has(7)) applyVersion(database, 7, MIGRATE_V7);
}

export { CREATE_TABLES_V1 as SCHEMA_STATEMENTS_V1 };
