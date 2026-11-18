import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { HOST_RPC_PROTOCOL_VERSION } from '../packages/contracts/src/host-rpc.js';
import { test, expect } from './fixtures/app.js';

const id = 'ssh-preparation-fixture';
test.use({
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const root = join(home, 'connection-provider'); const bin = join(home, 'bin');
    mkdirSync(root, { recursive: true }); mkdirSync(bin, { recursive: true });
    writeFileSync(join(home, 'preparation-mode'), 'blocked');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', zcc: { name: 'Workspace connection fixture', description: 'Isolated SSH preparation regression', branding: { icon: 'Cloud' }, server: './server.mjs' } }));
    writeFileSync(join(root, 'server.mjs'), `import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const home = process.env.HOME;
export default async api => {
  await api.sshConnections.register({
    owns: async (remote, signal) => { signal.throwIfAborted(); return remote.host === 'managed-fixture'; },
    prepare: async (_remote, signal) => {
      appendFileSync(home + '/preparations', 'prepare\\n');
      const mode = readFileSync(home + '/preparation-mode', 'utf8');
      if (mode === 'wait') return new Promise(resolve => {
        const cancelled = () => { appendFileSync(home + '/cancelled', 'cancelled\\n'); resolve({ status: 'blocked', message: 'Cancelled' }); };
        if (signal.aborted) cancelled(); else signal.addEventListener('abort', cancelled, { once: true });
      });
      if (mode === 'blocked') return { status: 'blocked', message: 'Workspace sign-in required. Complete sign-in and retry.' };
      writeFileSync(home + '/authenticated', 'ready');
      return { status: 'ready' };
    }
  });
}`);
    writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nif [ -f "$HOME/authenticated" ]; then echo prepared >> "$HOME/ssh-attempts"; else echo unprepared >> "$HOME/ssh-attempts"; fi\necho 'Connection closed by UNKNOWN port 65535' >&2\nexit 255\n`, { mode: 0o700 });
    await use({ PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ZCC_SKIP_PLUGIN_NPM: '1', ZCC_FAKE_PROVIDER: '1' });
  }
});

test('generic Reconnect prepares through a worker plugin, stops on failure, retries and cancels safely', async ({ app, home }) => {
  test.setTimeout(180_000);
  const win = app.window;
  const cli = await app.electron.evaluate(({ app }) => app.isPackaged ? `${process.resourcesPath}/zcc-cli/bin/zcc` : null)
    ?? resolve(process.env.ZCC_E2E_APP_ROOT ?? '.', 'packages/cli/dist/bin/zcc');
  await promisify(execFile)(process.execPath, [cli, 'plugin', 'install', '.'], {
    cwd: join(home, 'connection-provider'), env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SERVER_URL: new URL(win.url()).origin,
      ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined, ZCC_SKIP_PLUGIN_NPM: '1' }, timeout: 60_000
  });
  await expect.poll(() => win.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id)?.status, id)).toBe('running');
  await expect.poll(() => win.evaluate(async () => (await (await fetch('/api/v1/hosts')).json()).some((host: { isPrimary: boolean; status: string }) => host.isPrimary && host.status === 'connected'))).toBe(true);
  const issued = await win.evaluate(async () => (await fetch('/api/v1/hosts/join-codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());
  // Enrollment is a daemon-only endpoint: simulate the isolated remote in Node, never a browser origin.
  const enrolled = await fetch(`${new URL(win.url()).origin}/internal/hosts/enroll`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${issued.joinCode}` },
    body: JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostName: 'Managed fixture', hostId: issued.hostId, instanceId: '22222222-2222-4222-8222-222222222222' }) });
  expect(enrolled.ok, await enrolled.text()).toBe(true);
  const hostId = issued.hostId as string;
  await win.evaluate(async hostId => {
    const response = await fetch(`/api/v1/hosts/${hostId}/ssh-identity`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: 'managed-fixture' }) });
    if (!response.ok) throw Error(await response.text());
  }, hostId);
  await win.goto(`${new URL(win.url()).origin}/settings/machines`);
  expect(existsSync(join(home, 'preparations'))).toBe(false);
  await win.getByTestId(`machine-reconnect-${hostId}`).click();
  const drawer = win.getByTestId('host-install-drawer');
  await expect(drawer.getByTestId('host-install-stage-prepare')).toHaveAttribute('data-status', 'failed');
  await expect(drawer.getByRole('alert')).toContainText('Workspace sign-in required');
  await expect(drawer.getByTestId('host-install-stage-ssh')).toHaveCount(0);
  expect(existsSync(join(home, 'ssh-attempts'))).toBe(false);
  writeFileSync(join(home, 'preparation-mode'), 'ready');
  await drawer.getByTestId('host-install-retry').click();
  await expect(drawer.getByTestId('host-install-stage-prepare')).toHaveAttribute('data-status', 'passed');
  await expect(drawer.getByTestId('host-install-stage-ssh')).toHaveAttribute('data-status', 'failed', { timeout: 60_000 });
  await expect(drawer.getByTestId('host-install-stage-install')).toHaveAttribute('data-status', 'failed');
  expect(readFileSync(join(home, 'ssh-attempts'), 'utf8')).not.toContain('unprepared');
  expect(readFileSync(join(home, 'preparations'), 'utf8')).toBe('prepare\nprepare\n');
  await drawer.getByRole('button', { name: 'Close install log' }).click();

  // An ordinary SSH alias skips plugin authentication altogether.
  await win.evaluate(async () => { await (await fetch('/api/v1/hosts/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ssh: { host: 'ordinary-fixture' } }) })).text(); });
  expect(readFileSync(join(home, 'preparations'), 'utf8')).toBe('prepare\nprepare\n');

  writeFileSync(join(home, 'preparation-mode'), 'wait');
  const request = () => win.evaluate(async hostId => {
    const controller = new AbortController(); (window as unknown as { cancelPreparation: () => void }).cancelPreparation = () => controller.abort();
    try {
      const response = await fetch(`/api/v1/hosts/${hostId}/repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal });
      if (!response.ok) throw Error(`${response.status}: ${await response.text()}`);
      return await response.text();
    } catch (error) {
      if (controller.signal.aborted) return 'cancelled';
      throw error;
    }
  }, hostId);
  const pending = request();
  await expect.poll(() => readFileSync(join(home, 'preparations'), 'utf8').split('\n').filter(Boolean).length).toBe(3);
  await win.evaluate(() => (window as unknown as { cancelPreparation: () => void }).cancelPreparation());
  await pending;
  await expect.poll(() => existsSync(join(home, 'cancelled'))).toBe(true);
  const before = readFileSync(join(home, 'ssh-attempts'), 'utf8');
  const reloading = request();
  await expect.poll(() => readFileSync(join(home, 'preparations'), 'utf8').split('\n').filter(Boolean).length).toBe(4);
  appendFileSync(join(home, 'connection-provider/server.mjs'), '\n// replacement generation\n');
  expect(await win.evaluate(id => window.cc.pluginApps.reload(id), id)).toEqual({ ok: true, value: true });
  await reloading;
  expect(readFileSync(join(home, 'ssh-attempts'), 'utf8')).toBe(before);
});
