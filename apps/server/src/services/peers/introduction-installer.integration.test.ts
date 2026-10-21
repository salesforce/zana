import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from '../../http/product-server.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from '@zana-ai/zcc-host-daemon/server-connection';
import { createCommandRuntime } from '@zana-ai/zcc-host-daemon/command-dispatch';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { getHost, listAllHosts, listHosts } from '@zana-ai/zcc-db';
import { controlKey, sealControl } from './peer-control-protocol.js';
import { channelHash } from './enrolled-peer-channels.js';
import { createPluginApi, type PluginHandle } from '../../plugins/plugin-api.js';

const roots: string[] = [], servers: ProductServer[] = [], connections: EnrolledHostConnection[] = [], handles: PluginHandle[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.dispose();
  for (const connection of connections.splice(0)) await connection.close();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
type App = Awaited<ReturnType<typeof app>>;
async function app(directory?: string, key = randomBytes(32)) {
  const dir = directory ?? await realpath(await mkdtemp(join(tmpdir(), 'peer-installer-')));
  if (!directory) roots.push(dir);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: { getKey: async () => key } });
  servers.push(server);
  return { server, dir, key };
}
async function enroll(owner: App, local: App) {
  const issued = owner.server.ctx.joinCodes.mint();
  const response = await fetch(`${owner.server.url}internal/hosts/enroll`, { method: 'POST', headers: {
    authorization: `Bearer ${issued.joinCode}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    hostId: issued.hostId, hostName: 'Peer machine', instanceId: randomUUID() }) });
  expect(response.status).toBe(201);
  const credentials = await response.json() as { hostId: string; hostKey: string };
  const connection = startEnrolledHostConnection({ serverUrl: owner.server.url, ...credentials, dataDir: local.dir, localPeerAppDataDir: local.dir,
    runtime: createCommandRuntime({ dataDir: local.dir, emit() {} }) });
  connections.push(connection); await connection.ready;
  await vi.waitFor(async () => expect(await local.server.ctx.peerChannels.remote(owner.server.ctx.productInstanceId)).not.toBeNull());
  return credentials;
}
const scope = 'installer-opaque-scope';

/** a sponsors crossed introductions: b to c (c receives `toC`) and c to b (b receives `toB`), as the design-docs plugin does. */
async function introduced() {
  const a = await app(), b = await app(), c = await app();
  await enroll(a, b); await enroll(b, a); await enroll(a, c); await enroll(c, a);
  const sponsor = createPluginApi('test-plugin', join(a.dir, 'plugins', 'test-plugin'), { productContext: a.server.ctx }); handles.push(sponsor);
  const bId = b.server.ctx.productInstanceId, cId = c.server.ctx.productInstanceId;
  await sponsor.api.sdk.peers.enable(bId, { scope });
  await sponsor.api.sdk.peers.enable(cId, { scope });
  const toC = (await sponsor.api.sdk.peers.introduce(cId, { sponsorPeerId: bId, scope })).introductionId;
  const toB = (await sponsor.api.sdk.peers.introduce(bId, { sponsorPeerId: cId, scope })).introductionId;
  await a.server.ctx.peerAuthority.recover();
  expect(await a.server.ctx.peerAuthority.introductionStatus(toC)).toBe('complete');
  expect(await a.server.ctx.peerAuthority.introductionStatus(toB)).toBe('complete');
  // Deterministic direction: the lower instance id initiates.
  const [low, high] = bId < cId ? [{ app: b, id: bId, introductionId: toB }, { app: c, id: cId, introductionId: toC }]
    : [{ app: c, id: cId, introductionId: toC }, { app: b, id: bId, introductionId: toB }];
  return { a, b, c, bId, cId, toB, toC, low, high };
}
const forwardHosts = (owner: App) => listAllHosts(owner.server.ctx.db).filter(host => !host.destroyedAt && host.enrollmentCapability === 'peer.forward');
const executionHostCount = (owner: App) => listHosts(owner.server.ctx.db).filter(host => !host.destroyedAt && host.enrollmentCapability === 'execution').length;
const post = (owner: App, path: string, body: string) => fetch(`${owner.server.url}api/v1/peers/introductions/${path}`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body });
const decide = async (owner: App, introductionId: string) => expect((await post(owner, `${introductionId}/decision`, '{"decision":"approved"}')).status).toBe(200);
const installations = async (owner: App) => (await (await fetch(`${owner.server.url}api/v1/peers/installations`)).json() as {
  installations: Array<Record<string, unknown>> }).installations;

it('crossed introductions approved by both owners yield exactly one forward-only link per side, idempotently, with zero failed installs', async () => {
  const { a, b, c, bId, cId, toB, toC, low, high } = await introduced();
  const executionBefore = [executionHostCount(b), executionHostCount(c)];
  // Not yet approved: fails closed.
  const early = await post(c, `${toC}/enroll`, '{}');
  expect(early.status).toBe(409);
  expect(await early.json()).toEqual({ error: 'introduction is not approved' });
  // Both owners approve (the higher side first, so its consent notice waits at the initiator).
  await decide(high.app, high.introductionId);
  await vi.waitFor(async () => expect(await installations(high.app)).toEqual([expect.objectContaining({ role: 'responder', status: 'awaiting' })]));
  expect(forwardHosts(b)).toHaveLength(0); expect(forwardHosts(c)).toHaveLength(0);
  await decide(low.app, low.introductionId);
  await vi.waitFor(async () => {
    for (const owner of [b, c]) expect(await installations(owner)).toEqual([expect.objectContaining({ status: 'enrolled', connected: true })]);
  }, { timeout: 30_000 });
  // The explicit route joins or repeats the single enrollment idempotently on either side.
  for (const [owner, introductionId] of [[b, toB], [c, toC]] as const) {
    const response = await post(owner, `${introductionId}/enroll`, '{}');
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ status: 'enrolled', capability: 'peer.forward' });
    expect(JSON.stringify(body)).not.toMatch(/zcde_|hostKey|joinCode/);
  }
  const lowLinks = await installations(low.app), highLinks = await installations(high.app);
  expect(lowLinks).toEqual([expect.objectContaining({ introductionId: low.introductionId, role: 'requester', peerInstanceId: high.id, status: 'enrolled', connected: true })]);
  expect(highLinks).toEqual([expect.objectContaining({ introductionId: low.introductionId, role: 'responder', peerInstanceId: low.id, status: 'enrolled', connected: true })]);
  expect([...lowLinks, ...highLinks].filter(link => link.status !== 'enrolled')).toEqual([]);
  // Both directions exist and are forward-only.
  expect(await c.server.ctx.peerChannels.remote(bId)).toMatchObject({ capability: 'peer.forward' });
  expect(await b.server.ctx.peerChannels.remote(cId)).toMatchObject({ capability: 'peer.forward' });
  expect(forwardHosts(b)).toHaveLength(1); expect(forwardHosts(c)).toHaveLength(1);
  expect([executionHostCount(b), executionHostCount(c)]).toEqual(executionBefore);
  expect(forwardHosts(a)).toHaveLength(0);
  // Replayed decisions are refused and repeated enrolls change nothing.
  for (const side of [high, low]) expect((await post(side.app, `${side.introductionId}/decision`, '{"decision":"approved"}')).status).toBe(409);
  await high.app.server.ctx.peerInstaller!.enroll(high.introductionId); await low.app.server.ctx.peerInstaller!.enroll(low.introductionId);
  await b.server.ctx.peerInstaller!.whenIdle(); await c.server.ctx.peerInstaller!.whenIdle();
  expect(forwardHosts(b)).toHaveLength(1); expect(forwardHosts(c)).toHaveLength(1);
  expect(await installations(b)).toHaveLength(1); expect(await installations(c)).toHaveLength(1);
  for (const owner of [b, c]) {
    for (const file of await readdir(join(owner.dir, 'peer-authority'))) {
      const bytes = await readFile(join(owner.dir, 'peer-authority', file));
      expect(bytes.includes(Buffer.from('zcde_'))).toBe(false);
    }
  }
  // A forward-only host never gains execution rights through the installer.
  for (const host of forwardHosts(b)) expect(getHost(b.server.ctx.db, host.id)?.enrollmentCapability).toBe('peer.forward');
}, 120_000);

it('a half-approved pair waits without minting anything', async () => {
  const { b, c, low, high } = await introduced();
  await decide(low.app, low.introductionId);
  await low.app.server.ctx.peerInstaller!.whenIdle();
  expect(await installations(low.app)).toEqual([expect.objectContaining({ role: 'requester', status: 'awaiting', connected: false })]);
  expect(await installations(high.app)).toEqual([]);
  expect(forwardHosts(b)).toHaveLength(0); expect(forwardHosts(c)).toHaveLength(0);
  expect(await low.app.server.ctx.peerChannels.remote(high.id)).toBeNull();
}, 120_000);

it('fails closed and tears down when the advertised peer route is not loopback or allowlisted', async () => {
  const { low, high } = await introduced();
  // Responder advertises a non-loopback route; the requester rejects it without following it.
  vi.spyOn(high.app.server.ctx.peerInstaller as unknown as { localRoute(): string }, 'localRoute').mockReturnValue('https://attacker.example/');
  await high.app.server.ctx.peerAuthority.decideIntroduction(high.introductionId, 'approved');
  await high.app.server.ctx.peerInstaller!.enroll(high.introductionId);
  await low.app.server.ctx.peerAuthority.decideIntroduction(low.introductionId, 'approved');
  await expect(low.app.server.ctx.peerInstaller!.enroll(low.introductionId)).rejects.toThrow();
  expect(await low.app.server.ctx.peerInstaller!.list()).toEqual([expect.objectContaining({ introductionId: low.introductionId, status: 'failed' })]);
  expect(forwardHosts(low.app)).toHaveLength(0);
  expect(await readdir(join(low.app.dir, 'peer-installer-daemons')).catch(() => [])).toEqual([]);
}, 120_000);

it('an owner-allowlisted route origin applies live through the authenticated route', async () => {
  const { c } = await introduced();
  const url = `${c.server.url}api/v1/peers/route-origins`;
  const send = (method: string, body?: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  expect(await (await send('GET')).json()).toEqual({ origins: [] });
  expect((await send('POST', { origin: 'http://peer.example' })).status).toBe(400);
  const added = await send('POST', { origin: 'https://Peer.Example/' });
  expect(added.status).toBe(201); expect(await added.json()).toEqual({ origin: 'https://peer.example' });
  expect(await (await send('GET')).json()).toEqual({ origins: ['https://peer.example'] });
  // The installer's route decision reads the stored allowlist live: no restart between edits.
  const installer = c.server.ctx.peerInstaller as unknown as { route(peer: string, advertised: string, signal: AbortSignal): Promise<string> };
  const decide = () => installer.route(randomUUID(), 'https://peer.example/', new AbortController().signal);
  await expect(decide()).resolves.toBe('https://peer.example/');
  expect(await (await send('DELETE', { origin: 'https://peer.example' })).json()).toEqual({ removed: true });
  expect(await (await send('GET')).json()).toEqual({ origins: [] });
  await expect(decide()).rejects.toThrow('peer route is not loopback or allowlisted');
  // Unreadable allowlist storage contributes nothing (fails closed) rather than breaking routing.
  await send('POST', { origin: 'https://peer.example' });
  c.server.ctx.peerRouteAllowlist!.dispose();
  await expect(decide()).rejects.toThrow('peer route is not loopback or allowlisted');
  expect((await send('GET')).status).toBe(503);
}, 120_000);

it('peer.control rejects relayed enrollment ops without a completed job, an active sponsor link or an installer', async () => {
  const a = await app(), b = await app(), ab = await enroll(a, b), ba = await enroll(b, a);
  const bId = b.server.ctx.productInstanceId, aId = a.server.ctx.productInstanceId;
  const channel = (await a.server.ctx.peerChannels.remote(bId))!, host = getHost(a.server.ctx.db, ab.hostId)!;
  const key = controlKey(host.hostKeyHash, channelHash(channel));
  const header = { senderId: aId, recipientId: bId, senderHostId: ba.hostId, recipientHostId: ab.hostId };
  const post = (input: Parameters<typeof sealControl>[0]) => fetch(`${b.server.url}api/v1/peer-control`, { method: 'POST',
    body: JSON.stringify(sealControl(input, header, key)) });
  const offer = { route: 'http://127.0.0.1:4100/', joinCode: `zcde_${'a'.repeat(24)}` };
  const install = { operation: 'introduction.install' as const, introductionId: randomUUID(), pluginId: 'test-plugin', scope,
    peerInstanceId: randomUUID(), ...offer };
  expect((await post({ operation: 'introduction.enroll', introductionId: randomUUID(), ...offer })).status).toBe(403);
  expect((await post(install)).status).toBe(403); // no active sponsor link in this scope
  expect((await post({ ...install, introductionId: randomUUID(), joinCode: 'not-a-code' } as never)).status).toBe(403);
  // Consent notices: no completed job at the sponsor, no active sponsor link at the initiator, malformed fields.
  const consented = { operation: 'introduction.consented' as const, introductionId: randomUUID(), pluginId: 'test-plugin', scope, peerInstanceId: randomUUID() };
  expect((await post({ operation: 'introduction.consent', introductionId: randomUUID() })).status).toBe(403);
  expect((await post(consented)).status).toBe(403);
  expect((await post({ ...consented, introductionId: randomUUID(), scope: '' } as never)).status).toBe(403);
  const installer = b.server.ctx.peerInstaller;
  (b.server.ctx as { peerInstaller?: unknown }).peerInstaller = undefined;
  try {
    expect((await post({ ...install, introductionId: randomUUID() })).status).toBe(403);
    expect((await post({ ...consented, introductionId: randomUUID() })).status).toBe(403);
  }
  finally { (b.server.ctx as { peerInstaller?: unknown }).peerInstaller = installer; }
  expect(forwardHosts(b)).toHaveLength(0);
  key.fill(0);
}, 60_000);
