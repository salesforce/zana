import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, connect, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { startPairingForwarder } from '../apps/server/src/http/pairing-forwarder.js';
import { closeApp, expect, launchApp, test } from './fixtures/app.js';

const checkout = '/home/zcc/workspace/sample-app';
const remoteTMP = '/tmp/zana-bot-proof';
const exec = promisify(execFile);

test('a bot uses the selected Docker checkout for chat, jobs and scheduled runs', async ({ home }) => {
  test.skip(process.env.ZCC_E2E_BOTS_DOCKER !== '1', 'Set ZCC_E2E_BOTS_DOCKER=1 to run with Docker');
  test.setTimeout(240_000);
  const docker = async (args: string[]) => (await exec('docker', args, {
    encoding: 'utf8', timeout: args[0] === 'run' ? 60_000 : 30_000, maxBuffer: 1024 * 1024
  })).stdout.trim();
  const container = `zcc-remote-bot-${randomUUID().slice(0, 12)}`;
  const image = process.env.ZCC_E2E_BOTS_DOCKER_IMAGE ?? 'zcc-remote-machine:local';
  const local = join(home, 'local-checkout');
  mkdirSync(local);
  writeFileSync(join(local, 'machine.txt'), 'PRIMARY');
  const app = await launchApp(home, { e2e: true, env: { ZCC_FAKE_PROVIDER: '1' } });
  const page = app.window;
  const base = new URL(page.url()).origin;
  const request = (path: string, data?: unknown) => page.request.fetch(`${base}/api/v1${path}`, data === undefined ? {} : { method: 'POST', data });
  const rpc = (method: string, args: unknown = {}) => request('/plugin-apps/bots/rpc', { method, args });
  const value = async (method: string, args?: unknown) => {
    const response = await rpc(method, args);
    const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    expect(body).toHaveProperty('value');
    return body.value;
  };
  const forwarder = await startPairingForwarder(Number(new URL(base).port));
  // Docker Desktop reaches the host through this listener. The underlying
  // forwarder only exposes enrollment and authenticated machine routes.
  const network = createServer(client => {
    const daemon = connect(forwarder.port, '127.0.0.1');
    client.on('error', () => daemon.destroy());
    daemon.on('error', () => client.destroy());
    client.pipe(daemon).pipe(client);
  });
  let launchRequested = false;
  try {
    await new Promise<void>((resolve, reject) => {
      network.once('error', reject);
      network.listen(0, '0.0.0.0', resolve);
    });
    const port = (network.address() as AddressInfo).port;
    const remoteUrl = `http://host.docker.internal:${port}`;
    const register = await page.evaluate(path => window.cc.projects.add(path), local);
    expect(register.ok).toBe(true);
    const projectId = (register as { value: { id: string } }).value.id;
    const { hostId, joinCode } = await (await request('/hosts/join-codes', {})).json();
    expect(hostId).toBeTruthy();
    const hostState = async () => (await (await request('/hosts')).json()).find((host: { id: string }) => host.id === hostId);

    launchRequested = true;
    await docker(['run', '--pull', 'never', '--detach', '--name', container, '--hostname', 'docker-bot-linux', '--user', 'zcc',
      '--env', 'HOME=/home/zcc', '--env', 'ZCC_FAKE_PROVIDER=1', '--env', `ZCC_DATA_DIR=${remoteTMP}/data`,
      '--entrypoint', 'sleep', image, 'infinity']);
    await docker(['exec', container, 'mkdir', '-p', `${remoteTMP}/node_modules/tsx`]);
    const artifact = await page.request.get(`${base}/install/zcc-host.tgz`);
    expect(artifact.ok()).toBe(true);
    const archive = join(home, 'host-daemon.tgz');
    writeFileSync(archive, await artifact.body());
    await docker(['cp', archive, `${container}:${remoteTMP}/host-daemon.tgz`]);
    await docker(['exec', container, 'tar', '-xzf', `${remoteTMP}/host-daemon.tgz`, '-C', remoteTMP]);

    // The packed daemon discovers the provider fixture beside its entry point.
    // Node 22 strips the fixture's types, so the tsx preload is an empty module.
    const fake = readFileSync(new URL('../packages/agent-runtime/src/test/fake-provider-script.ts', import.meta.url), 'utf8');
    const fixture = join(home, 'fake-provider-script.ts');
    writeFileSync(fixture, `import { appendFileSync, readFileSync } from 'node:fs';\n${fake.replace(
      '  const plan = parseTurnPlan(inputText);',
      `  appendFileSync('${remoteTMP}/turns.jsonl', JSON.stringify({ cwd: process.cwd(), marker: readFileSync('machine.txt', 'utf8'), input: inputText }) + '\\n');\n  const plan = parseTurnPlan(inputText);`
    )}`);
    const shim = join(home, 'package.json');
    writeFileSync(shim, JSON.stringify({ name: 'tsx', exports: './index.mjs' }));
    const shimEntry = join(home, 'index.mjs'); writeFileSync(shimEntry, 'export {};');
    await docker(['cp', shim, `${container}:${remoteTMP}/node_modules/tsx/package.json`]);
    await docker(['cp', shimEntry, `${container}:${remoteTMP}/node_modules/tsx/index.mjs`]);
    await docker(['cp', fixture, `${container}:${remoteTMP}/fake-provider-script.ts`]);
    const marker = join(home, 'remote-marker'); writeFileSync(marker, 'DOCKER');
    await docker(['cp', marker, `${container}:${checkout}/machine.txt`]);
    const startDaemon = (code?: string) => docker(['exec', '--detach', container, 'sh', '-c',
      `exec node ${remoteTMP}/join.mjs "$@" >>${remoteTMP}/daemon.log 2>&1`, 'join-daemon',
      'join', '--host-id', hostId, '--server-url', remoteUrl, ...(code ? ['--join-code', code] : [])]);
    await startDaemon(joinCode);
    await expect.poll(async () => (await hostState())?.status, { timeout: 30_000 }).toBe('connected');
    const hostName = (await hostState()).name as string;
    const source = await request(`/projects/${projectId}/sources`, { hostId, path: checkout });
    expect(source.status(), await source.text()).toBe(201);
    const bot = 'docker-scout';
    await value('create', { name: 'Docker Scout', projectId, providerId: 'fake' });
    await page.getByRole('button', { name: 'Organize bots', exact: true }).click();
    await page.getByRole('link', { name: 'Open Bots panel', exact: true }).click();
    const panel = page.locator('.bt-root');
    await panel.getByRole('button', { name: /Docker Scout/ }).click();
    await panel.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Machine', exact: true }).click();
    await page.getByRole('option', { name: hostName, exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Machine settings saved.')).toBeVisible();

    const thread = async (threadId: string) => (await (await request(`/threads/${threadId}`)).json()).thread;
    const waitRemote = async (threadId: string) => {
      await expect.poll(async () => (await thread(threadId))?.status, { timeout: 25_000 }).toBe('idle');
      expect((await thread(threadId)).hostId).toBe(hostId);
    };
    const jobArgs = Buffer.from(JSON.stringify({ title: 'Inspect checkout', prompt: 'docker-background-proof' })).toString('base64url');
    const main = await value('send', { bot, message: `docker-chat-proof call_tool:bot_job_start tool_args:${jobArgs}` });
    await waitRemote(main.threadId);
    const jobs = await value('jobs', { bot });
    expect(jobs).toHaveLength(1);
    await waitRemote(jobs[0].threadId);

    const nextMinute = new Date(Date.now() + 60_000);
    const saved = await value('addRoutine', { bot, routine: {
      kind: 'agent', name: 'Docker digest', cron: `${nextMinute.getMinutes()} ${nextMinute.getHours()} * * *`, prompt: 'docker-routine-proof'
    } });
    const routineId = saved.routines[0].id;
    const runs = async () => (await value('get', { bot })).bot.routines[0].runs ?? [];
    await expect.poll(async () => (await runs())[0]?.status, { timeout: 85_000 }).toBe('posted');
    await waitRemote((await runs())[0].threadId);
    const transcript = await (await request(`/threads/${main.threadId}/events?limit=200`)).text();
    expect(transcript).toContain('docker-routine-proof');
    const turns = async () => (await docker(['exec', container, 'cat', `${remoteTMP}/turns.jsonl`])).split('\n').map(line => JSON.parse(line));
    const completedTurns = await turns();
    for (const prompt of ['docker-chat-proof', 'docker-background-proof', 'docker-routine-proof']) {
      expect(completedTurns.some(row => row.input.includes(prompt)), prompt).toBe(true);
    }
    for (const turn of completedTurns) expect(turn).toMatchObject({ cwd: checkout, marker: 'DOCKER' });

    await waitRemote(main.threadId);
    await docker(['stop', '--time', '2', container]);
    await expect.poll(async () => (await hostState())?.status).toBe('disconnected');
    await expect(page.locator('.bt-meta')).toContainText('Offline');
    for (const [method, args] of [['send', { bot, message: 'offline' }], ['runRoutine', { bot, routineId }]] as const) {
      expect(await (await rpc(method, args)).text()).toContain('is offline');
    }
    expect((await runs())[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('is offline') });
    expect((await value('get', { bot })).bot).toMatchObject({ mainThreadId: main.threadId, hostId });
    await docker(['start', container]);
    await startDaemon();
    await expect.poll(async () => (await hostState())?.status, { timeout: 30_000 }).toBe('connected');
    expect((await value('send', { bot, message: 'docker-retry-proof' })).threadId).toBe(main.threadId);
    await waitRemote(main.threadId);
    expect((await turns()).filter(row => row.input.includes('docker-retry-proof'))).toMatchObject([{ cwd: checkout, marker: 'DOCKER' }]);
    expect(readFileSync(join(local, 'machine.txt'), 'utf8')).toBe('PRIMARY');
  } finally {
    if (launchRequested) {
      try { await docker(['rm', '--force', container]); } catch (error) {
        if (!String(error).includes('No such container')) console.warn(`Could not remove ${container}`, error);
      }
    }
    await forwarder.close();
    await new Promise<void>(resolve => network.close(() => resolve()));
    await closeApp(app.electron);
  }
});
