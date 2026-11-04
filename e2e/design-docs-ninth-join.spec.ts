import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import type { PluginDatabase } from '../packages/plugin-sdk/src/server.js';
import { DesignDocPeerGroup } from '../plugins/design-docs/src/server/peer-group.js';
import { appendSeat, createRoster } from '../plugins/design-docs/src/server/peer-slots.js';
import { canonicalJson } from '../plugins/design-docs/src/shared/peer-contract.js';
import { test, expect, type AppHandle } from './fixtures/app.js';
import { corePeerConfig, createPeerApps } from './fixtures/peer-apps.js';
import { pairComputers } from './fixtures/core-peer-use.js';
import { connectedComputer, ddGroup, installDesignDocs, useDesignDocsOnBothSides } from './fixtures/design-docs-core.js';
import { startPrivateSshd } from './fixtures/sshd.js';

type Status = { members: Array<{ machineId: string }>; setup: { state: string; error: string | null } | null };

test('a full 8-seat group refuses a ninth member between two real built apps', async ({ home }) => {
  test.setTimeout(300_000);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  const rpc = <T,>(app: AppHandle, method: string, args?: unknown): Promise<T> => app.window.evaluate(
    ({ method, args }) => window.cc.pluginApps.callRpc('design-docs', method, args), { method, args }) as Promise<T>;
  try {
    const a = await peers.launch('app-a', { initialConfig: corePeerConfig, env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() } });
    const b = await peers.launch('app-b', { initialConfig: corePeerConfig });
    for (const app of [a, b]) await installDesignDocs(app);
    // Core owns the connection; Design Docs has not been approved to use it yet.
    await pairComputers(a, b);
    const bId = (await connectedComputer(a)).computerId, aId = (await connectedComputer(b)).computerId;

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
    // Ninth machine: B is a real core-connected computer. Both owners approve the use; the group must stay at eight.
    const attempt = await useDesignDocsOnBothSides(a, b).then(() => ({ failure: null }), error => ({ failure: String(error) }));
    await rpc(a, 'retryIntroductions').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 5000));
    const after = await ddGroup(a);
    expect(after.members).toHaveLength(8);
    expect(after.members.some(member => member.machineId === bId)).toBe(false);
    expect((await ddGroup(b)).members.some(member => member.machineId === bId)).toBe(false);
    console.log('[ninth-join] refused:', JSON.stringify({ attempt, setup: (await rpc<Status>(a, 'groupStatus')).setup }));
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
