import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { HOST_RPC_PROTOCOL_VERSION } from '../packages/contracts/src/host-rpc.js';
import { test, expect, launchApp } from './fixtures/app.js';

test('Default Project discovers remote models and machine renames survive pairing', async ({ home }) => {
  test.setTimeout(180_000);
  const emptyCatalog = join(home, 'empty-catalog'); mkdirSync(emptyCatalog);
  const app = await launchApp(home, { env: {
    ZCC_FAKE_PROVIDER: '1', ZCC_BUNDLED_PLUGINS_DIR: emptyCatalog, ZCC_BUNDLED_EXTENSIONS_DIR: emptyCatalog
  } });
  console.log('[machine-composer] app ready');
  const win = app.window;
  const origin = new URL(win.url()).origin;
  const api = async (path: string, body?: unknown) => win.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
  const navigate = (path: string) => win.evaluate(path => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  let child: ChildProcess | undefined;
  async function stopDaemon() {
    if (!child?.pid || child.exitCode !== null) return;
    const exited = new Promise<void>(resolve => child!.once('close', () => resolve()));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const timer = setTimeout(() => { try { process.kill(-child!.pid!, 'SIGKILL'); } catch {} }, 2000);
    await exited;
    clearTimeout(timer);
  }
  try {
    const scratch = await win.evaluate(() => window.cc.projects.ensureQuickAgent());
    expect(scratch.ok).toBe(true);
    if (!scratch.ok) throw new Error(scratch.message);
    await expect.poll(async () => (await api('/hosts')).body.some((host: any) => host.isPrimary && host.status === 'connected')).toBe(true);
    const grant = (await api('/hosts/join-codes', {})).body;
    const artifact = await fetch(`${origin}/install/zcc-host.tgz`);
    expect(artifact.status).toBe(200);
    const archive = join(home, 'daemon.tgz');
    writeFileSync(archive, Buffer.from(await artifact.arrayBuffer()), { mode: 0o600 });
    const unpack = join(home, 'packed-daemon'); mkdirSync(unpack);
    expect(spawnSync('tar', ['-xzf', archive, '-C', unpack]).status).toBe(0);
    const socket = createServer();
    await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const machineHome = join(home, 'remote-machine'); mkdirSync(machineHome);
    child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', '--join-code', grant.joinCode,
      '--host-id', grant.hostId, '--server-url', origin, '--host-daemon-port', String(port)], {
      detached: true, stdio: ['ignore', 'ignore', 'pipe'], cwd: machineHome,
      env: { PATH: process.env.PATH, HOME: machineHome, ZCC_DATA_DIR: join(machineHome, '.zcc'), SHELL: '/bin/sh', ZCC_FAKE_PROVIDER: '1' }
    });
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_384); });
    const remoteHost = async () => (await api('/hosts')).body.find((host: any) => host.id === grant.hostId);
    await expect.poll(async () => (await remoteHost())?.status, { timeout: 30_000 }).toBe('connected');
    expect(child.exitCode, stderr).toBeNull();
    console.log('[machine-composer] remote ready');
    const originalName = (await remoteHost()).name;
    const discovery = await api(`/system/execution-options?projectId=${scratch.value.id}&hostId=${grant.hostId}&providerId=fake`);
    expect(discovery.status, JSON.stringify(discovery.body)).toBe(200);
    expect(discovery.body.models).toContainEqual(expect.objectContaining({ id: 'fake-model' }));
    console.log('[machine-composer] model discovery ready');

    await navigate('/agents');
    if (await win.getByTestId('agents-new-empty').count()) await win.getByTestId('agents-new-empty').click();
    else await win.getByTestId('agents-board-new-thread').first().click();
    const modal = win.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'Modern', exact: true }).click();
    await modal.getByRole('button', { name: 'Project', exact: true }).click();
    await win.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: 'Default Project', exact: true }).click();
    await modal.getByRole('button', { name: 'Machine', exact: true }).click();
    await win.getByRole('listbox', { name: 'Machine' }).getByRole('option', { name: `${originalName.split('.')[0]} Online`, exact: true }).click();
    await expect(modal.getByTestId('model-reasoning-picker-trigger')).toContainText('Fake Model', { timeout: 60_000 });
    console.log('[machine-composer] picker ready');
    await win.locator('.palette-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(modal).toHaveCount(0);

    await navigate('/settings/machines');
    const card = win.locator('.machine-card').filter({ has: win.getByTestId(`machine-workspace-${grant.hostId}`) });
    await card.getByRole('button', { name: `Rename ${originalName}`, exact: true }).click();
    await card.getByRole('textbox', { name: 'Machine name', exact: true }).fill('My remote dev machine');
    await card.getByRole('textbox', { name: 'Machine name', exact: true }).press('Enter');
    await expect(card.locator('.machine-card-identity > strong')).toHaveText('My remote dev machine');
    await expect.poll(async () => (await remoteHost()).name).toBe('My remote dev machine');
    await stopDaemon();
    const repaired = await fetch(`${origin}/internal/hosts/enroll`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        authorization: `Bearer ${readFileSync(join(home, '.zcc', 'host-enroll.token'), 'utf8').trim()}` },
      body: JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: grant.hostId,
        hostName: 'opaque-hostname-after-repair', instanceId: randomUUID(), homeDir: machineHome })
    });
    expect(repaired.status).toBe(201);
    await expect.poll(async () => (await remoteHost()).name).toBe('My remote dev machine');
    await win.reload();
    await expect(win.locator('.machine-card-identity > strong').filter({ hasText: 'My remote dev machine' })).toBeVisible();
    console.log('[machine-composer] rename persisted');
  } finally {
    await stopDaemon();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([app.electron.close().catch(() => undefined), new Promise<void>(resolve => {
      timer = setTimeout(() => { app.electron.process().kill('SIGKILL'); resolve(); }, 15_000);
    })]);
    clearTimeout(timer);
  }
});
