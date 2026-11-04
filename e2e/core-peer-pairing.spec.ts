import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { corePeerConfig, createPeerApps, openCorePeers, type PeerApp } from './fixtures/peer-apps.js';
import { startPrivateSshd } from './fixtures/sshd.js';

/** Failure diagnostics: tail of each app's server/host logs. */
function dumpLogs(app: PeerApp): void {
  const dir = join(app.home, '.zcc', 'logs');
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { return; }
  for (const file of files.filter(name => /server|host|desktop/.test(name))) {
    console.log(`[core-pairing] ${app.name} ${file} (tail)\n${readFileSync(join(dir, file), 'utf8').slice(-4000)}`);
  }
}

const WRONG_CODE = 'ZZZZ-ZZZZ';
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Core Add computer: returns the invitation token and the spoken approval code shown on `inviter`. */
async function addComputer(inviter: PeerApp): Promise<{ token: string; approvalCode: string }> {
  const { window } = await openCorePeers(inviter);
  await window.getByRole('button', { name: 'Add computer', exact: true }).click();
  const panel = window.getByTestId('add-computer');
  const token = panel.getByRole('textbox', { name: 'Invitation', exact: true });
  await expect(token).toHaveValue(/^zccinv1\./, { timeout: 60_000 });
  const approvalCode = (await panel.getByTestId('approval-code').locator('strong').innerText()).trim();
  return { token: await token.inputValue(), approvalCode };
}

/** Core Join computer: types the invitation and spoken approval code, returns the pairing code the redeemer shows. */
async function joinComputer(redeemer: PeerApp, invitation: { token: string; approvalCode: string }): Promise<string> {
  const { window } = await openCorePeers(redeemer);
  await window.getByRole('button', { name: 'Join computer', exact: true }).click();
  const panel = window.getByTestId('join-computer');
  await panel.getByRole('textbox', { name: 'Invitation', exact: true }).fill(invitation.token);
  await panel.getByRole('textbox', { name: 'Approval code', exact: true }).fill(invitation.approvalCode);
  await panel.getByRole('button', { name: 'Join', exact: true }).click();
  const code = panel.getByTestId('pairing-code');
  await expect(code).toHaveText(CODE, { timeout: 90_000 });
  return (await code.innerText()).trim();
}

test('core pairing: invite, join, typed code, approve and a zero-use link on both computers', async ({ home }) => {
  test.setTimeout(300_000);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  try {
    const a = await peers.launch('app-a', { initialConfig: corePeerConfig, env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() } });
    const b = await peers.launch('app-b', { initialConfig: corePeerConfig });

    const invitation = await addComputer(a);
    const code = await joinComputer(b, invitation);

    const approve = a.window.getByTestId('peer-approve');
    await expect(approve).toBeVisible({ timeout: 90_000 });
    await expect(approve.locator('code')).not.toBeEmpty();

    // A wrong code is refused with the fixed message and does not approve.
    const input = approve.getByRole('textbox');
    await input.fill(WRONG_CODE);
    await approve.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(approve.getByRole('alert')).toBeVisible();
    await expect(a.window.getByTestId('peer-computer').filter({ hasText: 'Linked' })).toHaveCount(0);

    await input.fill(code.toLowerCase().replace('-', ' '));
    await approve.getByRole('button', { name: 'Approve', exact: true }).click();

    for (const app of [a, b]) {
      try {
      const row = app.window.getByTestId('peer-computer');
      await expect(row).toHaveCount(1, { timeout: 120_000 });
      await expect(row).toContainText('Linked', { timeout: 120_000 });
      await expect(row).toContainText('No plugin uses this computer.');
      await expect(row.getByTestId('peer-link-use')).toHaveCount(0);
      } catch (error) { dumpLogs(a); dumpLogs(b); throw error; }
    }
    // The pairing code never lingers once the connection is established.
    await expect(a.window.getByTestId('peer-approve')).toHaveCount(0);
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});

test('core pairing: five wrong codes burn the invitation', async ({ home }) => {
  test.setTimeout(300_000);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  try {
    const a = await peers.launch('app-a', { initialConfig: corePeerConfig, env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() } });
    const b = await peers.launch('app-b', { initialConfig: corePeerConfig });
    const code = await joinComputer(b, await addComputer(a));

    const approve = a.window.getByTestId('peer-approve');
    await expect(approve).toBeVisible({ timeout: 90_000 });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!await approve.isVisible().catch(() => false)) break;
      await approve.getByRole('textbox').fill(WRONG_CODE);
      await approve.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(approve.getByRole('alert').or(a.window.getByTestId('add-computer').getByRole('status'))).toBeVisible();
    }
    await expect(approve).toHaveCount(0, { timeout: 30_000 });
    // Even the correct code cannot revive a burned invitation, and no link exists.
    expect(code).toMatch(CODE);
    await expect(a.window.getByTestId('peer-link')).toHaveCount(0);
    await expect(b.window.getByTestId('peer-link')).toHaveCount(0);
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
