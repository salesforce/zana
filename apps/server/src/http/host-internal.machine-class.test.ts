import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getHost, upsertHost } from '@zana-ai/zcc-db';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { hashHostKey } from './host-hub.js';
import { handleHostInternalHttp, handleHostInternalUpgrade, MAX_ENROLL_RECOVERIES } from './host-internal.js';
import { createHmac } from 'node:crypto';

vi.mock('@zana-ai/zcc-db', async original => ({ ...await original<object>(), getHost: vi.fn(), upsertHost: vi.fn() }));

const instanceId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const otherHost = '33333333-3333-4333-8333-333333333333';
const joinCode = 'zcde_join-code';
const hostKey = 'fixture-host-key';
const machine = { 'x-zcc-connect-machine-host': hostId, 'x-zcc-connect-machine-instance': instanceId };
const forwardKey = (code: string) => createHmac('sha256', code).update(`connect-host:${instanceId}`).digest('base64url');
const enrollBody = { protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostName: 'peer', instanceId: '66666666-6666-4666-8666-666666666666', homeDir: '/home/peer' };

function fixture(capability: 'execution' | 'peer.forward' = 'peer.forward') {
  const record = { joinCode, hostId, expiresAt: Date.now() + 60_000, enrollmentCapability: capability, redeemedAt: null };
  const joinCodes = { peek: vi.fn((token: string) => token === joinCode ? record : null), redeem: vi.fn(() => record), recovered: vi.fn(() => null),
    inspect: vi.fn(() => ({ ok: false as const, reason: 'missing' as const })) };
  const session = { socket: { close: vi.fn() } };
  const ctx = {
    db: { sqlite: { transaction: (fn: () => unknown) => () => fn() } },
    config: { getConfig: () => ({}) },
    joinCodes, enrollToken: 'loopback-enroll-token', productInstanceId: instanceId,
    hostHub: { getSession: vi.fn(() => session), detach: vi.fn(), acceptHello: vi.fn(() => true) },
    hub: { emit: vi.fn() }
  };
  return { ctx, joinCodes };
}
function post(url: string, headers: Record<string, string>, body: unknown = enrollBody): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', url, headers: { host: '127.0.0.1:8780', 'content-type': 'application/json', ...headers } }) as IncomingMessage;
}
async function send(ctx: unknown, req: IncomingMessage) {
  const captured = { status: 0, body: undefined as any };
  const res = Object.assign(new EventEmitter(), { destroyed: false, writeHead(status: number) { captured.status = status; return res; }, end(body?: string) { captured.body = body ? JSON.parse(body) : undefined; }, getHeader() {}, setHeader() {} });
  await handleHostInternalHttp(req, res as unknown as ServerResponse, ctx as never);
  return captured;
}
function upgrade(ctx: unknown, headers: Record<string, string>) {
  const written: string[] = [];
  const socket = { write: (value: string) => { written.push(value); return true; }, destroy: vi.fn() } as unknown as Duplex;
  const wss = { handleUpgrade: vi.fn() };
  const req = { url: '/internal/hosts/ws', headers: { host: '127.0.0.1:8780', authorization: `Bearer ${hostKey}`, 'x-zcc-host-id': hostId, ...headers } } as unknown as IncomingMessage;
  handleHostInternalUpgrade(req, socket, Buffer.alloc(0), ctx as never, wss as never);
  return { accepted: wss.handleUpgrade.mock.calls.length === 1, status: written.join('').match(/HTTP\/1\.1 (\d+)/)?.[1] };
}

beforeEach(() => {
  vi.mocked(upsertHost).mockClear();
  vi.mocked(upsertHost).mockImplementation(((_db: unknown, input: { id: string }) => ({ id: input.id })) as never);
  vi.mocked(getHost).mockClear();
  vi.mocked(getHost).mockReturnValue(null as never);
});

const forwardHost = () => ({ id: hostId, hostKeyHash: hashHostKey(hostKey), enrollmentCapability: 'peer.forward' });

describe('host-internal Connect machine class admits a forward-only founding host', () => {
  it('enrolls a forward-only code on the machine class as peer.forward, bound to its own host and instance', async () => {
    const { ctx } = fixture('peer.forward');
    const ok = await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }));
    expect(ok.status).toBe(201);
    expect(ok.body.hostId).toBe(hostId);
    expect(vi.mocked(upsertHost).mock.calls.at(-1)![1]).toMatchObject({ id: hostId, enrollmentCapability: 'peer.forward' });
    for (const headers of [
      { ...machine, 'x-zcc-connect-machine-host': otherHost },
      { ...machine, 'x-zcc-connect-machine-instance': '55555555-5555-4555-8555-555555555555' }
    ]) expect((await send(ctx, post('/internal/hosts/enroll', { ...headers, authorization: `Bearer ${joinCode}` }))).status).toBe(403);
    expect(vi.mocked(upsertHost)).toHaveBeenCalledTimes(1);
  });

  it('keeps execution codes execution: no capability is written and a forward host is never widened', async () => {
    const { ctx } = fixture('execution');
    expect((await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }))).status).toBe(201);
    expect(vi.mocked(upsertHost).mock.calls.at(-1)![1]).not.toHaveProperty('enrollmentCapability');
  });

  it('never lets a fresh forward code downgrade an existing execution machine', async () => {
    const { ctx } = fixture('peer.forward');
    vi.mocked(getHost).mockReturnValue({ id: hostId, hostKeyHash: hashHostKey(hostKey), enrollmentCapability: 'execution' } as never);
    await expect(send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }))).rejects.toThrow('forward-only enrollment cannot replace an execution machine');
    expect(vi.mocked(upsertHost)).not.toHaveBeenCalled();
  });

  it('replays a lost forward-only response with the same deterministic key and no write, capped per code', async () => {
    const { ctx, joinCodes } = fixture('peer.forward');
    const first = await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }));
    expect(first.body.hostKey).toBe(forwardKey(joinCode));
    const stored = (vi.mocked(upsertHost).mock.calls.at(-1)![1] as { hostKeyHash: string }).hostKeyHash;
    joinCodes.peek.mockReturnValue(null as never);
    joinCodes.recovered.mockReturnValue({ joinCode, hostId, expiresAt: Date.now() + 60_000, enrollmentCapability: 'peer.forward' } as never);
    vi.mocked(getHost).mockReturnValue({ id: hostId, hostKeyHash: stored, enrollmentCapability: 'peer.forward' } as never);
    for (let i = 0; i < MAX_ENROLL_RECOVERIES; i += 1) {
      expect(await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }))).toMatchObject({ status: 201, body: { hostId, hostKey: first.body.hostKey } });
    }
    expect(await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }))).toMatchObject({ status: 403, body: { error: 'enrollment recovery limit reached' } });
    expect(vi.mocked(upsertHost)).toHaveBeenCalledTimes(1);
    // Destroyed or re-keyed hosts are never resurrected by a replay.
    vi.mocked(getHost).mockReturnValue({ id: hostId, hostKeyHash: stored, destroyedAt: 1, enrollmentCapability: 'peer.forward' } as never);
    expect((await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }))).status).toBe(403);
    vi.mocked(getHost).mockReturnValue({ id: hostId, hostKeyHash: hashHostKey('other-key'), enrollmentCapability: 'peer.forward' } as never);
    expect((await send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${joinCode}` }))).status).toBe(403);
  });

  it('prunes expired replay counters so a later code starts fresh', async () => {
    const { ctx, joinCodes } = fixture('peer.forward');
    joinCodes.peek.mockReturnValue(null as never);
    const replay = (code: string) => {
      joinCodes.recovered.mockReturnValue({ joinCode: code, hostId, expiresAt: Date.now() + 60_000, enrollmentCapability: 'peer.forward' } as never);
      vi.mocked(getHost).mockReturnValue({ id: hostId, hostKeyHash: hashHostKey(forwardKey(code)), enrollmentCapability: 'peer.forward' } as never);
      return send(ctx, post('/internal/hosts/enroll', { ...machine, authorization: `Bearer ${code}` }));
    };
    for (let i = 0; i < MAX_ENROLL_RECOVERIES; i += 1) expect((await replay('zcc_prune_a')).status).toBe(201);
    expect((await replay('zcc_prune_a')).status).toBe(403);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    try { expect((await replay('zcc_prune_b')).status).toBe(201); } finally { nowSpy.mockRestore(); }
  });

  it('refuses unauthenticated replay: no machine headers means no recovery', async () => {
    const { ctx, joinCodes } = fixture('peer.forward');
    joinCodes.peek.mockReturnValue(null as never);
    joinCodes.recovered.mockReturnValue({ joinCode, hostId, expiresAt: Date.now() + 60_000, enrollmentCapability: 'peer.forward' } as never);
    expect((await send(ctx, post('/internal/hosts/enroll', { authorization: `Bearer ${joinCode}` }))).status).toBe(401);
    expect(vi.mocked(upsertHost)).not.toHaveBeenCalled();
  });

  it('answers 403 to a forward-only host on EVERY machine-class path other than enroll and the WebSocket', async () => {
    const { ctx } = fixture('peer.forward');
    vi.mocked(getHost).mockReturnValue(forwardHost() as never);
    const auth = { ...machine, authorization: `Bearer ${hostKey}`, 'x-zcc-host-id': hostId };
    const pluginAsset = `/internal/plugins/some-plugin/host/${'a'.repeat(64)}`;
    for (const url of [
      '/internal/hosts/tool-call', '/internal/hosts/cli-callback',
      '/internal/hosts/interactive-request', '/internal/hosts/interactive-request/interrupt'
    ]) {
      const result = await send(ctx, post(url, auth, {}));
      expect(result, url).toMatchObject({ status: 403, body: { error: 'host enrollment does not authorize execution' } });
    }
    const asset = await send(ctx, Object.assign(post(pluginAsset, auth, {}), { method: 'GET' }) as IncomingMessage);
    expect(asset.status, pluginAsset).toBe(403);
    // The same credentials on an execution host pass the capability gate (not 403 for that reason).
    vi.mocked(getHost).mockReturnValue({ ...forwardHost(), enrollmentCapability: 'execution' } as never);
    const exec = await send(ctx, post('/internal/hosts/tool-call', auth, {}));
    expect(exec.body?.error).not.toBe('host enrollment does not authorize execution');
  });

  it('binds every machine-class host call to the gateway-attested host', async () => {
    const { ctx } = fixture('peer.forward');
    vi.mocked(getHost).mockReturnValue(forwardHost() as never);
    for (const url of ['/internal/hosts/tool-call', '/internal/hosts/cli-callback', '/internal/hosts/interactive-request', '/internal/hosts/interactive-request/interrupt']) {
      const wrong = await send(ctx, post(url, { ...machine, authorization: `Bearer ${hostKey}`, 'x-zcc-host-id': otherHost }, {}));
      expect(wrong, url).toMatchObject({ status: 403, body: { error: 'machine credential is bound to another host' } });
    }
  });

  it('opens the host WebSocket only for the machine-bound host, instance and an execution or forward capability', () => {
    const { ctx } = fixture();
    const host = (capability: string) => vi.mocked(getHost).mockReturnValue({ id: hostId, hostKeyHash: hashHostKey(hostKey), enrollmentCapability: capability } as never);
    for (const capability of ['peer.forward', 'execution']) {
      host(capability);
      expect(upgrade(ctx, machine).accepted, capability).toBe(true);
      expect(upgrade(ctx, { ...machine, 'x-zcc-host-id': otherHost })).toMatchObject({ accepted: false, status: '403' });
      expect(upgrade(ctx, { ...machine, 'x-zcc-connect-machine-instance': '55555555-5555-4555-8555-555555555555' })).toMatchObject({ accepted: false, status: '403' });
      // A machine-host header without the instance header is malformed: refused, never treated as direct.
      expect(upgrade(ctx, { 'x-zcc-connect-machine-host': hostId })).toMatchObject({ accepted: false, status: '403' });
      expect(upgrade(ctx, {}).accepted).toBe(true);
    }
    host('unknown');
    expect(upgrade(ctx, machine)).toMatchObject({ accepted: false, status: '403' });
  });
});
