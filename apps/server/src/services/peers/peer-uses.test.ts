import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { addHostLinkUse, destroyHost, openDatabase, removeHostLinkUse, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { hostUseApproved } from './peer-uses.js';

const opened: { db: ZccDatabase; dir: string }[] = [];
afterEach(() => { for (const { db, dir } of opened.splice(0)) { db.sqlite.close(); rmSync(dir, { recursive: true, force: true }); } });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-uses-')), db = openDatabase(join(dir, 'zcc.db'));
  opened.push({ db, dir });
  upsertHost(db, { name: 'laptop', hostKeyHash: 'exec-key', isPrimary: true });
  return db;
}

it('denies a connection with no use, allows only the approved plugin, and denies again after Stop using', () => {
  const db = setup();
  const link = upsertHost(db, { name: 'peer link', hostKeyHash: 'link-key', enrollmentCapability: 'peer.forward' });
  expect(hostUseApproved(db, link.id, 'plugin-x')).toBe(false);
  addHostLinkUse(db, link.id, { pluginId: 'plugin-x', scope: 'scope-1', label: 'X' });
  expect(hostUseApproved(db, link.id, 'plugin-x')).toBe(true);
  expect(hostUseApproved(db, link.id, 'plugin-y')).toBe(false);
  removeHostLinkUse(db, link.id, 'plugin-x');
  expect(hostUseApproved(db, link.id, 'plugin-x')).toBe(false);
});

it('denies a removed connection and never carries a use over to a re-link', () => {
  const db = setup();
  const first = upsertHost(db, { name: 'peer link', hostKeyHash: 'link-key', enrollmentCapability: 'peer.forward' });
  addHostLinkUse(db, first.id, { pluginId: 'plugin-x', scope: 'scope-1', label: 'X' });
  destroyHost(db, first.id);
  expect(hostUseApproved(db, first.id, 'plugin-x')).toBe(false);
  const relinked = upsertHost(db, { name: 'peer link', hostKeyHash: 'link-key-2', enrollmentCapability: 'peer.forward' });
  expect(relinked.id).not.toBe(first.id);
  expect(hostUseApproved(db, relinked.id, 'plugin-x')).toBe(false);
});

it('keeps execution enrollments outside connection use gating and denies unknown hosts', () => {
  const db = setup();
  const exec = upsertHost(db, { name: 'remote', hostKeyHash: 'remote-key', enrollmentCapability: 'execution', isPrimary: false });
  expect(hostUseApproved(db, exec.id, 'plugin-x')).toBe(true);
  expect(hostUseApproved(db, '00000000-0000-4000-8000-000000000000', 'plugin-x')).toBe(false);
});
