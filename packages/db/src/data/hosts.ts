import type { ZccDatabase } from '../connection.js';
import { createHostId } from '../ids.js';

export interface HostRow {
  id: string;
  name: string;
  type: string;
  hostKeyHash: string;
  destroyedAt: number | null;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface HostSqlRow {
  id: string;
  name: string;
  type: string;
  host_key_hash: string;
  destroyed_at: number | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

function toHost(row: HostSqlRow): HostRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    hostKeyHash: row.host_key_hash,
    destroyedAt: row.destroyed_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getHost(db: ZccDatabase, id: string): HostRow | null {
  const row = db.sqlite.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostSqlRow | undefined;
  return row ? toHost(row) : null;
}

export function listHosts(db: ZccDatabase): HostRow[] {
  return (db.sqlite.prepare('SELECT * FROM hosts WHERE destroyed_at IS NULL ORDER BY created_at').all() as HostSqlRow[])
    .map(toHost);
}

export function upsertHost(
  db: ZccDatabase,
  input: { id?: string; name: string; hostKeyHash: string; type?: string }
): HostRow {
  const now = Date.now();
  const existing = input.id ? getHost(db, input.id) : null;
  const id = existing?.id ?? input.id ?? createHostId();
  if (existing) {
    db.sqlite.prepare(
      `UPDATE hosts SET name = ?, host_key_hash = ?, type = ?, destroyed_at = NULL, last_seen_at = ?, updated_at = ? WHERE id = ?`
    ).run(input.name, input.hostKeyHash, input.type ?? existing.type, now, now, id);
  } else {
    db.sqlite.prepare(
      `INSERT INTO hosts (id, name, type, host_key_hash, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.type ?? 'persistent', input.hostKeyHash, now, now, now);
  }
  const row = getHost(db, id);
  if (!row) throw new Error(`host ${id} missing after upsert`);
  return row;
}

export function markHostSeen(db: ZccDatabase, id: string): void {
  const now = Date.now();
  db.sqlite.prepare('UPDATE hosts SET last_seen_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
}
