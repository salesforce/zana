import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type ZccDatabase } from '../connection.js';
import {
  HOST_LINK_USES_MAX,
  addHostLinkUse,
  destroyHost,
  findHostBySsh,
  getHost,
  getPrimaryHost,
  listAllHosts,
  listExecutionHosts,
  listHosts,
  listPluginLinkHosts,
  removeHostLinkUse,
  updateHostSshIdentity,
  upsertHost
} from './hosts.js';

let dir: string;
let file: string;
let db: ZccDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-hosts-purpose-'));
  file = join(dir, 'runtime.sqlite');
  db = openDatabase(file);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const link = (name = 'peer link') => upsertHost(db, { name, hostKeyHash: `k-${name}`, enrollmentCapability: 'peer.forward' });
const use = (pluginId = 'plug', scope = 's1', label = 'Plug') => ({ pluginId, scope, label });

describe('migration 35', () => {
  it('creates the purpose column and uses table on a fresh database', () => {
    expect(db.sqlite.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get('hosts', 'purpose_kind')).toBeDefined();
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'host_link_uses'").get()).toBeDefined();
    expect(db.sqlite.prepare('SELECT version FROM runtime_schema_migrations WHERE version = 35').get()).toBeDefined();
  });

  it('upgrades a v34 database, backfilling forward hosts as plugin links with empty uses', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    const fwd = link('fwd');
    db.sqlite.exec(`DROP TABLE host_link_uses; ALTER TABLE hosts DROP COLUMN purpose_kind;
      DELETE FROM runtime_schema_migrations WHERE version = 35;`);
    db.close();
    db = openDatabase(file);
    expect(getHost(db, exec.id)?.purpose).toEqual({ kind: 'execution' });
    expect(getHost(db, fwd.id)?.purpose).toEqual({ kind: 'plugin-link', uses: [] });
    expect(db.sqlite.prepare('SELECT purpose_kind FROM hosts WHERE id = ?').get(fwd.id)).toEqual({ purpose_kind: 'plugin-link' });
    expect(db.sqlite.prepare('SELECT purpose_kind FROM hosts WHERE id = ?').get(exec.id)).toEqual({ purpose_kind: 'execution' });
  });

  it('is replayable over an already-migrated schema and keeps uses', () => {
    const fwd = link();
    addHostLinkUse(db, fwd.id, use());
    db.sqlite.exec('DELETE FROM runtime_schema_migrations WHERE version = 35');
    db.close();
    db = openDatabase(file);
    expect(getHost(db, fwd.id)?.purpose).toMatchObject({ kind: 'plugin-link', uses: [expect.objectContaining({ pluginId: 'plug' })] });
  });

  it('rejects an unknown purpose kind at the schema level', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    expect(() => db.sqlite.prepare("UPDATE hosts SET purpose_kind = 'other' WHERE id = ?").run(exec.id)).toThrow();
  });
});

describe('host purpose mapping', () => {
  it('maps execution hosts to execution and forward hosts to plugin-link with uses', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    const fwd = link();
    expect(exec.purpose).toEqual({ kind: 'execution' });
    expect(fwd.purpose).toEqual({ kind: 'plugin-link', uses: [] });
    addHostLinkUse(db, fwd.id, use());
    expect(getHost(db, fwd.id)?.purpose).toMatchObject({ kind: 'plugin-link', uses: [{ pluginId: 'plug', scope: 's1', label: 'Plug' }] });
  });

  it('never leaves a forward host as an execution purpose, even through re-upsert', () => {
    const fwd = link();
    const again = upsertHost(db, { id: fwd.id, name: 'renamed', hostKeyHash: 'k2' });
    expect(again.enrollmentCapability).toBe('peer.forward');
    expect(again.purpose.kind).toBe('plugin-link');
    // Defense in depth: a corrupted stored purpose cannot make a forward host an execution host.
    db.sqlite.prepare("UPDATE hosts SET purpose_kind = 'execution' WHERE id = ?").run(fwd.id);
    expect(getHost(db, fwd.id)?.purpose.kind).toBe('plugin-link');
  });

  it('upgrading a link to execution clears its uses', () => {
    const fwd = link();
    addHostLinkUse(db, fwd.id, use());
    const upgraded = upsertHost(db, { id: fwd.id, name: 'x', hostKeyHash: 'k', enrollmentCapability: 'execution' });
    expect(upgraded.purpose).toEqual({ kind: 'execution' });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS c FROM host_link_uses').get()).toEqual({ c: 0 });
  });

  it('rejects an invalid capability', () => {
    expect(() => upsertHost(db, { name: 'x', hostKeyHash: 'k', enrollmentCapability: 'bogus' as never })).toThrow('invalid host enrollment capability');
  });
});

describe('listing', () => {
  it('listHosts and listExecutionHosts exclude plugin links', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    link();
    expect(listExecutionHosts(db).map((h) => h.id)).toEqual([exec.id]);
    expect(listHosts(db).map((h) => h.id)).toEqual([exec.id]);
  });

  it('listAllHosts returns both kinds in creation order and excludes destroyed hosts', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    const fwd = link();
    const removed = link('removed');
    destroyHost(db, removed.id);
    db.sqlite.prepare('UPDATE hosts SET created_at = 1 WHERE id = ?').run(exec.id);
    db.sqlite.prepare('UPDATE hosts SET created_at = 2 WHERE id = ?').run(fwd.id);
    expect(listAllHosts(db).map((h) => h.id)).toEqual([exec.id, fwd.id]);
  });

  it('execution listings exclude mismatched capability or plugin-link purpose', () => {
    const fwd = link();
    const mismatched = upsertHost(db, { name: 'mismatched', hostKeyHash: 'm' });
    db.sqlite.prepare("UPDATE hosts SET purpose_kind = 'execution' WHERE id = ?").run(fwd.id);
    db.sqlite.prepare("UPDATE hosts SET purpose_kind = 'plugin-link' WHERE id = ?").run(mismatched.id);
    expect(listHosts(db)).toEqual([]);
    expect(listExecutionHosts(db)).toEqual([]);
    expect(listPluginLinkHosts(db).map((h) => h.id).sort()).toEqual([fwd.id, mismatched.id].sort());
  });

  it('returns empty listings when no hosts exist', () => {
    expect(listHosts(db)).toEqual([]);
    expect(listExecutionHosts(db)).toEqual([]);
    expect(listPluginLinkHosts(db)).toEqual([]);
    expect(listAllHosts(db)).toEqual([]);
  });

  it('listPluginLinkHosts filters by plugin id', () => {
    const a = link('a');
    const b = link('b');
    upsertHost(db, { name: 'exec', hostKeyHash: 'e' });
    addHostLinkUse(db, a.id, use('one'));
    addHostLinkUse(db, b.id, use('two'));
    expect(listPluginLinkHosts(db).map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
    expect(listPluginLinkHosts(db, 'one').map((h) => h.id)).toEqual([a.id]);
    expect(listPluginLinkHosts(db, 'none')).toEqual([]);
  });

  it('loads uses for many plugin links in one grouped query, ordered and not mixed across hosts', () => {
    const hosts = Array.from({ length: 600 }, (_, i) => link(`h${i}`));
    addHostLinkUse(db, hosts[0]!.id, use('p1'));
    addHostLinkUse(db, hosts[0]!.id, { ...use('p2'), scope: 's2' });
    addHostLinkUse(db, hosts[599]!.id, use('p3'));
    const listed = new Map(listAllHosts(db).map((h) => [h.id, h]));
    const usesOf = (id: string) => { const p = listed.get(id)!.purpose; return p.kind === 'plugin-link' ? p.uses.map((u) => u.pluginId) : null; };
    expect(usesOf(hosts[0]!.id)).toEqual(['p1', 'p2']);
    expect(usesOf(hosts[1]!.id)).toEqual([]);
    expect(usesOf(hosts[599]!.id)).toEqual(['p3']);
  });

  it('findHostBySsh never returns a plugin link', () => {
    const fwd = link();
    db.sqlite.prepare("UPDATE hosts SET ssh_host = 'box' WHERE id = ?").run(fwd.id);
    expect(findHostBySsh(db, { host: 'box' })).toBeNull();
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    updateHostSshIdentity(db, exec.id, { host: 'box2' });
    expect(findHostBySsh(db, { host: 'box2' })?.id).toBe(exec.id);
  });
});

describe('primary host scope', () => {
  it.each([undefined, true, false])('never makes a new plugin link primary with isPrimary=%s', (isPrimary) => {
    const fwd = upsertHost(db, { name: 'peer', hostKeyHash: 'p', enrollmentCapability: 'peer.forward', isPrimary });
    expect(fwd.isPrimary).toBe(false);
    expect(getPrimaryHost(db)).toBeNull();
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'e' });
    expect(exec.isPrimary).toBe(true);
    expect(getPrimaryHost(db)?.id).toBe(exec.id);
  });

  it('does not displace an execution primary when inserting or updating a plugin link', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'e' });
    const fwd = upsertHost(db, { name: 'peer', hostKeyHash: 'p', enrollmentCapability: 'peer.forward', isPrimary: true });
    expect(fwd.isPrimary).toBe(false);
    const updated = upsertHost(db, { id: fwd.id, name: 'peer', hostKeyHash: 'p2', isPrimary: true });
    expect(updated.isPrimary).toBe(false);
    expect(getPrimaryHost(db)?.id).toBe(exec.id);
  });

  it('ignores legacy primary flags on forward-only and plugin-link-purpose hosts', () => {
    const fwd = link();
    const mismatched = upsertHost(db, { name: 'mismatched', hostKeyHash: 'm', isPrimary: false });
    db.sqlite.prepare("UPDATE hosts SET is_primary = 1, purpose_kind = 'execution' WHERE id = ?").run(fwd.id);
    db.sqlite.prepare("UPDATE hosts SET is_primary = 1, purpose_kind = 'plugin-link' WHERE id = ?").run(mismatched.id);
    expect(getPrimaryHost(db)).toBeNull();
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'e' });
    expect(getPrimaryHost(db)?.id).toBe(exec.id);
    db.sqlite.prepare('UPDATE hosts SET destroyed_at = 1 WHERE id = ?').run(exec.id);
    expect(getPrimaryHost(db)).toBeNull();
  });

  it.each([undefined, true, false])('clears primary on execution-to-link transition with isPrimary=%s and allows destruction', (isPrimary) => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'e' });
    const fwd = upsertHost(db, { id: exec.id, name: 'peer', hostKeyHash: 'p', enrollmentCapability: 'peer.forward', isPrimary });
    expect(fwd.isPrimary).toBe(false);
    expect(fwd.purpose).toEqual({ kind: 'plugin-link', uses: [] });
    expect(listHosts(db)).toEqual([]);
    expect(getPrimaryHost(db)).toBeNull();
    addHostLinkUse(db, fwd.id, use());
    expect(destroyHost(db, fwd.id)?.destroyedAt).not.toBeNull();
    expect(db.sqlite.prepare('SELECT COUNT(*) AS c FROM host_link_uses').get()).toEqual({ c: 0 });
  });

  it('keeps execution primary selection and preservation on re-upsert', () => {
    const first = upsertHost(db, { name: 'first', hostKeyHash: 'a', isPrimary: false });
    expect(getPrimaryHost(db)).toBeNull();
    const second = upsertHost(db, { name: 'second', hostKeyHash: 'b' });
    expect(upsertHost(db, { id: second.id, name: 'second', hostKeyHash: 'b2' }).isPrimary).toBe(true);
    expect(upsertHost(db, { id: first.id, name: 'first', hostKeyHash: 'a2', isPrimary: true }).isPrimary).toBe(true);
    expect(getPrimaryHost(db)?.id).toBe(first.id);
    expect(getHost(db, second.id)?.isPrimary).toBe(false);
  });
});

describe('link uses', () => {
  it('adds idempotently, refreshing the label and keeping since', async () => {
    const fwd = link();
    const first = addHostLinkUse(db, fwd.id, use('p', 's', 'Old'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = addHostLinkUse(db, fwd.id, use('p', 's', 'New'));
    expect(second.since).toBe(first.since);
    const stored = getHost(db, fwd.id)!.purpose;
    expect(stored).toMatchObject({ kind: 'plugin-link', uses: [{ label: 'New', since: first.since }] });
  });

  it('enforces the per-host cap but still refreshes an existing use at the cap', () => {
    expect(HOST_LINK_USES_MAX).toBe(32);
    const fwd = link();
    for (let i = 0; i < HOST_LINK_USES_MAX; i++) addHostLinkUse(db, fwd.id, use('p', `s${i}`));
    expect(() => addHostLinkUse(db, fwd.id, use('p', 'overflow'))).toThrow('host link use limit reached');
    expect(() => addHostLinkUse(db, fwd.id, use('p', 's0', 'Refreshed'))).not.toThrow();
    const purpose = getHost(db, fwd.id)!.purpose;
    expect(purpose.kind === 'plugin-link' && purpose.uses).toHaveLength(32);
    expect(removeHostLinkUse(db, fwd.id, 'p', 's0')).toBe(31);
    expect(() => addHostLinkUse(db, fwd.id, use('p', 'replacement'))).not.toThrow();
  });

  it('refuses execution, unknown and destroyed hosts', () => {
    const exec = upsertHost(db, { name: 'exec', hostKeyHash: 'a' });
    expect(() => addHostLinkUse(db, exec.id, use())).toThrow('host is not a plugin link');
    expect(() => addHostLinkUse(db, 'missing', use())).toThrow('host not found');
    const fwd = link();
    destroyHost(db, fwd.id);
    expect(() => addHostLinkUse(db, fwd.id, use())).toThrow('host not found');
  });

  it('validates use field bounds', () => {
    const fwd = link();
    expect(() => addHostLinkUse(db, fwd.id, use('', 's', 'l'))).toThrow('plugin id');
    expect(() => addHostLinkUse(db, fwd.id, use('p', '', 'l'))).toThrow('scope');
    expect(() => addHostLinkUse(db, fwd.id, use('p', 's', ''))).toThrow('label');
    expect(() => addHostLinkUse(db, fwd.id, use('p', 's', 'x'.repeat(81)))).toThrow('label');
    expect(() => addHostLinkUse(db, fwd.id, use('p'.repeat(129), 's', 'l'))).toThrow('plugin id');
    expect(() => addHostLinkUse(db, fwd.id, use('p', 's'.repeat(257), 'l'))).toThrow('scope');
  });

  it('removes one scope or a whole plugin and returns the remaining count', () => {
    const fwd = link();
    addHostLinkUse(db, fwd.id, use('p', 's1'));
    addHostLinkUse(db, fwd.id, use('p', 's2'));
    addHostLinkUse(db, fwd.id, use('q', 's1'));
    expect(removeHostLinkUse(db, fwd.id, 'p', 's1')).toBe(2);
    expect(removeHostLinkUse(db, fwd.id, 'p')).toBe(1);
    expect(removeHostLinkUse(db, fwd.id, 'missing')).toBe(1);
    expect(removeHostLinkUse(db, fwd.id, 'q', 's1')).toBe(0);
    expect(removeHostLinkUse(db, fwd.id, 'q', 's1')).toBe(0);
    expect(removeHostLinkUse(db, 'missing', 'p')).toBe(0);
  });

  it('cascades on hard delete and drops uses on soft destroy', () => {
    upsertHost(db, { name: 'primary', hostKeyHash: 'p', isPrimary: true });
    const a = link('a');
    const b = link('b');
    addHostLinkUse(db, a.id, use());
    addHostLinkUse(db, b.id, use());
    destroyHost(db, a.id);
    expect(db.sqlite.prepare('SELECT host_id FROM host_link_uses').all()).toEqual([{ host_id: b.id }]);
    db.sqlite.prepare('DELETE FROM hosts WHERE id = ?').run(b.id);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS c FROM host_link_uses').get()).toEqual({ c: 0 });
  });
});
