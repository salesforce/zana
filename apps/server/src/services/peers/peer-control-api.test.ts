import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { channelHash } from './enrolled-peer-channels.js';
import { handlePeerControlApi } from './peer-control-api.js';
import { BootstrapRejection, bootstrapKey } from './peer-link-bootstrap.js';
import { controlKey, openControl, sealControl } from './peer-control-protocol.js';

const credentialRoots: string[] = [], credentialDbs: ZccDatabase[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const db of credentialDbs.splice(0)) db.close();
  for (const dir of credentialRoots.splice(0)) await rm(dir, { recursive: true, force: true });
});
function request(body: string, patch: Record<string, unknown> = {}) {
  const req = Object.assign(new EventEmitter(), { url: '/api/v1/peer-control', method: 'POST',
    socket: { remoteAddress: '127.0.0.1' }, headers: {},
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }, destroy: vi.fn(), ...patch });
  const res = Object.assign(new EventEmitter(), { destroyed: false, getHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() });
  return { req, res, run: (ctx = {} as ProductHttpContext) => handlePeerControlApi(req as unknown as IncomingMessage, res as unknown as ServerResponse, ctx) };
}
it('ignores unrelated routes and rejects non-loopback without reading or dispatching', async () => {
  const unknown = request('{}', { url: '/other' }); await expect(unknown.run()).resolves.toBe(false);
  expect(unknown.res.end).not.toHaveBeenCalled();
  for (const patch of [{ socket: { remoteAddress: '192.0.2.1' } }, { socket: {} }, { method: 'GET' },
    { headers: { origin: 'http://evil.test' } }, { headers: { 'sec-fetch-site': 'same-origin' } }]) {
    const f = request('{}', patch); await expect(f.run()).resolves.toBe(true);
    expect(f.res.writeHead.mock.calls[0]![0]).toBe(403);
  }
});
it('bounds active requests, destroys stalled reads on timeout, releases slots and close listeners', async () => {
  vi.useFakeTimers();
  const pending = Array.from({ length: 8 }, () => {
    let reject!: (error: Error) => void;
    const read = new Promise<never>((_resolve, fail) => { reject = fail; });
    const f = request('', { async *[Symbol.asyncIterator]() { await read; } });
    f.req.destroy.mockImplementation(() => { f.res.destroyed = true; f.res.emit('close'); reject(new Error('closed')); });
    return { ...f, done: f.run() };
  });
  const blocked = request('{}'); await blocked.run(); expect(blocked.res.writeHead.mock.calls[0]![0]).toBe(403);
  await vi.advanceTimersByTimeAsync(15_000);
  await Promise.all(pending.map(f => f.done));
  for (const f of pending) {
    expect(f.req.destroy).toHaveBeenCalledOnce(); expect(f.res.end).not.toHaveBeenCalled();
    expect(f.res.listenerCount('close')).toBe(0);
  }
  const next = request('{}'); await next.run(); expect(next.res.end).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

const CODE = 'zcde_ABCDEFGHIJKLMNOPQRSTUVWX';
const CONNECT = 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';
const EXPIRES = 4_000_000_000_000;

function linksMock() {
  return {
    phase: vi.fn((_peer: string, _host?: string): string | undefined => undefined),
    foundedFor: vi.fn(async () => false),
    acceptRotate: vi.fn(async () => ({ accepted: true })),
    acceptRelink: vi.fn(async (): Promise<unknown> => ({ accepted: true, code: CODE, expiresAt: EXPIRES })),
    acceptRemoval: vi.fn(async () => ({ accepted: true })),
    bootstrapLink: vi.fn(async (): Promise<unknown> => undefined),
    answerPull: vi.fn(), acceptExchange: vi.fn(), acceptAbort: vi.fn(async () => undefined), acceptNudge: vi.fn(async () => undefined)
  };
}

async function linkFixture(capability: 'execution' | 'peer.forward', withLinks = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-control-api-'))); credentialRoots.push(root);
  const db = openDatabase(join(root, 'test.sqlite')); credentialDbs.push(db);
  const productInstanceId = randomUUID(), senderId = randomUUID();
  const host = upsertHost(db, { name: 'Peer', hostKeyHash: 'a'.repeat(64), isPrimary: false, enrollmentCapability: capability });
  const channel = { remoteInstanceId: senderId, hostId: randomUUID(), hostKey: randomBytes(32).toString('base64url'), capability };
  const session = {};
  const peerLinks = linksMock();
  const ctx = { productInstanceId, db, hostHub: { getSession: vi.fn(() => session) },
    peerChannels: { remote: vi.fn(async () => channel) }, peerControlReplay: { consumeAuthenticated: vi.fn(async () => true) },
    ...(withLinks ? { peerLinks } : {}) } as unknown as ProductHttpContext & { peerLinks?: ReturnType<typeof linksMock> };
  const key = controlKey(channelHash(channel), host.hostKeyHash);
  const identities = { senderId, recipientId: productInstanceId, senderHostId: host.id, recipientHostId: channel.hostId };
  const send = async (input: unknown) => {
    const call = request(JSON.stringify(sealControl(input, identities, key)));
    await expect(call.run(ctx)).resolves.toBe(true);
    const status = call.res.writeHead.mock.calls[0]![0] as number;
    const body = JSON.parse(call.res.end.mock.calls[0]![0] as string);
    return { status, call, body, reply: status === 200 ? openControl(body, key, true) : undefined };
  };
  return { ctx, key, host, senderId, channel, peerLinks, identities, send };
}

const consentInput = () => ({ operation: 'introduction.consent', introductionId: randomUUID() });
const intro = () => ({ pluginId: 'design-docs', scope: 'repo-1', peerInstanceId: randomUUID(), introductionId: randomUUID() });
const connect = () => ({ code: CONNECT, accountUrl: 'https://account.example', serverId: randomUUID() });
const route = () => ({ route: 'http://127.0.0.1:4100/', joinCode: `zcde_${'a'.repeat(24)}` });

it.each([
  ['invitation-founded peer.forward sponsor', 'peer.forward', 'founded', true, 'approved'],
  ['introduction-derived peer.forward sponsor', 'peer.forward', 'not-founded', false, 'pending'],
  ['peer.forward sponsor whose founding lookup fails', 'peer.forward', 'throws', false, 'pending'],
  ['peer.forward sponsor without peerLinks', 'peer.forward', 'none', false, 'pending'],
  ['execution sponsor', 'execution', 'founded', false, 'pending'],
  ['already linked introduction', 'peer.forward', 'founded', true, null]
] as const)('introduction from an %s is auto-approved and enrolled only when invitation-founded', async (_name, capability, foundings, consented, status) => {
  const f = await linkFixture(capability, foundings !== 'none');
  const body = intro();
  const receiveIntroduction = vi.fn(async (sponsorInstanceId: string, input: typeof body, _now: number, _options: { consented?: boolean }) =>
    status ? { ...input, sponsorInstanceId, status, receivedAt: 1 } : null);
  const enroll = vi.fn(async () => { throw new Error('installer offline'); });
  f.peerLinks.foundedFor.mockImplementation(async () => { if (foundings === 'throws') throw new Error('storage'); return foundings === 'founded'; });
  Object.assign(f.ctx, { peerAuthority: { receiveIntroduction }, peerInstaller: { enroll } });
  const result = await f.send({ operation: 'introduction', capability: 'peer.forward', ...body });
  expect(result.status).toBe(200);
  expect(receiveIntroduction).toHaveBeenCalledExactlyOnceWith(f.senderId, body, expect.any(Number), { consented });
  // The lookup is bound to the sponsor, the exact channel it used and the introduced plugin scope.
  if (capability === 'peer.forward' && foundings !== 'none') expect(f.peerLinks.foundedFor).toHaveBeenCalledExactlyOnceWith(f.senderId, f.channel.hostId, body.pluginId);
  else expect(f.peerLinks.foundedFor).not.toHaveBeenCalled();
  if (consented && status === 'approved') expect(enroll).toHaveBeenCalledExactlyOnceWith(body.introductionId);
  else expect(enroll).not.toHaveBeenCalled();
  expect(result.reply).toEqual({ accepted: true });
});

it('a pending introduction from an introduction-derived sponsor is never enrolled even if the authority reports it approved', async () => {
  const f = await linkFixture('peer.forward');
  const body = intro();
  const enroll = vi.fn(async () => undefined);
  Object.assign(f.ctx, { peerAuthority: { receiveIntroduction: vi.fn(async () => ({ ...body, sponsorInstanceId: f.senderId, status: 'approved', receivedAt: 1 })) },
    peerInstaller: { enroll } });
  const result = await f.send({ operation: 'introduction', capability: 'peer.forward', ...body });
  expect(result.status).toBe(200);
  expect(enroll).not.toHaveBeenCalled();
});

it('peer.rotate is delivered to peerLinks.acceptRotate for the destination host and answered sealed without echoing the code in clear', async () => {
  const f = await linkFixture('peer.forward');
  const result = await f.send({ operation: 'peer.rotate', hostId: f.channel.hostId, code: CODE, expiresAt: EXPIRES });
  expect(result).toMatchObject({ status: 200, reply: { accepted: true } });
  expect(f.peerLinks.acceptRotate).toHaveBeenCalledExactlyOnceWith(f.senderId, f.channel.hostId, { code: CODE, expiresAt: EXPIRES }, expect.any(AbortSignal));
  expect(JSON.stringify(result.call.res.end.mock.calls)).not.toContain(CODE);
});

it.each(['host-mismatch', 'execution', 'missing-links'])('peer.rotate is refused (%s) and never reaches peerLinks', async mode => {
  const f = await linkFixture(mode === 'execution' ? 'execution' : 'peer.forward', mode !== 'missing-links');
  const result = await f.send({ operation: 'peer.rotate', hostId: mode === 'host-mismatch' ? randomUUID() : f.channel.hostId, code: CODE, expiresAt: EXPIRES });
  expect(result.status).toBe(403);
  expect(f.peerLinks.acceptRotate).not.toHaveBeenCalled();
});

it('peer.rotate rejects a malformed code at the schema', async () => {
  const f = await linkFixture('peer.forward');
  expect((await f.send({ operation: 'peer.rotate', hostId: f.channel.hostId, code: 'abcd-1234', expiresAt: EXPIRES })).status).toBe(403);
  expect(f.peerLinks.acceptRotate).not.toHaveBeenCalled();
});

it('peer.relink and peer.remove reach peerLinks without a live sender session; other operations still require one', async () => {
  const f = await linkFixture('peer.forward');
  Object.assign(f.ctx, { hostHub: { getSession: vi.fn(() => null) } });
  const relink = await f.send({ operation: 'peer.relink', hostId: f.host.id });
  expect(relink).toMatchObject({ status: 200, reply: { accepted: true, code: CODE, expiresAt: EXPIRES } });
  expect(f.peerLinks.acceptRelink).toHaveBeenCalledExactlyOnceWith(f.senderId, f.host.id, expect.any(AbortSignal));
  f.peerLinks.acceptRelink.mockResolvedValueOnce({ accepted: false });
  await expect(f.send({ operation: 'peer.relink', hostId: f.host.id })).resolves.toMatchObject({ status: 200, reply: { accepted: false } });
  const ref = { pairingId: randomUUID(), hostId: randomUUID() };
  await expect(f.send({ operation: 'peer.remove', ...ref })).resolves.toMatchObject({ status: 200, reply: { accepted: true } });
  expect(f.peerLinks.acceptRemoval).toHaveBeenCalledExactlyOnceWith(f.senderId, f.host.id, ref);
  // Session-bound operations without the sender's session are refused before dispatch.
  await expect(f.send({ operation: 'peer.rotate', hostId: f.channel.hostId, code: CODE, expiresAt: EXPIRES })).resolves.toMatchObject({ status: 403 });
  await expect(f.send(consentInput())).resolves.toMatchObject({ status: 403 });
  expect(f.peerLinks.acceptRotate).not.toHaveBeenCalled();
});

it('use.request and use.decision reach the use layer with the sender and the host minted for it (our inbound host), and need a live session', async () => {
  const f = await linkFixture('peer.forward');
  const peerUseRequests = { acceptRequest: vi.fn(async () => ({ accepted: true })), acceptDecision: vi.fn(async () => ({ accepted: false })) };
  Object.assign(f.ctx, { peerUseRequests });
  const request = { pairingId: 'pair-1', pluginId: 'plugin-x' };
  await expect(f.send({ operation: 'use.request', ...request })).resolves.toMatchObject({ status: 200, reply: { accepted: true } });
  expect(peerUseRequests.acceptRequest).toHaveBeenCalledExactlyOnceWith(f.senderId, f.host.id, request);
  await expect(f.send({ operation: 'use.decision', ...request, approved: true })).resolves.toMatchObject({ status: 200, reply: { accepted: false } });
  expect(peerUseRequests.acceptDecision).toHaveBeenCalledExactlyOnceWith(f.senderId, f.host.id, { ...request, approved: true });
  Object.assign(f.ctx, { hostHub: { getSession: vi.fn(() => null) } });
  expect((await f.send({ operation: 'use.request', ...request })).status).toBe(403);
});

it.each(['execution', 'missing-uses'])('use.* messages are refused (%s) and malformed ones never dispatch', async mode => {
  const f = await linkFixture(mode === 'execution' ? 'execution' : 'peer.forward');
  const peerUseRequests = { acceptRequest: vi.fn(), acceptDecision: vi.fn() };
  if (mode === 'execution') Object.assign(f.ctx, { peerUseRequests });
  expect((await f.send({ operation: 'use.request', pairingId: 'pair-1', pluginId: 'plugin-x' })).status).toBe(403);
  if (mode === 'execution') return void expect(peerUseRequests.acceptRequest).not.toHaveBeenCalled();
  Object.assign(f.ctx, { peerUseRequests });
  expect((await f.send({ operation: 'use.decision', pairingId: 'pair-1', pluginId: 'plugin-x', approved: 'yes' })).status).toBe(403);
  expect((await f.send({ operation: 'use.request', pairingId: 'pair-1', pluginId: 'Not A Token!' })).status).toBe(403);
  expect(peerUseRequests.acceptRequest).not.toHaveBeenCalled();
  expect(peerUseRequests.acceptDecision).not.toHaveBeenCalled();
});

it('peer.relink is refused when hostId is not the sender host', async () => {
  const f = await linkFixture('peer.forward');
  expect((await f.send({ operation: 'peer.relink', hostId: randomUUID() })).status).toBe(403);
  expect(f.peerLinks.acceptRelink).not.toHaveBeenCalled();
});

it.each(['execution', 'missing-links'])('peer.relink and peer.remove are refused (%s)', async mode => {
  const f = await linkFixture(mode === 'execution' ? 'execution' : 'peer.forward', mode !== 'missing-links');
  for (const input of [{ operation: 'peer.relink', hostId: f.host.id }, { operation: 'peer.remove', pairingId: randomUUID(), hostId: randomUUID() }]) {
    expect((await f.send(input)).status).toBe(403);
  }
  expect(f.peerLinks.acceptRelink).not.toHaveBeenCalled();
  expect(f.peerLinks.acceptRemoval).not.toHaveBeenCalled();
});

it('introduction.enroll relays the connect form to the authority and returns its offer sealed', async () => {
  const f = await linkFixture('peer.forward');
  const offer = { connect: connect() }, introductionId = randomUUID();
  const relayIntroductionEnrollment = vi.fn(async () => offer);
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionEnrollment } });
  const result = await f.send({ operation: 'introduction.enroll', introductionId, connect: offer.connect });
  expect(result).toMatchObject({ status: 200, reply: offer });
  expect(relayIntroductionEnrollment).toHaveBeenCalledExactlyOnceWith(f.senderId, { introductionId, connect: offer.connect }, expect.any(AbortSignal));
});

it('introduction.enroll relays the route form as {introductionId, route, joinCode}', async () => {
  const f = await linkFixture('peer.forward');
  const offer = route(), introductionId = randomUUID();
  const relayIntroductionEnrollment = vi.fn(async () => offer);
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionEnrollment } });
  await expect(f.send({ operation: 'introduction.enroll', introductionId, ...offer })).resolves.toMatchObject({ status: 200, reply: offer });
  expect(relayIntroductionEnrollment).toHaveBeenCalledExactlyOnceWith(f.senderId, { introductionId, ...offer }, expect.any(AbortSignal));
});

it.each([
  ['both forms', () => ({ ...route(), connect: connect() })],
  ['neither form', () => ({})],
  ['route without joinCode', () => ({ route: route().route })],
  ['joinCode without route', () => ({ joinCode: route().joinCode })],
  ['non-https connect origin', () => ({ connect: { ...connect(), accountUrl: 'http://account.example' } })],
  ['connect with a path', () => ({ connect: { ...connect(), accountUrl: 'https://account.example/x' } })],
  ['connect with a bad code', () => ({ connect: { ...connect(), code: 'nope' } })]
])('introduction.enroll and introduction.install reject %s', async (_name, offer) => {
  const f = await linkFixture('peer.forward');
  const relayIntroductionEnrollment = vi.fn(async () => ({})), install = vi.fn(async () => ({}));
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionEnrollment }, peerInstaller: { install } });
  expect((await f.send({ operation: 'introduction.enroll', introductionId: randomUUID(), ...offer() })).status).toBe(403);
  expect((await f.send({ operation: 'introduction.install', ...intro(), ...offer() })).status).toBe(403);
  expect(relayIntroductionEnrollment).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
});

it('introduction.install passes the connect form to the installer and the route form likewise', async () => {
  const f = await linkFixture('peer.forward');
  const body = intro(), offer = { connect: connect() };
  const install = vi.fn(async () => offer);
  Object.assign(f.ctx, { peerInstaller: { install } });
  await expect(f.send({ operation: 'introduction.install', ...body, ...offer })).resolves.toMatchObject({ status: 200, reply: offer });
  expect(install).toHaveBeenLastCalledWith(f.senderId, { ...body, ...offer }, expect.any(AbortSignal));
  const local = route();
  install.mockResolvedValueOnce(local as never);
  await expect(f.send({ operation: 'introduction.install', ...body, ...local })).resolves.toMatchObject({ status: 200, reply: local });
  expect(install).toHaveBeenLastCalledWith(f.senderId, { ...body, ...local }, expect.any(AbortSignal));
});

it('introduction.install is refused without an installer', async () => {
  const f = await linkFixture('peer.forward');
  expect((await f.send({ operation: 'introduction.install', ...intro(), connect: connect() })).status).toBe(403);
});

it('introduction.consent and introduction.consented reach the authority and installer', async () => {
  const f = await linkFixture('peer.forward');
  const relayIntroductionConsent = vi.fn(async () => ({ recorded: true })), peerConsented = vi.fn(async () => ({ recorded: true }));
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionConsent }, peerInstaller: { peerConsented } });
  const input = consentInput();
  await expect(f.send(input)).resolves.toMatchObject({ status: 200, reply: { recorded: true } });
  expect(relayIntroductionConsent).toHaveBeenCalledExactlyOnceWith(f.senderId, { introductionId: input.introductionId }, expect.any(AbortSignal));
  const notice = { introductionId: randomUUID(), pluginId: 'design-docs', scope: 'repo-1', peerInstanceId: randomUUID() };
  await expect(f.send({ operation: 'introduction.consented', ...notice })).resolves.toMatchObject({ status: 200 });
  expect(peerConsented).toHaveBeenCalledExactlyOnceWith(f.senderId, notice);
  delete (f.ctx as { peerInstaller?: unknown }).peerInstaller;
  expect((await f.send({ operation: 'introduction.consented', ...notice })).status).toBe(403);
});

it.each(['recipient', 'sender'] as const)('mutual path is refused with "peer link not consented" while the %s host link is pre-consent', async which => {
  const f = await linkFixture('peer.forward');
  const relayIntroductionConsent = vi.fn(async () => ({ recorded: true }));
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionConsent } });
  const blocked = which === 'recipient' ? f.channel.hostId : f.host.id;
  f.peerLinks.phase.mockImplementation((_peer, host) => host === blocked ? 'pre-consent' : undefined);
  const result = await f.send(consentInput());
  expect(result).toMatchObject({ status: 403, body: { error: 'peer link not consented' } });
  expect(f.peerLinks.phase).toHaveBeenCalledWith(f.senderId, blocked);
  expect(relayIntroductionConsent).not.toHaveBeenCalled();
  expect(f.ctx.peerControlReplay.consumeAuthenticated).not.toHaveBeenCalled();
});

it.each([['linked'], [undefined]] as const)('mutual path is allowed when the link phase is %s', async phase => {
  const f = await linkFixture('peer.forward');
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionConsent: vi.fn(async () => ({ recorded: true })) } });
  f.peerLinks.phase.mockReturnValue(phase);
  await expect(f.send(consentInput())).resolves.toMatchObject({ status: 200, reply: { recorded: true } });
  expect(f.peerLinks.phase).toHaveBeenCalledTimes(2);
});

it('mutual path is unguarded when peerLinks is absent', async () => {
  const f = await linkFixture('peer.forward', false);
  Object.assign(f.ctx, { peerAuthority: { relayIntroductionConsent: vi.fn(async () => ({ recorded: true })) } });
  await expect(f.send(consentInput())).resolves.toMatchObject({ status: 200 });
});

function bootstrapFixture() {
  const productInstanceId = randomUUID(), senderId = randomUUID(), hostId = randomUUID(), invitationId = randomUUID();
  const channel = { remoteInstanceId: senderId, hostId, hostKey: randomBytes(32).toString('base64url'), capability: 'peer.forward' as const };
  const peerLinks = linksMock();
  const ctx = { productInstanceId, hostHub: { getSession: vi.fn() }, peerChannels: { remote: vi.fn(async () => channel) },
    peerControlReplay: { consumeAuthenticated: vi.fn(async () => true) }, peerLinks } as unknown as ProductHttpContext;
  const key = bootstrapKey(channelHash(channel), invitationId, senderId, productInstanceId, hostId);
  const packet = (input: unknown, sealKey: Uint8Array = key) =>
    sealControl(input, { senderId, recipientId: productInstanceId, senderHostId: hostId, recipientHostId: hostId }, sealKey);
  return { ctx, peerLinks, key, invitationId, senderId, hostId, packet };
}

it('a bootstrap-form packet is refused when peerLinks is absent', async () => {
  const f = bootstrapFixture();
  delete (f.ctx as { peerLinks?: unknown }).peerLinks;
  const call = request(JSON.stringify(f.packet({ op: 'bootstrap.abort', invitationId: f.invitationId, reason: 'denied' })));
  await expect(call.run(f.ctx)).resolves.toBe(true);
  expect(call.res.writeHead.mock.calls[0]![0]).toBe(403);
  expect(f.peerLinks.bootstrapLink).not.toHaveBeenCalled();
});

it('a bootstrap-form packet is dispatched to the bootstrap plane and answered with a sealed 200', async () => {
  const f = bootstrapFixture();
  f.peerLinks.bootstrapLink.mockResolvedValue({ invitationId: f.invitationId, role: 'redeemer', phase: 'pre-consent' });
  const call = request(JSON.stringify(f.packet({ op: 'bootstrap.abort', invitationId: f.invitationId, reason: 'denied' })));
  await expect(call.run(f.ctx)).resolves.toBe(true);
  expect(call.res.writeHead.mock.calls[0]![0]).toBe(200);
  expect(f.peerLinks.acceptAbort).toHaveBeenCalledExactlyOnceWith(f.invitationId, f.senderId, f.hostId, 'denied');
  expect(openControl(JSON.parse(call.res.end.mock.calls[0]![0] as string), f.key, true)).toEqual({ ok: true });
  // The mutual-path guard is never consulted for bootstrap-form packets.
  expect(f.peerLinks.phase).not.toHaveBeenCalled();
});

it('a BootstrapRejection passes its status through and a 502 is reported as 403', async () => {
  const f = bootstrapFixture();
  const abort = { op: 'bootstrap.abort', invitationId: f.invitationId, reason: 'denied' };
  // No link record: 404 with a bounded, secret-free message.
  const missing = request(JSON.stringify(f.packet(abort)));
  await missing.run(f.ctx);
  expect(missing.res.writeHead.mock.calls[0]![0]).toBe(404);
  expect(JSON.parse(missing.res.end.mock.calls[0]![0] as string)).toEqual({ error: 'peer link record missing' });
  // Undecryptable body (wrong key): 403.
  f.peerLinks.bootstrapLink.mockResolvedValue({ invitationId: f.invitationId, role: 'inviter', phase: 'linked' });
  const wrongKey = request(JSON.stringify(f.packet(abort, randomBytes(32))));
  await wrongKey.run(f.ctx);
  expect(wrongKey.res.writeHead.mock.calls[0]![0]).toBe(403);
  // A 502 from the bootstrap plane is surfaced as 403 with its message.
  f.peerLinks.acceptAbort.mockRejectedValueOnce(new BootstrapRejection(502, 'upstream'));
  const bad = request(JSON.stringify(f.packet(abort)));
  await bad.run(f.ctx);
  expect(bad.res.writeHead.mock.calls[0]![0]).toBe(403);
  expect(JSON.parse(bad.res.end.mock.calls[0]![0] as string)).toEqual({ error: 'upstream' });
  // Any non-rejection error falls to the generic refusal.
  f.peerLinks.acceptAbort.mockRejectedValueOnce(new Error('db down'));
  const boom = request(JSON.stringify(f.packet(abort)));
  await boom.run(f.ctx);
  expect(boom.res.writeHead.mock.calls[0]![0]).toBe(403);
  expect(JSON.parse(boom.res.end.mock.calls[0]![0] as string)).toEqual({ error: 'peer control unavailable or not authorized' });
});

it('a bootstrap-form packet for another recipient is refused', async () => {
  const f = bootstrapFixture();
  const packet = sealControl({}, { senderId: f.senderId, recipientId: randomUUID(), senderHostId: f.hostId, recipientHostId: f.hostId }, f.key);
  const call = request(JSON.stringify(packet));
  await call.run(f.ctx);
  expect(call.res.writeHead.mock.calls[0]![0]).toBe(403);
  expect(f.peerLinks.bootstrapLink).not.toHaveBeenCalled();
});

it('channel registration route accepts only a sealed, enroll-token-keyed channel', async () => {
  const bad = request(JSON.stringify({ sealed: 'not valid!' }), { url: '/api/v1/peer-channel-register' });
  await bad.run({ enrollToken: 't', productInstanceId: randomUUID() } as unknown as ProductHttpContext);
  expect(bad.res.writeHead.mock.calls[0]![0]).toBe(403);
});
