import type { ZccDatabase } from '../connection.js';
import { createHostId } from '../ids.js';

export type HostPermissionMode = 'accept-edits' | 'auto' | 'full';
export type HostEnrollmentCapability = 'execution' | 'peer.forward';
export type HostPurposeKind = 'execution' | 'plugin-link';

/** Hard bound on the uses one plugin-link host can carry. */
export const HOST_LINK_USES_MAX = 32;

/** One reason a plugin-link host exists. Written only by core link owners, never by plugin input. */
export interface HostLinkUse {
  pluginId: string;
  scope: string;
  /** The plugin's registered display name, supplied by core (never by the plugin at call time). */
  label: string;
  since: number;
}

/**
 * Display/listing metadata. No authorization path may read this: a host's
 * rights come from `enrollmentCapability` alone.
 */
export type HostPurpose = { kind: 'execution' } | { kind: 'plugin-link'; uses: HostLinkUse[] };

export interface HostRow {
  id: string;
  name: string;
  type: string;
  hostKeyHash: string;
  enrollmentCapability: HostEnrollmentCapability;
  purpose: HostPurpose;
  destroyedAt: number | null;
  lastSeenAt: number | null;
  maxPermissionMode: HostPermissionMode;
  lastRejectedProtocolVersion: number | null;
  isPrimary: boolean;
  homeDir: string | null;
  sshHost: string | null;
  sshUser: string | null;
  sshProxyJump: string | null;
  defaultWorkspacePath: string | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Name provenance (db-internal): true = user renamed, false = name derived by
   * the app (OS hostname / SSH alias), null = legacy row, provenance unknown.
   */
  nameUserSet: boolean | null;
}

interface HostSqlRow {
  id: string;
  name: string;
  type: string;
  host_key_hash: string;
  enrollment_capability: string;
  purpose_kind: string | null;
  destroyed_at: number | null;
  last_seen_at: number | null;
  max_permission_mode: string | null;
  last_rejected_protocol_version: number | null;
  is_primary: number | null;
  home_dir: string | null;
  ssh_host: string | null;
  ssh_user: string | null;
  ssh_proxy_jump: string | null;
  default_workspace_path: string | null;
  created_at: number;
  updated_at: number;
  name_user_set: number | null;
}

function asPermissionMode(value: string | null): HostPermissionMode {
  return value === 'accept-edits' || value === 'auto' || value === 'full' ? value : 'full';
}

interface HostLinkUseSqlRow {
  host_id: string;
  plugin_id: string;
  scope: string;
  label: string;
  since: number;
}

function toUse(row: HostLinkUseSqlRow): HostLinkUse {
  return { pluginId: row.plugin_id, scope: row.scope, label: row.label, since: row.since };
}

function isPluginLink(row: HostSqlRow): boolean {
  // A forward-only enrollment is a plugin link by definition, whatever the stored purpose says.
  return row.purpose_kind === 'plugin-link' || row.enrollment_capability !== 'execution';
}

function loadUses(db: ZccDatabase, hostIds: readonly string[]): Map<string, HostLinkUse[]> {
  const byHost = new Map<string, HostLinkUse[]>();
  if (hostIds.length === 0) return byHost;
  for (const hostId of hostIds) byHost.set(hostId, []);
  // One query per chunk (not per host), kept under SQLite's bound-variable limit.
  const CHUNK = 500;
  for (let start = 0; start < hostIds.length; start += CHUNK) {
    const chunk = hostIds.slice(start, start + CHUNK);
    const rows = db.sqlite.prepare(
      `SELECT host_id, plugin_id, scope, label, since FROM host_link_uses WHERE host_id IN (${chunk.map(() => '?').join(',')}) ORDER BY since, plugin_id, scope`
    ).all(...chunk) as HostLinkUseSqlRow[];
    for (const row of rows) byHost.get(row.host_id)?.push(toUse(row));
  }
  return byHost;
}

function toHosts(db: ZccDatabase, rows: HostSqlRow[]): HostRow[] {
  const uses = loadUses(db, rows.filter(isPluginLink).map((row) => row.id));
  return rows.map((row) => toHost(row, uses.get(row.id) ?? []));
}

function toHost(row: HostSqlRow, uses: HostLinkUse[] = []): HostRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    hostKeyHash: row.host_key_hash,
    enrollmentCapability: row.enrollment_capability === 'execution' ? 'execution' : 'peer.forward',
    purpose: isPluginLink(row) ? { kind: 'plugin-link', uses } : { kind: 'execution' },
    destroyedAt: row.destroyed_at,
    lastSeenAt: row.last_seen_at,
    maxPermissionMode: asPermissionMode(row.max_permission_mode),
    lastRejectedProtocolVersion: row.last_rejected_protocol_version,
    isPrimary: row.is_primary === 1,
    homeDir: row.home_dir,
    sshHost: row.ssh_host,
    sshUser: row.ssh_user,
    sshProxyJump: row.ssh_proxy_jump,
    defaultWorkspacePath: row.default_workspace_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nameUserSet: row.name_user_set === null || row.name_user_set === undefined ? null : row.name_user_set === 1
  };
}

export function getHost(db: ZccDatabase, id: string): HostRow | null {
  const row = db.sqlite.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostSqlRow | undefined;
  return row ? toHosts(db, [row])[0]! : null;
}

/** Hosts that can run work: preserves the execution-only contract for existing consumers. */
export function listHosts(db: ZccDatabase): HostRow[] {
  return listAllHosts(db).filter((row) => row.purpose.kind === 'execution');
}

/** Every live host, including plugin links. */
export function listAllHosts(db: ZccDatabase): HostRow[] {
  return toHosts(
    db,
    db.sqlite.prepare('SELECT * FROM hosts WHERE destroyed_at IS NULL ORDER BY created_at').all() as HostSqlRow[]
  );
}

/** Hosts that can run work: what machine pickers, project targets and the Machines settings may show. */
export function listExecutionHosts(db: ZccDatabase): HostRow[] {
  return listHosts(db);
}

/** Live plugin-link hosts, optionally only those with a use by `pluginId`. */
export function listPluginLinkHosts(db: ZccDatabase, pluginId?: string): HostRow[] {
  return listAllHosts(db).filter((row) =>
    row.purpose.kind === 'plugin-link'
    && (pluginId === undefined || row.purpose.uses.some((use) => use.pluginId === pluginId)));
}

function sanitizeUse(input: { pluginId: string; scope: string; label: string }): void {
  const bounded = (value: unknown, max: number) => typeof value === 'string' && value.length >= 1 && value.length <= max;
  if (!bounded(input.pluginId, 128)) throw new Error('invalid host link use plugin id');
  if (!bounded(input.scope, 256)) throw new Error('invalid host link use scope');
  if (!bounded(input.label, 80)) throw new Error('invalid host link use label');
}

/**
 * Records (idempotently) that a plugin link host serves `pluginId`/`scope`. Core-only
 * writer: callers pass a label taken from the plugin registry, never from plugin input.
 * Re-adding an existing use refreshes its label and keeps `since`.
 */
export function addHostLinkUse(
  db: ZccDatabase,
  hostId: string,
  input: { pluginId: string; scope: string; label: string }
): HostLinkUse {
  sanitizeUse(input);
  const host = getHost(db, hostId);
  if (!host || host.destroyedAt) throw new Error('host not found');
  if (host.purpose.kind !== 'plugin-link') throw new Error('host is not a plugin link');
  const existing = host.purpose.uses.find((use) => use.pluginId === input.pluginId && use.scope === input.scope);
  if (!existing && host.purpose.uses.length >= HOST_LINK_USES_MAX) throw new Error('host link use limit reached');
  const since = existing?.since ?? Date.now();
  db.sqlite.prepare(
    `INSERT INTO host_link_uses (host_id, plugin_id, scope, label, since) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(host_id, plugin_id, scope) DO UPDATE SET label = excluded.label`
  ).run(hostId, input.pluginId, input.scope, input.label, since);
  return { pluginId: input.pluginId, scope: input.scope, label: input.label, since };
}

/**
 * Removes one use (or every scope of `pluginId` when `scope` is omitted) and returns how many
 * uses the host has left. The caller decides whether zero remaining tears the link down.
 */
export function removeHostLinkUse(db: ZccDatabase, hostId: string, pluginId: string, scope?: string): number {
  if (scope === undefined) {
    db.sqlite.prepare('DELETE FROM host_link_uses WHERE host_id = ? AND plugin_id = ?').run(hostId, pluginId);
  } else {
    db.sqlite.prepare('DELETE FROM host_link_uses WHERE host_id = ? AND plugin_id = ? AND scope = ?')
      .run(hostId, pluginId, scope);
  }
  const row = db.sqlite.prepare('SELECT COUNT(*) AS count FROM host_link_uses WHERE host_id = ?').get(hostId) as { count: number };
  return row.count;
}

export function getPrimaryHost(db: ZccDatabase): HostRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM hosts WHERE destroyed_at IS NULL AND is_primary = 1
     AND enrollment_capability = 'execution' AND COALESCE(purpose_kind, 'execution') = 'execution'
     ORDER BY created_at LIMIT 1`
  ).get() as HostSqlRow | undefined;
  return row ? toHosts(db, [row])[0]! : null;
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
    enrollmentCapability?: HostEnrollmentCapability;
  }
): HostRow {
  if (input.enrollmentCapability !== undefined && !['execution', 'peer.forward'].includes(input.enrollmentCapability)) {
    throw new Error('invalid host enrollment capability');
  }
  const now = Date.now();
  const existing = input.id ? getHost(db, input.id) : null;
  const id = existing?.id ?? input.id ?? createHostId();
  // Purpose follows capability: a forward-only host is always a plugin link, never an execution host.
  const capability = input.enrollmentCapability ?? existing?.enrollmentCapability ?? 'execution';
  const purposeKind: HostPurposeKind = capability === 'execution' ? 'execution' : 'plugin-link';
  const makePrimary = capability === 'execution'
    && (input.isPrimary === true || (!existing && !getPrimaryHost(db) && input.isPrimary !== false));
  if (makePrimary) {
    db.sqlite.prepare('UPDATE hosts SET is_primary = 0, updated_at = ? WHERE is_primary = 1').run(now);
  }
  if (existing) {
    if (purposeKind === 'execution' && existing.purpose.kind === 'plugin-link') {
      db.sqlite.prepare('DELETE FROM host_link_uses WHERE host_id = ?').run(existing.id);
    }
    db.sqlite.prepare(
      `UPDATE hosts SET name = ?, host_key_hash = ?, type = ?, destroyed_at = NULL, last_seen_at = ?,
        is_primary = ?, home_dir = ?, max_permission_mode = ?, enrollment_capability = ?, purpose_kind = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name,
      input.hostKeyHash,
      input.type ?? existing.type,
      now,
      capability === 'execution' && (makePrimary || existing.isPrimary) ? 1 : 0,
      input.homeDir !== undefined ? input.homeDir : existing.homeDir,
      input.maxPermissionMode ?? existing.maxPermissionMode,
      capability,
      purposeKind,
      now,
      id
    );
  } else {
    db.sqlite.prepare(
      `INSERT INTO hosts (id, name, type, host_key_hash, last_seen_at, max_permission_mode, is_primary, home_dir, enrollment_capability, purpose_kind, created_at, updated_at, name_user_set)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      input.name,
      input.type ?? 'persistent',
      input.hostKeyHash,
      now,
      input.maxPermissionMode ?? 'full',
      makePrimary ? 1 : 0,
      input.homeDir ?? null,
      capability,
      purposeKind,
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
  db.sqlite.prepare('UPDATE hosts SET name = ?, name_user_set = 1, updated_at = ? WHERE id = ?').run(name, now, id);
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

export function updateHostDefaultWorkspacePath(
  db: ZccDatabase,
  id: string,
  defaultWorkspacePath: string | null
): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  const now = Date.now();
  db.sqlite.prepare(
    'UPDATE hosts SET default_workspace_path = ?, updated_at = ? WHERE id = ?'
  ).run(defaultWorkspacePath, now, id);
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
  const rows = listExecutionHosts(db).filter((row) => row.sshHost === input.host);
  if (!input.user) return rows[0] ?? null;
  // A row recorded by alias alone (ssh config supplies the user) is the same machine.
  return rows.find((row) => row.sshUser === input.user) ?? rows.find((row) => !row.sshUser) ?? null;
}

export function updateHostSshIdentity(
  db: ZccDatabase,
  id: string,
  input: { host: string; user?: string; proxyJump?: string }
): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  const now = Date.now();
  // The alias overwrites the name only when the name is app-derived. Explicit
  // provenance wins: 1 = user-owned (never overwritten, even if it equals the
  // alias), 0 = alias/default-owned (follows the alias). Legacy rows (NULL) fall
  // back to a heuristic: no prior alias, or name === prior alias, means derived.
  // Unavoidable ambiguity: a legacy user who renamed a host to exactly its old
  // alias (or renamed before any alias existed) is indistinguishable from an
  // autogenerated name and will follow the alias; any other legacy custom name
  // is preserved.
  const nameFromAlias = existing.nameUserSet === null
    ? !existing.sshHost || existing.name === existing.sshHost
    : !existing.nameUserSet;
  const name = nameFromAlias ? input.host : existing.name;
  db.sqlite.prepare(
    `UPDATE hosts SET name = ?, name_user_set = CASE WHEN ? = 1 THEN 0 ELSE name_user_set END,
       ssh_host = ?, ssh_user = ?, ssh_proxy_jump = ?, updated_at = ? WHERE id = ?`
  ).run(name, nameFromAlias ? 1 : 0, input.host, input.user ?? null, input.proxyJump ?? null, now, id);
  return getHost(db, id);
}

export function destroyHost(db: ZccDatabase, id: string): HostRow | null {
  const existing = getHost(db, id);
  if (!existing || existing.destroyedAt) return null;
  if (existing.isPrimary) return existing;
  const now = Date.now();
  // Soft delete keeps the row, so the FK cascade never fires: drop the uses explicitly.
  db.sqlite.prepare('DELETE FROM host_link_uses WHERE host_id = ?').run(id);
  db.sqlite.prepare(
    'UPDATE hosts SET destroyed_at = ?, host_key_hash = ?, updated_at = ? WHERE id = ?'
  ).run(now, `revoked:${now}`, now, id);
  return getHost(db, id);
}
