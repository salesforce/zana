import type { ZccDatabase } from '../connection.js';
import { createThreadId } from '../ids.js';

export type ThreadStatus = 'starting' | 'running' | 'disconnected' | 'failed' | 'completed';

export interface ThreadRow {
  id: string;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: ThreadStatus;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ThreadSqlRow {
  id: string;
  project_id: string;
  host_id: string;
  environment_id: string | null;
  provider_id: string;
  status: ThreadStatus;
  title: string | null;
  created_at: number;
  updated_at: number;
}

function toThread(row: ThreadSqlRow): ThreadRow {
  return {
    id: row.id,
    projectId: row.project_id,
    hostId: row.host_id,
    environmentId: row.environment_id,
    providerId: row.provider_id,
    status: row.status,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createThread(
  db: ZccDatabase,
  input: {
    id?: string;
    projectId: string;
    hostId: string;
    environmentId: string;
    providerId: string;
    status?: ThreadStatus;
    title?: string | null;
  }
): ThreadRow {
  const now = Date.now();
  const id = input.id ?? createThreadId();
  db.sqlite.prepare(
    `INSERT INTO legacy_agent_sessions (id, project_id, host_id, environment_id, provider_id, status, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.hostId,
    input.environmentId,
    input.providerId,
    input.status ?? 'starting',
    input.title ?? null,
    now,
    now
  );
  return getThread(db, id)!;
}

export function getThread(db: ZccDatabase, id: string): ThreadRow | null {
  const row = db.sqlite.prepare('SELECT * FROM legacy_agent_sessions WHERE id = ?').get(id) as ThreadSqlRow | undefined;
  return row ? toThread(row) : null;
}

export function listThreadsByProject(db: ZccDatabase, projectId: string): ThreadRow[] {
  return (db.sqlite.prepare(
    'SELECT * FROM legacy_agent_sessions WHERE project_id = ? ORDER BY updated_at DESC'
  ).all(projectId) as ThreadSqlRow[]).map(toThread);
}

export function listThreadsByHost(db: ZccDatabase, hostId: string): ThreadRow[] {
  return (db.sqlite.prepare('SELECT * FROM legacy_agent_sessions WHERE host_id = ?').all(hostId) as ThreadSqlRow[]).map(toThread);
}

export function listLiveThreads(db: ZccDatabase): ThreadRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM legacy_agent_sessions WHERE status IN ('starting', 'running') ORDER BY updated_at DESC`
  ).all() as ThreadSqlRow[]).map(toThread);
}

export function updateThreadStatus(db: ZccDatabase, id: string, status: ThreadStatus): ThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare('UPDATE legacy_agent_sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  return getThread(db, id);
}

/** Mark a thread completed so listLiveThreads cannot resurrect it after a failed HTTP archive. */
export function completeThread(db: ZccDatabase, id: string): boolean {
  const thread = getThread(db, id);
  if (!thread) return false;
  if (thread.status === 'completed' || thread.status === 'failed') return true;
  return Boolean(updateThreadStatus(db, id, 'completed'));
}

export function disconnectLiveThreadsForHost(db: ZccDatabase, hostId: string): number {
  const now = Date.now();
  const result = db.sqlite.prepare(
    `UPDATE legacy_agent_sessions SET status = 'disconnected', updated_at = ?
     WHERE host_id = ? AND status IN ('starting', 'running')`
  ).run(now, hostId);
  return result.changes;
}
