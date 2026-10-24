import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginPeerRequest } from '@zana-ai/zcc-plugin-sdk/server';
import { handlePeerApi, MAX_INBOUND_PEER_REQUESTS, PEER_BODY_READ_TIMEOUT_MS } from './peer-api.js';
import { PairStore } from '../services/peers/pair-store.js';
import { MAX_PEER_BODY_BYTES, type PeerRequestEnvelope } from '../services/peers/peer-auth.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  try { for (const close of cleanup.splice(0).reverse()) await close(); }
  finally { vi.restoreAllMocks(); }
});

async function incompleteRequest(target: string, envelope: PeerRequestEnvelope) {
  const url = new URL(target);
  const socket = connect({ host: url.hostname, port: Number(url.port) });
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  socket.on('error', () => {});
  cleanup.push(async () => { socket.destroy(); await closed; });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write([
    `POST ${url.pathname} HTTP/1.1`, `Host: ${url.host}`, 'Connection: close',
    'Content-Type: application/json', `Content-Length: ${MAX_PEER_BODY_BYTES}`,
    `X-Zcc-Peer-Envelope: ${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`,
    '', '{'
  ].join('\r\n'));
  return { socket, closed };
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'zana-peer-api-')));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const keyProvider = { getKey: async () => Buffer.alloc(32, 1) };
  const authority = {};
  const authorizeTransfer = async (context: unknown) => context === authority ? Buffer.alloc(32, 2) : null;
  const sender = new PairStore(join(directory, 'sender'), { localInstanceId: 'sender-a', keyProvider, authorizeTransfer });
  const options = { localInstanceId: 'recipient-b', keyProvider, authorizeTransfer };
  let pairs = new PairStore(join(directory, 'receiver'), options);
  const grant = { pairId: 'pair-a', localInstanceId: 'sender-a', remoteInstanceId: 'recipient-b',
    pluginId: 'plugin-a', scope: 'opaque-scope', targetHostId: 'host-b', epoch: 1, proposalId: 'proposal-a' };
  await sender.propose(grant);
  await pairs.importCredential({ ...grant, localInstanceId: 'recipient-b', remoteInstanceId: 'sender-a', targetHostId: 'host-a' },
    await sender.exportCredential(grant.pairId, authority), authority);
  await sender.activate('pair-a', 'proposal-a', 1);
  await pairs.activate('pair-a', 'proposal-a', 1);
  const dispatchPeer = vi.fn(async (_pluginId: string, _method: string, request: PluginPeerRequest): Promise<unknown> =>
    ({ peerId: request.peerId, body: request.body, scope: request.scope, grantEpoch: request.grantEpoch }));
  const ctx = { peerPairs: pairs, plugins: { dispatchPeer } };
  const handled = vi.fn();
  const server = createServer(async (request, response) => {
    try {
      if (!await handlePeerApi(request, response, ctx as never, new URL(request.url ?? '/', 'http://127.0.0.1').pathname, request.method ?? 'GET')) {
        response.writeHead(404).end();
      }
    } catch { response.writeHead(500).end(); }
    finally { handled(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { pairs.dispose(); sender.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/peer/plugin-a/handshake`;
  async function packet(body = '{}') {
    const envelope = (await sender.signRequest('pair-a', { pluginId: 'plugin-a', scope: grant.scope, method: 'handshake', body: Buffer.from(body) }))!;
    return { envelope, body };
  }
  function send(packet: { envelope: PeerRequestEnvelope; body: string }, target = url, method = 'POST') {
    return fetch(target, { method, headers: { 'content-type': 'application/json',
      'x-zcc-peer-envelope': Buffer.from(JSON.stringify(packet.envelope)).toString('base64url') }, body: packet.body });
  }
  return { sender, get pairs() { return pairs; }, dispatchPeer, handled, url, packet, send,
    removePlugins: () => { (ctx as { plugins?: unknown }).plugins = undefined; },
    restart: () => { pairs.dispose(); pairs = new PairStore(join(directory, 'receiver'), options); ctx.peerPairs = pairs; } };
}

describe('peer API canonical authorization', () => {
  it('authenticates exact packet and supplies public identity plus revocation fence, never credentials', async () => {
    const peer = await fixture();
    let request!: PluginPeerRequest;
    peer.dispatchPeer.mockImplementation(async (_plugin, _method, received) => {
      request = received;
      return received.commitSync(() => ({ peerId: received.peerId, body: received.body }));
    });
    const response = await peer.send(await peer.packet('{"value":"hello"}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { peerId: 'sender-a', body: { value: 'hello' } } });
    expect(Object.keys(request).sort()).toEqual(['body', 'commitSync', 'grantEpoch', 'peerId', 'scope', 'signal']);
    await expect(request.commitSync(() => true)).rejects.toThrow('no longer active');
  });

  it('durably rejects authenticated replay across app restart before dispatch', async () => {
    const peer = await fixture(), packet = await peer.packet();
    expect((await peer.send(packet)).status).toBe(200);
    peer.restart();
    expect((await peer.send(packet)).status).toBe(401);
    expect(peer.dispatchPeer).toHaveBeenCalledOnce();
  });

  it.each(['pairId', 'senderId', 'recipientId', 'pluginId', 'scope', 'route', 'nonce', 'signature', 'payloadHash', 'epoch', 'issuedAt'] as const)
    ('rejects signed %s substitution before dispatch', async field => {
      const peer = await fixture(), packet = await peer.packet();
      const patches = { pairId: 'pair-other', senderId: 'sender-other', recipientId: 'recipient-other', pluginId: 'other-plugin',
        scope: 'other-scope', route: '/api/v1/peer/plugin-a/other-method', nonce: 'r'.repeat(32), signature: 'b'.repeat(43),
        payloadHash: 'a'.repeat(64), epoch: 2, issuedAt: packet.envelope.issuedAt - 1 };
      const response = await peer.send({ ...packet, envelope: { ...packet.envelope, [field]: patches[field] } });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(peer.dispatchPeer).not.toHaveBeenCalled();
    });

  it('rejects changed bytes, invalid JSON, unknown envelope fields and invalid encoding', async () => {
    const peer = await fixture(), packet = await peer.packet();
    expect((await peer.send({ ...packet, body: '{"changed":true}' })).status).toBe(401);
    expect((await peer.send(await peer.packet('invalid JSON'))).status).toBe(400);
    expect((await peer.send({ ...packet, envelope: { ...packet.envelope, secret: 'forbidden' } as never })).status).toBe(400);
    expect((await fetch(peer.url, { method: 'POST', headers: { 'x-zcc-peer-envelope': '!!!' }, body: '{}' })).status).toBe(400);
    expect((await fetch(peer.url, { method: 'POST', headers: { authorization: 'daemon-token' }, body: '{}' })).status).toBe(400);
    expect(peer.dispatchPeer).not.toHaveBeenCalled();
  });

  it.each(['?query=1', '%2fextra', '/extra'])('rejects noncanonical route %s', async suffix => {
    const peer = await fixture();
    expect((await peer.send(await peer.packet(), peer.url + suffix)).status).toBe(400);
    expect(peer.dispatchPeer).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods and oversized request/response bodies', async () => {
    const peer = await fixture();
    expect((await peer.send(await peer.packet(), peer.url, 'PUT')).status).toBe(405);
    const packet = await peer.packet();
    expect((await peer.send({ ...packet, body: 'x'.repeat(8 * 1024 * 1024 + 1) })).status).toBe(413);
    peer.dispatchPeer.mockResolvedValue('x'.repeat(8 * 1024 * 1024));
    expect((await peer.send(await peer.packet())).status).toBe(413);
  });

  it('cancels in-flight dispatch and refuses transaction after revoke', async () => {
    const peer = await fixture();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const committed = vi.fn();
    let request!: PluginPeerRequest;
    peer.dispatchPeer.mockImplementation(async (_plugin, _method, value) => {
      request = value;
      entered();
      await new Promise<void>(resolve => value.signal.addEventListener('abort', () => resolve(), { once: true }));
      return value.commitSync(committed);
    });
    const response = peer.send(await peer.packet());
    await ready;
    await peer.pairs.revoke('pair-a');
    expect((await response).status).toBe(409);
    expect(request.signal.aborted).toBe(true);
    expect(committed).not.toHaveBeenCalled();
    expect((await peer.send(await peer.packet())).status).toBe(401);
  });

  it('rejects declared async commits before invoking mutation', async () => {
    const peer = await fixture(), mutate = vi.fn();
    peer.dispatchPeer.mockImplementation(async (_plugin, _method, request) => request.commitSync((async () => mutate()) as never));
    expect((await peer.send(await peer.packet())).status).toBe(409);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('bounds concurrent dispatch before allocating more request bodies', async () => {
    const peer = await fixture();
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    peer.dispatchPeer.mockImplementation(async () => { await held; return true; });
    const packets = await Promise.all(Array.from({ length: 5 }, () => peer.packet()));
    const operations = packets.slice(0, 4).map(packet => peer.send(packet));
    try {
      await vi.waitFor(() => expect(peer.dispatchPeer).toHaveBeenCalledTimes(4));
      const response = await peer.send(packets[4]!);
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ ok: false, code: 'peer-request-busy' });
    } finally { finish(); await Promise.all(operations); }
  });

  it('reserves four incomplete unknown-pair bodies process-wide, rejects a fifth before auth, and releases on disconnect', async () => {
    const first = await fixture(), second = await fixture();
    const envelope = { ...(await first.packet()).envelope, pairId: 'pair-unknown' };
    const firstAuth = vi.spyOn(first.pairs, 'authenticateRequest');
    const secondAuth = vi.spyOn(second.pairs, 'authenticateRequest');
    const allocate = vi.spyOn(Buffer, 'allocUnsafe');
    const bodyAllocations = () => allocate.mock.calls.map(([size]) => size).filter(size => size >= MAX_PEER_BODY_BYTES);
    const requests: Awaited<ReturnType<typeof incompleteRequest>>[] = [];
    try {
      expect(MAX_INBOUND_PEER_REQUESTS).toBe(4);
      expect(MAX_PEER_BODY_BYTES).toBe(8 * 1024 * 1024);
      for (const peer of [first, second, first, second]) {
        requests.push(await incompleteRequest(peer.url, envelope));
        await vi.waitFor(() => expect(bodyAllocations()).toHaveLength(requests.length));
      }
      expect(bodyAllocations()).toEqual(Array(4).fill(8 * 1024 * 1024));
      expect(bodyAllocations().reduce((total, size) => total + size, 0)).toBe(32 * 1024 * 1024);
      expect(first.handled).not.toHaveBeenCalled();
      expect(second.handled).not.toHaveBeenCalled();
      const response = await fetch(second.url, { method: 'POST', body: '{}' });
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ ok: false, code: 'peer-request-busy' });
      expect(bodyAllocations()).toHaveLength(4);
      expect(firstAuth).not.toHaveBeenCalled();
      expect(secondAuth).not.toHaveBeenCalled();
      expect(first.dispatchPeer).not.toHaveBeenCalled();
      expect(second.dispatchPeer).not.toHaveBeenCalled();

      requests[0]!.socket.destroy();
      await requests[0]!.closed;
      await vi.waitFor(() => expect(first.handled).toHaveBeenCalledOnce());
      expect(firstAuth).not.toHaveBeenCalled();
      const good = await first.send(await first.packet('{"afterDisconnect":true}'));
      expect(good.status).toBe(200);
      expect(await good.json()).toEqual({ ok: true, result: {
        peerId: 'sender-a', body: { afterDisconnect: true }, scope: 'opaque-scope', grantEpoch: 1
      } });
      expect(firstAuth).toHaveBeenCalledOnce();
      expect(secondAuth).not.toHaveBeenCalled();
      expect(bodyAllocations()).toEqual(Array(5).fill(MAX_PEER_BODY_BYTES));
      expect(await first.pairs.grant('pair-unknown')).toBeNull();
      expect(await second.pairs.grant('pair-unknown')).toBeNull();
    } finally {
      for (const request of requests) request.socket.destroy();
      await Promise.all(requests.map(request => request.closed));
      await vi.waitFor(() => {
        expect(first.handled.mock.calls.length + second.handled.mock.calls.length).toBe(requests.length + 2);
      });
    }
  });

  it('expires an incomplete body at the 15-second deadline despite trickle traffic, then admits a valid request', async () => {
    const peer = await fixture();
    const packet = await peer.packet();
    const authenticate = vi.spyOn(peer.pairs, 'authenticateRequest');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const slow = await incompleteRequest(peer.url, packet.envelope);
    const trickle = setInterval(() => slow.socket.write(' '), 1000);
    try {
      expect(PEER_BODY_READ_TIMEOUT_MS).toBe(15_000);
      await vi.waitFor(() => expect(timers.mock.calls.filter(([, delay]) => delay === 15_000)).toHaveLength(1));
      vi.advanceTimersByTime(PEER_BODY_READ_TIMEOUT_MS);
      await slow.closed;
      await vi.waitFor(() => expect(peer.handled).toHaveBeenCalledOnce());
      expect(authenticate).not.toHaveBeenCalled();
      expect(peer.dispatchPeer).not.toHaveBeenCalled();
      const response = await peer.send(await peer.packet('{"afterDeadline":true}'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, result: {
        peerId: 'sender-a', body: { afterDeadline: true }, scope: 'opaque-scope', grantEpoch: 1
      } });
      expect(authenticate).toHaveBeenCalledOnce();
      expect(peer.dispatchPeer).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      clearInterval(trickle);
      slow.socket.destroy();
      await slow.closed;
      await vi.waitFor(() => expect(peer.handled).toHaveBeenCalledTimes(2));
    }
  });

  it('accepts exactly 8 MiB but rejects chunked overflow before authentication', async () => {
    const peer = await fixture();
    peer.dispatchPeer.mockResolvedValue(true);
    const body = `"${'x'.repeat(MAX_PEER_BODY_BYTES - 2)}"`;
    const packet = await peer.packet(body);
    expect((await peer.send(packet)).status).toBe(200);
    const authenticate = vi.spyOn(peer.pairs, 'authenticateRequest');
    const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = httpRequest(peer.url, { method: 'POST', headers: {
        'content-type': 'application/json', 'transfer-encoding': 'chunked',
        'x-zcc-peer-envelope': Buffer.from(JSON.stringify(packet.envelope)).toString('base64url')
      } }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      cleanup.push(async () => { request.destroy(); });
      request.on('error', reject);
      request.write(body);
      request.end('x');
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ ok: false, code: 'peer-body-too-large' });
    expect(authenticate).not.toHaveBeenCalled();
    expect(peer.dispatchPeer).toHaveBeenCalledOnce();
    expect((await peer.send(await peer.packet())).status).toBe(200);
  });

  it('handles unavailable key/auth storage and rejected handler without leaking error text', async () => {
    const peer = await fixture();
    peer.dispatchPeer.mockRejectedValue(new Error('secret packet details'));
    expect(await (await peer.send(await peer.packet())).json()).toEqual({ ok: false, code: 'peer-request-rejected' });
    peer.pairs.dispose();
    const response = await peer.send(await peer.packet());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'peer-auth-unavailable' });
  });

  it('returns unknown method when plugin service is unavailable', async () => {
    const peer = await fixture(); peer.removePlugins();
    const response = await peer.send(await peer.packet());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: 'unknown-peer-method' });
    expect(peer.dispatchPeer).not.toHaveBeenCalled();
  });
});
