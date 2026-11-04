import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { MobileConnectionStore } from '../../mobile/connection.js';
import { createJoinCodeStore } from '../hosts/join-codes.js';
import { EnrolledPeerChannels } from './enrolled-peer-channels.js';
import { PeerIntroductionInstaller, type InstallerConnector } from './introduction-installer.js';
import type { ReceivedIntroduction } from './scoped-link-authority.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const run of cleanups.splice(0).reverse()) await run(); vi.restoreAllMocks(); });

const provider = { getKey: async () => Buffer.alloc(32, 9) };
const ACCOUNT = 'https://connect.example';
const PEER_URL = 'https://s-peer.connect.example';
const OWN_URL = 'https://s-own.connect.example';
const ENROLL_TOKEN = `zcde_${'e'.repeat(24)}`;
const CREDENTIAL = 'c'.repeat(43);
const peerCode = Array(8).fill('BEEF').join('-');
const ordered = (first: string) => () => `${first}${randomUUID().slice(1)}`;
const lower = ordered('0'), middle = ordered('8'), higher = ordered('f');
// The Connect-code branch requires an uppercase A-F within the 14-char span: real codes (BEEF-…) always
// carry letters, while a lowercase randomUUID never does. Without this, an all-digit UUID group window
// (DDDD-DDDD-DDDD) matched the uppercase-hex class and flaked as a false "leak" on unlucky seeds.
const SECRET_PATTERN = /(?=[-A-F0-9]{0,13}[A-F])[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}|zcde_|c{20}|enrollToken|credential/;

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(opts: { responder?: boolean; connect?: boolean; withDataDir?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'installer-connect-')));
  const db = openDatabase(join(root, 'zcc.db'));
  cleanups.push(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const self = middle(), peer = opts.responder ? lower() : higher(), sponsor = randomUUID();
  const ownServerId = randomUUID(), peerServerId = randomUUID(), peerHostId = randomUUID();
  if (opts.connect !== false) {
    await new MobileConnectionStore(join(root, 'mobile', 'connection.json')).write({
      mode: 'connect', accountUrl: ACCOUNT, serverId: ownServerId, publicUrl: OWN_URL, relayToken: 'r'.repeat(43) });
  }
  const joinCodes = createJoinCodeStore(db);
  const channels = new EnrolledPeerChannels(join(root, 'channels'), self, provider);
  cleanups.push(async () => { channels.dispose(); await channels.whenIdle(); });
  const sessions = new Map<string, { socket: { close: ReturnType<typeof vi.fn> } }>();
  const hostHub = { getSession: vi.fn((id: string) => sessions.get(id) ?? null), detach: vi.fn() } as never;
  const clock = { now: 1_000_000 };
  const received: ReceivedIntroduction[] = [];
  const state = { ourCode: undefined as string | undefined, mintCalls: 0, revoked: [] as string[], codeBodies: [] as Array<Record<string, any>>,
    redeemOverride: {} as Record<string, unknown>, servers: 'peer' as 'peer' | 'none' | 'fail', failRevoke: false, failRedeem: false, failMint: false,
    failNames: false, enrolledHostId: peerHostId };
  const peerRedeems = (joinCode: string) => {
    const issued = joinCodes.redeem(joinCode, clock.now);
    if (!issued) return;
    upsertHost(db, { id: issued.hostId, name: 'Peer', hostKeyHash: 'f'.repeat(64), enrollmentCapability: 'peer.forward', isPrimary: false });
    sessions.set(issued.hostId, { socket: { close: vi.fn() } });
  };
  const connectFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace('/api/connect', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    switch (path) {
      case '/hosts': return state.failNames ? new Response('', { status: 500 }) : Response.json({ machines: [] });
      case '/hosts/code': {
        state.mintCalls++;
        if (state.failMint) return new Response('', { status: 500 });
        state.codeBodies.push(body);
        state.ourCode = body.enrollToken;
        const n = String(state.mintCalls).padStart(4, '0');
        return Response.json({ code: Array(8).fill(`A${n.slice(1)}`).join('-'), serverId: ownServerId, hostId: body.hostId, serverUrl: OWN_URL,
          expiresAt: Date.now() + 60_000 });
      }
      case '/hosts/redeem':
        if (state.failRedeem) return new Response('', { status: 500 });
        return Response.json({ accountUrl: ACCOUNT, serverUrl: PEER_URL, hostId: peerHostId, serverId: peerServerId, instanceId: peer,
          credential: CREDENTIAL, enrollToken: ENROLL_TOKEN, expiresAt: Date.now() + 60_000, ...state.redeemOverride });
      case '/servers':
        if (state.servers === 'fail') return new Response('', { status: 500 });
        return Response.json({ servers: state.servers === 'peer' ? [{ id: peerServerId, instanceId: peer, revoked: false }] : [] });
      case '/hosts/revoke':
        if (state.failRevoke) return new Response('', { status: 500 });
        state.revoked.push(body.hostId);
        return Response.json({ revoked: true });
      default: return new Response('', { status: 404 });
    }
  }) as unknown as typeof fetch;
  const authority = {
    receivedIntroductions: vi.fn(async () => received.map(entry => ({ ...entry }))),
    requestIntroductionEnrollment: vi.fn(async (_id: string, _offer: unknown, _signal?: AbortSignal): Promise<any> =>
      ({ connect: { code: peerCode, accountUrl: ACCOUNT, serverId: peerServerId } })),
    notifyIntroductionConsent: vi.fn(async () => ({ recorded: true })),
    authorizeIntroducedInstall: vi.fn(async () => undefined),
    resolveHost: vi.fn(async (_peer: string, ids: readonly string[]) => ids[0] ?? null)
  };
  const connector = {
    enroll: vi.fn(async (_input: Parameters<InstallerConnector['enroll']>[0]) => ({ hostId: state.enrolledHostId, hostKey: 'k'.repeat(40) })),
    connect: vi.fn((input: Parameters<InstallerConnector['connect']>[0]) => {
      const ready = (async () => {
        await channels.register({ remoteInstanceId: input.expectedRemoteInstanceId, hostId: input.hostId, hostKey: input.hostKey, capability: 'peer.forward' });
        if (state.ourCode) peerRedeems(state.ourCode);
        input.onConnectionChange(true);
      })();
      return { ready, close: vi.fn(async () => undefined) };
    })
  };
  const options = {
    directory: join(root, 'peer-installer'), instanceId: self, keyProvider: provider, localAppDataDir: root, db, hostHub, joinCodes, channels, authority,
    localRoute: vi.fn((): string | null => null), connector: connector as InstallerConnector, onChanged: vi.fn(), now: () => clock.now,
    ...(opts.withDataDir === false ? {} : { dataDir: root }), connectFetch, pluginLabel: (pluginId: string) => pluginId === 'test-plugin' ? 'Test Plugin' : undefined
  };
  const make = (extra: Partial<ConstructorParameters<typeof PeerIntroductionInstaller>[0]> = {}) => {
    const installer = new PeerIntroductionInstaller({ ...options, ...extra });
    cleanups.push(async () => { installer.dispose(); await installer.whenIdle(); });
    return installer;
  };
  const approve = (patch: Partial<ReceivedIntroduction> = {}) => {
    const introductionId = randomUUID();
    received.push({ introductionId, sponsorInstanceId: sponsor, peerInstanceId: peer, pluginId: 'test-plugin', scope: 'opaque-scope',
      status: 'approved', receivedAt: clock.now, ...patch } as ReceivedIntroduction);
    return introductionId;
  };
  const consent = (installer: PeerIntroductionInstaller) =>
    installer.peerConsented(sponsor, { introductionId: randomUUID(), pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: peer });
  const input = (over: Record<string, unknown> = {}) => ({ introductionId: randomUUID(), pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: peer,
    connect: { code: peerCode, accountUrl: ACCOUNT, serverId: peerServerId }, ...over }) as Parameters<PeerIntroductionInstaller['install']>[1];
  return { root, db, joinCodes, channels, authority, connector, connectFetch, options, make, approve, consent, input, state, self, peer, sponsor, ownServerId, peerServerId, peerHostId, clock };
}
const forwardHosts = (f: Fixture) => (f.db.sqlite.prepare("SELECT id FROM hosts WHERE destroyed_at IS NULL AND enrollment_capability='peer.forward'").all() as Array<{ id: string }>).map(row => row.id);
const uses = (f: Fixture) => f.db.sqlite.prepare('SELECT host_id, plugin_id, scope, label FROM host_link_uses').all() as Array<{ host_id: string; plugin_id: string; scope: string; label: string }>;
const fail = (run: Promise<unknown>) => run.then(() => null, (error: Error) => error);

it('requester mints the Connect form, redeems at its own account and enrolls with the Connect credential', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  const id = f.approve();
  const result = await installer.enroll(id);
  expect(result).toMatchObject({ status: 'enrolled', role: 'requester', connected: true });
  // Connect form sent to the peer; no local route required (localRoute returns null).
  const [, request] = f.authority.requestIntroductionEnrollment.mock.calls[0]!;
  expect(request).toEqual({ connect: { code: expect.stringMatching(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/), accountUrl: ACCOUNT, serverId: f.ownServerId } });
  expect(f.state.codeBodies[0]).toMatchObject({ instanceId: f.self, enrollToken: expect.stringMatching(/^zcde_/) });
  expect(f.state.codeBodies[0]!.name).toMatch(/^Zana peer link: /);
  // Redeemed at the account with an attempt secret, then enrolled with the Connect credential and own instance id.
  const redeemCall = vi.mocked(f.connectFetch).mock.calls.find(([url]) => String(url).endsWith('/hosts/redeem'))!;
  expect(String(redeemCall[0])).toBe(`${ACCOUNT}/api/connect/hosts/redeem`);
  expect(JSON.parse(String(redeemCall[1]!.body))).toEqual({ code: peerCode, attemptSecret: expect.stringMatching(/^[\w-]{43}$/) });
  expect(f.connector.enroll).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: PEER_URL, joinCode: ENROLL_TOKEN, connectCredential: CREDENTIAL, instanceId: f.self }));
  // connect() uses the attested URL directly (an https non-allowlisted origin would fail route validation) plus credential and instance id.
  expect(f.connector.connect).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: PEER_URL, hostId: f.peerHostId, connectCredential: CREDENTIAL,
    instanceId: f.self, expectedRemoteInstanceId: f.peer }));
  // The inbound host records the plugin use with the registry label.
  const inbound = forwardHosts(f);
  expect(inbound).toHaveLength(1);
  expect(uses(f)).toEqual([{ host_id: inbound[0]!, plugin_id: 'test-plugin', scope: 'opaque-scope', label: 'Test Plugin' }]);
  expect(f.state.revoked).toEqual([]);
  expect(JSON.stringify(await installer.list())).not.toMatch(SECRET_PATTERN);
  // Restart reconnects an enrolled Connect link with the stored credential, never re-enrolling.
  installer.dispose(); await installer.whenIdle();
  const restarted = f.make();
  await restarted.start(); await restarted.whenIdle();
  expect(f.connector.connect).toHaveBeenCalledTimes(2);
  expect(f.connector.connect).toHaveBeenLastCalledWith(expect.objectContaining({ connectCredential: CREDENTIAL, instanceId: f.self, serverUrl: PEER_URL }));
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
});

it('records the plugin id as the use label when the registry has no name', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  f.approve({ pluginId: 'other-plugin' });
  const peer = f.peer;
  await installer.peerConsented(f.sponsor, { introductionId: randomUUID(), pluginId: 'other-plugin', scope: 'opaque-scope', peerInstanceId: peer });
  await installer.whenIdle();
  await vi.waitFor(async () => expect(await installer.list()).toContainEqual(expect.objectContaining({ pluginId: 'other-plugin', status: 'enrolled' })));
  expect(uses(f)).toContainEqual(expect.objectContaining({ plugin_id: 'other-plugin', label: 'other-plugin' }));
});

it.each([
  ['instance mismatch', { instanceId: randomUUID() }, 'peer identity mismatch'],
  ['server mismatch', { serverId: randomUUID() }, 'peer identity mismatch']
] as const)('requester refuses a redeemed %s, tears down and revokes the Connect inbound host', async (_label, override, message) => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  f.state.redeemOverride = override;
  const error = await fail(installer.enroll(f.approve()));
  expect(error?.message).toBe(message);
  expect(error?.message).not.toMatch(SECRET_PATTERN);
  expect(f.connector.enroll).not.toHaveBeenCalled();
  expect(forwardHosts(f)).toEqual([]);
  expect(f.state.revoked).toEqual([f.state.codeBodies[0]!.hostId]);
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'failed', connected: false })]);
});

it('requester refuses an enrolled host that is not the redeemed host', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  f.state.enrolledHostId = randomUUID();
  const error = await fail(installer.enroll(f.approve()));
  expect(error?.message).toBe('peer identity mismatch');
  expect(f.state.revoked).toEqual([f.state.codeBodies[0]!.hostId]);
  expect(f.connector.connect).not.toHaveBeenCalled();
});

it('requester refuses another account, a non-same-account instance and Connect failures without leaking secrets', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  const run = async () => { const error = await fail(installer.enroll(f.approve())); expect(error?.message).not.toMatch(SECRET_PATTERN); return error; };
  f.authority.requestIntroductionEnrollment.mockImplementationOnce(async () => ({ connect: { code: peerCode, accountUrl: 'https://other.example', serverId: f.peerServerId } }));
  expect((await run())?.message).toBe('peer is on another Zana Connect account');
  expect(f.state.redeemOverride).toEqual({});
  f.state.servers = 'none';
  expect((await run())?.message).toBe('peer is on another Zana Connect account');
  f.state.servers = 'fail';
  expect((await run())?.message).toBe('peer enrollment failed: Zana Connect unavailable');
  f.state.servers = 'peer'; f.state.failRedeem = true;
  expect((await run())?.message).toBe('peer enrollment failed: Zana Connect code could not be redeemed');
  expect(f.connector.enroll).not.toHaveBeenCalled();
  expect(forwardHosts(f)).toEqual([]);
  expect(f.state.revoked).toHaveLength(4);
});

it('rejects an offer in the other form than the request', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  f.authority.requestIntroductionEnrollment.mockImplementationOnce(async () => ({ route: 'http://127.0.0.1:4100/', joinCode: `zcde_${'p'.repeat(24)}` }));
  expect((await fail(installer.enroll(f.approve())))?.message).toBe('peer enrollment offer form mismatch');
  expect(f.connector.enroll).not.toHaveBeenCalled();
  expect(f.state.revoked).toHaveLength(1);
  // The route form request rejects a Connect reply as well.
  const g = await fixture({ connect: false }), route = g.make();
  g.options.localRoute.mockReturnValue('http://127.0.0.1:4200/');
  await g.consent(route);
  expect((await fail(route.enroll(g.approve())))?.message).toBe('peer enrollment offer form mismatch');
  expect(g.connectFetch).not.toHaveBeenCalled();
  expect(forwardHosts(g)).toEqual([]);
});

it('keeps the route form when Connect is off, there is no data dir or the connection file is unreadable', async () => {
  for (const kind of ['off', 'nodir', 'corrupt'] as const) {
    const f = await fixture({ connect: kind === 'corrupt', withDataDir: kind !== 'nodir' });
    if (kind === 'corrupt') await writeFile(join(f.root, 'mobile', 'connection.json'), '{not json');
    f.options.localRoute.mockReturnValue('http://127.0.0.1:4200/');
    f.authority.requestIntroductionEnrollment.mockImplementationOnce(async (_id, offer) => {
      f.state.ourCode = (offer as { joinCode: string }).joinCode; return { route: 'http://127.0.0.1:4100/', joinCode: `zcde_${'p'.repeat(24)}` };
    });
    const installer = f.make();
    await f.consent(installer);
    await expect(installer.enroll(f.approve())).resolves.toMatchObject({ status: 'enrolled' });
    expect(f.authority.requestIntroductionEnrollment).toHaveBeenCalledWith(expect.any(String), { route: 'http://127.0.0.1:4200/', joinCode: expect.stringMatching(/^zcde_/) }, expect.any(AbortSignal));
    expect(f.connectFetch).not.toHaveBeenCalled();
    expect(f.connector.enroll).toHaveBeenCalledWith(expect.not.objectContaining({ connectCredential: expect.anything() }));
    expect(f.connector.connect).toHaveBeenCalledWith(expect.not.objectContaining({ connectCredential: expect.anything() }));
  }
});

it('fails closed with a bounded error when the Connect code cannot be minted', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  f.state.failMint = true;
  const error = await fail(installer.enroll(f.approve()));
  expect(error?.message).toBe('peer enrollment unavailable: Zana Connect code could not be minted');
  expect(forwardHosts(f)).toEqual([]);
  expect(f.authority.requestIntroductionEnrollment).not.toHaveBeenCalled();
  // A failing name listing is tolerated (best effort); the code still mints.
  f.state.failMint = false; f.state.failNames = true;
  await expect(installer.enroll(f.approve())).resolves.toMatchObject({ status: 'enrolled' });
});

it('teardown still completes when the Connect revoke fails', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  f.state.redeemOverride = { instanceId: randomUUID() }; f.state.failRevoke = true;
  expect((await fail(installer.enroll(f.approve())))?.message).toBe('peer identity mismatch');
  expect(f.state.revoked).toEqual([]);
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'failed' })]);
  expect(forwardHosts(f)).toEqual([]);
});

it('responder answers a Connect-form install with its own Connect offer, enrolls with the credential and records the use', async () => {
  const f = await fixture({ responder: true }), installer = f.make();
  f.approve();
  const input = f.input();
  const offer = await installer.install(f.sponsor, input);
  expect(offer).toEqual({ connect: { code: expect.stringMatching(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/), accountUrl: ACCOUNT, serverId: f.ownServerId } });
  expect(f.authority.authorizeIntroducedInstall).toHaveBeenCalledWith(f.sponsor, input);
  await vi.waitFor(async () => expect(await installer.list()).toEqual([expect.objectContaining({ role: 'responder', status: 'enrolled', connected: true })]));
  expect(f.connector.enroll).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: PEER_URL, joinCode: ENROLL_TOKEN, connectCredential: CREDENTIAL, instanceId: f.self }));
  expect(f.connector.connect).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: PEER_URL, connectCredential: CREDENTIAL, instanceId: f.self }));
  const inbound = forwardHosts(f);
  expect(inbound).toHaveLength(1);
  expect(uses(f)).toEqual([expect.objectContaining({ host_id: inbound[0]!, plugin_id: 'test-plugin', label: 'Test Plugin' })]);
  // The same relayed code while enrolled re-sends the same offer without minting again.
  await expect(installer.install(f.sponsor, input)).resolves.toEqual(offer);
  expect(f.state.mintCalls).toBe(1);
});

it('responder reuses an unexpired Connect offer on a new relayed code instead of minting again', async () => {
  const f = await fixture({ responder: true }), installer = f.make();
  f.approve();
  f.connector.enroll.mockImplementation(() => new Promise(() => {}));
  const first = await installer.install(f.sponsor, f.input());
  const second = await installer.install(f.sponsor, f.input({ connect: { code: Array(8).fill('C0DE').join('-'), accountUrl: ACCOUNT, serverId: f.peerServerId } }));
  expect(second).toEqual(first);
  expect(f.state.mintCalls).toBe(1);
  expect(f.state.revoked).toEqual([]);
});

it('responder revokes an expired Connect offer before minting a replacement', async () => {
  const f = await fixture({ responder: true }), installer = f.make();
  f.clock.now = Date.now();
  f.approve();
  f.connector.enroll.mockImplementation(() => new Promise(() => {}));
  const first = await installer.install(f.sponsor, f.input());
  const oldHost = f.state.codeBodies[0]!.hostId;
  // Move the installer clock so the stored offer falls inside the 60s expiry margin.
  f.clock.now += 5_000;
  const second = await installer.install(f.sponsor, f.input({ connect: { code: Array(8).fill('C0DE').join('-'), accountUrl: ACCOUNT, serverId: f.peerServerId } }));
  expect(second).not.toEqual(first);
  expect(f.state.mintCalls).toBe(2);
  expect(f.state.revoked).toContain(oldHost);
});

it('responder tears down and revokes its Connect offer host when background enrollment fails', async () => {
  const f = await fixture({ responder: true }), installer = f.make();
  f.approve();
  f.state.redeemOverride = { instanceId: randomUUID() };
  await installer.install(f.sponsor, f.input());
  await installer.whenIdle();
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'failed', role: 'responder' })]);
  expect(f.state.revoked).toEqual([f.state.codeBodies[0]!.hostId]);
  expect(forwardHosts(f)).toEqual([]);
  expect(f.connector.enroll).not.toHaveBeenCalled();
});

it('responder refuses a Connect-form install when local Connect is off, on another account, or unapproved', async () => {
  const off = await fixture({ responder: true, connect: false });
  off.approve();
  const offInstaller = off.make();
  const offError = await fail(offInstaller.install(off.sponsor, off.input()));
  expect(offError?.message).toBe('peer enrollment requires Zana Connect');
  expect(offError?.message).not.toMatch(SECRET_PATTERN);
  expect(await offInstaller.list()).toEqual([]);
  expect(forwardHosts(off)).toEqual([]);

  const noDir = await fixture({ responder: true, withDataDir: false });
  noDir.approve();
  expect((await fail(noDir.make().install(noDir.sponsor, noDir.input())))?.message).toBe('peer enrollment requires Zana Connect');

  const f = await fixture({ responder: true });
  f.approve();
  const installer = f.make();
  const other = await fail(installer.install(f.sponsor, f.input({ connect: { code: peerCode, accountUrl: 'https://other.example', serverId: f.peerServerId } })));
  expect(other?.message).toBe('peer is on another Zana Connect account');
  expect(f.state.mintCalls).toBe(0);
  const noApproval = await fail(installer.install(f.sponsor, f.input({ scope: 'unapproved-scope' })));
  expect(noApproval?.message).toBe('introduction is not approved');
  expect(await installer.list()).toEqual([]);
  expect(f.state.mintCalls).toBe(0);
});

it('responder reports a bounded error when its Connect code cannot be minted and leaves nothing behind', async () => {
  const f = await fixture({ responder: true }), installer = f.make();
  f.approve();
  f.state.failMint = true;
  const error = await fail(installer.install(f.sponsor, f.input()));
  expect(error?.message).toBe('peer enrollment unavailable: Zana Connect code could not be minted');
  expect(error?.message).not.toMatch(SECRET_PATTERN);
  expect(forwardHosts(f)).toEqual([]);
});

it('revoking happens on dispose-independent sweep expiry of a stale pending Connect link', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  // Enrollment hangs so the pending Connect link is abandoned and swept on the next start.
  f.connector.enroll.mockImplementation(() => new Promise(() => {}));
  const pending = installer.enroll(f.approve()).catch((error: Error) => error);
  await vi.waitFor(() => expect(f.connector.enroll).toHaveBeenCalled());
  const hostId = f.state.codeBodies[0]!.hostId;
  installer.dispose(); await pending; await installer.whenIdle();
  const restarted = f.make();
  await restarted.start();
  expect(f.state.revoked).toContain(hostId);
  expect((await restarted.list()).every(link => link.status === 'failed')).toBe(true);
  expect(forwardHosts(f)).toEqual([]);
});
