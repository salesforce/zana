import type { ZccDatabase } from '../connection.js';
import { createThreadId } from '../ids.js';

export type ConversationThreadStatus = 'idle' | 'starting' | 'active' | 'stopping' | 'error';
export type ConversationThreadVisibility = 'visible' | 'hidden';

export interface ConversationThreadRow {
  id: string;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: ConversationThreadStatus;
  originKind: 'fork' | null;
  visibility: ConversationThreadVisibility;
  title: string | null;
  providerThreadId: string | null;
  parentThreadId: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ConversationThreadSqlRow {
  id: string;
  project_id: string;
  host_id: string;
  environment_id: string | null;
  provider_id: string;
  status: ConversationThreadStatus;
  origin_kind: 'fork' | null;
  visibility: ConversationThreadVisibility;
  title: string | null;
  provider_thread_id: string | null;
  parent_thread_id: string | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

function toThread(row: ConversationThreadSqlRow): ConversationThreadRow {
  return {
    id: row.id,
    projectId: row.project_id,
    hostId: row.host_id,
    environmentId: row.environment_id,
    providerId: row.provider_id,
    status: row.status,
    originKind: row.origin_kind,
    visibility: row.visibility,
    title: row.title,
    providerThreadId: row.provider_thread_id,
    parentThreadId: row.parent_thread_id,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createConversationThread(
  db: ZccDatabase,
  input: {
    id?: string;
    projectId: string;
    hostId: string;
    environmentId: string;
    providerId: string;
    status?: ConversationThreadStatus;
    title?: string | null;
    visibility?: ConversationThreadVisibility;
    parentThreadId?: string | null;
    originKind?: 'fork' | null;
  }
): ConversationThreadRow {
  const now = Date.now();
  const id = input.id ?? createThreadId();
  db.sqlite.prepare(
    `INSERT INTO threads (
       id, project_id, host_id, environment_id, provider_id, status, origin_kind,
       visibility, title, provider_thread_id, parent_thread_id, archived_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.hostId,
    input.environmentId,
    input.providerId,
    input.status ?? 'starting',
    input.originKind ?? null,
    input.visibility ?? 'visible',
    input.title ?? null,
    input.parentThreadId ?? null,
    now,
    now
  );
  return getConversationThread(db, id)!;
}

export function getConversationThread(db: ZccDatabase, id: string): ConversationThreadRow | null {
  const row = db.sqlite.prepare('SELECT * FROM threads WHERE id = ?').get(id) as ConversationThreadSqlRow | undefined;
  return row ? toThread(row) : null;
}

export function listConversationThreadsByProject(
  db: ZccDatabase,
  projectId: string,
  includeArchived = false
): ConversationThreadRow[] {
  const sql = includeArchived
    ? 'SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC'
    : 'SELECT * FROM threads WHERE project_id = ? AND archived_at IS NULL ORDER BY updated_at DESC';
  return (db.sqlite.prepare(sql).all(projectId) as ConversationThreadSqlRow[]).map(toThread);
}

export function listLiveConversationThreads(db: ZccDatabase): ConversationThreadRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM threads
     WHERE archived_at IS NULL AND status IN ('starting', 'active', 'stopping')
     ORDER BY updated_at DESC`
  ).all() as ConversationThreadSqlRow[]).map(toThread);
}

/** Cap for the unscoped visible-thread list (idle + error included). */
export const VISIBLE_CONVERSATION_THREAD_LIMIT = 200;

export function listVisibleConversationThreads(
  db: ZccDatabase,
  opts?: { limit?: number }
): ConversationThreadRow[] {
  const requested = opts?.limit ?? VISIBLE_CONVERSATION_THREAD_LIMIT;
  const limit = Math.max(1, Math.min(requested, VISIBLE_CONVERSATION_THREAD_LIMIT));
  return (db.sqlite.prepare(
    `SELECT * FROM threads
     WHERE archived_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(limit) as ConversationThreadSqlRow[]).map(toThread);
}

export function updateConversationThreadStatus(
  db: ZccDatabase,
  id: string,
  status: ConversationThreadStatus
): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  return getConversationThread(db, id);
}

export function setConversationProviderThreadId(
  db: ZccDatabase,
  id: string,
  providerThreadId: string
): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare('UPDATE threads SET provider_thread_id = ?, updated_at = ? WHERE id = ?').run(
    providerThreadId,
    now,
    id
  );
  return getConversationThread(db, id);
}

export function archiveConversationThread(db: ZccDatabase, id: string): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare(
    `UPDATE threads SET archived_at = ?, status = 'idle', updated_at = ? WHERE id = ? AND archived_at IS NULL`
  ).run(now, now, id);
  return getConversationThread(db, id);
}

export function countLiveConversationThreadsForEnvironment(db: ZccDatabase, environmentId: string): number {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS n FROM threads
     WHERE environment_id = ? AND archived_at IS NULL AND status IN ('starting', 'active', 'stopping')`
  ).get(environmentId) as { n: number };
  return row.n;
}
