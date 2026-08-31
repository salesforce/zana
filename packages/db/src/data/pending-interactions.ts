import type { ZccDatabase } from '../connection.js';
import { createPendingInteractionId } from '../ids.js';

export type PendingInteractionStatus = 'pending' | 'resolving' | 'resolved' | 'interrupted';
export type PendingInteractionOriginKind = 'provider' | 'plugin';

export interface PendingInteractionRow {
  id: string;
  threadId: string;
  originKind: PendingInteractionOriginKind;
  turnId: string | null;
  providerId: string | null;
  providerThreadId: string | null;
  providerRequestId: string | null;
  pluginId: string | null;
  rendererId: string | null;
  status: PendingInteractionStatus;
  payload: string;
  resolution: string | null;
  statusReason: string | null;
  createdAt: number;
  expiresAt: number | null;
  resolvedAt: number | null;
  updatedAt: number;
}

interface PendingInteractionSqlRow {
  id: string;
  thread_id: string;
  origin_kind: PendingInteractionOriginKind;
  turn_id: string | null;
  provider_id: string | null;
  provider_thread_id: string | null;
  provider_request_id: string | null;
  plugin_id: string | null;
  renderer_id: string | null;
  status: PendingInteractionStatus;
  payload: string;
  resolution: string | null;
  status_reason: string | null;
  created_at: number;
  expires_at: number | null;
  resolved_at: number | null;
  updated_at: number;
}

export type CreatePendingInteractionInput =
  | {
      originKind?: 'provider';
      threadId: string;
      turnId: string;
      providerId: string;
      providerThreadId: string;
      providerRequestId: string;
      payload: string;
      expiresAt?: number | null;
    }
  | {
      originKind: 'plugin';
      threadId: string;
      turnId?: string | null;
      pluginId: string;
      rendererId: string;
      payload: string;
      expiresAt?: number | null;
    };

export interface PendingInteractionProviderRequestIdentity {
  providerId: string;
  providerThreadId: string;
  providerRequestId: string;
}

const ACTIVE_STATUSES: readonly PendingInteractionStatus[] = ['pending', 'resolving'];
const SQLITE_IN_CLAUSE_BATCH_SIZE = 900;

function toRow(row: PendingInteractionSqlRow): PendingInteractionRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    originKind: row.origin_kind,
    turnId: row.turn_id,
    providerId: row.provider_id,
    providerThreadId: row.provider_thread_id,
    providerRequestId: row.provider_request_id,
    pluginId: row.plugin_id,
    rendererId: row.renderer_id,
    status: row.status,
    payload: row.payload,
    resolution: row.resolution,
    statusReason: row.status_reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at
  };
}

function sliceInClauseBatches<T>(values: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += SQLITE_IN_CLAUSE_BATCH_SIZE) {
    batches.push(values.slice(offset, offset + SQLITE_IN_CLAUSE_BATCH_SIZE));
  }
  return batches;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export function createPendingInteraction(
  db: ZccDatabase,
  input: CreatePendingInteractionInput
): PendingInteractionRow {
  const now = Date.now();
  const id = createPendingInteractionId();
  const isPlugin = input.originKind === 'plugin';
  const originKind: PendingInteractionOriginKind = isPlugin ? 'plugin' : 'provider';
  db.sqlite.prepare(
    `INSERT INTO pending_interactions (
       id, thread_id, origin_kind, turn_id, provider_id, provider_thread_id, provider_request_id,
       plugin_id, renderer_id, status, payload, resolution, status_reason, created_at, expires_at,
       resolved_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?, NULL, ?)`
  ).run(
    id,
    input.threadId,
    originKind,
    input.originKind === 'plugin' ? (input.turnId ?? null) : input.turnId,
    input.originKind === 'plugin' ? null : input.providerId,
    input.originKind === 'plugin' ? null : input.providerThreadId,
    input.originKind === 'plugin' ? null : input.providerRequestId,
    input.originKind === 'plugin' ? input.pluginId : null,
    input.originKind === 'plugin' ? input.rendererId : null,
    input.payload,
    now,
    input.expiresAt ?? null,
    now
  );
  return getPendingInteraction(db, id)!;
}

export function getPendingInteraction(db: ZccDatabase, id: string): PendingInteractionRow | null {
  const row = db.sqlite.prepare('SELECT * FROM pending_interactions WHERE id = ?').get(id) as
    | PendingInteractionSqlRow
    | undefined;
  return row ? toRow(row) : null;
}

export function getPendingInteractionByProviderRequest(
  db: ZccDatabase,
  args: PendingInteractionProviderRequestIdentity
): PendingInteractionRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM pending_interactions
     WHERE origin_kind = 'provider'
       AND provider_id = ?
       AND provider_thread_id = ?
       AND provider_request_id = ?`
  ).get(args.providerId, args.providerThreadId, args.providerRequestId) as
    | PendingInteractionSqlRow
    | undefined;
  return row ? toRow(row) : null;
}

export function getActivePendingInteractionForThread(
  db: ZccDatabase,
  threadId: string
): PendingInteractionRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM pending_interactions
     WHERE thread_id = ? AND status IN ('pending', 'resolving')
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(threadId) as PendingInteractionSqlRow | undefined;
  return row ? toRow(row) : null;
}

export function hasPendingInteractionForThread(db: ZccDatabase, threadId: string): boolean {
  const row = db.sqlite.prepare(
    `SELECT 1 AS n FROM pending_interactions WHERE thread_id = ? AND status = 'pending' LIMIT 1`
  ).get(threadId) as { n: number } | undefined;
  return Boolean(row);
}

export function listPendingInteractionsByThread(
  db: ZccDatabase,
  args: {
    threadId: string;
    statuses?: readonly PendingInteractionStatus[];
    limit?: number;
  }
): PendingInteractionRow[] {
  const statuses = args.statuses && args.statuses.length > 0 ? args.statuses : null;
  if (statuses) {
    const sql = args.limit
      ? `SELECT * FROM pending_interactions
         WHERE thread_id = ? AND status IN (${placeholders(statuses.length)})
         ORDER BY created_at DESC
         LIMIT ?`
      : `SELECT * FROM pending_interactions
         WHERE thread_id = ? AND status IN (${placeholders(statuses.length)})
         ORDER BY created_at DESC`;
    const params = args.limit
      ? [args.threadId, ...statuses, args.limit]
      : [args.threadId, ...statuses];
    return (db.sqlite.prepare(sql).all(...params) as PendingInteractionSqlRow[]).map(toRow);
  }
  const sql = args.limit
    ? 'SELECT * FROM pending_interactions WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM pending_interactions WHERE thread_id = ? ORDER BY created_at DESC';
  const params = args.limit ? [args.threadId, args.limit] : [args.threadId];
  return (db.sqlite.prepare(sql).all(...params) as PendingInteractionSqlRow[]).map(toRow);
}

export function listActivePendingInteractionsForPlugin(
  db: ZccDatabase,
  pluginId: string
): PendingInteractionRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM pending_interactions
     WHERE origin_kind = 'plugin' AND plugin_id = ? AND status IN ('pending', 'resolving')
     ORDER BY created_at DESC`
  ).all(pluginId) as PendingInteractionSqlRow[]).map(toRow);
}

export function listActivePluginPendingInteractions(db: ZccDatabase): PendingInteractionRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM pending_interactions
     WHERE origin_kind = 'plugin' AND status IN ('pending', 'resolving')
     ORDER BY created_at DESC`
  ).all() as PendingInteractionSqlRow[]).map(toRow);
}

export function setPendingInteractionResolving(
  db: ZccDatabase,
  args: { id: string; resolution: string }
): PendingInteractionRow | null {
  const now = Date.now();
  const result = db.sqlite.prepare(
    `UPDATE pending_interactions
     SET status = 'resolving', resolution = ?, status_reason = NULL, updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(args.resolution, now, args.id);
  if (result.changes === 0) return null;
  return getPendingInteraction(db, args.id);
}

function setTerminalState(
  db: ZccDatabase,
  args: {
    id: string;
    status: 'resolved' | 'interrupted';
    resolution: string | null;
    statusReason: string | null;
    resolvedAt?: number;
  }
): PendingInteractionRow | null {
  const now = Date.now();
  const resolvedAt = args.resolvedAt ?? now;
  const result = db.sqlite.prepare(
    `UPDATE pending_interactions
     SET status = ?, resolution = ?, status_reason = ?, resolved_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'resolving')`
  ).run(args.status, args.resolution, args.statusReason, resolvedAt, now, args.id);
  if (result.changes === 0) return null;
  return getPendingInteraction(db, args.id);
}

export function setPendingInteractionResolved(
  db: ZccDatabase,
  args: { id: string; resolution: string }
): PendingInteractionRow | null {
  return setTerminalState(db, {
    id: args.id,
    status: 'resolved',
    resolution: args.resolution,
    statusReason: null
  });
}

export function setPendingInteractionInterrupted(
  db: ZccDatabase,
  args: { id: string; statusReason: string }
): PendingInteractionRow | null {
  return setTerminalState(db, {
    id: args.id,
    status: 'interrupted',
    resolution: null,
    statusReason: args.statusReason
  });
}

function interruptWhere(
  db: ZccDatabase,
  args: {
    whereSql: string;
    params: unknown[];
    statusReason: string;
    resolvedAt?: number;
  }
): PendingInteractionRow[] {
  const now = Date.now();
  const resolvedAt = args.resolvedAt ?? now;
  const rows = db.sqlite.prepare(
    `SELECT * FROM pending_interactions
     WHERE ${args.whereSql} AND status IN ('pending', 'resolving')`
  ).all(...args.params) as PendingInteractionSqlRow[];
  if (rows.length === 0) return [];
  db.sqlite.prepare(
    `UPDATE pending_interactions
     SET status = 'interrupted', status_reason = ?, resolved_at = ?, updated_at = ?
     WHERE ${args.whereSql} AND status IN ('pending', 'resolving')`
  ).run(args.statusReason, resolvedAt, now, ...args.params);
  return rows.map((row) => ({
    ...toRow(row),
    status: 'interrupted',
    statusReason: args.statusReason,
    resolvedAt,
    updatedAt: now
  }));
}

export function interruptPendingInteractionsForThreads(
  db: ZccDatabase,
  args: {
    providerId: string;
    threadIds: readonly string[];
    statusReason: string;
    resolvedAt?: number;
  }
): PendingInteractionRow[] {
  if (args.threadIds.length === 0) return [];
  const interrupted: PendingInteractionRow[] = [];
  for (const batch of sliceInClauseBatches(args.threadIds)) {
    interrupted.push(
      ...interruptWhere(db, {
        whereSql: `origin_kind = 'provider' AND provider_id = ? AND thread_id IN (${placeholders(batch.length)})`,
        params: [args.providerId, ...batch],
        statusReason: args.statusReason,
        resolvedAt: args.resolvedAt
      })
    );
  }
  return interrupted;
}

export function interruptPendingInteractionsForThreadIds(
  db: ZccDatabase,
  args: {
    threadIds: readonly string[];
    statusReason: string;
    resolvedAt?: number;
  }
): PendingInteractionRow[] {
  if (args.threadIds.length === 0) return [];
  const interrupted: PendingInteractionRow[] = [];
  for (const batch of sliceInClauseBatches(args.threadIds)) {
    interrupted.push(
      ...interruptWhere(db, {
        whereSql: `thread_id IN (${placeholders(batch.length)})`,
        params: [...batch],
        statusReason: args.statusReason,
        resolvedAt: args.resolvedAt
      })
    );
  }
  return interrupted;
}

export function listActivePendingInteractionThreadIdsForHost(
  db: ZccDatabase,
  hostId: string
): string[] {
  return (db.sqlite.prepare(
    `SELECT DISTINCT pi.thread_id AS threadId
       FROM pending_interactions pi
       JOIN threads t ON t.id = pi.thread_id
      WHERE t.host_id = ?
        AND pi.status IN ('pending', 'resolving')`
  ).all(hostId) as Array<{ threadId: string }>).map((row) => row.threadId);
}

export function interruptPendingInteractionsForPlugin(
  db: ZccDatabase,
  args: {
    pluginId: string;
    statusReason: string;
    resolvedAt?: number;
  }
): PendingInteractionRow[] {
  return interruptWhere(db, {
    whereSql: `origin_kind = 'plugin' AND plugin_id = ?`,
    params: [args.pluginId],
    statusReason: args.statusReason,
    resolvedAt: args.resolvedAt
  });
}

export { ACTIVE_STATUSES };
