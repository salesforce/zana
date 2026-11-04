import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerControlPacket } from '@zana-ai/zcc-contracts/host-rpc';
import { destroyHost, openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { HostHub } from '../../http/host-hub.js';
import { channelHash, type EnrolledPeerChannel } from './enrolled-peer-channels.js';
import { controlResponse, openControl, sealControl } from './peer-control-protocol.js';
import {
  BOOTSTRAP_LIMITS, BootstrapRejection, NOT_CONSENTED, bootstrapKey, createBootstrapSender, handleBootstrapPacket,
  isBootstrapForm, rejectsMutualPacket, type BootstrapContext, type BootstrapLinkRecord, type BootstrapPeerLinks,
  type PeerLinkPhase
} from './peer-link-bootstrap.js';

const roots: string[] = [], databases: ZccDatabase[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

const INV = 'inv-1';
const CODE = 'zcde_ABCDEFGHIJKLMNOPQRSTUVWX';
const pullReply = (hostId = randomUUID()) => ({ redeem: { r: 1 }, reverse: { hostId, code: CODE, expiresAt: Date.now() + 60_000 } });
const pullInput = { op: 'bootstrap.pull', invitationId: INV, nonce: 'a'.repeat(48) } as const;
const abortInput = { op: 'bootstrap.abort', invitationId: INV, reason: 'denied' } as const;
const exchangeInput = { op: 'bootstrap.exchange', invitationId: INV, kind: 'exchange', wire: { w: 1 } } as const;

async function fixture(record: Partial<BootstrapLinkRecord> | null = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-bootstrap-'))); roots.push(root);
  const db = openDatabase(join(root, 'test.sqlite')); databases.push(db);
  const S = randomUUID(), R = randomUUID();
  const hostKey = randomBytes(32).toString('base64url');
  const hostKeyHash = createHash('sha256').update(hostKey).digest('hex');
  const host = upsertHost(db, { name: 'Peer', hostKeyHash, isPrimary: false, enrollmentCapability: 'peer.forward' });
  const H = host.id;
  const channel: EnrolledPeerChannel = { remoteInstanceId: S, hostId: H, hostKey, capability: 'peer.forward' };
  let current: BootstrapLinkRecord | undefined = record === null ? undefined
    : { invitationId: INV, role: 'redeemer', phase: 'pre-consent', ...record };
  const links = {
    phase: vi.fn((): PeerLinkPhase | undefined => current?.phase),
    bootstrapLink: vi.fn(async () => current),
    answerPull: vi.fn(async () => pullReply() as never),
    acceptExchange: vi.fn(async () => ({ accepted: true }) as Record<string, unknown>),
    acceptAbort: vi.fn(async () => undefined),
    acceptNudge: vi.fn(async () => undefined)
  };
  const seen = new Set<string>();
  const remote = vi.fn(async (): Promise<EnrolledPeerChannel | null> => channel);
  const ctx: BootstrapContext = {
    productInstanceId: R, peerChannels: { remote }, peerLinks: links as BootstrapPeerLinks,
    peerControlReplay: { consumeAuthenticated: async ({ nonce }) => { if (seen.has(nonce)) return false; seen.add(nonce); return true; } }
  };
  const key = () => bootstrapKey(hostKeyHash, INV, S, R, H);
  const seal = (input: unknown, k = key(), overrides: Partial<PeerControlPacket> = {}) =>
    ({ ...sealControl(input, { senderId: S, recipientId: R, senderHostId: H, recipientHostId: H }, k), ...overrides }) as PeerControlPacket;
  const session = {};
  const getSession = vi.fn(() => session as ReturnType<HostHub['getSession']>);
  const call = vi.fn<HostHub['callHostOnlineRpc']>(async input => {
    if (input.command.type !== 'peer.control') throw new Error('unexpected command');
    try {
      const response = await handleBootstrapPacket(input.command.packet, ctx, new AbortController().signal);
      return { status: 200, body: JSON.stringify(response) } as never;
    } catch (error) {
      if (error instanceof BootstrapRejection) return { status: error.status, body: JSON.stringify({ error: error.message }) } as never;
      throw error;
    }
  });
  const hub = { getSession, callHostOnlineRpc: call } as unknown as Pick<HostHub, 'getSession' | 'callHostOnlineRpc'>;
  const send = createBootstrapSender({ instanceId: S, db, hub });
  const sig = () => new AbortController().signal;
  const setRecord = (next: BootstrapLinkRecord | undefined) => { current = next; };
  return { db, S, R, H, host, hostKey, hostKeyHash, channel, links, remote, ctx, key, seal, session, getSession, call, hub, send, sig, setRecord };
}

const rejection = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { expect(error).toBeInstanceOf(BootstrapRejection); return error as BootstrapRejection; }
  throw new Error('expected BootstrapRejection');
};
const expectReject = async (promise: Promise<unknown>, status: number, message?: string) => {
  const error = await rejection(promise);
  expect(error.status).toBe(status);
  if (message) expect(error.message).toBe(message);
};

describe('end-to-end loopback accept paths', () => {
  it('bootstrap.pull returns the validated PullReply', async () => {
    const f = await fixture();
    const reply = pullReply(randomUUID());
    f.links.answerPull.mockResolvedValue(reply as never);
    await expect(f.send(f.H, f.R, { ...pullInput }, f.sig())).resolves.toEqual(reply);
    expect(f.links.answerPull).toHaveBeenCalledWith(INV, f.H, expect.any(AbortSignal));
    expect(f.call.mock.calls[0]![0].command).toMatchObject({ type: 'peer.control', timeoutMs: 15_000 });
  });

  it.each(['redeem', 'exchange'] as const)('bootstrap.exchange (%s) passes kind and wire through', async kind => {
    const f = await fixture({ role: 'inviter' });
    f.links.acceptExchange.mockResolvedValue({ wire: 'response', n: 7 });
    await expect(f.send(f.H, f.R, { ...exchangeInput, kind, wire: { x: kind } }, f.sig())).resolves.toEqual({ wire: 'response', n: 7 });
    expect(f.links.acceptExchange).toHaveBeenCalledWith(INV, f.S, f.H, kind, { x: kind }, expect.any(AbortSignal));
  });

  it.each([['inviter', 'pre-consent'], ['redeemer', 'activating'], ['inviter', 'linked']] as const)(
    'bootstrap.abort works for %s in %s', async (role, phase) => {
      const f = await fixture({ role, phase });
      for (const reason of ['denied', 'cancelled', 'expired'] as const) {
        await expect(f.send(f.H, f.R, { ...abortInput, reason }, f.sig())).resolves.toEqual({ ok: true });
        expect(f.links.acceptAbort).toHaveBeenLastCalledWith(INV, f.S, f.H, reason);
      }
    });

  it('bootstrap.nudge reaches a pre-consent redeemer only', async () => {
    const f = await fixture();
    await expect(f.send(f.H, f.R, { op: 'bootstrap.nudge', invitationId: INV }, f.sig())).resolves.toEqual({ ok: true });
    expect(f.links.acceptNudge).toHaveBeenCalledWith(INV, f.S, f.H);
    for (const record of [{ role: 'inviter' as const }, { phase: 'activating' as const }, { phase: 'linked' as const }]) {
      const other = await fixture(record);
      await expectReject(other.send(other.H, other.R, { op: 'bootstrap.nudge', invitationId: INV }, other.sig()), 403);
      expect(other.links.acceptNudge).not.toHaveBeenCalled();
    }
  });

  it('bootstrap.nudge rejects an invalid reply and an oversized or extended message', async () => {
    const f = await fixture();
    f.call.mockResolvedValueOnce({ status: 200, body: '' } as never);
    await expect(f.send(f.H, f.R, { op: 'bootstrap.nudge', invitationId: INV }, f.sig())).rejects.toThrow();
    await expectReject(handleBootstrapPacket(f.seal({ op: 'bootstrap.nudge', invitationId: INV, extra: 1 }), f.ctx), 403, NOT_CONSENTED);
    const wrongReply = await fixture();
    wrongReply.call.mockImplementationOnce(async input => {
      const packet = (input.command as { packet: PeerControlPacket }).packet;
      return { status: 200, body: JSON.stringify(controlResponse(packet, { ok: false }, wrongReply.key())) } as never;
    });
    await expect(wrongReply.send(wrongReply.H, wrongReply.R, { op: 'bootstrap.nudge', invitationId: INV }, wrongReply.sig()))
      .rejects.toThrow('invalid peer bootstrap.nudge reply');
  });
});

describe('receiver rejections', () => {
  it.each([
    ['proof', { operation: 'proof', nonce: 'c'.repeat(48) }],
    ['peer.remove', { operation: 'peer.remove', pairingId: 'p', hostId: randomUUID() }],
    ['introduction.consent', { operation: 'introduction.consent', introductionId: 'i' }],
    ['unknown op', { op: 'bootstrap.unknown' }],
    ['extra field', { ...abortInput, extra: 1 }],
    ['bad nonce', { ...pullInput, nonce: 'zz' }],
    ['non-object', 'hello']
  ])('pre-consent link rejects %s with not-consented and counts it', async (_name, input) => {
    const f = await fixture();
    await expectReject(handleBootstrapPacket(f.seal(input), f.ctx), 403, NOT_CONSENTED);
    expect(f.links.answerPull).not.toHaveBeenCalled();
    expect(f.links.acceptExchange).not.toHaveBeenCalled();
    expect(f.links.acceptAbort).not.toHaveBeenCalled();
  });

  it('counts non-allowlisted ops toward messagesPerLink', async () => {
    const f = await fixture();
    for (let i = 0; i < BOOTSTRAP_LIMITS.messagesPerLink; i++) {
      await expectReject(handleBootstrapPacket(f.seal({ operation: 'proof', nonce: 'c'.repeat(48) }), f.ctx), 403, NOT_CONSENTED);
    }
    await expectReject(handleBootstrapPacket(f.seal(abortInput), f.ctx), 429, 'peer bootstrap limit reached');
  });

  it('role and phase mismatches are 403', async () => {
    const inviter = await fixture({ role: 'inviter' });
    await expectReject(handleBootstrapPacket(inviter.seal(pullInput), inviter.ctx), 403, NOT_CONSENTED);
    const activating = await fixture({ phase: 'activating' });
    await expectReject(handleBootstrapPacket(activating.seal(pullInput), activating.ctx), 403, NOT_CONSENTED);
    const redeemer = await fixture({ role: 'redeemer' });
    await expectReject(handleBootstrapPacket(redeemer.seal(exchangeInput), redeemer.ctx), 403, NOT_CONSENTED);
    for (const f of [inviter, activating, redeemer]) {
      expect(f.links.answerPull).not.toHaveBeenCalled();
      expect(f.links.acceptExchange).not.toHaveBeenCalled();
    }
  });

  it.each([['missing', null], ['removed', { phase: 'removed' as const }], ['failed', { phase: 'failed' as const }],
    ['bad invitation id', { invitationId: '' }]])('record %s is 404 without calling the link store', async (_name, record) => {
    const f = await fixture(record);
    await expectReject(handleBootstrapPacket(f.seal(abortInput), f.ctx), 404, 'peer link record missing');
    expect(f.links.answerPull).not.toHaveBeenCalled();
    expect(f.links.acceptExchange).not.toHaveBeenCalled();
    expect(f.links.acceptAbort).not.toHaveBeenCalled();
  });

  it('rejects wrong recipient, mutual form and malformed packets', async () => {
    const f = await fixture();
    await expectReject(handleBootstrapPacket(f.seal(abortInput, f.key(), { recipientId: randomUUID() }), f.ctx), 403, 'wrong recipient');
    await expectReject(handleBootstrapPacket(f.seal(abortInput, f.key(), { recipientHostId: randomUUID() }), f.ctx), 403, 'not a bootstrap packet');
    await expect(handleBootstrapPacket({ nope: 1 } as never, f.ctx)).rejects.toThrow();
  });

  it.each(['no-channel', 'wrong-host', 'execution'])('channel %s is 403 peer link missing', async mode => {
    const f = await fixture();
    f.remote.mockResolvedValue(mode === 'no-channel' ? null
      : mode === 'wrong-host' ? { ...f.channel, hostId: randomUUID() } : { ...f.channel, capability: 'execution' });
    await expectReject(handleBootstrapPacket(f.seal(abortInput), f.ctx), 403, 'peer link missing');
    expect(f.links.bootstrapLink).not.toHaveBeenCalled();
  });

  it('wrong key is 403 not authorized; invitation mismatch is 403', async () => {
    const f = await fixture();
    const otherHash = createHash('sha256').update('another host key').digest('hex');
    const wrong = bootstrapKey(otherHash, INV, f.S, f.R, f.H);
    await expectReject(handleBootstrapPacket(f.seal(abortInput, wrong), f.ctx), 403, 'peer bootstrap not authorized');
    await expectReject(handleBootstrapPacket(f.seal({ ...abortInput, invitationId: 'inv-2' }), f.ctx), 403, 'peer bootstrap invitation mismatch');
    expect(f.links.acceptAbort).not.toHaveBeenCalled();
  });

  it('rejects a replayed packet', async () => {
    const f = await fixture();
    const packet = f.seal(abortInput);
    await handleBootstrapPacket(packet, f.ctx);
    await expectReject(handleBootstrapPacket(packet, f.ctx), 403, 'peer bootstrap replay');
    expect(f.links.acceptAbort).toHaveBeenCalledTimes(1);
  });

  it('rejects stale and future-dated packets, accepts the window edges', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    const base = Date.now();
    vi.setSystemTime(base);
    const stale = f.seal(abortInput), ok = f.seal(abortInput), future = f.seal(abortInput);
    vi.setSystemTime(base + 59_000);
    await expect(handleBootstrapPacket(ok, f.ctx)).resolves.toBeDefined();
    vi.setSystemTime(base + 60_000);
    await expectReject(handleBootstrapPacket(stale, f.ctx), 403, 'peer bootstrap replay');
    vi.setSystemTime(base - 11_000);
    await expectReject(handleBootstrapPacket(future, f.ctx), 403, 'peer bootstrap replay');
  });

  it('rejects oversized sealed packets and oversized plaintext', async () => {
    const f = await fixture({ role: 'inviter' });
    await expectReject(handleBootstrapPacket(f.seal({ pad: 'x'.repeat(40_000) }), f.ctx), 413, 'peer bootstrap message too large');
    // Within the sealed bound but plaintext just above 32 KiB.
    const base = Buffer.byteLength(JSON.stringify({ ...exchangeInput, wire: { pad: '' } }));
    const plainOver = f.seal({ ...exchangeInput, wire: { pad: 'x'.repeat(BOOTSTRAP_LIMITS.bodyBytes + 1 - base) } });
    expect(plainOver.sealed.length).toBeLessThanOrEqual(43_738);
    await expectReject(handleBootstrapPacket(plainOver, f.ctx), 413, 'peer bootstrap message too large');
  });

  it('rejects an oversized reply from the link store', async () => {
    const f = await fixture({ role: 'inviter' });
    f.links.acceptExchange.mockResolvedValue({ big: 'x'.repeat(33_000) });
    await expectReject(handleBootstrapPacket(f.seal(exchangeInput), f.ctx), 413, 'peer bootstrap reply too large');
  });

  it('maps unusable link-store replies to 404', async () => {
    const f = await fixture();
    f.links.answerPull.mockResolvedValue({ redeem: {}, reverse: { hostId: 'nope', code: 'x', expiresAt: 1 } } as never);
    await expectReject(handleBootstrapPacket(f.seal(pullInput), f.ctx), 404, 'peer bootstrap pull unavailable');
    const inviter = await fixture({ role: 'inviter' });
    for (const bad of [null, [1], 'str']) {
      inviter.links.acceptExchange.mockResolvedValueOnce(bad as never);
      await expectReject(handleBootstrapPacket(inviter.seal(exchangeInput), inviter.ctx), 404, 'peer bootstrap exchange unavailable');
    }
  });

  it('rejects when the connector registration changes during the request, except for abort', async () => {
    const f = await fixture({ role: 'inviter' });
    f.links.acceptExchange.mockImplementation(async () => {
      f.remote.mockResolvedValue({ ...f.channel, hostKey: 'k'.repeat(40) });
      return { accepted: true };
    });
    await expectReject(handleBootstrapPacket(f.seal(exchangeInput), f.ctx), 403, 'peer link changed');
    f.remote.mockReset(); f.remote.mockResolvedValueOnce(f.channel).mockResolvedValue(null);
    await expect(handleBootstrapPacket(f.seal(abortInput), f.ctx)).resolves.toBeDefined();
    const g = await fixture({ role: 'inviter' });
    g.links.acceptExchange.mockImplementation(async () => { g.remote.mockResolvedValue(null); return { accepted: true }; });
    await expectReject(handleBootstrapPacket(g.seal(exchangeInput), g.ctx), 403, 'peer link changed');
    const h = await fixture({ role: 'inviter' });
    h.links.acceptExchange.mockImplementation(async () => { h.remote.mockResolvedValue({ ...h.channel, hostId: randomUUID() }); return { accepted: true }; });
    await expectReject(handleBootstrapPacket(h.seal(exchangeInput), h.ctx), 403, 'peer link changed');
  });

  it('honours an aborted signal after authentication', async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort(new Error('shutdown'));
    await expect(handleBootstrapPacket(f.seal(abortInput), f.ctx, controller.signal)).rejects.toThrow('shutdown');
  });

  it('response packet round-trips with the bootstrap key', async () => {
    const f = await fixture();
    const packet = f.seal(abortInput);
    const response = await handleBootstrapPacket(packet, f.ctx);
    expect(openControl(response, f.key(), true)).toEqual({ ok: true });
  });
});

describe('receiver caps', () => {
  it('messagesPerLink 64 then 429', async () => {
    const f = await fixture();
    for (let i = 0; i < BOOTSTRAP_LIMITS.messagesPerLink; i++) await handleBootstrapPacket(f.seal(abortInput), f.ctx);
    await expectReject(handleBootstrapPacket(f.seal(abortInput), f.ctx), 429, 'peer bootstrap limit reached');
  });

  it('pullsPerLink 3 then 429', async () => {
    const f = await fixture();
    for (let i = 0; i < BOOTSTRAP_LIMITS.pullsPerLink; i++) await handleBootstrapPacket(f.seal(pullInput), f.ctx);
    await expectReject(handleBootstrapPacket(f.seal(pullInput), f.ctx), 429, 'peer bootstrap limit reached');
    expect(f.links.answerPull).toHaveBeenCalledTimes(3);
  });

  it('exchangesPerInvitation 20 then 429', async () => {
    const f = await fixture({ role: 'inviter' });
    for (let i = 0; i < BOOTSTRAP_LIMITS.exchangesPerInvitation; i++) await handleBootstrapPacket(f.seal(exchangeInput), f.ctx);
    await expectReject(handleBootstrapPacket(f.seal(exchangeInput), f.ctx), 429, 'peer bootstrap limit reached');
    expect(f.links.acceptExchange).toHaveBeenCalledTimes(20);
  });

  it('inbound concurrency 4: fifth in-flight request gets 429, slot frees afterwards', async () => {
    const f = await fixture({ role: 'inviter' });
    const releases: Array<() => void> = [];
    f.links.acceptExchange.mockImplementation(() => new Promise(resolve => { releases.push(() => resolve({ accepted: true })); }));
    const held = Array.from({ length: BOOTSTRAP_LIMITS.concurrentPerApp }, () => handleBootstrapPacket(f.seal(exchangeInput), f.ctx));
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    await expectReject(handleBootstrapPacket(f.seal(abortInput), f.ctx), 429, 'peer bootstrap busy');
    releases.forEach(release => release());
    await Promise.all(held);
    await expect(handleBootstrapPacket(f.seal(abortInput), f.ctx)).resolves.toBeDefined();
  });
});

describe('sender', () => {
  it('rejects oversized plaintext before any I/O', async () => {
    const f = await fixture({ role: 'inviter' });
    await expectReject(f.send(f.H, f.R, { ...exchangeInput, wire: { pad: 'x'.repeat(33_000) } }, f.sig()), 413, 'peer bootstrap message too large');
    expect(f.call).not.toHaveBeenCalled();
  });

  it('rejects invalid input, aborted signals, self and malformed recipients', async () => {
    const f = await fixture();
    const aborted = new AbortController(); aborted.abort(new Error('stop'));
    await expect(f.send(f.H, f.R, { ...abortInput }, aborted.signal)).rejects.toThrow('stop');
    await expect(f.send(f.H, f.R, { op: 'bootstrap.abort', invitationId: INV, reason: 'nope' } as never, f.sig())).rejects.toThrow();
    await expectReject(f.send(f.H, f.S, { ...abortInput }, f.sig()), 403, 'peer bootstrap recipient invalid');
    await expectReject(f.send(f.H, 'bad id!', { ...abortInput }, f.sig()), 403, 'peer bootstrap recipient invalid');
    expect(f.call).not.toHaveBeenCalled();
  });

  it.each(['missing', 'destroyed', 'execution', 'primary'])('rejects %s host with 403', async mode => {
    const f = await fixture();
    let hostId = f.H;
    if (mode === 'missing') hostId = randomUUID();
    if (mode === 'destroyed') destroyHost(f.db, f.H);
    if (mode === 'execution') upsertHost(f.db, { id: f.H, name: 'Peer', hostKeyHash: f.hostKeyHash, enrollmentCapability: 'execution' });
    // A primary host is always an execution host (a forward-only link can never be primary), so it is rejected by the capability clause.
    if (mode === 'primary') hostId = upsertHost(f.db, { name: 'Primary', hostKeyHash: 'b'.repeat(64), isPrimary: true, enrollmentCapability: 'execution' }).id;
    await expectReject(f.send(hostId, f.R, { ...abortInput }, f.sig()), 403, 'peer link unavailable');
    expect(f.call).not.toHaveBeenCalled();
  });

  it('no hub session is 404', async () => {
    const f = await fixture();
    f.getSession.mockReturnValue(null as never);
    await expectReject(f.send(f.H, f.R, { ...abortInput }, f.sig()), 404, 'peer link offline');
  });

  it.each([[403, 403], [404, 404], [413, 413], [429, 429], [500, 502], [401, 502]])('maps rpc status %i to %i', async (status, mapped) => {
    const f = await fixture();
    f.call.mockResolvedValue({ status, body: '{}' } as never);
    await expectReject(f.send(f.H, f.R, { ...abortInput }, f.sig()), mapped, 'peer bootstrap rejected');
  });

  it('propagates receiver rejections through the loopback', async () => {
    const f = await fixture(null);
    await expectReject(f.send(f.H, f.R, { ...abortInput }, f.sig()), 404);
    const g = await fixture({ role: 'inviter' });
    await expectReject(g.send(g.H, g.R, { ...pullInput }, g.sig()), 403);
  });

  it.each(['no-response', 'body-type', 'body-size', 'bad-json', 'mismatch', 'direction', 'big-sealed', 'big-plain',
    'bad-pull', 'bad-abort', 'bad-exchange'])('rejects invalid response: %s', async mode => {
    const f = await fixture();
    const input = mode === 'bad-pull' ? pullInput : mode === 'bad-exchange' ? exchangeInput : abortInput;
    f.call.mockImplementation(async rpc => {
      if (rpc.command.type !== 'peer.control') throw new Error('unexpected command');
      const packet = rpc.command.packet, k = f.key();
      const reply = (value: unknown, p = packet) => ({ status: 200, body: JSON.stringify(controlResponse(p, value, k)) });
      switch (mode) {
        case 'no-response': return undefined as never;
        case 'body-type': return { status: 200, body: 5 } as never;
        case 'body-size': return { status: 200, body: 'x'.repeat(64 * 1024 + 5000) } as never;
        case 'bad-json': return { status: 200, body: '{' } as never;
        case 'mismatch': return reply({ ok: true }, { ...packet, nonce: 'd'.repeat(48) }) as never;
        case 'direction': return { status: 200, body: JSON.stringify(sealControl({ ok: true }, packet, k)) } as never;
        case 'big-sealed': return reply({ pad: 'x'.repeat(40_000) }) as never;
        case 'big-plain': return reply({ a: 'x'.repeat(32_761) }) as never;
        case 'bad-pull': return reply({ redeem: {}, reverse: { hostId: randomUUID(), code: 'SECRET-CODE-1', expiresAt: 5 } }) as never;
        case 'bad-abort': return reply({ ok: false }) as never;
        default: return reply([1, 2]) as never;
      }
    });
    const run = f.send(f.H, f.R, { ...input } as never, f.sig());
    if (mode === 'big-sealed' || mode === 'big-plain') await expectReject(run, 413, 'peer bootstrap reply too large');
    else {
      const error = await run.then(() => undefined, (e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).not.toContain('SECRET-CODE');
      expect(error!.message).not.toContain(CODE);
    }
  });

  it('never echoes the connect code from an invalid pull reply', async () => {
    const f = await fixture();
    f.call.mockImplementation(async rpc => {
      if (rpc.command.type !== 'peer.control') throw new Error('unexpected');
      return { status: 200, body: JSON.stringify(controlResponse(rpc.command.packet, { redeem: {}, reverse: { hostId: randomUUID(), code: CODE, expiresAt: -1 } }, f.key())) } as never;
    });
    const error = await f.send(f.H, f.R, { ...pullInput }, f.sig()).then(() => undefined, (e: Error) => e);
    expect(error!.message).toBe('invalid peer bootstrap pull reply');
    expect(String(error!.stack)).not.toContain(CODE);
  });

  it.each(['session', 'destroyed', 'key'])('rejects when %s changed during the call', async mode => {
    const f = await fixture();
    const original = f.call.getMockImplementation()!;
    f.call.mockImplementation(async input => {
      const result = await original(input);
      if (mode === 'session') f.getSession.mockReturnValue({} as never);
      if (mode === 'destroyed') destroyHost(f.db, f.H);
      if (mode === 'key') upsertHost(f.db, { id: f.H, name: 'Peer', hostKeyHash: 'c'.repeat(64), enrollmentCapability: 'peer.forward' });
      return result;
    });
    await expect(f.send(f.H, f.R, { ...abortInput }, f.sig())).rejects.toThrow('peer link changed');
  });

  it('abort mid-call rejects with the abort reason and detaches the listener', async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.call.mockImplementation(() => new Promise(() => undefined));
    const run = f.send(f.H, f.R, { ...abortInput }, controller.signal);
    await vi.waitFor(() => expect(f.call).toHaveBeenCalled());
    controller.abort(new Error('shutdown'));
    await expect(run).rejects.toThrow('shutdown');
  });

  it('rpc error propagates', async () => {
    const f = await fixture();
    f.call.mockRejectedValue(new Error('rpc down'));
    await expect(f.send(f.H, f.R, { ...abortInput }, f.sig())).rejects.toThrow('rpc down');
  });

  it('outbound concurrency 4: fifth call gets 429 and slots free after failure', async () => {
    const f = await fixture();
    const fails: Array<(e: Error) => void> = [];
    f.call.mockImplementation(() => new Promise((_resolve, reject) => { fails.push(reject); }));
    const held = Array.from({ length: 4 }, () => f.send(f.H, f.R, { ...abortInput }, f.sig()));
    const settled = Promise.allSettled(held);
    await vi.waitFor(() => expect(fails).toHaveLength(4));
    await expectReject(f.send(f.H, f.R, { ...abortInput }, f.sig()), 429, 'peer bootstrap busy');
    fails.forEach(fail => fail(new Error('x')));
    await settled;
    f.call.mockRejectedValue(new Error('after'));
    await expect(f.send(f.H, f.R, { ...abortInput }, f.sig())).rejects.toThrow('after');
  });

  it('outbound message cap 64', async () => {
    const f = await fixture();
    f.call.mockRejectedValue(new Error('x'));
    for (let i = 0; i < BOOTSTRAP_LIMITS.messagesPerLink; i++) await expect(f.send(f.H, f.R, { ...abortInput }, f.sig())).rejects.toThrow('x');
    await expectReject(f.send(f.H, f.R, { ...abortInput }, f.sig()), 429, 'peer bootstrap limit reached');
  });

  it('outbound pull cap 3', async () => {
    const f = await fixture();
    f.call.mockRejectedValue(new Error('x'));
    for (let i = 0; i < BOOTSTRAP_LIMITS.pullsPerLink; i++) await expect(f.send(f.H, f.R, { ...pullInput }, f.sig())).rejects.toThrow('x');
    await expectReject(f.send(f.H, f.R, { ...pullInput }, f.sig()), 429, 'peer bootstrap limit reached');
  });

  it('outbound exchange cap 20 per invitation', async () => {
    const f = await fixture({ role: 'inviter' });
    f.call.mockRejectedValue(new Error('x'));
    for (let i = 0; i < BOOTSTRAP_LIMITS.exchangesPerInvitation; i++) await expect(f.send(f.H, f.R, { ...exchangeInput }, f.sig())).rejects.toThrow('x');
    await expectReject(f.send(f.H, f.R, { ...exchangeInput }, f.sig()), 429, 'peer bootstrap limit reached');
    // A different invitation has its own exchange budget.
    await expect(f.send(f.H, f.R, { ...exchangeInput, invitationId: 'inv-other' }, f.sig())).rejects.toThrow('x');
  });
});

describe('rejectsMutualPacket', () => {
  const packet = (f: { S: string; H: string }, other = randomUUID()) => ({ senderId: f.S, senderHostId: other, recipientHostId: f.H });

  it('false without links or without a phase or when linked', async () => {
    const f = await fixture();
    expect(rejectsMutualPacket(undefined, packet(f))).toBe(false);
    const none = { ...f.links, phase: vi.fn(() => undefined) } as unknown as BootstrapPeerLinks;
    expect(rejectsMutualPacket(none, packet(f))).toBe(false);
    const linked = { ...f.links, phase: vi.fn(() => 'linked' as const) } as unknown as BootstrapPeerLinks;
    expect(rejectsMutualPacket(linked, packet(f))).toBe(false);
    expect(linked.phase).toHaveBeenCalledTimes(2);
  });

  it.each(['pre-consent', 'activating'] as const)('true when either host is %s', async phase => {
    const f = await fixture();
    const other = randomUUID();
    const onRecipient = { phase: vi.fn((_s: string, host?: string) => host === f.H ? phase : undefined) } as unknown as BootstrapPeerLinks;
    const onSender = { phase: vi.fn((_s: string, host?: string) => host === other ? phase : undefined) } as unknown as BootstrapPeerLinks;
    expect(rejectsMutualPacket(onRecipient, packet(f, other))).toBe(true);
    expect(rejectsMutualPacket(onSender, packet(f, other))).toBe(true);
  });

  it('counts rejected mutual packets toward the link message budget', async () => {
    const f = await fixture();
    for (let i = 0; i < BOOTSTRAP_LIMITS.messagesPerLink; i++) expect(rejectsMutualPacket(f.links as unknown as BootstrapPeerLinks, packet(f))).toBe(true);
    await expectReject(handleBootstrapPacket(f.seal(abortInput), f.ctx), 429, 'peer bootstrap limit reached');
  });
});

describe('bootstrapKey / isBootstrapForm / module boundary', () => {
  const hash = 'a'.repeat(64), S = randomUUID(), R = randomUUID(), H = randomUUID();

  it('is deterministic and differs by every input', () => {
    const base = bootstrapKey(hash, INV, S, R, H);
    expect(base).toHaveLength(32);
    expect(bootstrapKey(hash, INV, S, R, H).equals(base)).toBe(true);
    const variants = [bootstrapKey('b'.repeat(64), INV, S, R, H), bootstrapKey(hash, 'inv-2', S, R, H),
      bootstrapKey(hash, INV, randomUUID(), R, H), bootstrapKey(hash, INV, S, randomUUID(), H), bootstrapKey(hash, INV, S, R, randomUUID()),
      bootstrapKey(hash, INV, R, S, H)];
    for (const variant of variants) expect(variant.equals(base)).toBe(false);
  });

  it.each([
    ['bad hash', () => bootstrapKey('A'.repeat(64), INV, S, R, H)],
    ['short hash', () => bootstrapKey('ab', INV, S, R, H)],
    ['bad invitation', () => bootstrapKey(hash, '', S, R, H)],
    ['bad sender', () => bootstrapKey(hash, INV, 'bad id', R, H)],
    ['bad recipient', () => bootstrapKey(hash, INV, S, '', H)],
    ['sender == recipient', () => bootstrapKey(hash, INV, S, S, H)],
    ['bad host id', () => bootstrapKey(hash, INV, S, R, 'not-a-uuid')]
  ])('throws on %s', (_name, run) => { expect(run).toThrow('peer bootstrap key unavailable'); });

  it('isBootstrapForm detects equal host ids', () => {
    expect(isBootstrapForm({ senderHostId: H, recipientHostId: H })).toBe(true);
    expect(isBootstrapForm({ senderHostId: H, recipientHostId: randomUUID() })).toBe(false);
  });

  it('does not import scoped-link-authority', async () => {
    const source = await readFile(join(__dirname, 'peer-link-bootstrap.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*scoped-link-authority/);
    expect(source).not.toMatch(/ScopedLinkAuthority[^\n]*\.context\(/);
  });

  it('channelHash matches the sender-side hostKeyHash used by the fixture', async () => {
    const f = await fixture();
    expect(channelHash(f.channel)).toBe(f.host.hostKeyHash);
  });
});
