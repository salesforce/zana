import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../connection.js';
import { createConversationThread, getConversationThread } from './conversation-threads.js';
import { addHostLinkUse, getHost, renameHost, updateHostSshIdentity, upsertHost } from './hosts.js';
import { createEnvironment } from './environments.js';

it.each(['fresh', 'v26', 'main27', 'main28', 'candidate27'])('preserves data and both schemas when upgrading %s', lineage => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-merge-migration-'));
  const file = join(dir, 'runtime.sqlite');
  let db = openDatabase(file);
  try {
    const host = upsertHost(db, { name: 'host', hostKeyHash: 'hash' });
    const environment = createEnvironment(db, { projectId: 'project', hostId: host.id });
    const thread = createConversationThread(db, { projectId: 'project', hostId: host.id, environmentId: environment.id, providerId: 'fake' });
    if (lineage !== 'fresh') db.sqlite.exec('DELETE FROM runtime_schema_migrations WHERE version = 29');
    if (lineage === 'v26' || lineage === 'candidate27') {
      db.sqlite.exec(`DROP TABLE plugin_interactions; DROP TABLE dispatch_admission_generations;
        DELETE FROM runtime_schema_migrations WHERE version >= ${lineage === 'v26' ? 27 : 28};`);
    }
    if (lineage === 'main27') db.sqlite.exec('DROP TABLE dispatch_admission_generations; DELETE FROM runtime_schema_migrations WHERE version = 28');
    if (lineage !== 'fresh' && lineage !== 'candidate27') db.sqlite.exec('DROP INDEX thread_events_user_history_idx; DROP INDEX threads_visible_project_idx');
    const insertInteraction = () => db.sqlite.prepare(`INSERT INTO plugin_interactions
      (id, plugin_id, project_id, correlation_id, kind, payload_json, status, generation, created_at, updated_at)
      VALUES ('retained', 'probe', 'project', 'correlation', 'prompt', '{}', 'pending', 1, 1, 1)`).run();
    if (lineage === 'main27' || lineage === 'main28' || lineage === 'fresh') insertInteraction();
    db.close();
    db = openDatabase(file);
    expect(getConversationThread(db, thread.id)?.id).toBe(thread.id);
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('plugin_interactions', 'dispatch_admission_generations', 'thread_events_user_history_idx', 'threads_visible_project_idx') ORDER BY name").all())
      .toEqual(['dispatch_admission_generations', 'plugin_interactions', 'thread_events_user_history_idx', 'threads_visible_project_idx'].map(name => ({ name })));
    if (lineage === 'v26' || lineage === 'candidate27') insertInteraction();
    expect(db.sqlite.prepare('SELECT version FROM runtime_schema_migrations WHERE version >= 27 ORDER BY version').all())
      .toEqual(Array.from({ length: 13 }, (_, index) => ({ version: index + 27 })));
    db.close();
    db = openDatabase(file);
    expect(db.sqlite.prepare("SELECT status FROM plugin_interactions WHERE id = 'retained'").get()).toEqual({ status: 'pending' });
    expect(getConversationThread(db, thread.id)?.id).toBe(thread.id);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([
  'v32', 'main33', 'main34', 'main35', 'main36', 'main35-missing-name',
  'branch33', 'branch34', 'branch35', 'merged', 'replay39'
])('repairs colliding host migrations without changing persisted data for %s', lineage => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-host-lineage-'));
  const file = join(dir, 'runtime.sqlite');
  let db = openDatabase(file);
  try {
    const host = upsertHost(db, { name: 'remote', hostKeyHash: 'remote-key' });
    updateHostSshIdentity(db, host.id, { host: 'remote-alias', user: 'owner', proxyJump: 'jump' });
    renameHost(db, host.id, 'Custom remote');
    const peer = upsertHost(db, { name: 'peer', hostKeyHash: 'peer-key', enrollmentCapability: 'peer.forward' });
    const use = addHostLinkUse(db, peer.id, { pluginId: 'probe', scope: 'project', label: 'Probe' });
    db.sqlite.prepare(`INSERT INTO host_join_codes
      (hash, host_id, expires_at, redeemed_at, enrollment_capability)
      VALUES ('join-key', ?, 12345, NULL, 'peer.forward')`).run(peer.id);

    const keepHostCapability = lineage.startsWith('branch') || lineage === 'merged' || lineage === 'replay39';
    const keepJoinCapability = keepHostCapability && lineage !== 'branch33';
    const keepPurpose = ['branch35', 'merged', 'replay39'].includes(lineage);
    const keepName = (lineage.startsWith('main') && lineage !== 'main35-missing-name')
      || lineage === 'merged' || lineage === 'replay39';
    if (!keepPurpose) db.sqlite.exec('DROP TABLE host_link_uses; ALTER TABLE hosts DROP COLUMN purpose_kind');
    if (!keepHostCapability) db.sqlite.exec('ALTER TABLE hosts DROP COLUMN enrollment_capability');
    if (!keepJoinCapability) db.sqlite.exec('ALTER TABLE host_join_codes DROP COLUMN enrollment_capability');
    if (!keepName) db.sqlite.exec('ALTER TABLE hosts DROP COLUMN name_user_set');
    const versions = lineage === 'v32' ? []
      : lineage === 'main36' ? [33, 34, 36]
      : lineage === 'merged' || lineage === 'replay39' ? [33, 34, 35, 36, 37, 38, 39]
      : lineage.endsWith('33') ? [33]
      : lineage.endsWith('34') ? [33, 34]
      : [33, 34, 35];
    db.sqlite.exec('DELETE FROM runtime_schema_migrations WHERE version >= 33');
    for (const version of versions) {
      db.sqlite.prepare('INSERT INTO runtime_schema_migrations (version, applied_at) VALUES (?, 1)').run(version);
    }
    if (lineage === 'replay39') db.sqlite.exec('DELETE FROM runtime_schema_migrations WHERE version = 39');
    const history = db.sqlite.prepare('SELECT version, applied_at FROM runtime_schema_migrations ORDER BY version').all();
    db.close();
    db = openDatabase(file);

    const assertData = () => {
      expect(getHost(db, host.id)).toMatchObject({
        name: 'Custom remote', hostKeyHash: 'remote-key', sshHost: 'remote-alias',
        sshUser: 'owner', sshProxyJump: 'jump', nameUserSet: keepName ? true : null,
        enrollmentCapability: 'execution', purpose: { kind: 'execution' }
      });
      expect(getHost(db, peer.id)).toMatchObject({
        hostKeyHash: 'peer-key', enrollmentCapability: keepHostCapability ? 'peer.forward' : 'execution',
        purpose: keepHostCapability ? { kind: 'plugin-link', uses: keepPurpose ? [use] : [] } : { kind: 'execution' }
      });
      expect(db.sqlite.prepare('SELECT * FROM host_join_codes WHERE hash = ?').get('join-key')).toEqual({
        hash: 'join-key', host_id: peer.id, expires_at: 12345, redeemed_at: null,
        enrollment_capability: keepJoinCapability ? 'peer.forward' : 'execution'
      });
      expect(db.sqlite.prepare('SELECT version, applied_at FROM runtime_schema_migrations ORDER BY version').all())
        .toEqual(expect.arrayContaining(history));
      expect(db.sqlite.prepare('SELECT version FROM runtime_schema_migrations WHERE version >= 33 ORDER BY version').all())
        .toEqual([33, 34, 35, 36, 37, 38, 39].map(version => ({ version })));
    };
    assertData();
    // Both new columns retain their authorization constraints after lineage repair.
    expect(() => db.sqlite.exec("UPDATE hosts SET enrollment_capability = 'invalid'")).toThrow();
    expect(() => db.sqlite.exec("UPDATE host_join_codes SET enrollment_capability = 'invalid'")).toThrow();
    expect(() => db.sqlite.exec("UPDATE hosts SET purpose_kind = 'invalid'")).toThrow();
    db.close();
    db = openDatabase(file);
    assertData();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
