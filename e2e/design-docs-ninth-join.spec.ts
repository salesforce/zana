import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import type { PluginDatabase } from '../packages/plugin-sdk/src/server.js';
import { DesignDocPeerGroup } from '../plugins/design-docs/src/server/peer-group.js';
import { appendSeat, createRoster } from '../plugins/design-docs/src/server/peer-slots.js';
import { canonicalJson } from '../plugins/design-docs/src/shared/peer-contract.js';
import { test, expect, type AppHandle } from './fixtures/app.js';
import { createPeerApps } from './fixtures/peer-apps.js';

type Status = { members: Array<{ machineId: string }>; setup: { state: string; error: string | null } | null; enrolled: Array<{ id: string; connected: boolean }> };

test('a full 8-seat group refuses a ninth member between two real built apps', async ({ home }) => {
  test.setTimeout(300_000);
  const peers = createPeerApps(home);
  const rpc = <T,>(app: AppHandle, method: string, args?: unknown): Promise<T> => app.window.evaluate(
    ({ method, args }) => window.cc.pluginApps.callRpc('design-docs', method, args), { method, args }) as Promise<T>;
  try {
    const a = await peers.launch('app-a'), b = await peers.launch('app-b');
    for (const app of [a, b]) {
      expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
      const trust = app.window.getByRole('button', { name: 'Install with full trust' });
      if (await trust.isVisible().catch(() => false)) await trust.click();
      await expect.poll(() => app.window.evaluate(async () =>
        (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'design-docs')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
    }
    await peers.enroll(a, b); await peers.enroll(b, a);
    const enrolledOf = async (app: AppHandle) => {
      let id = '';
      await expect.poll(async () => { id = (await rpc<Status>(app, 'groupStatus')).enrolled.find(peer => peer.connected)?.id ?? ''; return id; }, { timeout: 30_000 }).not.toBe('');
      return id;
    };
    const bId = await enrolledOf(a), aId = await enrolledOf(b);

    // Fill A's group to the 8-seat limit with governance-valid members (isolated HOME only).
    const db = createSqliteDatabase(join(a.home, '.zcc', 'plugins', 'design-docs', 'data.db'), { fileMustExist: true });
    try {
      db.pragma('busy_timeout = 5000');
      const statements = (sql: string) => sql.split(';').map(statement => statement.trim()).filter(Boolean);
      const database: PluginDatabase = {
        prepare: sql => db.prepare(sql),
        runScript: sql => { for (const statement of statements(sql)) db.prepare(statement).run(); },
        migrate: list => { for (const sql of list) db.prepare(sql).run(); },
        transaction: fn => db.transaction(fn)()
      };
      const group = new DesignDocPeerGroup(database), local = group.sync.localRepository()!;
      const founders = [
        { replicaId: local.replicaId, machineId: aId, joinedAt: 1, sponsorReplicaId: null },
        { replicaId: 'e2e-replica-2', machineId: 'e2e-app-2', joinedAt: 1, sponsorReplicaId: local.replicaId }
      ];
      let roster = createRoster(local.repoId, 'e2e-full', founders, 'e2e-found', local.replicaId);
      for (let seat = 3; seat <= 8; seat++) {
        const owner = roster.genesis.founders[seat <= 5 ? 0 : 1]!.replicaId;
        roster = appendSeat(roster, { kind: 'admit', seat, requestId: `e2e-join-${seat}`, ownerReplicaId: owner,
          member: { replicaId: `e2e-replica-${seat}`, machineId: `e2e-app-${seat}`, joinedAt: seat, sponsorReplicaId: owner } });
      }
      expect(roster.members).toHaveLength(8);
      database.transaction(() => {
        db.prepare('UPDATE sync_group_control SET local_peer_id = ?, roster_json = ? WHERE singleton = 1').run(aId, canonicalJson(roster));
        group.sync.setGroup(local.repoId, roster.groupId, roster.members, roster.rosterEpoch);
      });
    } finally { db.close(); }

    expect((await rpc<Status>(a, 'groupStatus')).members).toHaveLength(8);
    // Ninth machine: B is a real mutually enrolled app. Both owners try; the group must stay at eight.
    const attempt = await rpc<Status>(a, 'enablePeer', { peerId: bId }).then(status => status, error => ({ failure: String(error) }));
    await rpc(b, 'enablePeer', { peerId: aId }).catch(() => {});
    await rpc(a, 'retryIntroductions').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 5000));
    const after = await rpc<Status>(a, 'groupStatus');
    expect(after.members).toHaveLength(8);
    expect(after.members.some(member => member.machineId === bId)).toBe(false);
    expect((await rpc<Status>(b, 'groupStatus')).members.some(member => member.machineId === bId)).toBe(false);
    console.log('[ninth-join] refused:', JSON.stringify('failure' in attempt ? attempt : { setup: attempt.setup }));
  } finally {
    await peers.dispose();
  }
});
