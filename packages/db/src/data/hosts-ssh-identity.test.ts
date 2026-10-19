import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  destroyHost,
  renameHost,
  findHostBySsh,
  getHost,
  openDatabase,
  updateHostSshIdentity,
  upsertHost,
  type ZccDatabase
} from '../index.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function open(): ZccDatabase {
  dir = mkdtempSync(join(tmpdir(), 'zcc-host-ssh-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  return db;
}

describe('host SSH identity', () => {
  it('names a machine after the SSH alias it was first paired through', () => {
    const db = open();
    const host = upsertHost(db, { name: 'wmqzgvj45eds0hqkctr35t16711', hostKeyHash: 'h'.repeat(64) });
    expect(updateHostSshIdentity(db, host.id, { host: 'sfw-264', user: 'sfwork' })).toMatchObject({
      name: 'sfw-264', sshHost: 'sfw-264', sshUser: 'sfwork'
    });
  });

  it('keeps the existing name when the identity was already recorded', () => {
    const db = open();
    const host = upsertHost(db, { name: 'pod-name', hostKeyHash: 'h'.repeat(64) });
    updateHostSshIdentity(db, host.id, { host: 'sfw-264' });
    renameHost(db, host.id, 'Build box');
    expect(updateHostSshIdentity(db, host.id, { host: 'sfw-264-alt', user: 'sfwork' })).toMatchObject({
      name: 'Build box', sshHost: 'sfw-264-alt'
    });
  });

  it('renames an alias-derived name to the new alias but keeps a user-chosen name', () => {
    const db = open();
    const host = upsertHost(db, { name: 'pod-name', hostKeyHash: 'h'.repeat(64) });
    updateHostSshIdentity(db, host.id, { host: 'sfw-264' });
    expect(updateHostSshIdentity(db, host.id, { host: 'sfw-300' })?.name).toBe('sfw-300');
    renameHost(db, host.id, 'Build box');
    const reused = upsertHost(db, { id: host.id, name: 'Build box', hostKeyHash: 'h'.repeat(64) });
    expect(updateHostSshIdentity(db, reused.id, { host: 'sfw-400' })?.name).toBe('Build box');
  });

  it('refuses a removed machine', () => {
    const db = open();
    upsertHost(db, { name: 'laptop', hostKeyHash: 'p'.repeat(64), isPrimary: true });
    const host = upsertHost(db, { name: 'gone', hostKeyHash: 'h'.repeat(64), isPrimary: false });
    expect(destroyHost(db, host.id)?.destroyedAt).toBeTruthy();
    expect(updateHostSshIdentity(db, host.id, { host: 'sfw-264' })).toBeNull();
    expect(getHost(db, host.id)?.name).toBe('gone');
  });

  it('matches an alias-only identity for a user-qualified lookup, preferring an exact user', () => {
    const db = open();
    const aliasOnly = upsertHost(db, { name: 'a', hostKeyHash: 'a'.repeat(64) });
    updateHostSshIdentity(db, aliasOnly.id, { host: 'sfw-264' });
    expect(findHostBySsh(db, { host: 'sfw-264', user: 'sfwork' })?.id).toBe(aliasOnly.id);
    expect(findHostBySsh(db, { host: 'sfw-264' })?.id).toBe(aliasOnly.id);

    const exact = upsertHost(db, { name: 'b', hostKeyHash: 'b'.repeat(64) });
    updateHostSshIdentity(db, exact.id, { host: 'sfw-264', user: 'sfwork' });
    expect(findHostBySsh(db, { host: 'sfw-264', user: 'sfwork' })?.id).toBe(exact.id);
  });

  it('does not match another user or another alias', () => {
    const db = open();
    const host = upsertHost(db, { name: 'a', hostKeyHash: 'a'.repeat(64) });
    updateHostSshIdentity(db, host.id, { host: 'sfw-264', user: 'root' });
    expect(findHostBySsh(db, { host: 'sfw-264', user: 'sfwork' })).toBeNull();
    expect(findHostBySsh(db, { host: 'sfw-265' })).toBeNull();
  });

  describe('name provenance', () => {
    const legacy = (db: ZccDatabase, id: string) =>
      db.sqlite.prepare('UPDATE hosts SET name_user_set = NULL WHERE id = ?').run(id);

    it('marks new hosts app-owned and renames user-owned', () => {
      const db = open();
      const host = upsertHost(db, { name: 'pod', hostKeyHash: 'h'.repeat(64) });
      expect(host.nameUserSet).toBe(false);
      expect(renameHost(db, host.id, 'Mine')?.nameUserSet).toBe(true);
      expect(renameHost(db, 'missing', 'x')).toBeNull();
    });

    it('preserves a rename made before the first alias', () => {
      const db = open();
      const host = upsertHost(db, { name: 'pod', hostKeyHash: 'h'.repeat(64) });
      renameHost(db, host.id, 'Mine');
      expect(updateHostSshIdentity(db, host.id, { host: 'sfw-1' })).toMatchObject({ name: 'Mine', sshHost: 'sfw-1', nameUserSet: true });
    });

    it('preserves a rename made after identity, even when equal to the alias', () => {
      const db = open();
      const host = upsertHost(db, { name: 'pod', hostKeyHash: 'h'.repeat(64) });
      updateHostSshIdentity(db, host.id, { host: 'sfw-1' });
      renameHost(db, host.id, 'sfw-1');
      expect(updateHostSshIdentity(db, host.id, { host: 'sfw-2' })).toMatchObject({ name: 'sfw-1' });
    });

    it('refreshes alias-owned names', () => {
      const db = open();
      const host = upsertHost(db, { name: 'pod', hostKeyHash: 'h'.repeat(64) });
      expect(updateHostSshIdentity(db, host.id, { host: 'a' })).toMatchObject({ name: 'a', nameUserSet: false });
      expect(updateHostSshIdentity(db, host.id, { host: 'b' })).toMatchObject({ name: 'b', nameUserSet: false });
    });

    it('legacy NULL rows: preserve custom names, follow alias when name equals it or none set', () => {
      const db = open();
      const a = upsertHost(db, { name: 'pod', hostKeyHash: 'a'.repeat(64) });
      updateHostSshIdentity(db, a.id, { host: 'x' });
      db.sqlite.prepare('UPDATE hosts SET name = ? WHERE id = ?').run('Custom', a.id);
      legacy(db, a.id);
      expect(getHost(db, a.id)?.nameUserSet).toBeNull();
      expect(updateHostSshIdentity(db, a.id, { host: 'y' })).toMatchObject({ name: 'Custom' });
      const b = upsertHost(db, { name: 'pod2', hostKeyHash: 'b'.repeat(64) });
      updateHostSshIdentity(db, b.id, { host: 'x' });
      legacy(db, b.id);
      expect(updateHostSshIdentity(db, b.id, { host: 'y' })).toMatchObject({ name: 'y' });
      const c = upsertHost(db, { name: 'pod3', hostKeyHash: 'c'.repeat(64) });
      legacy(db, c.id);
      expect(updateHostSshIdentity(db, c.id, { host: 'z' })).toMatchObject({ name: 'z' });
    });

    it('migrates a legacy v32 database preserving ids and names, and is replayable', () => {
      const first = open();
      const host = upsertHost(first, { name: 'Custom', hostKeyHash: 'h'.repeat(64) });
      const file = join(dir!, 'zcc.sqlite');
      first.sqlite.exec('ALTER TABLE hosts DROP COLUMN name_user_set; DELETE FROM runtime_schema_migrations WHERE version = 33');
      first.close();
      let re = openDatabase(file);
      expect(getHost(re, host.id)).toMatchObject({ id: host.id, name: 'Custom', nameUserSet: null });
      re.sqlite.exec('DELETE FROM runtime_schema_migrations WHERE version = 33');
      re.close();
      re = openDatabase(file);
      expect(getHost(re, host.id)).toMatchObject({ name: 'Custom', nameUserSet: null });
      re.close();
    });

    it('repairs a database that recorded v33 without adding name provenance', () => {
      const first = open();
      const host = upsertHost(first, { name: 'Custom', hostKeyHash: 'h'.repeat(64) });
      const file = join(dir!, 'zcc.sqlite');
      first.sqlite.exec('ALTER TABLE hosts DROP COLUMN name_user_set; DELETE FROM runtime_schema_migrations WHERE version = 34');
      first.close();

      const re = openDatabase(file);
      expect(updateHostSshIdentity(re, host.id, { host: 'sfw-264' })).toMatchObject({
        name: 'sfw-264',
        sshHost: 'sfw-264',
        nameUserSet: false
      });
      re.close();
    });
  });
});
