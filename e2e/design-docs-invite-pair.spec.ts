import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { corePeerConfig, createPeerApps, type PeerApp } from './fixtures/peer-apps.js';
import { reopenCorePeers } from './fixtures/core-peer-use.js';
import {
  connectDesignDocs, ddConnections, ddGroup, ddRpc, installDesignDocs, openDesignDocsPeers, syncUntilListed
} from './fixtures/design-docs-core.js';
import { listening, pidsMatching, startPrivateSshd, type PrivateSshd } from './fixtures/sshd.js';

/** The app's own authorized_keys (the private sshd's AuthorizedKeysFile for it), Zana-owned lines only. */
function zanaLines(app: PeerApp): string[] {
  try {
    return readFileSync(join(app.home, '.ssh', 'authorized_keys'), 'utf8').split('\n').filter(line => line.includes('zana-peer-v1:'));
  } catch { return []; }
}

/** The redeemer's persistent link ssh (one per link), found by its throwaway directory and the private sshd port. */
const linkSshPids = (sshd: PrivateSshd): number[] => pidsMatching(`zcc-peer-link-.* -p ${sshd.port} `);

const linkState = async (app: PeerApp) => (await ddConnections(app)).map(link => link.state).join(',');

function dumpLogs(app: PeerApp): void {
  const dir = join(app.home, '.zcc', 'logs');
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { return; }
  for (const file of files.filter(name => /server|host|desktop/.test(name))) {
    console.log(`[dd-core] ${app.name} ${file} (tail)\n${readFileSync(join(dir, file), 'utf8').slice(-6000)}`);
  }
}

test('core-paired computers share Design Docs both ways, heal a killed ssh and clean up when core removes the link', async ({ home }) => {
  test.setTimeout(720_000);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  const started = Date.now();
  const step = (name: string) => console.log(`[dd-core] +${Math.round((Date.now() - started) / 1000)}s ${name}`);
  try {
    const a = await peers.launch('app-a', { initialConfig: corePeerConfig, env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() } });
    const b = await peers.launch('app-b', { initialConfig: corePeerConfig });
    for (const app of [a, b]) await installDesignDocs(app);

    // Nothing of ours in authorized_keys and no group before any computer is linked.
    expect(zanaLines(a)).toEqual([]);
    expect((await ddGroup(a)).configured).toBe(false);

    step('core pairing + use on both computers');
    await connectDesignDocs(a, b);
    expect((await ddGroup(a)).members.map(member => member.machineId).sort()).toEqual((await ddGroup(b)).members.map(member => member.machineId).sort());
    await expect.poll(async () => `${await linkState(a)}|${await linkState(b)}`, { timeout: 60_000 }).toBe('connected|connected');
    expect(zanaLines(a).length).toBeGreaterThan(0);
    expect(zanaLines(b)).toEqual([]);
    expect(linkSshPids(sshd)).toHaveLength(1);

    // The Design Docs panel lists the computer, with no pairing controls of its own.
    for (const app of [a, b]) {
      const region = await openDesignDocsPeers(app);
      await expect(region.getByLabel('Computers').locator('.dd-peers-badge', { hasText: /^Connected$/ })).toHaveCount(1, { timeout: 60_000 });
      await expect(region.getByRole('button', { name: 'Stop using', exact: true })).toHaveCount(1);
      await expect(region.getByRole('button', { name: /Add peer|Join peer/ })).toHaveCount(0);
      await expect(region).toContainText('Sync group: 2 of 8 computers');
    }

    step('sync A -> B');
    const fromA = await ddRpc<{ id: string }>(a, 'create', { title: 'Doc from A', template: 'blank', status: 'approved' });
    await ddRpc(a, 'writeFile', { doc: fromA.id, path: 'note.md', content: 'written on A', baseRevision: 0, baseFileId: null });
    await syncUntilListed(a, b, fromA.id);
    expect((await ddRpc<{ content: string }>(b, 'readFile', { doc: fromA.id, path: 'note.md' })).content).toBe('written on A');

    step('sync B -> A (edit)');
    const noteOnB = await ddRpc<{ revision: number; fileId: string }>(b, 'readFile', { doc: fromA.id, path: 'note.md' });
    await ddRpc(b, 'writeFile', { doc: fromA.id, path: 'note.md', content: 'edited on B', baseRevision: noteOnB.revision, baseFileId: noteOnB.fileId });
    await expect.poll(async () => {
      await ddRpc(b, 'syncNow').catch(() => {}); await ddRpc(a, 'syncNow').catch(() => {});
      return (await ddRpc<{ content: string }>(a, 'readFile', { doc: fromA.id, path: 'note.md' }).catch(() => ({ content: '' }))).content;
    }, { timeout: 90_000 }).toBe('edited on B');

    step('SIGKILL B ssh');
    const [killed] = linkSshPids(sshd);
    expect(killed).toBeTruthy();
    process.kill(killed!, 'SIGKILL');
    await expect.poll(async () => (await linkState(b)) !== 'connected', { message: 'B reports the dropped ssh', timeout: 20_000, intervals: [100] }).toBe(true);
    await expect.poll(async () => `${await linkState(a)}|${await linkState(b)}`, { message: 'link heals', timeout: 90_000 }).toBe('connected|connected');
    const healed = linkSshPids(sshd);
    expect(healed).toHaveLength(1);
    expect(healed[0]).not.toBe(killed);
    const afterHeal = await ddRpc<{ id: string }>(b, 'create', { title: 'After heal', template: 'blank', status: 'approved' });
    await syncUntilListed(b, a, afterHeal.id);

    step('delete on B reaches A');
    await ddRpc(b, 'remove', { doc: fromA.id });
    await expect.poll(async () => {
      await ddRpc(b, 'syncNow').catch(() => {}); await ddRpc(a, 'syncNow').catch(() => {});
      return (await ddRpc<Array<{ id: string }>>(a, 'list')).some(doc => doc.id === fromA.id);
    }, { message: 'paired delete propagates', timeout: 90_000 }).toBe(false);
    await expect(ddRpc(a, 'readFile', { doc: fromA.id, path: 'note.md' })).rejects.toThrow(/not found/);
    await ddRpc(a, 'syncNow').catch(() => {}); await ddRpc(b, 'syncNow').catch(() => {});
    for (const app of [a, b]) expect((await ddRpc<Array<{ id: string }>>(app, 'list')).some(doc => doc.id === fromA.id)).toBe(false);
    expect((await ddRpc<Array<{ id: string }>>(a, 'list')).some(doc => doc.id === afterHeal.id)).toBe(true);

    step('Stop syncing keeps the core link and ends sync');
    // Fresh sync makes Design Docs count as actively transferring, so core gates the stop with its confirm.
    await ddRpc(a, 'syncNow').catch(() => {});
    const { window: corePeers } = await reopenCorePeers(a);
    // The active-transfer gate now lives on the per-plugin use row; it names Design Docs before cutting it off.
    await corePeers.getByTestId('peer-link-use').getByRole('button', { name: 'Stop syncing Design Docs', exact: true }).click();
    const active = corePeers.getByRole('alertdialog', { name: /^Active transfer with / });
    await expect(active).toContainText('Design Docs is transferring with');
    await active.getByRole('button', { name: 'Stop anyway', exact: true }).click();
    await expect(active).toHaveCount(0);
    await expect.poll(async () => (await ddConnections(a))[0]?.usedByThisPlugin, { timeout: 60_000 }).toBe(false);
    await expect(corePeers.getByTestId('peer-computer')).toHaveCount(1);
    await expect(corePeers.getByTestId('peer-computer')).toContainText('Linked');
    expect(linkSshPids(sshd)).toHaveLength(1);

    step('remove the computer in core Settings → Peers');
    const bHostLine = zanaLines(a).length;
    expect(bHostLine).toBeGreaterThan(0);
    // The use is already stopped, and removal no longer gates on active transfers: plain Remove computer → confirm.
    await corePeers.getByTestId('peer-computer').getByRole('button', { name: 'Remove computer', exact: true }).click();
    await corePeers.getByRole('alertdialog', { name: 'Confirm removing computer link' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(corePeers.getByTestId('peer-link')).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => zanaLines(a), { message: 'no zana-peer-v1 lines remain', timeout: 30_000 }).toEqual([]);
    // Removal is local to A (it never waits on B). B sees its link drop, then removes its own half in core.
    await expect.poll(async () => await linkState(b), { message: 'B stops reporting connected', timeout: 60_000 }).not.toBe('connected');
    const { window: bPeers } = await reopenCorePeers(b);
    await expect(bPeers.getByTestId('peer-computer')).toHaveCount(1);
    // B's peer is unreachable now, so nothing is active; the confirm names the plugin but shows no active-transfer gate.
    await bPeers.getByTestId('peer-computer').getByRole('button', { name: 'Remove computer', exact: true }).click();
    await bPeers.getByRole('alertdialog', { name: 'Confirm removing computer link' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(bPeers.getByTestId('peer-link')).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => linkSshPids(sshd).length, { message: 'B closes its ssh', timeout: 60_000 }).toBe(0);
    await expect.poll(async () => (await ddConnections(b)).length, { timeout: 60_000 }).toBe(0);
    await expect.poll(async () => (await ddConnections(a)).length, { timeout: 60_000 }).toBe(0);
    await expect(await openDesignDocsPeers(a)).toContainText('No computers are connected');
    await expect.poll(() => listening(sshd.port), { message: 'private sshd stays up for the test host', timeout: 10_000 }).toBe(true);
    step('done');
  } catch (error) {
    console.log('[dd-core] sshd log', sshd.log().slice(-3000));
    for (const app of peers.apps) dumpLogs(app);
    throw error;
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
