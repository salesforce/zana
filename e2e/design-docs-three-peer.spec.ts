import { test, expect, type AppHandle } from './fixtures/app.js';
import { join } from 'node:path';
import { corePeerConfig, createPeerApps, hostCapabilities, type PeerApp } from './fixtures/peer-apps.js';
import { pairComputers } from './fixtures/core-peer-use.js';
import { ddConnections, ddGroup as group, ddRpc as rpc, installDesignDocs as install, newComputer, useDesignDocsOnBothSides } from './fixtures/design-docs-core.js';
import { startPrivateSshd } from './fixtures/sshd.js';

const members = async (app: AppHandle) => (await group(app)).members.length;
const api = (app: AppHandle, path: string, init?: { method: string; body?: string }) => app.window.evaluate(async ({ path, init }) => {
  const response = await fetch(path, init ? { method: init.method, headers: { 'content-type': 'application/json' }, body: init.body } : undefined);
  return { status: response.status, body: await response.json().catch(() => null) };
}, { path, init });

/**
 * Core pairs `inviter` with `redeemer` through Settings -> Peers, then Design Docs on the inviter asks to use the new
 * computer and both owners approve. `known` are the inviter's/redeemer's earlier computers, `rows` the Linked rows each shows.
 */
async function connect(inviter: PeerApp, redeemer: PeerApp, rows: { inviter: number; redeemer: number }): Promise<void> {
  const knownInviter = (await ddConnections(inviter)).map(c => c.computerId);
  await pairComputers(inviter, redeemer, rows);
  const target = await newComputer(inviter, knownInviter);
  await useDesignDocsOnBothSides(inviter, redeemer, target);
}

/** Bilateral manual sync: every listed owner presses Sync Now until `app` holds the document. */
async function syncUntil(app: AppHandle, owners: AppHandle[], docId: string): Promise<void> {
  await expect.poll(async () => {
    for (const owner of owners) await rpc(owner, 'syncNow').catch(() => {});
    return (await rpc<Array<{ id: string }>>(app, 'list')).some(doc => doc.id === docId);
  }, { timeout: 120_000 }).toBe(true);
}

/**
 * Every route that needs an execution host is refused on a peer.forward host. An invitation link's plugin-link host is
 * not addressable through machine routes at all (404); an introduction-installed host is refused by the host-hub gate (503).
 */
async function expectForwardOnly(app: AppHandle, hostIds: string[]): Promise<void> {
  for (const hostId of hostIds) {
    const probe = await app.window.evaluate(async hostId => {
      const response = await fetch(`/api/v1/hosts/${hostId}/directory?path=%2F`);
      return { status: response.status, body: await response.json().catch(() => null) };
    }, hostId);
    expect([404, 503]).toContain(probe.status);
    expect(JSON.stringify(probe.body)).toContain(probe.status === 404 ? 'host not found' : 'host enrollment does not authorize command');
  }
}

test('three apps connect through core over a private sshd; C joins via B and syncs transitively', async ({ home }) => {
  test.setTimeout(900_000);
  const sshd = await startPrivateSshd(['app-a', 'app-b', 'app-c'].map(name => join(home, name, '.ssh', 'authorized_keys')));
  const peers = createPeerApps(home);
  const options = () => ({ env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() }, initialConfig: corePeerConfig });
  const started = Date.now();
  const step = (name: string) => console.log(`[three-peer] +${Math.round((Date.now() - started) / 1000)}s ${name}`);
  try {
    const a = await peers.launch('app-a', options());
    const b = await peers.launch('app-b', options());
    const c = await peers.launch('app-c', options());
    for (const app of [a, b, c]) await install(app);
    const baseline = { a: hostCapabilities(a).execution, b: hostCapabilities(b).execution, c: hostCapabilities(c).execution };
    expect([hostCapabilities(a).forward, hostCapabilities(b).forward, hostCapabilities(c).forward]).toEqual([[], [], []]);

    // Founding: A and B link in core Settings -> Peers; both owners approve Design Docs' use, which forms the group.
    step('A-B connection');
    await connect(a, b, { inviter: 1, redeemer: 1 });
    await expect.poll(async () => `${await members(a)},${await members(b)}`, { timeout: 120_000 }).toBe('2,2').catch(async error => {
      for (const [name, app] of [['a', a], ['b', b]] as const) {
        const status = await group(app);
        console.log(`[three-peer] ${name} group not formed`, JSON.stringify({ setup: status.setup, jobs: status.jobs, members: status.members, connections: await ddConnections(app),
          enrolled: (status as unknown as { enrolled: unknown }).enrolled, peers: (status as unknown as { peers: unknown }).peers,
          forward: hostCapabilities(app).forward }));
      }
      throw error;
    });
    const forwardAB = { a: hostCapabilities(a).forward, b: hostCapabilities(b).forward };
    expect(forwardAB.a.length).toBeGreaterThan(0);
    expect(forwardAB.b.length).toBeGreaterThan(0);
    await expectForwardOnly(a, forwardAB.a);
    await expectForwardOnly(b, forwardAB.b);

    // C links with B in core; Design Docs on B asks to use C and both owners approve. B is the sponsor: C joins the existing group.
    step('C joins via B');
    await connect(b, c, { inviter: 2, redeemer: 1 });
    await expect.poll(async () => (await Promise.all([a, b, c].map(members))).join(','), { timeout: 180_000 }).toBe('3,3,3').catch(async error => {
      for (const [name, app] of [['a', a], ['b', b], ['c', c]] as const) {
        const status = await group(app);
        console.log(`[three-peer] ${name} stuck`, JSON.stringify({ setup: status.setup, jobs: status.jobs, members: status.members, connections: await ddConnections(app) }));
      }
      throw error;
    });
    const rosters = await Promise.all([a, b, c].map(async app => JSON.stringify((await group(app)).roster!.members.map(m => m.replicaId).sort())));
    expect(new Set(rosters).size).toBe(1);
    // Peer links are forward-only hosts: no execution host appears and execution RPC is refused over them.
    for (const [app, name] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) {
      expect(hostCapabilities(app).execution).toBe(baseline[name]);
      await expectForwardOnly(app, hostCapabilities(app).forward);
    }
    // Settings -> Machines lists execution machines only.
    for (const app of [a, b, c]) {
      const listed = JSON.stringify((await api(app, '/api/v1/hosts')).body);
      for (const hostId of hostCapabilities(app).forward) expect(listed).not.toContain(hostId);
    }

    // An edit on C reaches B and A.
    step('transitive sync');
    const doc = await rpc<{ id: string }>(c, 'create', { title: 'Transitive from C', template: 'blank', status: 'approved' });
    await syncUntil(b, [c, b], doc.id);
    await syncUntil(a, [b, a, c], doc.id);

    // C goes away: A and B keep syncing among themselves.
    step('C offline');
    const cReplica = (await group(c)).replicaId;
    await peers.close(c);
    const second = await rpc<{ id: string }>(a, 'create', { title: 'A after C offline', template: 'blank', status: 'approved' });
    await syncUntil(b, [a, b], second.id);

    // Removal: A retires the offline C; the barrier reaches B and the remaining pair still syncs.
    step('remove C');
    await rpc(a, 'removePeer', { replicaId: cReplica });
    const retiring = async (app: AppHandle) => (await group(app)).members.find(member => member.replicaId === cReplica)?.retiring ?? true;
    await expect.poll(() => retiring(a), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => { await rpc(a, 'retryIntroductions').catch(() => {}); return retiring(b); }, { timeout: 90_000 }).toBe(true);
    const third = await rpc<{ id: string }>(b, 'create', { title: 'B after C retired', template: 'blank', status: 'approved' });
    await syncUntil(a, [b, a], third.id);
    expect(hostCapabilities(a).execution).toBe(baseline.a);
    expect(hostCapabilities(b).execution).toBe(baseline.b);
    step('done');
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
