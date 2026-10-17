import { test, expect, type AppHandle } from './fixtures/app.js';
import { join } from 'node:path';
import { createPeerApps, hostCapabilities } from './fixtures/peer-apps.js';
import { startPrivateSshd } from './fixtures/sshd.js';

type Member = { machineId: string; replicaId: string; authorized: boolean; retiring?: boolean };
type GroupStatus = { configured: boolean; replicaId: string; members: Member[]; roster: { members: Array<{ replicaId: string }> } | null; setup?: unknown; jobs?: unknown };
type PeerLink = { pairingId: string; peerInstanceId: string; phase: string; state: string; reason?: string | null };
type InviteView = { available: boolean; invitations: Array<{ invitationId: string; role: string; state: string }>; links: PeerLink[] };

const rpc = <T,>(app: AppHandle, method: string, args?: unknown): Promise<T> => app.window.evaluate(
  ({ method, args }) => window.cc.pluginApps.callRpc('design-docs', method, args), { method, args }) as Promise<T>;
const group = (app: AppHandle) => rpc<GroupStatus>(app, 'groupStatus');
const invites = (app: AppHandle) => rpc<InviteView>(app, 'inviteState');
const members = async (app: AppHandle) => (await group(app)).members.length;
const api = (app: AppHandle, path: string, init?: { method: string; body?: string }) => app.window.evaluate(async ({ path, init }) => {
  const response = await fetch(path, init ? { method: init.method, headers: { 'content-type': 'application/json' }, body: init.body } : undefined);
  return { status: response.status, body: await response.json().catch(() => null) };
}, { path, init });

async function install(app: AppHandle): Promise<void> {
  expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
  const trust = app.window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => app.window.evaluate(async () =>
    (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'design-docs')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  await expect.poll(() => group(app).then(status => (status as unknown as { lifecycleAvailable: boolean }).lifecycleAvailable, () => null), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => invites(app).then(view => view.available, () => null), { timeout: 30_000 }).toBe(true);
}

async function openPeers(app: AppHandle) {
  const window = app.window;
  await window.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => {} });
  });
  if (!await window.locator('.dd-peers-view').isVisible().catch(() => false)) {
    await window.getByRole('button', { name: 'Design Docs', exact: true }).click();
    await window.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  }
  const region = window.locator('.dd-peers-view').getByRole('region', { name: 'Database sync peers' });
  await expect(region).toBeVisible({ timeout: 30_000 });
  return region;
}

/** Add peer through the UI; token v3 carries the inviter's pinned ssh endpoint and a forward-only join code (10 minutes). */
async function addPeer(app: AppHandle, sshd: { port: number; hostKey: string }): Promise<string> {
  const panel = (await openPeers(app)).getByLabel('Pair a peer');
  await panel.getByRole('button', { name: 'Add peer', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: /^Invitation ready\. Expires in (10|9):\d{2}\./ })).toBeVisible({ timeout: 20_000 });
  // The field shows the auto-copied format (a link when the build has one); pick the raw code for the tests.
  await panel.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Invitation', exact: true })).toHaveValue(/^zccinv1\./);
  const token = await panel.getByRole('textbox', { name: 'Invitation', exact: true }).inputValue();
  const body = JSON.parse(Buffer.from(token.slice('zccinv1.'.length), 'base64url').toString('utf8'));
  expect(body).toMatchObject({ v: 3, link: { endpoint: { host: 'localhost', port: sshd.port, hostKey: sshd.hostKey }, joinCode: expect.stringMatching(/^zcde_/) } });
  expect(body.exp - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  expect(JSON.stringify(body)).not.toMatch(/\.connect\.zana\.localhost|"http:/);
  return token;
}

async function joinPeer(app: AppHandle, token: string): Promise<void> {
  const panel = (await openPeers(app)).getByLabel('Pair a peer');
  await panel.getByRole('textbox', { name: 'Paste invitation', exact: true }).fill(token);
  await panel.getByRole('button', { name: 'Join peer', exact: true }).click();
}

/** Approve on the pairing row, then confirm in the owner-proof approval sheet (only unanswered sheets count). */
async function approveInUi(app: AppHandle): Promise<void> {
  const row = (await openPeers(app)).getByLabel('Pairing').locator('li').filter({ hasText: /^Approve pairing with / });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  const sheet = <T,>(script: string) => app.electron.evaluate(async ({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval' &&
      !w.webContents.getTitle().startsWith('approve:') && w.webContents.getTitle() !== 'cancel');
    return win ? await win.webContents.executeJavaScript(script) as T : null;
  }, script);
  await expect.poll(() => sheet<string>('document.body.innerText'), { timeout: 15_000 }).toContain('Pair with another computer');
  await expect.poll(() => sheet<boolean>(`(() => { const button = document.getElementById('approve'); if (!button.disabled) setTimeout(() => button.click(), 0); return true; })()`), { timeout: 15_000 }).toBeNull();
}

/** Redeemer joins (pasting is its consent, no approval); only the inviter approves; both reach Ready. */
async function pair(inviter: AppHandle, redeemer: AppHandle, label: string, sshd: { port: number; hostKey: string }, inviterConnected: number): Promise<void> {
  await joinPeer(redeemer, await addPeer(inviter, sshd));
  const redeemerList = (await openPeers(redeemer)).getByLabel('Pairing');
  await expect(redeemerList).toContainText(/Pending: contacting the other computer\.|Awaiting the other owner's approval for |Approved\. Connecting to /, { timeout: 60_000 });
  await expect(redeemerList.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  // Both Peers views stay open: concurrent automatic Enable is resolved by the initiator tie-break.
  await approveInUi(inviter);
  // The Ready row clears itself once the link exists; the inviter's computer cards carry the result.
  const ready = async (app: AppHandle) => expect((await openPeers(app)).getByLabel('Computers').locator('.dd-peers-badge', { hasText: /^Connected$/ })).toHaveCount(inviterConnected, { timeout: 120_000 });
  await ready(inviter).catch(async error => {
    for (const [name, app] of [['inviter', inviter], ['redeemer', redeemer]] as const)
      console.log(`[three-peer] ${label} ${name} pairing stuck`, JSON.stringify(await invites(app)));
    throw error;
  });
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

test('three apps pair by invitation over a private sshd; C joins via an invitation copied from B and syncs transitively', async ({ home }) => {
  test.setTimeout(900_000);
  const sshd = await startPrivateSshd(['app-a', 'app-b', 'app-c'].map(name => join(home, name, '.ssh', 'authorized_keys')));
  const peers = createPeerApps(home);
  const options = () => ({ env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() }, initialConfig: { mobileGatewayEnabled: false } });
  const started = Date.now();
  const step = (name: string) => console.log(`[three-peer] +${Math.round((Date.now() - started) / 1000)}s ${name}`);
  try {
    const a = await peers.launch('app-a', options());
    const b = await peers.launch('app-b', options());
    const c = await peers.launch('app-c', options());
    for (const app of [a, b, c]) await install(app);
    const baseline = { a: hostCapabilities(a).execution, b: hostCapabilities(b).execution, c: hostCapabilities(c).execution };
    expect([hostCapabilities(a).forward, hostCapabilities(b).forward, hostCapabilities(c).forward]).toEqual([[], [], []]);

    // Founding: A invites, B joins. One bilateral owner consent forms the group (no peers.enroll, no Enable step).
    step('A-B invitation');
    await pair(a, b, 'A-B', sshd, 1);
    await expect.poll(async () => `${await members(a)},${await members(b)}`, { timeout: 120_000 }).toBe('2,2').catch(async error => {
      for (const [name, app] of [['a', a], ['b', b]] as const) {
        const status = await group(app);
        console.log(`[three-peer] ${name} group not formed`, JSON.stringify({ setup: status.setup, jobs: status.jobs, members: status.members, invites: await invites(app),
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

    // C pastes an invitation copied from B; only B (the inviter) approves. B is the sponsor: C joins the existing group.
    step('C joins via B');
    await pair(b, c, 'B-C', sshd, 2);
    await expect.poll(async () => (await Promise.all([a, b, c].map(members))).join(','), { timeout: 180_000 }).toBe('3,3,3').catch(async error => {
      for (const [name, app] of [['a', a], ['b', b], ['c', c]] as const) {
        const status = await group(app);
        console.log(`[three-peer] ${name} stuck`, JSON.stringify({ setup: status.setup, jobs: status.jobs, members: status.members, links: (await invites(app)).links }));
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
