import type { ZccDatabase } from '../connection.js';
import { createThreadId } from '../ids.js';
import {
  evaluateThreadLifecycleEvent,
  type ThreadLifecycleEvent
} from '@zana-ai/zcc-domain/thread-runtime';

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
  originPluginId: string | null;
  visibility: ConversationThreadVisibility;
  title: string | null;
  providerThreadId: string | null;
  parentThreadId: string | null;
  archivedAt: number | null;
  pinnedAt: number | null;
  pinOrder: number | null;
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
  origin_plugin_id: string | null;
  visibility: ConversationThreadVisibility;
  title: string | null;
  provider_thread_id: string | null;
  parent_thread_id: string | null;
  archived_at: number | null;
  pinned_at: number | null;
  pin_order: number | null;
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
    originPluginId: row.origin_plugin_id ?? null,
    visibility: row.visibility,
    title: row.title,
    providerThreadId: row.provider_thread_id,
    parentThreadId: row.parent_thread_id,
    archivedAt: row.archived_at,
    pinnedAt: row.pinned_at ?? null,
    pinOrder: row.pin_order ?? null,
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
    originPluginId?: string | null;
  }
): ConversationThreadRow {
  const now = Date.now();
  const id = input.id ?? createThreadId();
  db.sqlite.prepare(
    `INSERT INTO threads (
       id, project_id, host_id, environment_id, provider_id, status, origin_kind,
       origin_plugin_id, visibility, title, provider_thread_id, parent_thread_id, archived_at,
       pinned_at, pin_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.hostId,
    input.environmentId,
    input.providerId,
    input.status ?? 'starting',
    input.originKind ?? null,
    input.originPluginId ?? null,
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
  includeArchived = false,
  opts?: { includeHidden?: boolean }
): ConversationThreadRow[] {
  const includeHidden = opts?.includeHidden === true;
  const clauses = ['project_id = ?'];
  if (!includeArchived) clauses.push('archived_at IS NULL');
  if (!includeHidden) clauses.push("visibility = 'visible'");
  const order = includeArchived
    ? 'ORDER BY updated_at DESC'
    : 'ORDER BY (pinned_at IS NULL), pin_order ASC, updated_at DESC';
  const sql = `SELECT * FROM threads WHERE ${clauses.join(' AND ')} ${order}`;
  return (db.sqlite.prepare(sql).all(projectId) as ConversationThreadSqlRow[]).map(toThread);
}

export interface ConversationThreadListQuery {
  includeHidden?: boolean;
  originKind?: 'fork' | null;
  originPluginId?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
}

/** Plugin/SDK listing: filter by origin, visibility, and archive state. */
export function queryConversationThreads(
  db: ZccDatabase,
  query: ConversationThreadListQuery
): ConversationThreadRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.archived === true) clauses.push('archived_at IS NOT NULL');
  else if (query.archived === false) clauses.push('archived_at IS NULL');
  if (query.includeHidden !== true) clauses.push("visibility = 'visible'");
  if (query.originKind === 'fork') {
    clauses.push("origin_kind = 'fork'");
  } else if (query.originKind === null) {
    clauses.push('origin_kind IS NULL');
  }
  if (query.originPluginId) {
    clauses.push('origin_plugin_id = ?');
    params.push(query.originPluginId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
  const offset = Math.max(0, query.offset ?? 0);
  const sql = `SELECT * FROM threads ${where} ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`;
  return (db.sqlite.prepare(sql).all(...params, limit, offset) as ConversationThreadSqlRow[]).map(toThread);
}

export function listLiveConversationThreads(db: ZccDatabase): ConversationThreadRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM threads
     WHERE archived_at IS NULL AND status IN ('starting', 'active', 'stopping')
     ORDER BY updated_at DESC`
  ).all() as ConversationThreadSqlRow[]).map(toThread);
}

export function listLiveConversationThreadsForHost(
  db: ZccDatabase,
  hostId: string
): ConversationThreadRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM threads
     WHERE host_id = ? AND archived_at IS NULL AND status IN ('starting', 'active', 'stopping')
     ORDER BY updated_at DESC`
  ).all(hostId) as ConversationThreadSqlRow[]).map(toThread);
}

/** Cap for the unscoped visible-thread list (idle + error included). */
export const VISIBLE_CONVERSATION_THREAD_LIMIT = 200;

/** Idle + error included: background workflows can outlive the spawning turn. */
export function listConversationThreadsForHost(
  db: ZccDatabase,
  hostId: string,
  opts?: { limit?: number }
): ConversationThreadRow[] {
  const requested = opts?.limit ?? VISIBLE_CONVERSATION_THREAD_LIMIT;
  const limit = Math.max(1, Math.min(requested, VISIBLE_CONVERSATION_THREAD_LIMIT));
  return (db.sqlite.prepare(
    `SELECT * FROM threads
     WHERE host_id = ? AND archived_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(hostId, limit) as ConversationThreadSqlRow[]).map(toThread);
}

export function listVisibleConversationThreads(
  db: ZccDatabase,
  opts?: { limit?: number }
): ConversationThreadRow[] {
  const requested = opts?.limit ?? VISIBLE_CONVERSATION_THREAD_LIMIT;
  const limit = Math.max(1, Math.min(requested, VISIBLE_CONVERSATION_THREAD_LIMIT));
  return (db.sqlite.prepare(
    `SELECT * FROM threads
     WHERE archived_at IS NULL AND visibility = 'visible'
     ORDER BY (pinned_at IS NULL), pin_order ASC, updated_at DESC
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

export type ApplyConversationThreadLifecycleNoopReason =
  | 'not-found'
  | 'illegal-transition'
  | 'superseded'
  | 'cas-conflict';

export type ApplyConversationThreadLifecycleEventOutcome =
  | { applied: true; thread: ConversationThreadRow }
  | { applied: false; reason: ApplyConversationThreadLifecycleNoopReason; detail: string };

export interface ApplyConversationThreadLifecycleEventArgs {
  event: ThreadLifecycleEvent;
  threadId: string;
}

/** Apply a lifecycle event against a loaded snapshot (CAS on snapshot.status). */
export function applyConversationThreadLifecycleEventOnRow(
  db: ZccDatabase,
  thread: ConversationThreadRow,
  event: ThreadLifecycleEvent
): ApplyConversationThreadLifecycleEventOutcome {
  const evaluation = evaluateThreadLifecycleEvent({
    event,
    thread: {
      archivedAt: thread.archivedAt,
      deletedAt: null,
      status: thread.status
    }
  });
  if ('noop' in evaluation) {
    return {
      applied: false,
      reason: evaluation.noop,
      detail: evaluation.detail
    };
  }
  const now = Date.now();
  const result = db.sqlite.prepare(
    'UPDATE threads SET status = ?, updated_at = ? WHERE id = ? AND status = ?'
  ).run(evaluation.to, now, thread.id, thread.status);
  if (result.changes === 0) {
    return {
      applied: false,
      reason: 'cas-conflict',
      detail: `status changed from ${thread.status} while applying ${event.type}`
    };
  }
  const next = getConversationThread(db, thread.id);
  if (!next) {
    return {
      applied: false,
      reason: 'not-found',
      detail: `thread not found: ${thread.id}`
    };
  }
  return { applied: true, thread: next };
}

/**
 * Single writer for conversation-thread status: evaluate THREAD_LIFECYCLE then
 * compare-and-set. Never throws on stale or illegal events.
 */
export function applyConversationThreadLifecycleEvent(
  db: ZccDatabase,
  args: ApplyConversationThreadLifecycleEventArgs
): ApplyConversationThreadLifecycleEventOutcome {
  const thread = getConversationThread(db, args.threadId);
  if (!thread) {
    return {
      applied: false,
      reason: 'not-found',
      detail: `thread not found: ${args.threadId}`
    };
  }
  return applyConversationThreadLifecycleEventOnRow(db, thread, args.event);
}

export function updateConversationThreadParent(
  db: ZccDatabase,
  id: string,
  parentThreadId: string | null
): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare('UPDATE threads SET parent_thread_id = ?, updated_at = ? WHERE id = ?').run(
    parentThreadId,
    now,
    id
  );
  return getConversationThread(db, id);
}

export function updateConversationThreadTitle(
  db: ZccDatabase,
  id: string,
  title: string
): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
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

export function unarchiveConversationThread(db: ZccDatabase, id: string): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare(
    `UPDATE threads SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL`
  ).run(now, id);
  return getConversationThread(db, id);
}

export function pinConversationThread(db: ZccDatabase, id: string): ConversationThreadRow | null {
  const thread = getConversationThread(db, id);
  if (!thread || thread.archivedAt) return thread;
  if (thread.pinnedAt != null) return thread;
  const now = Date.now();
  const max = db.sqlite.prepare(
    'SELECT MAX(pin_order) AS n FROM threads WHERE pinned_at IS NOT NULL'
  ).get() as { n: number | null };
  const pinOrder = (max.n ?? 0) + 1;
  db.sqlite.prepare(
    'UPDATE threads SET pinned_at = ?, pin_order = ?, updated_at = ? WHERE id = ?'
  ).run(now, pinOrder, now, id);
  return getConversationThread(db, id);
}

export function unpinConversationThread(db: ZccDatabase, id: string): ConversationThreadRow | null {
  const now = Date.now();
  db.sqlite.prepare(
    'UPDATE threads SET pinned_at = NULL, pin_order = NULL, updated_at = ? WHERE id = ?'
  ).run(now, id);
  return getConversationThread(db, id);
}

export function reorderPinnedConversationThread(
  db: ZccDatabase,
  id: string,
  beforeId: string | null
): ConversationThreadRow | null {
  const thread = getConversationThread(db, id);
  if (!thread?.pinnedAt) return thread;
  const pinned = (db.sqlite.prepare(
    `SELECT id FROM threads
      WHERE pinned_at IS NOT NULL AND archived_at IS NULL
      ORDER BY pin_order ASC, id ASC`
  ).all() as Array<{ id: string }>).map((row) => row.id);
  const without = pinned.filter((rowId) => rowId !== id);
  const insertAt = beforeId ? without.indexOf(beforeId) : -1;
  const next = insertAt >= 0
    ? [...without.slice(0, insertAt), id, ...without.slice(insertAt)]
    : [...without, id];
  const now = Date.now();
  const update = db.sqlite.prepare('UPDATE threads SET pin_order = ?, updated_at = ? WHERE id = ?');
  next.forEach((rowId, index) => update.run(index + 1, now, rowId));
  return getConversationThread(db, id);
}

export function countLiveConversationThreadsForEnvironment(db: ZccDatabase, environmentId: string): number {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS n FROM threads
     WHERE environment_id = ? AND archived_at IS NULL AND status IN ('starting', 'active', 'stopping')`
  ).get(environmentId) as { n: number };
  return row.n;
}
