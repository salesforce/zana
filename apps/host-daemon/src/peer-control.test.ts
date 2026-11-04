import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, link, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PEER_CONTROL_MAX_BYTES, PEER_CONTROL_ROUTE } from '@zana-ai/zcc-contracts/host-rpc';
import { registerLocalPeerApp } from './peer-forward.js';
import { PeerControlForwarder } from './peer-control.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
/** Windows: no process.getuid, uid 0, and synthetic modes (directories 0o777/0o666, writable files 0o666). */
function simulateWindows(): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');
  Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
  cleanup.push(() => { if (getuid) Object.defineProperty(process, 'getuid', getuid); else delete (process as { getuid?: unknown }).getuid; });
}
async function fixture(handler?: (req: IncomingMessage, res: ServerResponse) => void) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'peer-control-daemon-')));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const localId = randomUUID(), remoteId = randomUUID(), hostId = randomUUID(), paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    if (handler) handler(req, res);
    else res.end(req.url === '/api/v1/peer-channel-register' ? '{"registered":true}' : 'x'.repeat(24_000));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const port = (server.address() as { port: number }).port;
  cleanup.push(await registerLocalPeerApp(dir, { port, instanceId: localId }));
  await writeFile(join(dir, 'host-enroll.token'), 't'.repeat(43), { mode: 0o600 });
  const peer = new PeerControlForwarder({ localAppDataDir: dir, hostId, hostKey: randomBytes(32).toString('base64url') });
  cleanup.push(async () => { peer.close(); await peer.whenIdle(); });
  await peer.hello(remoteId, 'execution');
  const command = { type: 'peer.control', timeoutMs: 1000, packet: { version: 1, senderId: remoteId, recipientId: localId,
    senderHostId: randomUUID(), recipientHostId: hostId, route: PEER_CONTROL_ROUTE,
    nonce: 'c'.repeat(48), issuedAt: Date.now(), sealed: 's'.repeat(43) } };
  return { dir, port, paths, localId, remoteId, hostId, peer, command };
}

it('reads the enrollment token under Windows-reported modes but still rejects a hard-linked token', async () => {
  simulateWindows();
  const f = await fixture((_req, res) => res.end('{}'));
  await chmod(f.dir, 0o777);
  await chmod(join(f.dir, 'peer-app'), 0o777);
  await chmod(join(f.dir, 'host-enroll.token'), 0o666);
  await expect(f.peer.forward(f.command)).resolves.toEqual({ status: 200, body: '{}' });
  expect(f.paths).toContain(PEER_CONTROL_ROUTE);
  await link(join(f.dir, 'host-enroll.token'), join(f.dir, 'token-copy'));
  f.paths.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(f.peer.forward(f.command)).rejects.toMatchObject({ code: 'peer_control_failed' });
  expect(console.warn).toHaveBeenCalledWith('[peer-control] forward failed: unsafe local app token');
  expect(f.paths).toEqual([]);
});

it('uses only registered loopback routes, preserves >8192 bytes, never sends plaintext credentials', async () => {
  const bodies: string[] = [], headers: IncomingMessage['headers'][] = [];
  const f = await fixture((req, res) => {
    headers.push(req.headers); let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { bodies.push(body); res.end(req.url === PEER_CONTROL_ROUTE ? 'x'.repeat(24_000) : '{}'); });
  });
  await expect(f.peer.forward(f.command)).resolves.toEqual({ status: 200, body: 'x'.repeat(24_000) });
  expect(f.paths).toEqual(['/api/v1/peer-channel-register', '/api/v1/peer-channel-register', PEER_CONTROL_ROUTE]);
  expect(JSON.parse(bodies[0]!)).toEqual({ sealed: expect.stringMatching(/^[A-Za-z0-9_-]+$/) });
  expect(bodies[0]).not.toContain('hostKey'); expect(bodies[0]).not.toContain('t'.repeat(43));
  expect(JSON.parse(bodies[2]!)).toEqual(f.command.packet);
  for (const header of headers) { expect(header.authorization).toBeUndefined(); expect(header.cookie).toBeUndefined(); }
});

it.each(['missing-config', 'missing-remote', 'unexpected-remote', 'self', 'sender', 'recipient', 'host', 'closed'])
  ('rejects %s before control dispatch', async mode => {
    const f = await fixture(); f.paths.length = 0;
    let peer = f.peer;
    if (mode === 'missing-config') { peer = new PeerControlForwarder({ hostId: f.hostId, hostKey: 'x'.repeat(32) }); cleanup.push(() => peer.close()); }
    if (mode === 'missing-remote') await peer.hello(undefined, undefined);
    if (mode === 'unexpected-remote') {
      peer = new PeerControlForwarder({ localAppDataDir: f.dir, hostId: f.hostId, hostKey: 'x'.repeat(32), expectedRemoteId: randomUUID() });
      cleanup.push(() => peer.close()); await peer.hello(f.remoteId, 'peer.forward');
    }
    if (mode === 'self') await peer.hello(f.localId, 'execution');
    if (mode === 'closed') peer.close();
    const packet = { ...f.command.packet,
      senderId: mode === 'sender' ? randomUUID() : f.command.packet.senderId,
      recipientId: mode === 'recipient' ? randomUUID() : f.command.packet.recipientId,
      recipientHostId: mode === 'host' ? randomUUID() : f.command.packet.recipientHostId };
    await expect(peer.forward({ ...f.command, packet })).rejects.toThrow();
    expect(f.paths).toEqual([]);
  });

it.each(['unsafe-mode', 'symlink', 'oversized', 'short', 'missing'])('fails closed for %s local token', async mode => {
  const f = await fixture(), file = join(f.dir, 'host-enroll.token'); f.paths.length = 0;
  if (mode === 'unsafe-mode') await chmod(file, 0o644);
  if (mode === 'oversized') await writeFile(file, 'x'.repeat(513));
  if (mode === 'short') await writeFile(file, 'short');
  if (mode === 'missing' || mode === 'symlink') await rm(file);
  if (mode === 'symlink') { await writeFile(join(f.dir, 'other'), 'x'.repeat(43), { mode: 0o600 }); await symlink(join(f.dir, 'other'), file); }
  await expect(f.peer.forward(f.command)).rejects.toMatchObject({ code: 'peer_control_failed' });
  expect(f.paths).toEqual([]);
});

it.each(['redirect', 'registration-error', 'oversized', 'utf8'])('rejects real HTTP %s and never follows redirects', async mode => {
  const f = await fixture((req, res) => {
    if (mode === 'registration-error') { res.writeHead(403).end(); return; }
    if (req.url !== PEER_CONTROL_ROUTE) { res.end('{}'); return; }
    if (mode === 'redirect') res.writeHead(302, { location: '/secret' }).end();
    if (mode === 'oversized') res.end(Buffer.alloc(PEER_CONTROL_MAX_BYTES + 1, 'x'));
    if (mode === 'utf8') res.end(Buffer.from([0xff]));
  });
  await expect(f.peer.forward(f.command)).rejects.toMatchObject({ code: 'peer_control_failed' });
  expect(f.paths).not.toContain('/secret');
});

it('rejects transport redirect mismatches and empty bodies remain valid', async () => {
  const f = await fixture();
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const response = new Response(null, { status: 204 });
    Object.defineProperty(response, 'url', { value: String(input) }); return response;
  });
  await expect(f.peer.forward(f.command)).rejects.toThrow(); // registration must succeed first
  mock.mockImplementation(async input => {
    const response = new Response(null, { status: String(input).endsWith(PEER_CONTROL_ROUTE) ? 204 : 200 });
    Object.defineProperty(response, 'url', { value: String(input) }); return response;
  });
  await expect(f.peer.forward(f.command)).resolves.toEqual({ status: 204, body: '' });
  mock.mockImplementation(async () => {
    const response = new Response('redirect'); Object.defineProperty(response, 'url', { value: 'http://evil.test/' }); return response;
  });
  await expect(f.peer.forward(f.command)).rejects.toThrow();
});

it('timeout, cancellation and close abort pending HTTP; concurrency slots recover', async () => {
  const f = await fixture((req, res) => { if (req.url !== PEER_CONTROL_ROUTE) res.end('{}'); });
  await expect(f.peer.forward({ ...f.command, timeoutMs: 20 })).rejects.toMatchObject({ code: 'peer_control_failed' });
  const pending = Array.from({ length: 4 }, () => f.peer.forward(f.command).then(() => false, () => true));
  await vi.waitFor(() => expect(f.paths.filter(path => path === PEER_CONTROL_ROUTE).length).toBeGreaterThanOrEqual(4));
  await expect(f.peer.forward(f.command)).rejects.toMatchObject({ code: 'peer_control_unavailable' });
  f.peer.cancelAll(); expect(await Promise.all(pending)).toEqual([true, true, true, true]);
  const next = f.peer.forward(f.command).then(() => false, () => true);
  await vi.waitFor(() => expect(f.paths.filter(path => path === PEER_CONTROL_ROUTE).length).toBeGreaterThanOrEqual(5));
  f.peer.close(); expect(await next).toBe(true);
  await expect(f.peer.forward(f.command)).rejects.toMatchObject({ code: 'peer_control_unavailable' });
});

it.each(['hello', 'forward'])('idle waits for cancelled %s registration cleanup', async operation => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let signal: AbortSignal | undefined;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) => {
    signal = options?.signal as AbortSignal;
    await held;
    signal.throwIfAborted();
    throw new Error('unexpected transport success');
  });
  const pending = (operation === 'hello' ? f.peer.hello(f.remoteId, 'execution') : f.peer.forward(f.command)).catch(() => undefined);
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    f.peer.close(); expect(signal?.aborted).toBe(true);
    let idle = false;
    const closing = f.peer.whenIdle().then(() => { idle = true; });
    await Promise.resolve(); expect(idle).toBe(false);
    release(); await closing; await pending;
    await expect(f.peer.forward(f.command)).rejects.toMatchObject({ code: 'peer_control_unavailable' });
  } finally { release(); await pending; }
});

it('forward-only links register and carry control; an unknown capability string stays closed', async () => {
  const f = await fixture(); f.paths.length = 0;
  const peer = new PeerControlForwarder({ localAppDataDir: f.dir, hostId: f.hostId, hostKey: 'x'.repeat(32), expectedRemoteId: f.remoteId });
  cleanup.push(() => peer.close());
  await peer.hello(f.remoteId, 'peer.forward');
  expect(f.paths).toEqual(['/api/v1/peer-channel-register']);
  await expect(peer.forward(f.command)).resolves.toMatchObject({ status: 200 });
  await peer.hello(f.remoteId, 'other' as never); f.paths.length = 0;
  await expect(peer.forward(f.command)).rejects.toThrow();
  expect(f.paths).toEqual([]);
});

it('an unpinned forward-only link never registers or carries control', async () => {
  const f = await fixture(); f.paths.length = 0;
  const peer = new PeerControlForwarder({ localAppDataDir: f.dir, hostId: f.hostId, hostKey: 'x'.repeat(32) });
  cleanup.push(() => peer.close());
  await peer.hello(f.remoteId, 'peer.forward');
  await expect(peer.forward(f.command)).rejects.toThrow();
  expect(f.paths).toEqual([]);
});

it('logs the cause of a sanitized control failure without leaking it to the caller', async () => {
  const f = await fixture(); f.paths.length = 0;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failure = f.peer.forward({ ...f.command, packet: { ...f.command.packet, senderId: randomUUID() } });
  await expect(failure).rejects.toMatchObject({ code: 'peer_control_failed', message: 'peer control unavailable or not authorized' });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[peer-control] forward failed: peer control destination mismatch'));
});
