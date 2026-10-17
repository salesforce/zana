import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type AppHandle } from './fixtures/app.js';
import { createPeerApps, type PeerApp } from './fixtures/peer-apps.js';
import { listening, pidsMatching, startPrivateSshd, type PrivateSshd } from './fixtures/sshd.js';

type Member = { machineId: string; replicaId: string; authorized: boolean; connected?: boolean };
type GroupStatus = { configured: boolean; replicaId: string; members: Member[]; enrolled: Array<{ id: string; name: string; connected: boolean }> };
type InviteItem = { invitationId: string; role: 'inviter' | 'redeemer'; state: string; reason: string | null; awaitingMyApproval?: boolean; peer?: { name: string; fingerprint: string } };
type PeerLink = { pairingId: string; peerInstanceId: string; scope: string; phase: string; state: 'connected' | 'reconnecting' | 'disconnected'; reason?: string | null };
type InviteView = { available: boolean; reason: string | null; invitations: InviteItem[]; links: PeerLink[]; enableError: string | null };
type TokenBody = { v: number; exp: number; link: { endpoint: { host: string; port: number; user: string; hostKey: string }; bootstrapSeed: string;
  listenPort: number; targetPort: number; hostId: string; joinCode: string } } & Record<string, unknown>;

const rpc = <T,>(app: AppHandle, method: string, args?: unknown): Promise<T> => app.window.evaluate(
  ({ method, args }) => window.cc.pluginApps.callRpc('design-docs', method, args), { method, args }) as Promise<T>;
const invites = (app: AppHandle) => rpc<InviteView>(app, 'inviteState');
const group = (app: AppHandle) => rpc<GroupStatus>(app, 'groupStatus');
/** Declined, replayed or expired attempts end as `failed` records; only the rest are links. */
const liveLinks = async (app: AppHandle) => (await invites(app)).links.filter(link => link.phase !== 'removed' && link.phase !== 'failed');
const tokenBody = (token: string): TokenBody => JSON.parse(Buffer.from(token.slice('zccinv1.'.length), 'base64url').toString('utf8'));

async function install(app: AppHandle): Promise<void> {
  expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
  const trust = app.window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => app.window.evaluate(async () =>
    (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'design-docs')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  // Pairing composes after the plugin reports running; wait until its lifecycle answers.
  await expect.poll(() => group(app).then(status => (status as unknown as { lifecycleAvailable: boolean }).lifecycleAvailable, () => null), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => invites(app).then(view => view.available, () => null), { timeout: 30_000 }).toBe(true);
}

/** Design Docs -> Settings -> Peers (default tab). Clipboard writes are captured in the renderer, never the real clipboard. */
async function openPeers(app: AppHandle) {
  const window = app.window;
  await window.evaluate(() => {
    (window as any).__copied = [];
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => { (window as any).__copied.push(text); } });
  });
  if (!await window.locator('.dd-peers-view').isVisible().catch(() => false)) {
    await window.getByRole('button', { name: 'Design Docs', exact: true }).click();
    await window.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  }
  const region = window.locator('.dd-peers-view').getByRole('region', { name: 'Database sync peers' });
  await expect(region).toBeVisible({ timeout: 30_000 });
  return region;
}

/** Add peer: returns the invitation token both from the readonly field and from the captured clipboard copy. */
async function addPeer(app: AppHandle): Promise<string> {
  const panel = (await openPeers(app)).getByLabel('Pair a peer');
  await panel.getByRole('button', { name: 'Add peer', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: /^Invitation ready\. Expires in \d+:\d{2}\. Paste it on the other computer before then\.$/ })).toBeVisible({ timeout: 30_000 });
  // The field shows the auto-copied format (a link when the build has one); pick the raw code for the tests.
  await panel.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Invitation', exact: true })).toHaveValue(/^zccinv1\./);
  const token = await panel.getByRole('textbox', { name: 'Invitation', exact: true }).inputValue();
  expect(token).toMatch(/^zccinv1\./);
  return token;
}

async function joinPeer(app: AppHandle, token: string): Promise<void> {
  const panel = (await openPeers(app)).getByLabel('Pair a peer');
  await panel.getByRole('textbox', { name: 'Paste invitation', exact: true }).fill(token);
  await panel.getByRole('button', { name: 'Join peer', exact: true }).click();
}

/** The pairing row's peer fingerprint: on the inviter while its owner decides, on the redeemer while it waits for that. */
async function pairingFingerprint(app: AppHandle, row_: RegExp = /^Approve pairing with /): Promise<string> {
  const row = (await openPeers(app)).getByLabel('Pairing').locator('li').filter({ hasText: row_ });
  await expect(row).toBeVisible({ timeout: 60_000 });
  return (await row.locator('code').innerText()).trim();
}

/** Clicks Approve on the pairing row, then confirms in the main-process approval sheet (owner proof). */
async function approveInUi(app: AppHandle): Promise<void> {
  const list = (await openPeers(app)).getByLabel('Pairing');
  const row = list.locator('li').filter({ hasText: /^Approve pairing with / });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  // An answered sheet can linger (never shown) when its parent window is hidden, as here with several apps open;
  // it has already resolved, so only an unanswered sheet counts.
  const sheet = <T,>(script: string) => app.electron.evaluate(async ({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval' &&
      !w.webContents.getTitle().startsWith('approve:') && w.webContents.getTitle() !== 'cancel');
    return win ? await win.webContents.executeJavaScript(script) as T : null;
  }, script);
  await expect.poll(() => sheet<string>('document.body.innerText'), { timeout: 15_000 }).toContain('Pair with another computer');
  const text = (await sheet<string>('document.body.innerText'))!;
  expect(text).toContain('Approve pairing');
  expect(text).toContain('does not share projects, threads, terminals or files');
  await expect.poll(() => sheet<boolean>(`(() => { const button = document.getElementById('approve'); if (!button.disabled) setTimeout(() => button.click(), 0); return true; })()`), { timeout: 15_000 }).toBeNull();
}

async function linkState(app: AppHandle): Promise<string> {
  return (await liveLinks(app)).map(link => `${link.state}${link.reason ? `:${link.reason}` : ''}`).join(',');
}

/** The app's own authorized_keys (the private sshd's AuthorizedKeysFile for it), Zana-owned lines only. */
function zanaLines(app: PeerApp): string[] {
  try {
    return readFileSync(join(app.home, '.ssh', 'authorized_keys'), 'utf8').split('\n').filter(line => line.includes('zana-peer-v1:'));
  } catch { return []; }
}

/** The redeemer's persistent link ssh (one per link), found by its throwaway directory and the private sshd port. */
const linkSshPids = (sshd: PrivateSshd): number[] => pidsMatching(`zcc-peer-link-.* -p ${sshd.port} `);

function dumpLogs(app: PeerApp): void {
  const dir = join(app.home, '.zcc', 'logs');
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { return; }
  for (const file of files.filter(name => /server|host|desktop/.test(name))) {
    console.log(`[invite-pair] ${app.name} ${file} (tail)\n${readFileSync(join(dir, file), 'utf8').slice(-6000)}`);
  }
}

const options = (sshd?: { endpoint: string }) => ({
  initialConfig: { mobileGatewayEnabled: false },
  ...(sshd ? { env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint } } : {})
});

test('two fresh apps pair over a private sshd, sync both ways, heal a killed ssh and clean up on remove', async ({ home }) => {
  test.setTimeout(600_000);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  const started = Date.now();
  const step = (name: string) => console.log(`[invite-pair] +${Math.round((Date.now() - started) / 1000)}s ${name}`);
  try {
    const a = await peers.launch('app-a', options({ endpoint: sshd.endpoint() }));
    const b = await peers.launch('app-b', options());
    for (const app of [a, b]) await install(app);

    // No peers yet: nothing of ours in authorized_keys.
    expect(zanaLines(a)).toEqual([]);

    step('add peer');
    const token = await addPeer(a);
    const body = tokenBody(token);
    expect(body.v).toBe(3);
    expect(body.link.endpoint).toEqual({ host: 'localhost', port: sshd.port, user: sshd.user, hostKey: sshd.hostKey });
    expect(body.link.joinCode).toMatch(/^zcde_/);
    const { listenPort: P, targetPort: F } = body.link;
    const bootstrap = zanaLines(a);
    expect(bootstrap).toHaveLength(1);
    expect(bootstrap[0]).toMatch(/^restrict,port-forwarding,/);
    expect(bootstrap[0]).toContain(`permitlisten="127.0.0.1:${P}"`);
    expect(bootstrap[0]).toContain(`permitopen="127.0.0.1:${F}"`);
    expect(bootstrap[0]).toContain('command="/usr/bin/false"');
    expect(bootstrap[0]).toMatch(/expiry-time="\d{12}Z"/);
    expect(bootstrap[0]).toMatch(/ zana-peer-v1:\S+:bootstrap$/);
    expect(await listening(F)).toBe(true);

    // A cannot redeem its own invitation.
    await joinPeer(a, token);
    await expect((await openPeers(a)).getByLabel('Pair a peer').getByRole('alert')).toContainText('This invitation was created on this computer');

    step('B joins (no approval of its own), A approves with fingerprint compare');
    await joinPeer(b, token);
    // Pasting the invitation is B's consent: it waits on A's owner and is never offered an Approve button or sheet.
    const bFingerprint = await pairingFingerprint(b, /^Awaiting the other owner's approval for /);
    console.log('[invite-pair] B sees inviter fingerprint', bFingerprint);
    expect(bFingerprint).toMatch(/\S{8,}/);
    const bList = (await openPeers(b)).getByLabel('Pairing');
    await expect(bList.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    const aFingerprint = await pairingFingerprint(a);
    console.log('[invite-pair] A sees redeemer fingerprint', aFingerprint);
    expect(aFingerprint).not.toBe(bFingerprint);
    await approveInUi(a);
    // B's transient "Approved. Connecting" / "Ready" row is not asserted: it clears itself once the link exists, so it
    // cannot be observed reliably. The Connected badges below are the checked outcome on both sides.
    // A finished pairing hands over to its computer card (the Ready row clears itself once the link exists).
    await expect((await openPeers(a)).getByLabel('Computers').locator('.dd-peers-badge', { hasText: /^Connected$/ })).toHaveCount(1, { timeout: 120_000 }).catch(error => { dumpLogs(a); dumpLogs(b); throw error; });
    await expect((await openPeers(b)).getByLabel('Computers').locator('.dd-peers-badge', { hasText: /^Connected$/ })).toHaveCount(1, { timeout: 120_000 });

    step('key swap and connected');
    // The throwaway bootstrap line is replaced by B's per-link key: gone, and exactly one link line remains.
    await expect.poll(() => zanaLines(a).map(line => line.split(' ').at(-1)!.split(':')[3]), { timeout: 30_000 }).toEqual(['link']);
    expect(zanaLines(a)[0]).toContain(`permitlisten="127.0.0.1:${P}"`);
    expect(zanaLines(a)[0]).toContain(`permitopen="127.0.0.1:${F}"`);
    expect(zanaLines(a)[0]).not.toContain('expiry-time');
    expect(zanaLines(b)).toEqual([]);
    await expect.poll(async () => `${(await group(a)).members.length},${(await group(b)).members.length}`, { timeout: 120_000 }).toBe('2,2');
    await expect.poll(async () => `${await linkState(a)}|${await linkState(b)}`, { timeout: 60_000 }).toBe('connected|connected');
    await expect((await openPeers(a)).getByLabel('Computers')).toContainText('Connected');
    await expect((await openPeers(b)).getByLabel('Computers')).toContainText('Connected');
    expect(linkSshPids(sshd)).toHaveLength(1);

    step('sync A -> B');
    const syncUntil = async (writer: PeerApp, reader: PeerApp, docId: string) => {
      await expect.poll(async () => {
        await rpc(writer, 'syncNow').catch(() => {}); await rpc(reader, 'syncNow').catch(() => {});
        return (await rpc<Array<{ id: string }>>(reader, 'list')).some(doc => doc.id === docId);
      }, { timeout: 90_000 }).toBe(true);
    };
    const fromA = await rpc<{ id: string }>(a, 'create', { title: 'Doc from A', template: 'blank', status: 'approved' });
    await rpc(a, 'writeFile', { doc: fromA.id, path: 'note.md', content: 'written on A', baseRevision: 0, baseFileId: null });
    await syncUntil(a, b, fromA.id);
    expect((await rpc<{ content: string }>(b, 'readFile', { doc: fromA.id, path: 'note.md' })).content).toBe('written on A');

    step('sync B -> A (edit)');
    const noteOnB = await rpc<{ revision: number; fileId: string }>(b, 'readFile', { doc: fromA.id, path: 'note.md' });
    await rpc(b, 'writeFile', { doc: fromA.id, path: 'note.md', content: 'edited on B', baseRevision: noteOnB.revision, baseFileId: noteOnB.fileId });
    await expect.poll(async () => {
      await rpc(b, 'syncNow').catch(() => {}); await rpc(a, 'syncNow').catch(() => {});
      return (await rpc<{ content: string }>(a, 'readFile', { doc: fromA.id, path: 'note.md' }).catch(() => ({ content: '' }))).content;
    }, { timeout: 90_000 }).toBe('edited on B');

    step('SIGKILL B ssh');
    const [killed] = linkSshPids(sshd);
    expect(killed).toBeTruthy();
    process.kill(killed!, 'SIGKILL');
    await expect.poll(async () => (await linkState(b)).startsWith('reconnecting') || (await linkState(b)).startsWith('disconnected'),
      { message: 'B reports the dropped ssh', timeout: 20_000, intervals: [100] }).toBe(true);
    await expect.poll(async () => `${await linkState(a)}|${await linkState(b)}`, { message: 'link heals', timeout: 90_000 }).toBe('connected|connected');
    const healed = linkSshPids(sshd);
    expect(healed).toHaveLength(1);
    expect(healed[0]).not.toBe(killed);
    const afterHeal = await rpc<{ id: string }>(b, 'create', { title: 'After heal', template: 'blank', status: 'approved' });
    await syncUntil(b, a, afterHeal.id);

    step('delete on B reaches A');
    await rpc(b, 'remove', { doc: fromA.id });
    expect((await rpc<Array<{ id: string }>>(b, 'list')).some(doc => doc.id === fromA.id)).toBe(false);
    await expect.poll(async () => {
      await rpc(b, 'syncNow').catch(() => {}); await rpc(a, 'syncNow').catch(() => {});
      return (await rpc<Array<{ id: string }>>(a, 'list')).some(doc => doc.id === fromA.id);
    }, { message: 'paired delete propagates', timeout: 90_000 }).toBe(false);
    await expect(rpc(a, 'readFile', { doc: fromA.id, path: 'note.md' })).rejects.toThrow(/not found/);
    // Another round of sync must not bring it back from either side.
    await rpc(a, 'syncNow').catch(() => {}); await rpc(b, 'syncNow').catch(() => {});
    for (const app of [a, b]) expect((await rpc<Array<{ id: string }>>(app, 'list')).some(doc => doc.id === fromA.id)).toBe(false);
    expect((await rpc<Array<{ id: string }>>(a, 'list')).some(doc => doc.id === afterHeal.id)).toBe(true);

    step('remove peer');
    const bId = (await liveLinks(a))[0]!.peerInstanceId;
    const region = await openPeers(a);
    a.window.once('dialog', dialog => void dialog.accept());
    await region.getByLabel('Computers').getByRole('listitem').filter({ has: a.window.locator(`[title*="${bId}"]`) }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(async () => (await liveLinks(a)).length, { timeout: 60_000 }).toBe(0);
    // Remove ends the whole pairing: no dead card for B, no tombstone text, no group count.
    await expect(region.getByLabel('Computers').locator(`[title*="${bId}"]`)).toHaveCount(0, { timeout: 30_000 });
    await expect(region).not.toContainText('Not syncing. Add peer to pair again.');
    await expect(region).not.toContainText('Sync group:');
    await expect.poll(() => zanaLines(a), { message: 'no zana-peer-v1 lines remain', timeout: 30_000 }).toEqual([]);
    await expect.poll(() => listening(F), { message: 'nothing listens on F', timeout: 30_000 }).toBe(false);
    await expect.poll(() => linkSshPids(sshd).length, { message: 'B closes its ssh', timeout: 60_000 }).toBe(0);
    step('done');
  } catch (error) {
    console.log('[invite-pair] sshd log', sshd.log().slice(-3000));
    for (const app of peers.apps) dumpLogs(app);
    throw error;
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});

test('negatives: cancelled invitation drops its line; wrong host key shows the mismatch card; stopped sshd shows the Remote Login guidance', async ({ home }) => {
  test.setTimeout(600_000);
  const sshd = await startPrivateSshd(['app-a', 'app-w', 'app-b'].map(name => join(home, name, '.ssh', 'authorized_keys')));
  const peers = createPeerApps(home);
  try {
    const a = await peers.launch('app-a', options({ endpoint: sshd.endpoint() }));
    const w = await peers.launch('app-w', options({ endpoint: sshd.endpoint({ hostKey: sshd.strangerHostKey }) }));
    const b = await peers.launch('app-b', options());
    for (const app of [a, w, b]) await install(app);

    // Cancel invitation: the throwaway bootstrap line is removed and nothing keeps listening.
    await addPeer(a);
    expect(zanaLines(a)).toHaveLength(1);
    const panelA = (await openPeers(a)).getByLabel('Pair a peer');
    await panelA.getByRole('button', { name: 'Cancel invitation', exact: true }).click();
    await expect.poll(() => zanaLines(a), { timeout: 30_000 }).toEqual([]);
    await expect(panelA.getByRole('textbox', { name: 'Invitation', exact: true })).toHaveCount(0);

    // Wrong host key: the invitation pins a key the sshd does not hold; the redeemer refuses before authenticating.
    const mismatched = await addPeer(w);
    expect(tokenBody(mismatched).link.endpoint.hostKey).toBe(sshd.strangerHostKey);
    await joinPeer(b, mismatched);
    const panelB = (await openPeers(b)).getByLabel('Pair a peer');
    await expect(panelB.getByText('The computer you reached is not the one that made the invitation').first()).toBeVisible({ timeout: 60_000 });
    expect(linkSshPids(sshd)).toEqual([]);

    // sshd stopped: B cannot reach Remote Login and is told how to turn it on.
    const stopped = await addPeer(a);
    expect(tokenBody(stopped).link.endpoint.hostKey).toBe(sshd.hostKey);
    sshd.stop();
    await expect.poll(() => listening(sshd.port), { timeout: 10_000 }).toBe(false);
    await joinPeer(b, stopped);
    await expect(panelB.getByText(/Remote Login/).first()).toBeVisible({ timeout: 60_000 });
    await expect(panelB.getByText(/System Settings > General > Sharing/).first()).toBeVisible();
    expect(linkSshPids(sshd)).toEqual([]);
  } catch (error) {
    console.log('[invite-pair] sshd log', sshd.log().slice(-3000));
    for (const app of peers.apps) dumpLogs(app);
    throw error;
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
