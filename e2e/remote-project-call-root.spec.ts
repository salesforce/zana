import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';
import { stubOpenDialog, stubNativeDialogs } from './sdk/native-dialog.js';
import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { Page } from '@playwright/test';

async function request(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 2000);
  await exited; clearTimeout(timer);
}

// A second real daemon process joins the built app over its real socket; the
// project below exists only on that machine, so the server cannot realpath it.
test('a plugin project call on a machine-only project is confined by that machine daemon', async ({ home }) => {
  test.setTimeout(240_000);
  const localRoot = join(home, 'local-checkout');
  mkdirSync(localRoot, { recursive: true });
  const fixture = join(home, 'root-probe-plugin'); mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: '@zcc-ext/root-probe', version: '1.0.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Root probe', description: 'Project root probe', branding: { icon: 'Cpu' }, server: './server.mjs', host: './host.mjs' } }));
  writeFileSync(join(fixture, 'server.mjs'), `export default function(zcc) {
    zcc.rpc.method('where', args => zcc.host.projectCall({ projectId: args.projectId, method: 'where', hostId: args.hostId }));
  }`);
  writeFileSync(join(fixture, 'host.mjs'), `import { experimental_defineHostEntry, defineRpcContract } from '@zana-ai/zcc-plugin-sdk/host';
    const any = { '~standard': { version: 1, vendor: 'fixture', validate: value => ({ value }) } };
    export default experimental_defineHostEntry({
      contract: defineRpcContract({ where: { input: any, output: any } }),
      handlers: { where: (_input, context) => ({ projectRoot: context.experimental_paths.projectRoot }) }
    });`);
  await buildPluginHost(fixture, '2.3.0');
  const app = await launchApp(home);
  let child: ChildProcess | undefined;
  try {
    const localProject = ((await app.window.evaluate(path => window.cc.projects.add(path), localRoot)) as any).value.id as string;
    await expect.poll(async () => (await request(app.window, '/hosts')).body.some((host: any) => host.isPrimary && host.status === 'connected')).toBe(true);
    const grant = (await request(app.window, '/hosts/join-codes', {})).body;
    const origin = new URL(app.window.url()).origin;
    const artifactResponse = await fetch(`${origin}/install/zcc-host.tgz`);
    expect(artifactResponse.status).toBe(200);
    const unpack = join(home, 'packed-daemon'); mkdirSync(unpack);
    const archive = join(home, 'daemon.tgz'); writeFileSync(archive, Buffer.from(await artifactResponse.arrayBuffer()), { mode: 0o600 });
    expect(spawnSync('tar', ['-xzf', archive, '-C', unpack]).status).toBe(0);
    const machineHome = join(home, 'execution-machine'); mkdirSync(machineHome, { recursive: true });
    let stderr = '';
    child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', '--join-code', grant.joinCode, '--host-id', grant.hostId, '--server-url', origin, '--host-daemon-port', String(await unusedPort())], {
      detached: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH, HOME: machineHome, ZCC_DATA_DIR: join(machineHome, '.zcc-machines', 'fixture'), SHELL: '/bin/sh' }
    });
    child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_384); });
    await expect.poll(async () => (await request(app.window, '/hosts')).body.find((host: any) => host.id === grant.hostId)?.status, { timeout: 30_000 }).toBe('connected');
    expect(child.exitCode, stderr).toBeNull();

    // The folder is created and registered by the machine itself, so only that machine knows it.
    const created = await request(app.window, '/projects/create-folder', { hostId: grant.hostId, parentPath: machineHome, name: 'machine-only', operationId: randomUUID() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const remoteProject = created.body.project as { id: string; path: string; hostId: string };
    expect(remoteProject.hostId).toBe(grant.hostId);
    const remoteReal = realpathSync(join(machineHome, 'machine-only'));
    expect(remoteProject.path).toBe(remoteReal);

    await stubOpenDialog(app.electron, [[fixture]]); await stubNativeDialogs(app.electron, [0]);
    expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }))).toMatchObject({ ok: true, value: { id: 'root-probe' } });

    const where = (args: Record<string, unknown>) => request(app.window, '/plugin-apps/root-probe/rpc', { method: 'where', args });
    const remote = await where({ projectId: remoteProject.id });
    expect(remote.status, JSON.stringify(remote.body)).toBe(200);
    expect(remote.body.value).toMatchObject({ result: { projectRoot: remoteReal } });

    // The local project still runs on the server machine with the server realpath.
    const local = await where({ projectId: localProject });
    expect(local.status, JSON.stringify(local.body)).toBe(200); expect(local.body.value).toMatchObject({ result: { projectRoot: realpathSync(localRoot) } });

    // A project may not be driven on a machine that holds no checkout of it.
    expect((await where({ projectId: localProject, hostId: grant.hostId })).status).not.toBe(200);
    expect((await where({ projectId: 'forged-project-id' })).status).not.toBe(200);
  } finally { await stop(child); await app.electron.close(); }
});
