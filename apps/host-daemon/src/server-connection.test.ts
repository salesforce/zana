import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { startEnrolledHostConnection } from './server-connection.js';
import type { CommandRuntime } from './command-dispatch.js';
import { MachineEnvironment } from './machine-environment.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const instanceId = '22222222-2222-4222-8222-222222222222';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllGlobals(); });
async function fixture(connectCredential?: string, helloCapability?: 'execution' | 'peer.forward', productInstanceId?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-reconnect-'));
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  let failures = 0; let upgrades = 0; let status = 503;
  let accepted: WebSocket;
  const requests: Array<{ url: string; headers: import('node:http').IncomingHttpHeaders }> = [];
  const hellos: any[] = [];
  const messages: any[] = [];
  const sockets = new Set<import('node:stream').Duplex>();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => {
    upgrades++;
    requests.push({ url: request.url!, headers: request.headers });
    if (failures-- > 0) { socket.end(`HTTP/1.1 ${status} Failure\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      accepted = ws;
      ws.on('message', raw => {
        const message = JSON.parse(String(raw));
        messages.push(message);
        if (message.type === 'host.hello') {
          hellos.push(message);
          ws.send(JSON.stringify({ type: 'host.hello-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId,
            enrollmentCapability: helloCapability, productInstanceId, pluginHostGenerations: [{ pluginId: 'test', generation: 'current' }] }));
        }
        if (message.type === 'host.ready') ws.send(JSON.stringify({ type: 'host.ready-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId: message.instanceId }));
        if (message.type === 'host.event') ws.send(JSON.stringify({ type: 'host.event-ack', protocolVersion: HOST_RPC_PROTOCOL_VERSION, batchId: message.batchId, accepted: message.events.length, rejected: [] }));
        if (message.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      });
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  cleanup.push(async () => {
    for (const socket of wss.clients) socket.terminate();
    for (const socket of sockets) socket.destroy();
    wss.close(); await new Promise<void>(r => server.close(() => r())); rmSync(dataDir, { recursive: true, force: true });
  });
  const reconcile = vi.fn(async () => {});
  const runtime = { dataDir, environments: new Map(), threads: new Map(), terminals: new Map(), provisionSignals: new Map(), lanes: new Map(),
    loadConfig: () => ({}), verifyProviders: async () => ({ providers: [] }), emit: () => {}, pluginHosts: { reconcileGenerations: reconcile } } as unknown as CommandRuntime;
  const changes: boolean[] = [];
  const connect = (enrollmentCapability?: 'execution' | 'peer.forward', expectedRemoteInstanceId?: string) => {
    const connection = startEnrolledHostConnection({ serverUrl: `http://127.0.0.1:${(server.address() as any).port}/t/zcrs_abcdefghijklmnop`, hostId, instanceId,
      hostKey: 'secret-machine-key', connectCredential, runtime, dataDir, enrollmentCapability, expectedRemoteInstanceId, onConnectionChange: value => changes.push(value) });
    void connection.ready.catch(() => {}); cleanup.push(() => connection.close()); return connection;
  };
  return { runtime, connect, changes, hellos, reconcile, requests, messages, send: (message: unknown) => accepted.send(JSON.stringify(message)), get upgrades() { return upgrades; },
    rejectNext: (count = 1, code = 503) => { failures = count; status = code; }, drop: () => accepted.terminate() };
}

describe('enrolled host with BB ws transport', () => {
  it('authenticated hello narrows execution even without local capability metadata', async () => {
    const f = await fixture(undefined, 'peer.forward'), connection = f.connect(); await connection.ready;
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.messages.find(m => m.type === 'host.ready').runtime).toEqual({ threads: [], loadedEnvironments: [] });
    f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'denied', command: { type: 'provider.status' } });
    await vi.waitFor(() => expect(f.messages.find(m => m.requestId === 'denied')).toMatchObject({ ok: false, error: { code: 'capability_denied' } }));
  });
  it('replies invalid_request to a malformed peer.control request instead of dropping it', async () => {
    const f = await fixture(), connection = f.connect(); await connection.ready;
    f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'bad-control', command: { type: 'peer.control' } });
    await vi.waitFor(() => expect(f.messages.find(m => m.requestId === 'bad-control')).toMatchObject({ ok: false, error: { code: 'invalid_request' } }));
  });
  it('closes an introduced link whose server identifies as a different app, before ready', async () => {
    const expected = '33333333-3333-4333-8333-333333333333';
    const wrong = await fixture(undefined, 'peer.forward', '44444444-4444-4444-8444-444444444444');
    wrong.connect('peer.forward', expected);
    await vi.waitFor(() => expect(wrong.hellos).toHaveLength(1));
    await vi.waitFor(() => expect(wrong.changes.at(-1)).toBe(false));
    expect(wrong.messages.some(m => m.type === 'host.ready')).toBe(false);
    const right = await fixture(undefined, 'peer.forward', expected), connection = right.connect('peer.forward', expected);
    await connection.ready;
    expect(right.messages.some(m => m.type === 'host.ready')).toBe(true);
  });
  it('denies every execution command for a peer.forward enrollment before dispatch', async () => {
    const f = await fixture(), connection = f.connect('peer.forward'); await connection.ready;
    expect(f.reconcile).not.toHaveBeenCalled();
    for (const type of ['provider.status', 'thread.start', 'host.read_file', 'terminal.start', 'plugin.host.call', 'project.catalogue.list', 'project.catalogue.register']) {
      f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: type, command: { type } });
      await vi.waitFor(() => expect(f.messages.find(m => m.requestId === type)).toMatchObject({ ok: false, error: { code: 'capability_denied' } }));
    }
    f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'forward', command: { type: 'peer.forward' } });
    await vi.waitFor(() => expect(f.messages.find(m => m.requestId === 'forward')).toMatchObject({ ok: false, error: { code: 'unknown_command' } }));
    expect(f.messages.filter(m => m.type === 'host.event').flatMap(m => m.events).some(event => event.kind === 'project.catalogue.changed')).toBe(false);
  });
  it.each([undefined, 'c'.repeat(43)])('reconnects after a failed upgrade with the same identity (Connect credential=%s)', async credential => {
    // The affected Node 22 native WebSocket never emits close for a failed
    // upgrade. Prove the production path never calls that implementation.
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('native WebSocket must not be used'); } });
    const f = await fixture(credential); const connection = f.connect(); await connection.ready;
    expect(f.changes).toEqual([true]);
    f.rejectNext(); f.drop();
    await vi.waitFor(() => expect(f.hellos).toHaveLength(2), { timeout: 8000 });
    await vi.waitFor(() => expect(f.changes).toEqual([true, false, true]));
    expect(f.upgrades).toBe(3);
    expect(f.hellos[1]).toEqual(f.hellos[0]);
    expect(f.reconcile).toHaveBeenCalledTimes(2);
    for (const request of f.requests) {
      expect(request.url).toBe('/t/zcrs_abcdefghijklmnop/internal/hosts/ws');
      expect(request.headers.authorization).toBe('Bearer secret-machine-key');
      expect(request.headers['x-zcc-host-id']).toBe(hostId);
      expect(request.headers['x-zcc-machine-credential']).toBe(credential);
    }
  }, 12000);
  it('retries a transient initial upgrade failure without settling ready early', async () => {
    const f = await fixture(); f.rejectNext(); const connection = f.connect();
    await connection.ready;
    expect(f.upgrades).toBe(2); expect(f.changes).toEqual([true]);
  });
  it('dispatches RPC and flushes acknowledged events only after readiness, including reconnect', async () => {
    const f = await fixture(); const connection = f.connect();
    connection.runtime.emit({ kind: 'terminal.output', terminalId: instanceId, payload: { data: 'before ready' } });
    await connection.ready;
    await connection.sink.flush();
    expect(f.messages.findIndex(m => m.type === 'host.ready')).toBeLessThan(f.messages.findIndex(m => m.type === 'host.event'));
    f.send(null); f.send({ type: 'unrecognized' });
    f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'provider-check', command: { type: 'provider.status' } });
    await vi.waitFor(() => expect(f.messages.find(m => m.requestId === 'provider-check')).toMatchObject({ type: 'host-rpc.response', ok: true }));
    f.rejectNext(); f.drop();
    await vi.waitFor(() => expect(f.changes.at(-1)).toBe(false));
    connection.runtime.emit({ kind: 'terminal.output', terminalId: instanceId, payload: { data: 'while offline' } });
    await vi.waitFor(() => expect(f.changes.at(-1)).toBe(true), { timeout: 8000 });
    await connection.sink.flush();
    const events = f.messages.filter(m => m.type === 'host.event').flatMap(m => m.events);
    expect(events.filter(event => event.kind === 'terminal.output').map(event => event.payload.data)).toEqual(['before ready', 'while offline']);
    expect(events.some(event => event.kind === 'project.catalogue.changed')).toBe(true);
  }, 12000);
  it('holds server-pushed environment only while the session is open', async () => {
    const f = await fixture();
    const target: NodeJS.ProcessEnv = {};
    f.runtime.machineEnvironment = new MachineEnvironment(target);
    const connection = f.connect(); await connection.ready;
    f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'env-push',
      command: { type: 'host.environment.replace', entries: [{ name: 'FORWARDED_TEST_TOKEN', value: 'secret-value' }] } });
    await vi.waitFor(() => expect(f.messages.find(m => m.requestId === 'env-push')).toMatchObject({ ok: true }));
    expect(f.messages.find(m => m.requestId === 'env-push')?.result).toEqual({ applied: ['FORWARDED_TEST_TOKEN'], skipped: [] });
    expect(JSON.stringify(f.messages.find(m => m.requestId === 'env-push'))).not.toContain('secret-value');
    expect(target.FORWARDED_TEST_TOKEN).toBe('secret-value');
    f.rejectNext(); f.drop();
    await vi.waitFor(() => expect(f.changes.at(-1)).toBe(false));
    expect(target.FORWARDED_TEST_TOKEN).toBeUndefined();
    await vi.waitFor(() => expect(f.changes.at(-1)).toBe(true), { timeout: 8000 });
    f.send({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'env-push-2',
      command: { type: 'host.environment.replace', entries: [{ name: 'FORWARDED_TEST_TOKEN', value: 'second' }] } });
    await vi.waitFor(() => expect(target.FORWARDED_TEST_TOKEN).toBe('second'));
    await connection.close();
    expect(target.FORWARDED_TEST_TOKEN).toBeUndefined();
  }, 12000);
  it('rejects authentication failures and cancels retries on shutdown', async () => {
    const f = await fixture(); f.rejectNext(1, 401); const connection = f.connect();
    const closeTunnels = vi.fn();
    connection.runtime.peerSsh = { close: closeTunnels } as any;
    await expect(connection.ready).rejects.toThrow('rejected credentials (401)');
    await connection.close(); await new Promise(r => setTimeout(r, 1200));
    expect(f.upgrades).toBe(1);
    expect(closeTunnels).toHaveBeenCalledOnce();
  });
});
