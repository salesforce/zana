import type { ZccDatabase } from '../connection.js';
import { createHostSessionId } from '../ids.js';

export interface HostSessionRow {
  id: string;
  hostId: string;
  instanceId: string;
  hostName: string;
  status: 'active' | 'closed';
  closeReason: string | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface HostSessionSqlRow {
  id: string;
  host_id: string;
  instance_id: string;
  host_name: string;
  status: 'active' | 'closed';
  close_reason: string | null;
  closed_at: number | null;
  created_at: number;
  updated_at: number;
}

function toSession(row: HostSessionSqlRow): HostSessionRow {
  return {
    id: row.id,
    hostId: row.host_id,
    instanceId: row.instance_id,
    hostName: row.host_name,
    status: row.status,
    closeReason: row.close_reason,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getActiveSessionForHost(db: ZccDatabase, hostId: string): HostSessionRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM host_sessions WHERE host_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`
  ).get(hostId) as HostSessionSqlRow | undefined;
  return row ? toSession(row) : null;
}

/** Latest session for a host, including closed rows from a crash or replace. */
export function getLatestSessionForHost(db: ZccDatabase, hostId: string): HostSessionRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM host_sessions WHERE host_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
  ).get(hostId) as HostSessionSqlRow | undefined;
  return row ? toSession(row) : null;
}

export function openHostSession(
  db: ZccDatabase,
  input: { hostId: string; instanceId: string; hostName: string }
): HostSessionRow {
  const now = Date.now();
  db.sqlite.prepare(
    `UPDATE host_sessions SET status = 'closed', close_reason = 'replaced', closed_at = ?, updated_at = ?
     WHERE host_id = ? AND status = 'active'`
  ).run(now, now, input.hostId);
  const id = createHostSessionId();
  db.sqlite.prepare(
    `INSERT INTO host_sessions (id, host_id, instance_id, host_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, input.hostId, input.instanceId, input.hostName, now, now);
  const row = db.sqlite.prepare('SELECT * FROM host_sessions WHERE id = ?').get(id) as HostSessionSqlRow;
  return toSession(row);
}

export function closeHostSession(
  db: ZccDatabase,
  hostId: string,
  reason: string
): void {
  const now = Date.now();
  db.sqlite.prepare(
    `UPDATE host_sessions SET status = 'closed', close_reason = ?, closed_at = ?, updated_at = ?
     WHERE host_id = ? AND status = 'active'`
  ).run(reason, now, now, hostId);
}
