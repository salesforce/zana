import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Relay is unconfigured in the isolated E2E home, so the server's preferred
// join-code route issues a loopback-forwarder tunnel code. A bare remote-run
// installer cannot reach this computer, so the dialog offers a laptop-run
// `ssh -R` command (never a bare one) and keeps Connect.
test('Add Machine offers a tunnel command, not a bare one, when the relay is unavailable', async ({ home }) => {
  // One SSH alias so Connect has a selectable target; nothing ever dials it.
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.ssh/config'), 'Host e2e-gate-host\n  HostName 192.0.2.1\n  User e2e\n', { mode: 0o600 });
  const app = await launchApp(home);
  try {
    const win = app.window;
    const preferred = win.waitForResponse(response =>
      response.url().includes('/hosts/join-codes/preferred') && response.request().method() === 'POST');

    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-machines').click();
    await win.getByRole('button', { name: /^Add (a )?machine$/i }).first().click();

    const response = await preferred;
    expect(response.status()).toBe(201);
    const issued = await response.json();
    expect(issued.pairingMode).toBe('tunnel');
    expect(issued.pairingServerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const dialog = win.getByRole('dialog');
    const methodSsh = dialog.getByTestId('add-machine-method-ssh');
    if (await methodSsh.count()) await methodSsh.click();

    const otherWays = dialog.getByTestId('add-machine-other-ways');
    await expect(otherWays).toBeVisible();
    await expect(otherWays).not.toHaveAttribute('open', '');

    await otherWays.locator('summary').click();
    await expect(dialog.getByTestId('add-machine-relay-unavailable')).toHaveCount(0);

    const connect = dialog.getByTestId('add-machine-connect');
    await expect(connect).toBeVisible();
    await dialog.getByTestId('add-machine-ssh-host').getByRole('option', { name: /e2e-gate-host/ }).click();
    await expect(connect).toBeEnabled();

    const command = dialog.getByTestId('machines-join-command');
    await expect(command).toContainText('ssh -o ExitOnForwardFailure=yes -R');
    await expect(command).toContainText('e2e-gate-host');
    await expect(command).not.toContainText(/^curl /);
    await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
  } finally {
    await closeApp(app.electron);
  }
});
