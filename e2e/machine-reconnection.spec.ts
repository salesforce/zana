import { test, expect, launchApp } from './fixtures/app.js';
import { createServer, request as httpRequest } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { peerRestartCommand } from '../apps/host-daemon/src/peer-daemon.js';

async function unusedPort() {
  const s = createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>(r => s.close(() => r())); return port;
}

test('Machines recover failed upgrades, missing hello and heartbeat replies without reinstalling', async ({ home }) => {
  test.setTimeout(360000);
  const app = await launchApp(home);
  const desktopProcess = app.electron.process();
  let desktopStderr = '';
  desktopProcess.stderr?.on('data', bytes => { desktopStderr = (desktopStderr + String(bytes)).slice(-32768); });
  const origin = new URL(app.window.url()).origin;
  const api = async (path: string, body?: unknown) => app.window.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, { path, body });
  const proxy = createServer((req, res) => {
    const upstream = httpRequest(new URL(req.url!, origin), { method: req.method, headers: { ...req.headers, host: new URL(origin).host } }, reply => {
      res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  const rawSockets = new Set<import('node:net').Socket>();
  proxy.on('connection', s => { rawSockets.add(s); s.on('close', () => rawSockets.delete(s)); });
  const wss = new WebSocketServer({ noServer: true });
  const upstreamSockets = new Set<WebSocket>();
  let rejectUpgrades = 0, upgrades = 0, dropAcks = false, dropHello = false;
  const hellos: Array<{ instanceId: string; protocolVersion: number }> = [];
  let daemonSocket: WebSocket | undefined;
  const rpcResponses: Array<{ requestId: string; ok: boolean }> = [];
  proxy.on('upgrade', (req, socket, head) => {
    upgrades++;
    if (rejectUpgrades-- > 0) { socket.end('HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, client => {
      daemonSocket = client;
      const url = new URL(req.url!, origin); url.protocol = 'ws:';
      const upstream = new WebSocket(url, { headers: { authorization: req.headers.authorization!, 'x-zcc-host-id': req.headers['x-zcc-host-id'] as string } });
      upstreamSockets.add(upstream);
      const pending: string[] = [];
      client.on('message', raw => {
        const text = String(raw); const message = JSON.parse(text);
        if (message.type === 'host.hello') hellos.push(message);
        if (message.type === 'host-rpc.response') rpcResponses.push(message);
        if (upstream.readyState === WebSocket.OPEN) upstream.send(text); else pending.push(text);
      });
      upstream.on('open', () => { for (const text of pending) upstream.send(text); pending.length = 0; });
      upstream.on('message', raw => {
        const message = JSON.parse(String(raw));
        if ((dropAcks && message.type === 'heartbeat-ack') || (dropHello && message.type === 'host.hello-ok')) return;
        if (client.readyState === WebSocket.OPEN) client.send(raw.toString());
      });
      upstream.on('error', () => client.terminate());
      upstream.on('close', () => { upstreamSockets.delete(upstream); client.terminate(); });
      client.on('error', () => upstream.terminate());
      client.on('close', () => upstream.terminate());
    });
  });
  await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
  const address = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  const machineHome = join(home, 'execution-machine');
  const dataDir = join(machineHome, '.zcc-machines/fixture.test'), runtime = join(dataDir, 'runtime');
  mkdirSync(runtime, { recursive: true });
  let child: ChildProcess | undefined, consent: ChildProcess | undefined, replacementPid: number | undefined;
  let stderr = '';
  try {
    await expect.poll(async () => (await api('/hosts')).some((h: any) => h.isPrimary && h.status === 'connected')).toBe(true);
    const grant = await api('/hosts/join-codes', {});
    const response = await fetch(`${origin}/install/zcc-host.tgz`);
    expect(response.status).toBe(200);
    const artifact = join(home, 'daemon.tgz'); writeFileSync(artifact, Buffer.from(await response.arrayBuffer()));
    expect(spawnSync('tar', ['-xzf', artifact, '-C', runtime]).status).toBe(0);
    const port = await unusedPort(); writeFileSync(join(dataDir, 'host-daemon.port'), String(port));
    const entry = join(runtime, 'join.mjs');
    child = spawn(process.execPath, [entry, 'join', '--join-code', grant.joinCode, '--host-id', grant.hostId,
      '--server-url', address, '--host-daemon-port', String(port), '--auto-update'], {
      detached: true, stdio: ['ignore', 'ignore', 'pipe'], cwd: machineHome,
      env: { PATH: process.env.PATH, HOME: machineHome, ZCC_DATA_DIR: dataDir, SHELL: '/bin/sh' }
    });
    child.stderr!.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-16384); });
    const online = async () => (await api('/hosts')).find((h: any) => h.id === grant.hostId)?.status;
    await expect.poll(online, { timeout: 30000 }).toBe('connected');
    const auth = readFileSync(join(dataDir, 'auth.json'), 'utf8');
    const lifetime = hellos[0].instanceId;
    await app.window.goto(`${origin}/settings/machines`);
    const card = app.window.locator('.machine-card').filter({ has: app.window.getByTestId(`machine-workspace-${grant.hostId}`) });
    await expect(card).toHaveClass(/machine-card--online/);

    // Even a failed health probe creates an internal runtime. Use a missing
    // artifact to exercise that path without starting a provider. It must not enter the
    // project-environment inventory or the next reconnect rejects readiness.
    daemonSocket!.send(JSON.stringify({ type: 'host-rpc.request', protocolVersion: hellos[0].protocolVersion,
      requestId: 'fixture-health', command: { type: 'provider.health', providerId: 'fixture', cwd: machineHome,
        bridgeLaunch: { pluginId: 'fixture-health', source: { kind: 'artifact', digest: 'a'.repeat(64), byteLength: 1 },
          capabilities: { supportsServiceTier: false, permissionModes: ['full'], supportsThreadArchive: false,
            supportsThreadRename: false, fork: 'checkpoint' } } } }));
    await expect.poll(() => rpcResponses.find(response => response.requestId === 'fixture-health')).toMatchObject({ ok: false, commandType: 'provider.health' });

    // Same daemon process / lifetime after a real failed HTTP upgrade.
    rejectUpgrades = 1;
    for (const client of wss.clients) client.terminate();
    await expect.poll(online).toBe('disconnected');
    await expect(card).not.toHaveClass(/machine-card--online/);
    await expect.poll(online, { timeout: 15000 }).toBe('connected');
    await expect(card).toHaveClass(/machine-card--online/);
    expect(upgrades).toBeGreaterThanOrEqual(3);

    // A socket that opens without a hello response has its own deadline.
    dropHello = true;
    for (const client of wss.clients) client.terminate();
    const beforeHello = upgrades;
    await expect.poll(() => upgrades, { timeout: 20000 }).toBeGreaterThanOrEqual(beforeHello + 2);
    dropHello = false;
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${port}/status`)).json(), { timeout: 20000 }).toMatchObject({ connected: true });

    // Keep TCP and client heartbeats flowing, but lose only server replies.
    const beforeLease = upgrades; dropAcks = true;
    await expect.poll(() => upgrades, { timeout: 90000 }).toBeGreaterThan(beforeLease);
    dropAcks = false;
    await expect.poll(online).toBe('connected');
    expect(hellos.every(hello => hello.instanceId === lifetime)).toBe(true);
    expect(child.exitCode, stderr).toBeNull();
    expect(readFileSync(join(dataDir, 'auth.json'), 'utf8')).toBe(auth);

    // Real Electron -> shell -> installed restart command, on a host without
    // a user service. Uses the same saved credentials, no enrollment request.
    const bin = join(machineHome, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o700 });
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    rejectUpgrades = Number.POSITIVE_INFINITY;
    const output = await app.electron.evaluate(async (_electron, input) => {
      const { execFile } = process.getBuiltinModule('node:child_process');
      return new Promise<string>((resolve, reject) => execFile('/bin/sh', ['-c', input.command], {
        env: { PATH: input.path, HOME: input.home, ZCC_NODE: input.node }, timeout: 25000, maxBuffer: 65536
      }, (error, stdout, stderr) => error ? reject(new Error(`Restart failed: ${stderr}`)) : resolve(stdout)));
    }, { command: peerRestartCommand('fixture.test'), path: `${bin}:${process.env.PATH}`, home: machineHome, node: process.execPath });
    expect(output).toContain('restarted using saved enrollment');
    await expect.poll(() => { try { return Number(readFileSync(join(dataDir, 'host-daemon.pid'), 'utf8')); } catch { return child.pid; } }).not.toBe(child.pid);
    replacementPid = Number(readFileSync(join(dataDir, 'host-daemon.pid'), 'utf8'));
    expect(replacementPid).toBeGreaterThan(1);
    // No supervisor is available. Saved enrollment must survive an outage
    // longer than the former startup deadline without exiting or reinstalling.
    await new Promise(resolve => setTimeout(resolve, 65000));
    expect(() => process.kill(replacementPid!, 0)).not.toThrow();
    expect(Number(readFileSync(join(dataDir, 'host-daemon.pid'), 'utf8'))).toBe(replacementPid);
    expect(await (await fetch(`http://127.0.0.1:${port}/status`)).json()).toMatchObject({ connected: false });
    rejectUpgrades = 0;
    await expect.poll(online, { timeout: 45000 }).toBe('connected');
    await expect(card).toHaveClass(/machine-card--online/);
    expect(readFileSync(join(dataDir, 'auth.json'), 'utf8')).toBe(auth);
    expect(hellos.at(-1)!.instanceId).not.toBe(lifetime);

    // A legacy enrollment (no provenance) whose forwarded loopback port changed
    // is refused, and the app's repair path recovers it with one-join consent.
    const holder = Number(readFileSync(join(dataDir, 'host-daemon.pid'), 'utf8'));
    for (const pid of new Set([holder, replacementPid!])) {
      try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
    }
    await expect.poll(async () => { try { process.kill(holder, 0); return 'alive'; } catch { return 'gone'; } }, { timeout: 30000 }).toBe('gone');
    const legacy = JSON.parse(readFileSync(join(dataDir, 'auth.json'), 'utf8'));
    delete legacy.provenance; legacy.serverUrl = 'http://127.0.0.1:1/';
    writeFileSync(join(dataDir, 'auth.json'), JSON.stringify(legacy), { mode: 0o600 });
    const legacyAuth = readFileSync(join(dataDir, 'auth.json'), 'utf8');
    const repair = await api('/hosts/join-codes', {});
    const joinArgs = ['join', '--join-code', repair.joinCode, '--host-id', repair.hostId, '--server-url', address, '--host-daemon-port', String(port)];
    const joinEnv = { PATH: process.env.PATH, HOME: machineHome, ZCC_DATA_DIR: dataDir, SHELL: '/bin/sh' };
    const refused = spawnSync(process.execPath, [entry, ...joinArgs], { cwd: machineHome, env: joinEnv, encoding: 'utf8', timeout: 30000 });
    expect(refused.status).not.toBe(0);
    expect(`${refused.stderr}${refused.stdout}`).toContain('belongs to another server');
    expect(readFileSync(join(dataDir, 'auth.json'), 'utf8')).toBe(legacyAuth);
    consent = spawn(process.execPath, [entry, ...joinArgs], { detached: true, stdio: ['ignore', 'ignore', 'pipe'], cwd: machineHome, env: { ...joinEnv, ZCC_HOST_REPLACE_ENROLLMENT: '1' } });
    consent.stderr!.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-16384); });
    const repaired = async () => (await api('/hosts')).find((h: any) => h.id === repair.hostId)?.status;
    await expect.poll(repaired, { timeout: 30000 }).toBe('connected');
    expect(JSON.parse(readFileSync(join(dataDir, 'auth.json'), 'utf8')).serverUrl).toBe(`${address}/`);
  } catch (error) {
    console.error('Isolated daemon diagnostics:', stderr);
    console.error('Isolated desktop diagnostics:', desktopProcess.exitCode, desktopProcess.signalCode, desktopStderr);
    for (const name of ['desktop', 'server', 'host-daemon']) {
      try { console.error(`${name} log:`, readFileSync(join(home, `.zcc/logs/${name}.log`), 'utf8').slice(-12000)); } catch {}
    }
    throw error;
  } finally {
    if (!replacementPid) { try { replacementPid = Number(readFileSync(join(dataDir, 'host-daemon.pid'), 'utf8')); } catch {} }
    const pids = new Set([child?.pid, replacementPid, consent?.pid]);
    for (const pid of pids) if (pid && pid > 1) { try { process.kill(-pid, 'SIGTERM'); } catch {} }
    for (const socket of upstreamSockets) socket.terminate();
    for (const socket of wss.clients) socket.terminate();
    for (const socket of rawSockets) socket.destroy();
    wss.close(); proxy.closeAllConnections(); await new Promise<void>(r => proxy.close(() => r()));
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([app.electron.close().catch(() => undefined), new Promise<void>(resolve => {
      shutdownTimer = setTimeout(() => { desktopProcess.kill('SIGKILL'); resolve(); }, 10000);
    })]); } finally { clearTimeout(shutdownTimer); }
  }
});
