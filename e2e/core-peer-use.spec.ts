import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { corePeerConfig, createPeerApps, type PeerApp } from './fixtures/peer-apps.js';
import { startPrivateSshd } from './fixtures/sshd.js';
import {
  PROBE_NAME, answerApprovalSheet, installProbePlugin, pairComputers, probeRpc, reopenCorePeers, writeProbePlugin, type ProbeConnection
} from './fixtures/core-peer-use.js';

const USE_SHEET = 'Allow a plugin to use a connection';

function dumpLogs(app: PeerApp): void {
  const dir = join(app.home, '.zcc', 'logs');
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { return; }
  for (const file of files.filter(name => /server|host|desktop/.test(name))) {
    console.log(`[core-use] ${app.name} ${file} (tail)\n${readFileSync(join(dir, file), 'utf8').slice(-4000)}`);
  }
}

async function paired(home: string) {
  const source = join(home, 'probe-plugin');
  writeProbePlugin(source);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  const prelaunch = (isolatedHome: string) => installProbePlugin(isolatedHome, source);
  const a = await peers.launch('app-a', { initialConfig: corePeerConfig, prelaunch, env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() } });
  const b = await peers.launch('app-b', { initialConfig: corePeerConfig, prelaunch });
  try {
    await pairComputers(a, b);
  } catch (error) { dumpLogs(a); dumpLogs(b); throw error; }
  return { peers, sshd, a, b };
}

const connectionTo = async (app: PeerApp): Promise<ProbeConnection> => {
  let found: ProbeConnection | undefined;
  await expect.poll(async () => { found = (await probeRpc<ProbeConnection[]>(app, 'connections'))[0]; return found?.state; }, { timeout: 60_000 }).toBe('connected');
  return found!;
};

/** The plugin on `requester` asks to use the connection; both owners approve in their own main-process sheet. */
async function useOnBothSides(requester: PeerApp, other: PeerApp): Promise<void> {
  const target = await connectionTo(requester);
  expect(target.usedByThisPlugin).toBe(false);
  const asked = await probeRpc<{ status: string }>(requester, 'requestUse', { computerId: target.computerId });
  expect(asked.status).toBe('pending');
  const texts = await Promise.all([answerApprovalSheet(requester, USE_SHEET), answerApprovalSheet(other, USE_SHEET)]);
  for (const text of texts) expect(text).toContain(`Plugin: ${PROBE_NAME}`);
  for (const app of [requester, other]) {
    await expect.poll(async () => (await connectionTo(app)).usedByThisPlugin, { timeout: 90_000 }).toBe(true);
  }
}

/** Plugin-level traffic grant on both computers (the plugin's `peers.enable`), so `peers.call` can carry real traffic. */
async function allowTraffic(first: PeerApp, second: PeerApp): Promise<void> {
  for (const app of [first, second]) {
    const peer = await connectionTo(app);
    await probeRpc(app, 'enable', { peerId: peer.computerId, scope: 'connection' });
  }
}

/** Every side shows exactly one link whose "Used by" line matches, and no error banner. */
async function expectUsed(apps: PeerApp[], used: boolean): Promise<void> {
  for (const app of apps) {
    const { window } = await reopenCorePeers(app);
    const computer = window.getByTestId('peer-computer');
    await expect(computer).toHaveCount(1, { timeout: 60_000 });
    if (used) {
      // The panel now shows a "Used by" heading with each plugin name in its own use row, rather than
      // a single "Used by: <name>" line.
      await expect(computer).toContainText('Used by', { timeout: 60_000 });
      await expect(computer.getByTestId('peer-link-use')).toHaveCount(1);
      await expect(computer.getByTestId('peer-link-use')).toContainText(PROBE_NAME, { timeout: 60_000 });
    } else {
      await expect(computer).toContainText('No plugin uses this computer.', { timeout: 60_000 });
      await expect(computer.getByTestId('peer-link-use')).toHaveCount(0);
    }
    await expect(computer).toContainText('Linked');
    await expect(window.locator('.peers-error')).toHaveCount(0);
  }
}

test('core use: request and approve on both computers, traffic needs confirmation to remove, Stop using keeps the link', async ({ home }) => {
  test.setTimeout(420_000);
  const { peers, sshd, a, b } = await paired(home);
  try {
    // Pairing alone creates a zero-use link, shown on both computers.
    await expectUsed([a, b], false);
    expect((await connectionTo(a)).usedByThisPlugin).toBe(false);

    await useOnBothSides(a, b);
    await expectUsed([a, b], true);

    // Real traffic through the use, then "Stop syncing" that use asks before cutting it off while a
    // transfer is live; "Keep syncing" cancels and keeps everything. (The active-transfer gate now lives
    // on the per-plugin use row, not on the computer-level Remove.)
    const peerOfA = await connectionTo(a);
    await allowTraffic(a, b);
    await expect.poll(() => probeRpc<{ text: string }>(a, 'echo', { computerId: peerOfA.computerId, text: 'hello' }).then(r => r.text, () => null), { timeout: 60_000 }).toBe('hello');
    const { window } = await reopenCorePeers(a);
    await window.getByTestId('peer-link-use').getByRole('button', { name: `Stop syncing ${PROBE_NAME}`, exact: true }).click();
    const active = window.getByRole('alertdialog', { name: /^Active transfer with / });
    await expect(active).toContainText(`${PROBE_NAME} is transferring with`);
    await expect(active).toContainText('Stop anyway?');
    await active.getByRole('button', { name: 'Keep syncing', exact: true }).click();
    await expect(active).toHaveCount(0);
    await expectUsed([a, b], true);

    // Confirming "Stop anyway" ends the plugin's use only; the link itself stays and reads as zero-use.
    // (The active-transfer gate is the confirmation, so stopping a live use must go through this dialog
    // rather than a direct stopUsing call.)
    await window.getByTestId('peer-link-use').getByRole('button', { name: `Stop syncing ${PROBE_NAME}`, exact: true }).click();
    const stopping = window.getByRole('alertdialog', { name: /^Active transfer with / });
    await stopping.getByRole('button', { name: 'Stop anyway', exact: true }).click();
    await expect(stopping).toHaveCount(0);
    await expect.poll(async () => (await connectionTo(a)).usedByThisPlugin, { timeout: 60_000 }).toBe(false);
    await expectUsed([a], false);
    await expect(a.window.getByTestId('peer-link')).toHaveCount(1);
    await expect(b.window.getByTestId('peer-link')).toHaveCount(1);
    expect(await probeRpc<string[]>(a, 'removing')).toEqual([]);
  } catch (error) { dumpLogs(a); dumpLogs(b); throw error; } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});

test('core use: Remove with active traffic is confirmed, then runs the plugin cleanup and drops the link', async ({ home }) => {
  test.setTimeout(420_000);
  const { peers, sshd, a, b } = await paired(home);
  try {
    await useOnBothSides(b, a);
    const target = await connectionTo(b);
    await allowTraffic(b, a);
    await expect.poll(() => probeRpc<{ text: string }>(b, 'echo', { computerId: target.computerId, text: 'ping' }).then(r => r.text, () => null), { timeout: 60_000 }).toBe('ping');

    const { window } = await reopenCorePeers(b);
    // Active traffic is confirmed on the per-use "Stop syncing" gate; Stop anyway ends the use. The link
    // itself is then dropped from the computer-level Remove, which runs the plugin cleanup.
    await window.getByTestId('peer-link-use').getByRole('button', { name: `Stop syncing ${PROBE_NAME}`, exact: true }).click();
    const active = window.getByRole('alertdialog', { name: /^Active transfer with / });
    await expect(active).toContainText(`${PROBE_NAME} is transferring with`);
    await active.getByRole('button', { name: 'Stop anyway', exact: true }).click();
    await expect(active).toHaveCount(0);

    await window.getByTestId('peer-computer').getByRole('button', { name: 'Remove computer', exact: true }).click();
    await window.getByRole('alertdialog', { name: 'Confirm removing computer link' }).getByRole('button', { name: 'Remove', exact: true }).click();

    await expect(window.getByTestId('peer-link')).toHaveCount(0, { timeout: 30_000 });
    await expect(window.locator('.peers-error')).toHaveCount(0);
    expect(await probeRpc<string[]>(b, 'removing')).toEqual([target.computerId]);
  } catch (error) { dumpLogs(a); dumpLogs(b); throw error; } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});

test('core use: Remove with an unreachable peer is immediate and never asks about active transfers', async ({ home }) => {
  test.setTimeout(420_000);
  const { peers, sshd, a, b } = await paired(home);
  try {
    await useOnBothSides(a, b);
    await allowTraffic(a, b);
    // The peer goes away; no call has succeeded, so nothing counts as active.
    await peers.close(b);

    const { window } = await reopenCorePeers(a);
    await window.getByTestId('peer-computer').getByRole('button', { name: 'Remove computer', exact: true }).click();
    await expect(window.getByRole('alertdialog', { name: /^Active transfer with / })).toHaveCount(0);
    const confirm = window.getByRole('alertdialog', { name: 'Confirm removing computer link' });
    await expect(confirm).toContainText(`Plugins using it: ${PROBE_NAME}`);
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

    // Immediate: no wait on the unreachable peer, no hook-failure dialog, no error banner.
    await expect(window.getByTestId('peer-link')).toHaveCount(0, { timeout: 15_000 });
    await expect(window.getByRole('alertdialog', { name: 'Plugin cleanup did not finish' })).toHaveCount(0);
    await expect(window.locator('.peers-error')).toHaveCount(0);
    expect(await probeRpc<string[]>(a, 'removing')).toHaveLength(1);
  } catch (error) { dumpLogs(a); throw error; } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
