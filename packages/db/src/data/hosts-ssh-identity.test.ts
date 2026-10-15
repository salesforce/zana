import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  destroyHost,
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
    db.sqlite.prepare('UPDATE hosts SET name = ? WHERE id = ?').run('Build box', host.id);
    expect(updateHostSshIdentity(db, host.id, { host: 'sfw-264-alt', user: 'sfwork' })).toMatchObject({
      name: 'Build box', sshHost: 'sfw-264-alt'
    });
  });

  it('renames an alias-derived name to the new alias but keeps a user-chosen name', () => {
    const db = open();
    const host = upsertHost(db, { name: 'pod-name', hostKeyHash: 'h'.repeat(64) });
    updateHostSshIdentity(db, host.id, { host: 'sfw-264' });
    expect(updateHostSshIdentity(db, host.id, { host: 'sfw-300' })?.name).toBe('sfw-300');
    db.sqlite.prepare('UPDATE hosts SET name = ? WHERE id = ?').run('Build box', host.id);
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
});
