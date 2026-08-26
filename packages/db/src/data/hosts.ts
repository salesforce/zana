import type { ZccDatabase } from '../connection.js';
import { createHostId } from '../ids.js';

export type HostPermissionMode = 'accept-edits' | 'auto' | 'full';

export interface HostRow {
  id: string;
  name: string;
  type: string;
  hostKeyHash: string;
  destroyedAt: number | null;
  lastSeenAt: number | null;
  maxPermissionMode: HostPermissionMode;
  lastRejectedProtocolVersion: number | null;
  isPrimary: boolean;
  homeDir: string | null;
  sshHost: string | null;
  sshUser: string | null;
  sshProxyJump: string | null;
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
  max_permission_mode: string | null;
  last_rejected_protocol_version: number | null;
  is_primary: number | null;
  home_dir: string | null;
  ssh_host: string | null;
  ssh_user: string | null;
  ssh_proxy_jump: string | null;
  created_at: number;
  updated_at: number;
}

function asPermissionMode(value: string | null): HostPermissionMode {
  return value === 'accept-edits' || value === 'auto' || value === 'full' ? value : 'full';
}

function toHost(row: HostSqlRow): HostRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    hostKeyHash: row.host_key_hash,
    destroyedAt: row.destroyed_at,
    lastSeenAt: row.last_seen_at,
    maxPermissionMode: asPermissionMode(row.max_permission_mode),
    lastRejectedProtocolVersion: row.last_rejected_protocol_version,
    isPrimary: row.is_primary === 1,
    homeDir: row.home_dir,
    sshHost: row.ssh_host,
    sshUser: row.ssh_user,
    sshProxyJump: row.ssh_proxy_jump,
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

export function getPrimaryHost(db: ZccDatabase): HostRow | null {
  const row = db.sqlite.prepare(
    'SELECT * FROM hosts WHERE destroyed_at IS NULL AND is_primary = 1 ORDER BY created_at LIMIT 1'
  ).get() as HostSqlRow | undefined;
  return row ? toHost(row) : null;
}

export function upsertHost(
  db: ZccDatabase,
  input: {
    id?: string;
    name: string;
    hostKeyHash: string;
    type?: string;
    isPrimary?: boolean;
    homeDir?: string | null;
    maxPermissionMode?: HostPermissionMode;
  }
): HostRow {
  const now = Date.now();
  const existing = input.id ? getHost(db, input.id) : null;
  const id = existing?.id ?? input.id ?? createHostId();
  const makePrimary = input.isPrimary === true || (!existing && !getPrimaryHost(db) && input.isPrimary !== false);
  if (makePrimary) {
    db.sqlite.prepare('UPDATE hosts SET is_primary = 0, updated_at = ? WHERE is_primary = 1').run(now);
  }
  if (existing) {
    db.sqlite.prepare(
      `UPDATE hosts SET name = ?, host_key_hash = ?, type = ?, destroyed_at = NULL, last_seen_at = ?,
        is_primary = ?, home_dir = ?, max_permission_mode = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name,
      input.hostKeyHash,
      input.type ?? existing.type,
      now,
      makePrimary || existing.isPrimary ? 1 : 0,
      input.homeDir !== undefined ? input.homeDir : existing.homeDir,
      input.maxPermissionMode ?? existing.maxPermissionMode,
      now,
      id
    );
  } else {
    db.sqlite.prepare(
      `INSERT INTO hosts (id, name, type, host_key_hash, last_seen_at, max_permission_mode, is_primary, home_dir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.type ?? 'persistent',
      input.hostKeyHash,
      now,
      input.maxPermissionMode ?? 'full',
      makePrimary ? 1 : 0,
      input.homeDir ?? null,
      now,
      now
    );
  }
  const row = getHost(db, id);
  if (!row) throw new Error(`host ${id} missing after upsert`);
  return row;
}

export function markHostSeen(db: ZccDatabase, id: string): void {
  const now = Date.now();
  db.sqlite.prepare('UPDATE hosts SET last_seen_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
}

export function renameHost(db: ZccDatabase, id: string, name: string): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  const now = Date.now();
  db.sqlite.prepare('UPDATE hosts SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
  return getHost(db, id);
}

export function updateHostPermissionCeiling(
  db: ZccDatabase,
  id: string,
  maxPermissionMode: HostPermissionMode
): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  const now = Date.now();
  db.sqlite.prepare('UPDATE hosts SET max_permission_mode = ?, updated_at = ? WHERE id = ?')
    .run(maxPermissionMode, now, id);
  return getHost(db, id);
}

export function markHostProtocolRejected(db: ZccDatabase, id: string, protocolVersion: number): void {
  const now = Date.now();
  db.sqlite.prepare(
    'UPDATE hosts SET last_rejected_protocol_version = ?, updated_at = ? WHERE id = ?'
  ).run(protocolVersion, now, id);
}

export function findHostBySsh(
  db: ZccDatabase,
  input: { host: string; user?: string }
): HostRow | null {
  const rows = listHosts(db);
  return rows.find((row) => {
    if (!row.sshHost || row.sshHost !== input.host) return false;
    if (input.user) return row.sshUser === input.user;
    return true;
  }) ?? null;
}

export function updateHostSshIdentity(
  db: ZccDatabase,
  id: string,
  input: { host: string; user?: string; proxyJump?: string }
): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  const now = Date.now();
  db.sqlite.prepare(
    `UPDATE hosts SET ssh_host = ?, ssh_user = ?, ssh_proxy_jump = ?, updated_at = ? WHERE id = ?`
  ).run(input.host, input.user ?? null, input.proxyJump ?? null, now, id);
  return getHost(db, id);
}

export function destroyHost(db: ZccDatabase, id: string): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  if (existing.isPrimary) return existing;
  const now = Date.now();
  db.sqlite.prepare(
    'UPDATE hosts SET destroyed_at = ?, host_key_hash = ?, updated_at = ? WHERE id = ?'
  ).run(now, `revoked:${now}`, now, id);
  return getHost(db, id);
}
