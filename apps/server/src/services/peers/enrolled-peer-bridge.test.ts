import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, destroyHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { HostHub } from '../../http/host-hub.js';
import { createEnrolledPeerBridge } from './enrolled-peer-bridge.js';
import { EnrolledPeerChannels, channelHash } from './enrolled-peer-channels.js';
import { controlKey, controlResponse, openControl, sealControl } from './peer-control-protocol.js';
import type { PairProposal } from './scoped-link-authority.js';
import { sealPeerBytes, unsealPeerBytes, serializePeerStorage } from './peer-auth.js';

const roots: string[] = [], databases: ZccDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture(capability: 'execution' | 'peer.forward' = 'execution') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-bridge-'))); roots.push(root);
  const db = openDatabase(join(root, 'test.sqlite')); databases.push(db);
  const instanceId = randomUUID(), remoteId = randomUUID();
  const host = upsertHost(db, { name: 'Peer', hostKeyHash: 'a'.repeat(64), isPrimary: false, enrollmentCapability: capability });
  const channels = new EnrolledPeerChannels(join(root, 'channels'), instanceId, { getKey: async () => Buffer.alloc(32, 19) });
  const channel = { remoteInstanceId: remoteId, hostId: randomUUID(), hostKey: randomBytes(32).toString('base64url'), capability };
  await channels.register(channel);
  const key = controlKey(host.hostKeyHash, channelHash(channel));
  const session = {};
  const getSession = vi.fn(() => session as ReturnType<HostHub['getSession']>);
  const call = vi.fn<HostHub['callHostOnlineRpc']>(async input => {
    if (input.command.type !== 'peer.control') throw new Error('unexpected command');
    const data = openControl(input.command.packet, key) as { operation: string };
    return { status: 200, body: JSON.stringify(controlResponse(input.command.packet,
      data.operation === 'proof' ? { sealedProof: 'proof' } : { accepted: true }, key)) } as never;
  });
  const bridge = createEnrolledPeerBridge({ instanceId, db, channels, hub: { getSession, callHostOnlineRpc: call } as unknown as HostHub });
  const proposal: PairProposal = { pairId: 'pair', proposalId: 'proposal', localInstanceId: instanceId, remoteInstanceId: remoteId,
    targetHostId: host.id, pluginId: 'test-plugin', scope: 'scope', epoch: 1 };
  const prove = (signal = new AbortController().signal) => bridge.prove(host.id,
    { senderInstanceId: instanceId, recipientInstanceId: remoteId, nonce: 'c'.repeat(48) }, signal);
  return { root, db, channels, channel, host, key, session, getSession, call, bridge, proposal, prove };
}

it('dispatches only encrypted core commands and delivers introductions as sealed control', async () => {
  const f = await fixture(); await expect(f.prove()).resolves.toEqual({ sealedProof: 'proof' });
  for (const operation of ['import', 'activate', 'revoke'] as const) {
    await f.bridge.exchange(f.host.id, operation, f.proposal, operation === 'import' ? Buffer.from('sealed') : undefined, new AbortController().signal);
  }
  expect(f.call).toHaveBeenCalledTimes(4);
  expect(f.call.mock.calls[0]![0].command).toMatchObject({ type: 'peer.control', timeoutMs: 15_000 });
  await f.bridge.introduce(f.host.id, { recipientInstanceId: f.channel.remoteInstanceId, capability: 'peer.forward', pluginId: 'test-plugin', scope: 'scope',
    peerInstanceId: randomUUID(), introductionId: 'intro' }, new AbortController().signal);
  expect(f.call).toHaveBeenCalledTimes(5);
  f.call.mockImplementationOnce(async input => {
    if (input.command.type !== 'peer.control') throw new Error('unexpected command');
    return { status: 200, body: JSON.stringify(controlResponse(input.command.packet, { accepted: false }, f.key)) } as never;
  });
  await expect(f.bridge.introduce(f.host.id, { recipientInstanceId: f.channel.remoteInstanceId, capability: 'peer.forward', pluginId: 'test-plugin', scope: 'scope',
    peerInstanceId: randomUUID(), introductionId: 'intro2' }, new AbortController().signal)).rejects.toThrow('not accepted');
});

it('dispatches proof and pair lifecycle over a matched forward-only enrollment', async () => {
  const f = await fixture('peer.forward');
  await expect(f.prove()).resolves.toEqual({ sealedProof: 'proof' });
  for (const operation of ['import', 'activate', 'revoke'] as const) {
    await f.bridge.exchange(f.host.id, operation, f.proposal, operation === 'import' ? Buffer.from('sealed') : undefined, new AbortController().signal);
  }
  expect(f.call).toHaveBeenCalledTimes(4);
});

it.each(['pending', 'rpc-error'])('cancellation drains bridge when RPC is %s without late registry reads', async mode => {
  const f = await fixture(), controller = new AbortController();
  const remote = vi.spyOn(f.channels, 'remote');
  let reject!: (error: Error) => void;
  f.call.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = f.prove(controller.signal);
  const rejected = expect(pending).rejects.toThrow(mode === 'pending' ? 'shutdown' : 'rpc error');
  await vi.waitFor(() => expect(f.call).toHaveBeenCalled());
  const reads = remote.mock.calls.length;
  if (mode === 'pending') controller.abort(new Error('shutdown'));
  else reject(new Error('rpc error'));
  await rejected;
  reject(new Error('late rpc failure'));
  await Promise.resolve();
  expect(remote).toHaveBeenCalledTimes(reads);
});

it.each(['aborted', 'host-missing', 'host-destroyed', 'host-scoped', 'channel-missing', 'channel-scoped', 'offline', 'sender', 'recipient'])
  ('rejects %s before RPC', async mode => {
    const f = await fixture(), controller = new AbortController();
    if (mode === 'aborted') controller.abort();
    if (mode === 'host-missing') f.db.sqlite.prepare('DELETE FROM hosts WHERE id = ?').run(f.host.id);
    if (mode === 'host-destroyed') destroyHost(f.db, f.host.id);
    if (mode === 'host-scoped') upsertHost(f.db, { id: f.host.id, name: 'Peer', hostKeyHash: f.host.hostKeyHash, enrollmentCapability: 'peer.forward' });
    if (mode === 'channel-missing') vi.spyOn(f.channels, 'remote').mockResolvedValue(null);
    if (mode === 'channel-scoped') await f.channels.register({ ...f.channel, capability: 'peer.forward' });
    if (mode === 'offline') f.getSession.mockReturnValue(null);
    const run = ['sender', 'recipient'].includes(mode)
      ? f.bridge.prove(f.host.id, { nonce: 'c'.repeat(48), senderInstanceId: mode === 'sender' ? 'other' : f.proposal.localInstanceId,
        recipientInstanceId: mode === 'recipient' ? undefined : f.proposal.remoteInstanceId }, controller.signal)
      : f.prove(controller.signal);
    await expect(run).rejects.toThrow(); expect(f.call).not.toHaveBeenCalled();
  });

it.each(['destroy', 'capability', 'key', 'session', 'channel-key', 'channel-host', 'channel-capability', 'channel-missing', 'abort'])
  ('rejects enrollment %s change while RPC is pending', async mode => {
    const f = await fixture(), controller = new AbortController(), original = f.call.getMockImplementation()!;
    f.call.mockImplementation(async input => {
      const result = await original(input);
      if (mode === 'destroy') destroyHost(f.db, f.host.id);
      if (mode === 'capability' || mode === 'key') upsertHost(f.db, { id: f.host.id, name: 'Peer',
        hostKeyHash: mode === 'key' ? 'b'.repeat(64) : f.host.hostKeyHash, enrollmentCapability: mode === 'capability' ? 'peer.forward' : 'execution' });
      if (mode === 'session') f.getSession.mockReturnValue({} as never);
      if (mode.startsWith('channel-')) await f.channels.register({ ...f.channel,
        hostKey: mode === 'channel-key' ? 'x'.repeat(32) : f.channel.hostKey,
        hostId: mode === 'channel-host' ? randomUUID() : f.channel.hostId,
        capability: mode === 'channel-capability' ? 'peer.forward' : 'execution' });
      if (mode === 'channel-missing') vi.spyOn(f.channels, 'remote').mockResolvedValue(null);
      if (mode === 'abort') controller.abort();
      return result;
    });
    await expect(f.prove(controller.signal)).rejects.toThrow();
  });

it.each(['status', 'json', 'binding', 'direction', 'proof', 'accepted'])('rejects invalid %s response', async mode => {
  const f = await fixture();
  f.call.mockImplementation(async input => {
    if (input.command.type !== 'peer.control') throw new Error('unexpected command');
    const packet = input.command.packet;
    if (mode === 'status') return { status: 403, body: '{}' } as never;
    if (mode === 'json') return { status: 200, body: '{' } as never;
    const result = mode === 'direction' ? sealControl({}, packet, f.key)
      : controlResponse(mode === 'binding' ? { ...packet, nonce: 'd'.repeat(48) } : packet,
        mode === 'accepted' ? { accepted: false } : { sealedProof: 42 }, f.key);
    return { status: 200, body: JSON.stringify(result) } as never;
  });
  await expect(mode === 'accepted' ? f.bridge.exchange(f.host.id, 'activate', f.proposal, undefined, new AbortController().signal)
    : f.prove()).rejects.toThrow();
});

it('derives symmetric keys, binds every packet field and separates request/response ciphertext', () => {
  const key = controlKey('a'.repeat(64), 'b'.repeat(64));
  expect(controlKey('b'.repeat(64), 'a'.repeat(64))).toEqual(key);
  for (const bad of ['A'.repeat(64), 'short']) expect(() => controlKey(bad, 'a'.repeat(64))).toThrow('credential');
  const packet = sealControl({ operation: 'proof', nonce: 'c'.repeat(48) },
    { senderId: 'app-a', recipientId: 'app-b', senderHostId: randomUUID(), recipientHostId: randomUUID() }, key);
  expect(openControl(packet, key)).toEqual({ operation: 'proof', nonce: 'c'.repeat(48) });
  expect(() => openControl(packet, key, true)).toThrow();
  for (const patch of [{ senderId: 'app-c' }, { recipientId: 'app-c' }, { senderHostId: randomUUID() },
    { recipientHostId: randomUUID() }, { nonce: 'd'.repeat(48) }, { issuedAt: packet.issuedAt + 1 }]) {
    expect(() => openControl({ ...packet, ...patch }, key)).toThrow();
  }
  const bytes = Buffer.from(packet.sealed, 'base64url'); bytes[bytes.length - 1]! ^= 1;
  expect(() => openControl({ ...packet, sealed: bytes.toString('base64url') }, key)).toThrow();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // Two-byte JSON plus framing leaves pad bits in the final base64url character.
  const noncanonical = sealControl({}, packet, key);
  noncanonical.sealed = noncanonical.sealed.slice(0, -1) + alphabet[alphabet.indexOf(noncanonical.sealed.at(-1)!) + 1];
  expect(() => openControl(noncanonical, key)).toThrow('noncanonical');
});

it('channel registry replaces exact remote entries, persists privately, rejects self and malformed input', async () => {
  const f = await fixture();
  await expect(f.channels.remote(randomUUID())).resolves.toBeNull();
  await f.channels.register({ ...f.channel, hostKey: 'x'.repeat(32) });
  expect(await f.channels.remote(f.channel.remoteInstanceId)).toMatchObject({ hostKey: 'x'.repeat(32) });
  await expect(f.channels.register({ ...f.channel, remoteInstanceId: f.proposal.localInstanceId })).rejects.toThrow('self');
  await expect(f.channels.register({ ...f.channel, capability: 'root' } as never)).rejects.toThrow();
  f.channels.dispose(); await f.channels.whenIdle();
  expect(f.channels.current(f.channel.remoteInstanceId)).toBeNull();
  await expect(f.channels.register(f.channel)).rejects.toThrow('disposed');
  await expect(f.channels.remote(f.channel.remoteInstanceId)).rejects.toThrow('disposed');
});

it('channel generation cache fails closed on corrupt storage, capacity, and rotation queued behind read', async () => {
  const f = await fixture(), directory = join(f.root, 'channels'), file = join(directory, 'channels-v1.bin');
  const key = Buffer.alloc(32, 19), aad = `channels-v1:${f.proposal.localInstanceId}`;
  await f.channels.remote(f.channel.remoteInstanceId);
  expect(f.channels.current(f.channel.remoteInstanceId)?.keyHash).toBe(channelHash(f.channel));
  let release!: () => void;
  const lock = serializePeerStorage(directory, () => new Promise<void>(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const rotating = f.channels.register({ ...f.channel, hostKey: 'r'.repeat(32) });
  expect(f.channels.current(f.channel.remoteInstanceId)?.keyHash).toBe(channelHash({ ...f.channel, hostKey: 'r'.repeat(32) }));
  release(); await lock; await rotating;
  const bytes = await readFile(file), state = JSON.parse(unsealPeerBytes(bytes, key, aad).toString());
  state.channels = Array.from({ length: 256 }, () => ({ ...f.channel, remoteInstanceId: randomUUID() }));
  await writeFile(file, sealPeerBytes(Buffer.from(JSON.stringify(state)), key, aad));
  await expect(f.channels.register({ ...f.channel, remoteInstanceId: randomUUID() })).rejects.toThrow('capacity');
  await f.channels.remote(state.channels[0].remoteInstanceId);
  await expect(f.channels.register({ ...f.channel, remoteInstanceId: randomUUID() })).rejects.toThrow('capacity');
  state.channels[1] = state.channels[0];
  await writeFile(file, sealPeerBytes(Buffer.from(JSON.stringify(state)), key, aad));
  await expect(f.channels.remote(f.channel.remoteInstanceId)).rejects.toThrow('corrupt');
  expect(f.channels.current(f.channel.remoteInstanceId)).toBeNull();
});

it('relays introduction enrollment as sealed control and never echoes a malformed offer', async () => {
  const f = await fixture('peer.forward');
  const offer = { route: 'http://127.0.0.1:4100/', joinCode: `zcde_${'a'.repeat(24)}` };
  const reply = (value: unknown) => f.call.mockImplementationOnce(async input => {
    if (input.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(input.command.packet, f.key)).toMatchObject({ operation: 'introduction.enroll', introductionId: 'intro', ...offer });
    expect(JSON.stringify(input.command.packet)).not.toContain(offer.joinCode);
    return { status: 200, body: JSON.stringify(controlResponse(input.command.packet, value, f.key)) } as never;
  });
  const request = () => f.bridge.introductionEnrollment!(f.host.id, { recipientInstanceId: f.channel.remoteInstanceId,
    operation: 'introduction.enroll', introductionId: 'intro', ...offer }, new AbortController().signal);
  reply(offer);
  await expect(request()).resolves.toEqual(offer);
  reply({ ...offer, extra: 'zcde_leak' });
  const error = await request().catch((e: Error) => e);
  expect(error.message).toBe('invalid peer enrollment offer');
  reply({ route: offer.route, joinCode: 'not-a-code' });
  await expect(request()).rejects.toThrow('invalid peer enrollment offer');
});

it('relays consent notices as sealed control and only accepts a strict boolean reply', async () => {
  const f = await fixture('peer.forward');
  const reply = (value: unknown) => f.call.mockImplementationOnce(async input => {
    if (input.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(input.command.packet, f.key)).toMatchObject({ operation: 'introduction.consent', introductionId: 'intro' });
    return { status: 200, body: JSON.stringify(controlResponse(input.command.packet, value, f.key)) } as never;
  });
  const request = () => f.bridge.introductionConsent!(f.host.id, { recipientInstanceId: f.channel.remoteInstanceId,
    operation: 'introduction.consent', introductionId: 'intro' }, new AbortController().signal);
  reply({ recorded: true });
  await expect(request()).resolves.toEqual({ recorded: true });
  reply({ recorded: false });
  await expect(request()).resolves.toEqual({ recorded: false });
  for (const bad of [{ recorded: 'yes' }, { recorded: true, extra: 1 }, null]) {
    reply(bad);
    await expect(request()).rejects.toThrow('invalid peer consent reply');
  }
});

it('channel unregister removes only the exact enrollment and fails closed after dispose', async () => {
  const f = await fixture();
  await f.channels.remote(f.channel.remoteInstanceId);
  await expect(f.channels.unregister(f.channel.remoteInstanceId, randomUUID())).resolves.toBe(false);
  await expect(f.channels.unregister(randomUUID(), f.channel.hostId)).resolves.toBe(false);
  expect(await f.channels.remote(f.channel.remoteInstanceId)).not.toBeNull();
  await expect(f.channels.unregister(f.channel.remoteInstanceId, f.channel.hostId)).resolves.toBe(true);
  expect(f.channels.current(f.channel.remoteInstanceId)).toBeNull();
  expect(await f.channels.remote(f.channel.remoteInstanceId)).toBeNull();
  f.channels.dispose();
  await expect(f.channels.unregister(f.channel.remoteInstanceId, f.channel.hostId)).rejects.toThrow('disposed');
});

const CODE = 'zcde_ABCDEFGHIJKLMNOPQRSTUVWX';
const CONNECT_CODE = 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';
const EXPIRES = 4_000_000_000_000;

it('relays peer.rotate as sealed control and only accepts a strict boolean reply without echoing the code', async () => {
  const f = await fixture('peer.forward');
  const input = { recipientInstanceId: f.channel.remoteInstanceId, hostId: randomUUID(), code: CODE, expiresAt: EXPIRES };
  const reply = (value: unknown) => f.call.mockImplementationOnce(async req => {
    if (req.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(req.command.packet, f.key)).toEqual({ operation: 'peer.rotate', hostId: input.hostId, code: CODE, expiresAt: EXPIRES });
    expect(JSON.stringify(req.command.packet)).not.toContain(CODE);
    return { status: 200, body: JSON.stringify(controlResponse(req.command.packet, value, f.key)) } as never;
  });
  const request = () => f.bridge.peerRotate!(f.host.id, input, new AbortController().signal);
  reply({ accepted: true });
  await expect(request()).resolves.toEqual({ accepted: true });
  reply({ accepted: false });
  await expect(request()).resolves.toEqual({ accepted: false });
  for (const bad of [{ accepted: 'yes' }, { accepted: true, code: CODE }, null]) {
    reply(bad);
    const error = await request().catch((e: Error) => e);
    expect(error.message).toBe('invalid peer rotate reply');
    expect(error.message).not.toContain(CODE);
  }
});

it('relays peer.relink as sealed control and never echoes a rejected reply carrying a code', async () => {
  const f = await fixture('peer.forward');
  const input = { recipientInstanceId: f.channel.remoteInstanceId, hostId: randomUUID() };
  const reply = (value: unknown) => f.call.mockImplementationOnce(async req => {
    if (req.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(req.command.packet, f.key)).toEqual({ operation: 'peer.relink', hostId: input.hostId });
    return { status: 200, body: JSON.stringify(controlResponse(req.command.packet, value, f.key)) } as never;
  });
  const request = () => f.bridge.peerRelink!(f.host.id, input, new AbortController().signal);
  reply({ accepted: true, code: CODE, expiresAt: EXPIRES });
  await expect(request()).resolves.toEqual({ accepted: true, code: CODE, expiresAt: EXPIRES });
  reply({ accepted: false });
  await expect(request()).resolves.toEqual({ accepted: false });
  const invalid = [{ accepted: true }, { accepted: true, code: 'bad', expiresAt: EXPIRES }, { accepted: true, code: CODE, expiresAt: EXPIRES, extra: 1 },
    { accepted: false, code: CODE }, { accepted: 'yes', code: CODE, expiresAt: EXPIRES }, null];
  for (const bad of invalid) {
    reply(bad);
    const error = await request().catch((e: Error) => e);
    expect(error.message).toBe('invalid peer relink reply');
    expect(error.message).not.toContain(CODE);
  }
});

it('relays peer.remove as sealed control and only accepts a strict boolean reply', async () => {
  const f = await fixture('peer.forward');
  const ref = { recipientInstanceId: f.channel.remoteInstanceId, pairingId: randomUUID(), hostId: randomUUID() };
  const reply = (value: unknown) => f.call.mockImplementationOnce(async req => {
    if (req.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(req.command.packet, f.key)).toEqual({ operation: 'peer.remove', pairingId: ref.pairingId, hostId: ref.hostId });
    return { status: 200, body: JSON.stringify(controlResponse(req.command.packet, value, f.key)) } as never;
  });
  const signal = new AbortController().signal;
  reply({ accepted: true });
  await expect(f.bridge.peerRemove!(f.host.id, ref, signal)).resolves.toEqual({ accepted: true });
  reply({ accepted: false });
  await expect(f.bridge.peerRemove!(f.host.id, ref, signal)).resolves.toEqual({ accepted: false });
  reply({ accepted: 1 });
  await expect(f.bridge.peerRemove!(f.host.id, ref, signal)).rejects.toThrow('invalid peer removal reply');
});

it.each([
  ['useRequest', 'use.request', { pluginId: 'plugin-x' }],
  ['useDecision', 'use.decision', { pluginId: 'plugin-x', approved: true }]
] as const)('relays %s as sealed control carrying ids only and requires a strict boolean reply', async (method, operation, extra) => {
  const f = await fixture('peer.forward');
  const ref = { recipientInstanceId: f.channel.remoteInstanceId, pairingId: 'pair-1', ...extra };
  const reply = (value: unknown) => f.call.mockImplementationOnce(async req => {
    if (req.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(req.command.packet, f.key)).toEqual({ operation, pairingId: 'pair-1', ...extra });
    return { status: 200, body: JSON.stringify(controlResponse(req.command.packet, value, f.key)) } as never;
  });
  const signal = new AbortController().signal;
  const send = (f.bridge as unknown as Record<string, (h: string, i: unknown, s: AbortSignal) => Promise<unknown>>)[method]!;
  reply({ accepted: true });
  await expect(send(f.host.id, ref, signal)).resolves.toEqual({ accepted: true });
  reply({ accepted: false });
  await expect(send(f.host.id, ref, signal)).resolves.toEqual({ accepted: false });
  reply({ accepted: 1 });
  await expect(send(f.host.id, ref, signal)).rejects.toThrow('invalid peer use reply');
});

it('relays the connect form of an introduction enrollment and rejects a malformed connect reply without echoing it', async () => {
  const f = await fixture('peer.forward');
  const connect = { code: CONNECT_CODE, accountUrl: 'https://account.example', serverId: randomUUID() };
  const reply = (value: unknown) => f.call.mockImplementationOnce(async req => {
    if (req.command.type !== 'peer.control') throw new Error('unexpected command');
    expect(openControl(req.command.packet, f.key)).toMatchObject({ operation: 'introduction.enroll', introductionId: 'intro', connect });
    return { status: 200, body: JSON.stringify(controlResponse(req.command.packet, value, f.key)) } as never;
  });
  const request = () => f.bridge.introductionEnrollment!(f.host.id, { recipientInstanceId: f.channel.remoteInstanceId,
    operation: 'introduction.enroll', introductionId: 'intro', connect }, new AbortController().signal);
  reply({ connect });
  await expect(request()).resolves.toEqual({ connect });
  reply({ connect: { ...connect, accountUrl: 'http://insecure.example' } });
  const error = await request().catch((e: Error) => e);
  expect(error.message).toBe('invalid peer enrollment offer');
  expect(error.message).not.toContain(CODE);
});
