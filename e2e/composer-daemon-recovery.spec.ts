import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { HOST_RPC_PROTOCOL_VERSION } from '../packages/contracts/src/host-rpc.js';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('both composers recover a stopped host connection while its Electron utility is still alive', async ({ app }) => {
  const win = app.window;
  await dismissConsentOverlays(win);
  await win.getByTestId('nav-home').click();
  const composer = win.locator('.home-agent-composer');
  const modes = composer.getByRole('group', { name: 'Launch mode' });
  await modes.getByRole('button', { name: 'Modern', exact: true }).click();
  const prompt = composer.getByTestId('thread-command-input');
  await prompt.fill('Preserve this draft while recovering');
  await expect(composer.getByRole('button', { name: 'Restart host daemon', exact: true })).toHaveCount(0);
  const utilityPid = await app.electron.evaluate(({ app }) => app.getAppMetrics().find(metric => metric.name?.includes('host-runtime.js'))?.pid);
  expect(utilityPid).toBeTruthy();

  // Reproduce the important failure boundary: the enrolled connection is
  // permanently stopped, but the utility's private recovery transport survives.
  // Authenticated supersession stops that connection without killing the app.
  const auth = JSON.parse(readFileSync(join(app.home, '.zcc/auth.json'), 'utf8'));
  const url = new URL('/internal/hosts/ws', win.url()); url.protocol = 'ws:';
  const instanceId = randomUUID();
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${auth.hostKey}`, 'x-zcc-host-id': auth.hostId } });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture host handshake timed out')), 10_000);
      socket.once('error', error => { clearTimeout(timeout); reject(error); });
      socket.once('open', () => socket.send(JSON.stringify({ type: 'host.hello', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: auth.hostId, instanceId })));
      socket.on('message', bytes => {
        const message = JSON.parse(String(bytes));
        if (message.type === 'host.hello-ok') socket.send(JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
          hostId: auth.hostId, instanceId, runtime: { threads: [], loadedEnvironments: [] } }));
        if (message.type === 'host.ready-ok') { clearTimeout(timeout); resolve(); }
      });
    });
  } finally { socket.terminate(); }

  const restart = composer.getByRole('button', { name: 'Restart host daemon', exact: true });
  await expect(restart).toBeVisible({ timeout: 15_000 });
  await modes.getByRole('button', { name: 'CLI Agent', exact: true }).click();
  await expect(restart).toBeVisible();
  await expect(composer.getByTestId('legacy-agent-command-input')).toHaveText('Preserve this draft while recovering');
  await modes.getByRole('button', { name: 'Modern', exact: true }).click();
  await restart.click();
  await expect(restart).toHaveCount(0, { timeout: 30_000 });
  await expect(prompt).toHaveText('Preserve this draft while recovering');
  await expect.poll(() => win.evaluate(async () => (await (await fetch('/api/v1/hosts')).json()).some(
    (host: { isPrimary: boolean; status: string }) => host.isPrimary && host.status === 'connected'))).toBe(true);
  expect(await app.electron.evaluate(({ app }) => app.getAppMetrics().find(metric => metric.name?.includes('host-runtime.js'))?.pid)).toBe(utilityPid);
});
