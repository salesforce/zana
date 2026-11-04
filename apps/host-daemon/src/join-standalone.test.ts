import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION, PEER_CONTROL_ROUTE, PEER_CONTROL_MAX_BYTES } from '@zana-ai/zcc-contracts/host-rpc';
import { PROTOCOL_VERSION, runJoinStandalone } from './join-standalone.js';
import { PEER_FORWARD_MAX_BYTES, registerLocalPeerApp } from './peer-forward.js';
import { PeerControlForwarder } from './peer-control.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function directory() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-standalone-')));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function http(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  return { server, port, url: `http://127.0.0.1:${port}` };
}
async function fixture(options: {
  capability?: 'execution' | 'peer.forward' | 'missing';
  run?: typeof runJoinStandalone;
  registered?: boolean;
  independent?: boolean;
  handler?: (req: IncomingMessage, res: ServerResponse) => void;
} = {}) {
  const dir = await directory(), localDir = options.independent === false ? dir : await directory();
  const hostId = randomUUID(), localId = randomUUID(), remoteId = randomUUID();
  const hostKey = randomBytes(32).toString('base64url');
  const localRequests: Array<{ path: string; body: string; headers: IncomingMessage['headers'] }> = [];
  const app = await http((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      localRequests.push({ path: req.url!, body, headers: req.headers });
      if (options.handler) options.handler(req, res);
      else res.end(req.url === '/api/v1/peer-channel-register' ? '{}' : body);
    });
  });
  if (options.registered !== false) cleanup.push(await registerLocalPeerApp(localDir, { port: app.port, instanceId: localId }));
  await writeFile(join(localDir, 'host-enroll.token'), 't'.repeat(43), { mode: 0o600 });
  const enrollments: unknown[] = [];
  const remote = await http((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      enrollments.push(JSON.parse(body));
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({
        protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, hostKey
      }));
    });
  });
  const wss = new WebSocketServer({ server: remote.server });
  cleanup.push(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  });
  const responses = new Map<string, any>();
  const hellos: unknown[] = [];
  let socket: WebSocket | undefined;
  let capability = options.capability ?? 'execution';
  wss.on('connection', client => {
    socket = client;
    client.on('message', bytes => {
      const message = JSON.parse(String(bytes));
      if (message.type === 'host.hello') {
        hellos.push(message);
        client.send(JSON.stringify({ type: 'host.hello-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
          hostId, productInstanceId: remoteId, ...(capability === 'missing' ? {} : { enrollmentCapability: capability }) }));
      }
      if (message.type === 'host.ready') client.send(JSON.stringify({ type: 'host.ready-ok',
        protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId: message.instanceId }));
      if (message.type === 'heartbeat') client.send(JSON.stringify({ type: 'heartbeat-ack' }));
      if (message.type === 'host-rpc.response') responses.set(message.requestId, message);
    });
  });
  const statusPort = (await http((_req, res) => res.end())).port;
  // Reserve a dynamic port rather than colliding with another fixture's random range.
  await cleanup.pop()!();
  const argv = ['join', '--join-code', 'join-token-join-token', '--server-url', remote.url,
    '--host-id', hostId, '--host-daemon-port', String(statusPort)];
  const env = { ...process.env, ZCC_DATA_DIR: dir,
    ZCC_LOCAL_PEER_APP_DATA_DIR: options.independent === false ? '' : localDir };
  const run = options.run ?? runJoinStandalone;
  const running = await run(argv, env);
  cleanup.push(() => running.close());
  const body = JSON.stringify({ text: 'x'.repeat(24_000) });
  const command = { type: 'peer.forward', protocolVersion: 2, pairId: 'pair-a', senderId: remoteId,
    recipientId: localId, pluginId: 'plugin-a', scope: 'opaque-scope', route: '/api/v1/peer/plugin-a/echo',
    method: 'echo', httpMethod: 'POST', body, payloadHash: createHash('sha256').update(body).digest('hex'),
    signature: 'a'.repeat(43), nonce: 'n'.repeat(16), issuedAt: Date.now(), epoch: 1, timeoutMs: 1000 };
  const control = { type: 'peer.control', timeoutMs: 1000, packet: { version: 1, senderId: remoteId,
    recipientId: localId, senderHostId: randomUUID(), recipientHostId: hostId, route: PEER_CONTROL_ROUTE,
    nonce: 'c'.repeat(48), issuedAt: Date.now(), sealed: 's'.repeat(43) } };
  const send = (command: unknown, patch = {}) => {
    const requestId = randomUUID();
    socket!.send(JSON.stringify({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId, command, ...patch }));
    return requestId;
  };
  const result = async (id: string) => {
    await vi.waitFor(() => expect(responses.has(id)).toBe(true));
    return responses.get(id)!;
  };
  return { dir, localDir, remote, localRequests, enrollments, hellos, hostId, running, argv, env,
    command, control, send, result, statusPort, responses,
    raw(input: unknown) { socket!.send(JSON.stringify(input)); },
    reconnect(next: typeof capability) { capability = next; socket!.terminate(); } };
}

describe('standalone joined-host protocol', () => {
  it('canonical protocol and real independent-app RPC preserve complete v2 envelope and >8192 bytes', async () => {
    expect(PROTOCOL_VERSION).toBe(HOST_RPC_PROTOCOL_VERSION);
    const f = await fixture();
    expect(f.enrollments[0]).toMatchObject({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: f.hostId });
    const status = await fetch(`http://127.0.0.1:${f.statusPort}/status`).then(res => res.json());
    expect(status).toMatchObject({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, connected: true, autoUpdate: false });
    const response = await f.result(f.send(f.command));
    expect(response).toMatchObject({ ok: true, commandType: 'peer.forward', result: { status: 200, body: f.command.body } });
    const request = f.localRequests.at(-1)!;
    const { type: _type, method: _method, body: _body, timeoutMs: _timeout, ...envelope } = f.command;
    expect(JSON.parse(Buffer.from(request.headers['x-zcc-peer-envelope'] as string, 'base64url').toString())).toEqual(envelope);
    expect(request.path).toBe(f.command.route);
    expect(request.headers.authorization).toBeUndefined(); expect(request.headers.cookie).toBeUndefined();
    expect((await f.result(f.send(f.control))).result).toEqual({ status: 200, body: JSON.stringify(f.control.packet) });
    const registration = f.localRequests.find(request => request.path === '/api/v1/peer-channel-register')!;
    expect(JSON.parse(registration.body)).toEqual({ sealed: expect.stringMatching(/^[A-Za-z0-9_-]+$/) });
    expect(registration.body).not.toContain('hostKey'); expect(registration.body).not.toContain('t'.repeat(43));
    await f.running.close(); await f.running.close();
    const resumed = await runJoinStandalone(f.argv, f.env); cleanup.push(() => resumed.close());
    expect(f.enrollments).toHaveLength(1);
  });

  it.each(['peer.forward', 'missing'] as const)('%s capability allows peer.forward and peer.control but denies execution', async capability => {
    const f = await fixture({ capability });
    f.localRequests.length = 0;
    const forward = vi.spyOn(PeerControlForwarder.prototype, 'forward');
    const response = await f.result(f.send(f.control));
    expect(forward).toHaveBeenCalledExactlyOnceWith(f.control);
    expect(response).toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    for (const command of [{ type: 'terminal.start' }, { type: 'host.list_loaded_environments' },
      { type: 'plugin.host.call' }, { type: 'future.command' }]) {
      expect(await f.result(f.send(command))).toMatchObject({ ok: false, error: { code: 'capability_denied' } });
    }
    expect(f.localRequests).toHaveLength(0);
    expect(await f.result(f.send(f.command))).toMatchObject({ ok: true });
  });

  it('validates allowed peer commands before dispatch under peer.forward capability', async () => {
    const f = await fixture({ capability: 'peer.forward' }); f.localRequests.length = 0;
    const forward = vi.spyOn(PeerControlForwarder.prototype, 'forward');
    for (const command of [
      { ...f.command, scope: undefined },
      { ...f.control, packet: { ...f.control.packet, route: '/secret' } },
      { ...f.control, extra: true }
    ]) expect(await f.result(f.send(command))).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await f.result(f.send(f.control, { extra: true })))
      .toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await f.result(f.send(f.control, { protocolVersion: HOST_RPC_PROTOCOL_VERSION - 1 })))
      .toMatchObject({ ok: false, error: { code: 'protocol_mismatch' } });
    expect(forward).not.toHaveBeenCalled();
    expect(await f.result(f.send({ ...f.control, packet: { ...f.control.packet, recipientId: randomUUID() } })))
      .toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    expect(f.localRequests).toHaveLength(0);
  });

  it('fails closed for unknown, unsupported, malformed, extra-field and obsolete RPC', async () => {
    const f = await fixture(); f.localRequests.length = 0;
    for (const [command, patch, code] of [
      [{ type: 'future.command' }, {}, 'invalid_request'],
      [{ type: 'provider.status' }, {}, 'unsupported_command'],
      [{ ...f.command, scope: undefined }, {}, 'invalid_request'],
      [{ ...f.command, url: 'http://evil.test/' }, {}, 'invalid_request'],
      [{ ...f.control, packet: { ...f.control.packet, route: '/secret' } }, {}, 'invalid_request'],
      [f.command, { protocolVersion: HOST_RPC_PROTOCOL_VERSION - 1 }, 'protocol_mismatch'],
      [f.command, { extra: true }, 'invalid_request']
    ] as const) expect(await f.result(f.send(command, patch))).toMatchObject({ ok: false, error: { code } });
    expect(f.localRequests).toHaveLength(0);
  });

  it('uses local data-dir fallback, validates identity, sanitizes transport errors and bounds reply IDs', async () => {
    const f = await fixture({ independent: false }); f.localRequests.length = 0;
    expect(await f.result(f.send(f.command))).toMatchObject({ ok: true });
    const before = f.localRequests.length;
    expect(await f.result(f.send({ ...f.control, packet: { ...f.control.packet, recipientId: randomUUID() } })))
      .toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    expect(f.localRequests).toHaveLength(before);
    f.raw(null); f.raw({ type: 'future.message' });
    f.send(f.command, { requestId: 'x'.repeat(129) });
    expect(await f.result('unknown'))
      .toMatchObject({ requestId: 'unknown', ok: false, error: { code: 'invalid_request' } });
    const mock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret-credential-body'));
    const result = await f.result(f.send(f.command));
    expect(result).toMatchObject({ ok: false, error: { code: 'peer_forward_failed', message: 'peer forwarding failed' } });
    expect(JSON.stringify(result)).not.toContain('secret-credential-body');
    mock.mockRestore();
  });

  it.each(['missing', 'unsafe'] as const)('fails closed for %s local registration', async mode => {
    const f = await fixture({ registered: mode !== 'missing' }); f.localRequests.length = 0;
    if (mode === 'unsafe') await chmod(join(f.localDir, 'peer-app', 'endpoint.json'), 0o644);
    expect(await f.result(f.send(f.command))).toMatchObject({ ok: false, error: { code: 'peer_app_unavailable' } });
    expect(await f.result(f.send(f.control))).toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    expect(f.localRequests).toHaveLength(0);
  });

  it.each(['redirect', 'size', 'utf8', 'timeout'] as const)('enforces real HTTP %s bounds for both transports', async mode => {
    const f = await fixture({ handler(req, res) {
      if (req.url === '/api/v1/peer-channel-register') { res.end('{}'); return; }
      if (mode === 'redirect') res.writeHead(302, { location: '/secret' }).end();
      if (mode === 'size') res.end(Buffer.alloc(req.url === PEER_CONTROL_ROUTE ? PEER_CONTROL_MAX_BYTES + 1 : PEER_FORWARD_MAX_BYTES + 1));
      if (mode === 'utf8') res.end(Buffer.from([0xff]));
    } });
    expect(await f.result(f.send({ ...f.command, timeoutMs: 100 }))).toMatchObject({ ok: false });
    expect(await f.result(f.send({ ...f.control, timeoutMs: 100 }))).toMatchObject({ ok: false });
    expect(f.localRequests.map(request => request.path)).not.toContain('/secret');
  });

  it('enforces byte/concurrency limits and releases pending work on disconnect', async () => {
    const f = await fixture({ handler(req, res) { if (req.url === '/api/v1/peer-channel-register') res.end('{}'); } });
    const body = '\u00e9'.repeat(PEER_FORWARD_MAX_BYTES / 2 + 1);
    expect(await f.result(f.send({ ...f.command, body }))).toMatchObject({ ok: false, error: { code: 'request_too_large' } });
    const pending = Array.from({ length: 4 }, () => f.send({ ...f.command, timeoutMs: 10_000 }));
    await vi.waitFor(() => expect(f.localRequests.filter(request => request.path === f.command.route)).toHaveLength(4));
    expect(await f.result(f.send(f.command))).toMatchObject({ ok: false, error: { code: 'peer_forward_busy' } });
    f.reconnect('peer.forward');
    await vi.waitFor(() => expect(f.hellos).toHaveLength(2), { timeout: 5000 });
    await vi.waitFor(async () => expect((await fetch(`http://127.0.0.1:${f.statusPort}/status`).then(res => res.json())).connected).toBe(true));
    expect(await f.result(f.send({ ...f.control, timeoutMs: 20 })))
      .toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    expect(await f.result(f.send({ type: 'provider.status' })))
      .toMatchObject({ ok: false, error: { code: 'capability_denied' } });
    expect(await f.result(f.send({ ...f.command, timeoutMs: 20 }))).toMatchObject({ ok: false, error: { code: 'peer_forward_timeout' } });
    for (const id of pending) expect(f.responses.has(id)).toBe(false);
    f.reconnect('execution');
    await vi.waitFor(() => expect(f.hellos).toHaveLength(3), { timeout: 5000 });
    await vi.waitFor(async () => expect((await fetch(`http://127.0.0.1:${f.statusPort}/status`).then(res => res.json())).connected).toBe(true));
    expect(await f.result(f.send({ ...f.control, timeoutMs: 20 })))
      .toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    expect(await f.result(f.send({ type: 'provider.status' })))
      .toMatchObject({ ok: false, error: { code: 'capability_denied' } });
  });

  it('rejects mismatched saved enrollment, missing auth and invalid arguments without leaving status listener', async () => {
    const f = await fixture(); await f.running.close();
    await expect(runJoinStandalone([...f.argv, '--auto-update'], { ...f.env, ZCC_DATA_DIR: '' })).rejects.toThrow('ZCC_DATA_DIR');
    await expect(runJoinStandalone(['join'], {})).rejects.toThrow('server-url');
    await expect(runJoinStandalone(['join', '--server-url', f.remote.url, '--host-daemon-port', '0'], f.env)).rejects.toThrow('host-daemon-port');
    await writeFile(join(f.dir, 'auth.json'), JSON.stringify({ hostId: randomUUID(), hostKey: 'k'.repeat(43) }));
    await expect(runJoinStandalone(f.argv, f.env)).rejects.toThrow('another server or host');
    await writeFile(join(f.dir, 'auth.json'), 'invalid-json');
    const argv = f.argv.filter((_value, index) => index !== 1 && index !== 2);
    await expect(runJoinStandalone(argv, f.env)).rejects.toThrow('auth.json is absent');
  });
});

// Source-only verification can opt out of rebuilding generated bundles.
describe.skipIf(process.env.ZCC_SKIP_JOIN_BUNDLE_TESTS === '1')('generated standalone bundle', () => {
  let run: typeof runJoinStandalone;
  let shim: { PROTOCOL_VERSION: number; runJoinStandalone: typeof runJoinStandalone };
  beforeAll(async () => {
    const out = await mkdtemp(join(tmpdir(), 'zcc-standalone-build-'));
    try {
      const build = spawnSync(process.execPath, ['apps/host-daemon/scripts/build-join.mjs', '--outfile', join(out, 'dist', 'join.mjs')],
        { cwd: new URL('../../../', import.meta.url), timeout: 60_000, encoding: 'utf8' });
      expect(build.status, build.stderr).toBe(0);
      const bundle = await import(/* @vite-ignore */ pathToFileURL(join(out, 'dist', 'join-standalone.mjs')).href);
      expect(bundle.PROTOCOL_VERSION).toBe(HOST_RPC_PROTOCOL_VERSION);
      run = bundle.runJoinStandalone;
      const shimSource = await readFile(new URL('./join-standalone.mjs', import.meta.url), 'utf8');
      expect(shimSource).toContain("from '../dist/join-standalone.mjs'");
      // Keep the production shim's exact relative import, but resolve it to this
      // private fresh bundle rather than shared dist output or Vitest's cache.
      await mkdir(join(out, 'src'));
      const shimPath = join(out, 'src', 'join-standalone.mjs');
      await writeFile(shimPath, shimSource);
      shim = await import(/* @vite-ignore */ pathToFileURL(shimPath).href);
    } finally { await rm(out, { recursive: true, force: true }); }
  }, 60_000);
  it('the source shim re-exports the generated bundle and stays inert when imported', async () => {
    expect(shim.PROTOCOL_VERSION).toBe(HOST_RPC_PROTOCOL_VERSION);
    expect(typeof shim.runJoinStandalone).toBe('function');
  }, 60_000);
  it('the shim runs the join when launched directly and closes it on SIGINT/SIGTERM', async () => {
    const close = vi.fn(async () => undefined), run = vi.fn(async () => ({ hostId: 'h', close }));
    vi.resetModules();
    vi.doMock('../dist/join-standalone.mjs', () => ({ PROTOCOL_VERSION: 1, runJoinStandalone: run }));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const argv = process.argv;
    try {
      // `join` is required: a bare launch of the file must not start a daemon.
      process.argv = [argv[0], '/x/join-standalone.mjs'];
      await import('./join-standalone.mjs?bare');
      expect(run).not.toHaveBeenCalled();
      process.argv = [argv[0], '/x/join-standalone.mjs', 'join'];
      await import('./join-standalone.mjs?direct');
      expect(run).toHaveBeenCalledTimes(1);
      process.emit('SIGTERM');
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      process.argv = argv;
      vi.doUnmock('../dist/join-standalone.mjs');
    }
  });
  it('built Node-only helper forwards and controls independent app, denies scoped execution', async () => {
    const full = await fixture({ run });
    expect(await full.result(full.send(full.command))).toMatchObject({ ok: true, result: { body: full.command.body } });
    expect(await full.result(full.send(full.control))).toMatchObject({ ok: true });
    expect(await full.result(full.send({ type: 'host.list_loaded_environments' }))).toMatchObject({ ok: false });
    const scoped = await fixture({ run, capability: 'peer.forward' });
    expect(await scoped.result(scoped.send(scoped.command))).toMatchObject({ ok: true });
    expect(await scoped.result(scoped.send(scoped.control))).toMatchObject({ ok: false, error: { code: 'peer_control_failed' } });
    expect(await scoped.result(scoped.send({ type: 'host.list_loaded_environments' })))
      .toMatchObject({ ok: false, error: { code: 'capability_denied' } });
    expect(scoped.localRequests.map(request => request.path)).toEqual([scoped.command.route]);
  });
});
