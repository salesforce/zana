import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getHost, openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { createJoinCodeStore, type JoinCodeStore } from '../hosts/join-codes.js';
import { EnrolledPeerChannels } from './enrolled-peer-channels.js';
import { INSTALLER_MAX_CONSENTS, INSTALLER_MAX_LINKS, INTRODUCTION_APPROVAL_TTL_MS, PeerIntroductionInstaller, type InstallerConnector } from './introduction-installer.js';
import type { ReceivedIntroduction } from './scoped-link-authority.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const run of cleanups.splice(0).reverse()) await run(); vi.restoreAllMocks(); });

const provider = { getKey: async () => Buffer.alloc(32, 9) };
const code = (char: string) => `zcde_${char.repeat(24)}`;
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Instance ids ordered so the test controls who initiates: lower ids initiate. */
const ordered = (first: string) => () => `${first}${randomUUID().slice(1)}`;
const lower = ordered('0'), middle = ordered('8'), higher = ordered('f');

async function fixture(shared?: { root: string; db: ZccDatabase; joinCodes: JoinCodeStore; self: string; peer: string; sponsor: string }, opts: { responder?: boolean } = {}) {
  const root = shared?.root ?? await realpath(await mkdtemp(join(tmpdir(), 'installer-unit-')));
  const db = shared?.db ?? openDatabase(join(root, 'zcc.db'));
  if (!shared) cleanups.push(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const self = shared?.self ?? middle(), peer = shared?.peer ?? (opts.responder ? lower() : higher()), sponsor = shared?.sponsor ?? randomUUID();
  const joinCodes = shared?.joinCodes ?? createJoinCodeStore(db);
  const channels = new EnrolledPeerChannels(join(root, 'channels'), self, provider);
  const sessions = new Map<string, { socket: { close: ReturnType<typeof vi.fn> } }>();
  const hostHub = { getSession: vi.fn((id: string) => sessions.get(id) ?? null), detach: vi.fn() } as never;
  const clock = { now: 1_000_000 };
  const received: ReceivedIntroduction[] = [];
  /** The remote app redeems our forward-only code: its daemon becomes our inbound host with a live session. */
  const peerRedeems = (joinCode: string, capability: 'peer.forward' | 'execution' = 'peer.forward') => {
    const issued = joinCodes.redeem(joinCode, clock.now);
    if (!issued) return null;
    upsertHost(db, { id: issued.hostId, name: 'Peer', hostKeyHash: 'f'.repeat(64), enrollmentCapability: capability, isPrimary: false });
    sessions.set(issued.hostId, { socket: { close: vi.fn() } });
    return issued.hostId;
  };
  const state = { ourCode: undefined as string | undefined, inboundCapability: 'peer.forward' as 'peer.forward' | 'execution', registerChannel: true };
  const authority = {
    receivedIntroductions: vi.fn(async () => received.map(entry => ({ ...entry }))),
    requestIntroductionEnrollment: vi.fn(async (_id: string, offer: { route: string; joinCode: string }) => {
      state.ourCode = offer.joinCode; return { route: 'http://127.0.0.1:4100/', joinCode: code('p') };
    }),
    notifyIntroductionConsent: vi.fn(async (_id: string, _signal?: AbortSignal) => ({ recorded: true })),
    authorizeIntroducedInstall: vi.fn(async () => undefined),
    resolveHost: vi.fn(async (_peer: string, ids: readonly string[]) => ids[0] ?? null)
  };
  const closes: Array<ReturnType<typeof vi.fn>> = [];
  const connector = {
    enroll: vi.fn(async (_input: Parameters<InstallerConnector['enroll']>[0]) => ({ hostId: randomUUID(), hostKey: 'k'.repeat(40) })),
    connect: vi.fn((input: Parameters<InstallerConnector['connect']>[0]) => {
      const close = vi.fn(async () => undefined); closes.push(close);
      const ready = (async () => {
        if (state.registerChannel) await channels.register({ remoteInstanceId: input.expectedRemoteInstanceId, hostId: input.hostId, hostKey: input.hostKey, capability: 'peer.forward' });
        if (state.ourCode) peerRedeems(state.ourCode, state.inboundCapability);
        input.onConnectionChange(true);
      })();
      return { ready, close };
    })
  };
  const options = {
    directory: join(root, 'peer-installer'), instanceId: self, keyProvider: provider, localAppDataDir: root, db, hostHub, joinCodes, channels, authority,
    localRoute: vi.fn((): string | null => 'http://127.0.0.1:4200/'), connector: connector as InstallerConnector, onChanged: vi.fn(), now: () => clock.now
  };
  const make = (extra: Partial<ConstructorParameters<typeof PeerIntroductionInstaller>[0]> = {}) => {
    const installer = new PeerIntroductionInstaller({ ...options, ...extra });
    cleanups.push(async () => { installer.dispose(); await installer.whenIdle(); });
    return installer;
  };
  cleanups.push(async () => { channels.dispose(); await channels.whenIdle(); });
  const approve = (introductionId = randomUUID(), patch: Partial<ReceivedIntroduction> = {}) => {
    received.push({ introductionId, sponsorInstanceId: sponsor, peerInstanceId: peer, pluginId: 'test-plugin', scope: 'opaque-scope',
      status: 'approved', receivedAt: clock.now, ...patch } as ReceivedIntroduction);
    return introductionId;
  };
  /** The other owner's consent, relayed by the sponsor to this (initiating) side. */
  const consent = (installer: PeerIntroductionInstaller, peerInstanceId = peer, introductionId = randomUUID()) =>
    installer.peerConsented(sponsor, { introductionId, pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId });
  return { root, db, joinCodes, channels, sessions, hostHub, clock, received, authority, connector, closes, options, make, approve, consent, peerRedeems, state, self, peer, sponsor,
    shared: { root, db, joinCodes, self, peer, sponsor } };
}
const forwardHosts = (f: Fixture) => (f.db.sqlite.prepare("SELECT id FROM hosts WHERE destroyed_at IS NULL AND enrollment_capability='peer.forward'").all() as Array<{ id: string }>).map(row => row.id);
const daemons = async (f: Fixture) => readdir(join(f.root, 'peer-installer-daemons')).catch(() => [] as string[]);

it('requester enrolls an approved introduction forward-only, deduplicates concurrent calls and stays idempotent', async () => {
  const f = await fixture(), installer = f.make();
  await expect(f.consent(installer)).resolves.toEqual({ recorded: true });
  const id = f.approve();
  const [first, second] = await Promise.all([installer.enroll(id), installer.enroll(id)]);
  expect(first).toEqual(second);
  expect(first).toEqual({ introductionId: id, role: 'requester', peerInstanceId: f.peer, sponsorInstanceId: f.sponsor, pluginId: 'test-plugin',
    scope: 'opaque-scope', status: 'enrolled', capability: 'peer.forward', expiresAt: expect.any(Number), connected: true });
  expect(f.authority.requestIntroductionEnrollment).toHaveBeenCalledTimes(1);
  expect(f.authority.requestIntroductionEnrollment).toHaveBeenCalledWith(id, { route: 'http://127.0.0.1:4200/', joinCode: f.state.ourCode }, expect.any(AbortSignal));
  expect(f.connector.enroll).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://127.0.0.1:4100/', joinCode: code('p') }));
  expect(f.connector.connect).toHaveBeenCalledWith(expect.objectContaining({ expectedRemoteInstanceId: f.peer, serverUrl: 'http://127.0.0.1:4100/' }));
  expect(forwardHosts(f)).toHaveLength(1);
  expect(f.options.onChanged).toHaveBeenCalled();
  // A working link is never re-enrolled.
  await expect(installer.enroll(id)).resolves.toMatchObject({ status: 'enrolled' });
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
  const listed = await installer.list();
  expect(listed).toEqual([first]);
  expect(JSON.stringify(listed)).not.toMatch(/zcde_|kkkk/);
  // Restart: start() reconnects the enrolled link without enrolling again.
  installer.dispose(); await installer.whenIdle();
  const restarted = f.make();
  await restarted.start(); await restarted.whenIdle();
  expect(f.connector.connect).toHaveBeenCalledTimes(2);
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
  await vi.waitFor(async () => expect(await restarted.enroll(id)).toMatchObject({ status: 'enrolled', connected: true }));
});

it('reconnects an enrolled link that has no live connection on a repeated enroll', async () => {
  const f = await fixture(), id = f.approve();
  const first = f.make();
  await f.consent(first); await first.whenIdle();
  await first.enroll(id); first.dispose(); await first.whenIdle();
  const second = f.make();
  await expect(second.enroll(id)).resolves.toMatchObject({ status: 'enrolled' });
  expect(f.connector.connect).toHaveBeenCalledTimes(2);
});

it('fails closed before minting anything for unapproved, expired, malformed or route-less requests', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  await expect(installer.enroll(randomUUID())).rejects.toThrow('introduction is not approved');
  const denied = f.approve(undefined, { status: 'denied' });
  await expect(installer.enroll(denied)).rejects.toThrow('introduction is not approved');
  const old = f.approve(undefined, { receivedAt: f.clock.now - INTRODUCTION_APPROVAL_TTL_MS });
  await expect(installer.enroll(old)).rejects.toThrow('introduction expired');
  expect(() => installer.enroll('bad id')).toThrow();
  f.options.localRoute.mockReturnValue(null);
  await expect(installer.enroll(f.approve())).rejects.toThrow('local peer route unavailable');
  f.options.localRoute.mockReturnValue('http://evil.example/');
  await expect(installer.enroll(f.approve())).rejects.toThrow('peer route is not loopback or allowlisted');
  expect(f.authority.requestIntroductionEnrollment).not.toHaveBeenCalled();
  expect(forwardHosts(f)).toEqual([]);
});

it.each(['request', 'route', 'enroll', 'connect', 'mutual', 'identity', 'abort'] as const)('tears down every created resource when %s fails', async mode => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  const id = f.approve();
  const controller = new AbortController();
  if (mode === 'request') f.authority.requestIntroductionEnrollment.mockRejectedValueOnce(new Error('internal detail zcde_secret'));
  if (mode === 'route') f.authority.requestIntroductionEnrollment.mockImplementationOnce(async () => ({ route: 'https://unlisted.example/', joinCode: code('p') }));
  if (mode === 'enroll') f.connector.enroll.mockRejectedValueOnce(new Error('HTTP 500 with body'));
  if (mode === 'connect') f.connector.connect.mockImplementationOnce(() => ({ ready: Promise.reject(new Error('ws closed')), close: vi.fn(async () => undefined) }));
  if (mode === 'identity') f.authority.resolveHost.mockResolvedValueOnce(null);
  if (mode === 'mutual') {
    f.state.registerChannel = false;
    const original = f.channels.remote.bind(f.channels);
    vi.spyOn(f.channels, 'remote').mockImplementation(async remote => { f.clock.now += 31_000; return original(remote); });
  }
  if (mode === 'abort') f.connector.enroll.mockImplementationOnce(async () => { controller.abort(); throw new Error('aborted'); });
  const error = await installer.enroll(id, controller.signal).then(() => null, (e: Error) => e);
  expect(error?.message).toBe(mode === 'identity' ? 'peer identity mismatch' : mode === 'mutual' ? 'peer enrollment did not complete'
    : mode === 'route' ? 'peer route is not loopback or allowlisted' : mode === 'abort' ? 'peer enrollment cancelled or timed out' : 'peer enrollment failed');
  expect(error?.message).not.toMatch(/zcde_|body|500/);
  expect(await installer.list()).toEqual([expect.objectContaining({ introductionId: id, status: 'failed', connected: false })]);
  expect(forwardHosts(f)).toEqual([]);
  if (f.state.ourCode) expect(f.joinCodes.peek(f.state.ourCode, f.clock.now)).toBeNull();
  vi.mocked(f.channels.remote).mockRestore?.();
  expect(await f.channels.remote(f.peer)).toBeNull();
  expect(await daemons(f)).toEqual([]);
  // A failed link retries cleanly with fresh codes.
  f.state.registerChannel = true; f.authority.resolveHost.mockImplementation(async (_p, ids) => ids[0] ?? null);
  await expect(installer.enroll(id)).resolves.toMatchObject({ status: 'enrolled' });
});

it('never destroys an execution-tier host it did not mint as forward-only', async () => {
  const f = await fixture(), installer = f.make();
  await f.consent(installer);
  const id = f.approve();
  f.state.inboundCapability = 'execution';
  const original = f.channels.remote.bind(f.channels);
  vi.spyOn(f.channels, 'remote').mockImplementation(async remote => { f.clock.now += 31_000; return original(remote); });
  await expect(installer.enroll(id)).rejects.toThrow('peer enrollment did not complete');
  const execution = f.db.sqlite.prepare("SELECT id FROM hosts WHERE enrollment_capability='execution' AND destroyed_at IS NULL").all() as Array<{ id: string }>;
  expect(execution).toHaveLength(1);
  expect(getHost(f.db, execution[0]!.id)?.destroyedAt).toBeNull();
}, 60_000);

it('refuses a peer that is already enrolled through another channel, installs in the wrong direction and unapproved installs', async () => {
  const f = await fixture(), installer = f.make();
  await f.channels.register({ remoteInstanceId: f.peer, hostId: randomUUID(), hostKey: 'x'.repeat(40), capability: 'execution' });
  await expect(installer.enroll(f.approve())).rejects.toThrow('peer is already enrolled');
  await f.consent(installer);
  await expect(installer.enroll(f.approve())).rejects.toThrow('peer is already enrolled');
  // This side initiates towards a higher peer: an install relayed from it is the crossed direction and is refused.
  const install = (g: Fixture, patch: Record<string, string> = {}) => g.make().install(g.sponsor, { introductionId: randomUUID(), pluginId: 'test-plugin',
    scope: 'opaque-scope', peerInstanceId: g.peer, route: 'http://127.0.0.1:4100/', joinCode: code('r'), ...patch });
  await expect(install(f)).rejects.toThrow('peer installation conflicts');
  const r = await fixture(undefined, { responder: true });
  // Responder without its own owner's approval for the pair: refused, nothing minted.
  await expect(install(r)).rejects.toThrow('introduction is not approved');
  r.approve(undefined, { scope: 'other-scope' });
  await expect(install(r)).rejects.toThrow('introduction is not approved');
  r.approve(undefined, { receivedAt: r.clock.now - INTRODUCTION_APPROVAL_TTL_MS });
  await expect(install(r)).rejects.toThrow('introduction is not approved');
  r.approve();
  await r.channels.register({ remoteInstanceId: r.peer, hostId: randomUUID(), hostKey: 'x'.repeat(40), capability: 'execution' });
  await expect(install(r)).rejects.toThrow('peer is already enrolled');
  expect(forwardHosts(f)).toEqual([]); expect(forwardHosts(r)).toEqual([]);
});

it('honours an owner-registered SSH route first and an explicit origin allowlist for advertised routes', async () => {
  const f = await fixture();
  const routeFor = vi.fn(async () => 'http://127.0.0.1:4999/');
  const pinned = f.make({ routeFor });
  await f.consent(pinned);
  await pinned.enroll(f.approve());
  expect(f.connector.enroll).toHaveBeenLastCalledWith(expect.objectContaining({ serverUrl: 'http://127.0.0.1:4999/' }));
  const g = await fixture();
  g.authority.requestIntroductionEnrollment.mockImplementation(async (_id, offer) => { g.state.ourCode = offer.joinCode; return { route: 'https://peer.example/', joinCode: code('p') }; });
  const strict = g.make();
  await g.consent(strict);
  await expect(strict.enroll(g.approve())).rejects.toThrow('peer route is not loopback or allowlisted');
  strict.dispose(); await strict.whenIdle();
  // The allowlist may be async (owner-managed storage) and is read per attempt.
  const allowedOrigins = vi.fn(async () => ['https://peer.example']);
  await expect(g.make({ allowedOrigins }).enroll(g.approve())).resolves.toMatchObject({ status: 'enrolled' });
  expect(allowedOrigins).toHaveBeenCalled();
  expect(g.connector.enroll).toHaveBeenLastCalledWith(expect.objectContaining({ serverUrl: 'https://peer.example/' }));
});

it('responder answers a relayed install quickly, enrolls in the background, reuses an unredeemed offer and restarts on a new code', async () => {
  const f = await fixture(undefined, { responder: true }), installer = f.make(), id = randomUUID();
  f.approve();
  const input = { introductionId: id, pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer, route: 'http://127.0.0.1:4100/', joinCode: code('r') };
  let release!: () => void;
  f.connector.enroll.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { hostId: randomUUID(), hostKey: 'k'.repeat(40) }; });
  const offer = await installer.install(f.sponsor, input);
  expect(offer).toEqual({ route: 'http://127.0.0.1:4200/', joinCode: expect.stringMatching(/^zcde_/) });
  expect(f.authority.authorizeIntroducedInstall).toHaveBeenCalledWith(f.sponsor, input);
  expect(await installer.list()).toEqual([expect.objectContaining({ role: 'responder', status: 'pending' })]);
  // Same relayed code while pending and unconnected restarts only if no attempt is live; offer is reused.
  f.state.ourCode = offer.joinCode;
  await vi.waitFor(() => expect(f.connector.enroll).toHaveBeenCalledTimes(1));
  release();
  await vi.waitFor(async () => expect(await installer.list()).toEqual([expect.objectContaining({ status: 'enrolled', connected: true })]));
  expect(f.connector.enroll).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://127.0.0.1:4100/', joinCode: code('r') }));
  const hostsBefore = forwardHosts(f);
  const again = await installer.install(f.sponsor, input);
  expect(again.joinCode).toBe(offer.joinCode); // enrolled with the same peer code: nothing is re-minted or torn down
  await installer.whenIdle();
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
  expect(forwardHosts(f)).toEqual(hostsBefore);
  // A different relayed code restarts the attempt with a fresh offer (the old one was redeemed).
  const restarted = await installer.install(f.sponsor, { ...input, joinCode: code('s') });
  expect(restarted.joinCode).not.toBe(offer.joinCode);
  f.state.ourCode = restarted.joinCode;
  await vi.waitFor(() => expect(f.connector.enroll).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () => expect(await installer.list()).toEqual([expect.objectContaining({ status: 'enrolled' })]));
  expect(forwardHosts(f).length).toBeGreaterThanOrEqual(1);
});

it('responder reuses an unredeemed offer and fails closed with teardown when background enrollment fails', async () => {
  const f = await fixture(undefined, { responder: true }), installer = f.make(), id = randomUUID();
  f.approve();
  const input = { introductionId: id, pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer, route: 'http://127.0.0.1:4100/', joinCode: code('r') };
  f.connector.enroll.mockRejectedValue(new Error('unreachable'));
  const first = await installer.install(f.sponsor, input);
  await installer.whenIdle();
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'failed' })]);
  expect(f.joinCodes.peek(first.joinCode, f.clock.now)).toBeNull();
  expect(await daemons(f)).toEqual([]);
  f.connector.enroll.mockImplementation(() => new Promise(() => {}));
  const retry = await installer.install(f.sponsor, input);
  const reuse = await installer.install(f.sponsor, input);
  expect(reuse.joinCode).toBe(retry.joinCode);
  // Authorization and route are checked before any state changes.
  f.authority.authorizeIntroducedInstall.mockRejectedValueOnce(new Error('introduction sponsor is not linked'));
  await expect(installer.install(f.sponsor, { ...input, introductionId: randomUUID() })).rejects.toThrow('not linked');
  await expect(installer.install(f.sponsor, { ...input, introductionId: randomUUID(), route: 'https://evil.example/' })).rejects.toThrow('peer route is not loopback or allowlisted');
  const aborted = new AbortController(); aborted.abort();
  await expect(installer.install(f.sponsor, { ...input, introductionId: randomUUID() }, aborted.signal)).rejects.toThrow();
  f.options.localRoute.mockReturnValue(null);
  await expect(installer.install(f.sponsor, { ...input, introductionId: randomUUID() })).rejects.toThrow('local peer route unavailable');
  expect(await installer.list()).toHaveLength(1);
});

it('expires abandoned pending links on sweep and start, and bounds stored links', async () => {
  const f = await fixture(), installer = f.make();
  f.connector.enroll.mockImplementation(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const base = { pluginId: 'test-plugin', scope: 'opaque-scope', route: 'http://127.0.0.1:4100/', joinCode: code('r') };
  /** A lower (initiating) peer whose pair this owner approved. */
  const approvedPeer = () => { const peerInstanceId = lower(); f.approve(undefined, { peerInstanceId }); return peerInstanceId; };
  for (let index = 0; index < INSTALLER_MAX_LINKS; index++) {
    await installer.install(f.sponsor, { ...base, introductionId: randomUUID(), peerInstanceId: approvedPeer() });
  }
  await expect(installer.install(f.sponsor, { ...base, introductionId: randomUUID(), peerInstanceId: approvedPeer() })).rejects.toThrow('capacity');
  expect(await installer.sweep()).toBe(0);
  f.clock.now += 16 * 60_000;
  // Expired pending entries are evictable even before a sweep.
  await installer.install(f.sponsor, { ...base, introductionId: randomUUID(), peerInstanceId: approvedPeer() });
  expect(await installer.sweep()).toBe(INSTALLER_MAX_LINKS - 1);
  expect((await installer.list()).filter(link => link.status === 'failed')).toHaveLength(INSTALLER_MAX_LINKS - 1);
  installer.dispose(); await installer.whenIdle();
  const restarted = f.make();
  await restarted.start();
  expect((await restarted.list()).every(link => link.status === 'failed')).toBe(true);
  expect(forwardHosts(f)).toEqual([]);
}, 60_000);

it('dispose aborts in-flight work, closes connections and rejects later calls', async () => {
  const f = await fixture(), installer = f.make(), id = f.approve();
  await f.consent(installer); await installer.whenIdle();
  await installer.enroll(id);
  const other = higher();
  await f.consent(installer, other);
  const pendingId = f.approve(undefined, { peerInstanceId: other });
  f.connector.enroll.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const pending = installer.enroll(pendingId).catch((error: Error) => error);
  await vi.waitFor(() => expect(f.connector.enroll).toHaveBeenCalledTimes(2));
  installer.dispose(); installer.dispose();
  expect(await pending).toBeInstanceOf(Error);
  await installer.whenIdle();
  expect(f.closes[0]).toHaveBeenCalled();
  expect(() => installer.enroll(id)).toThrow('disposed');
  await expect(installer.install(f.sponsor, { introductionId: id, pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer,
    route: 'http://127.0.0.1:4100/', joinCode: code('r') })).rejects.toThrow('disposed');
  await expect(installer.list()).rejects.toThrow('disposed');
  await expect(installer.sweep()).rejects.toThrow('disposed');
  expect(() => installer.start()).toThrow('disposed');
});

it('initiator waits as awaiting without minting until the peer consents, then enrolls exactly once', async () => {
  const f = await fixture(), installer = f.make(), id = f.approve();
  // Half-approved: only this owner approved. Nothing is minted or requested.
  const waiting = await installer.enroll(id);
  expect(waiting).toMatchObject({ introductionId: id, role: 'requester', status: 'awaiting', connected: false });
  await expect(installer.enroll(id)).resolves.toMatchObject({ status: 'awaiting' });
  expect(f.authority.requestIntroductionEnrollment).not.toHaveBeenCalled();
  expect(f.authority.notifyIntroductionConsent).not.toHaveBeenCalled();
  expect(forwardHosts(f)).toEqual([]);
  // The peer's consent arrives (relayed): the single enrollment starts in the background; replays are idempotent.
  await expect(f.consent(installer)).resolves.toEqual({ recorded: true });
  await expect(f.consent(installer)).resolves.toEqual({ recorded: true });
  await installer.whenIdle();
  expect(await installer.list()).toEqual([expect.objectContaining({ introductionId: id, role: 'requester', status: 'enrolled', connected: true })]);
  expect(f.authority.requestIntroductionEnrollment).toHaveBeenCalledTimes(1);
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
  expect(forwardHosts(f)).toHaveLength(1);
  // A late replay after enrollment does not enroll again.
  await f.consent(installer); await installer.whenIdle();
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
  expect((await installer.list()).filter(link => link.status === 'failed')).toEqual([]);
});

it('consent notices are authorized, ignored towards the non-initiator, bounded and validated', async () => {
  const f = await fixture(), installer = f.make();
  // Without this owner's approval the consent is only recorded.
  await expect(f.consent(installer)).resolves.toEqual({ recorded: true });
  await installer.whenIdle();
  expect(await installer.list()).toEqual([]);
  // A notice for a lower peer is the crossed direction: this side never initiates there.
  await expect(f.consent(installer, lower())).resolves.toEqual({ recorded: false });
  f.authority.authorizeIntroducedInstall.mockRejectedValueOnce(new Error('introduction sponsor is not linked'));
  await expect(f.consent(installer, higher())).rejects.toThrow('not linked');
  await expect(installer.peerConsented(f.sponsor, { introductionId: 'bad id', pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer })).rejects.toThrow();
  // The consent store is capped; the oldest entry is dropped first.
  for (let index = 0; index < INSTALLER_MAX_CONSENTS; index++) await f.consent(installer, higher());
  // The very first consent (for f.peer) was evicted: an approved enroll for it now waits again.
  await expect(installer.enroll(f.approve())).resolves.toMatchObject({ status: 'awaiting' });
  expect(f.authority.requestIntroductionEnrollment).not.toHaveBeenCalled();
  installer.dispose();
  await expect(f.consent(installer)).rejects.toThrow('disposed');
});

it('a concurrent consent waits for the in-flight attempt, then starts the enrollment', async () => {
  const f = await fixture(), installer = f.make(), id = f.approve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = f.authority.receivedIntroductions.getMockImplementation()!;
  f.authority.receivedIntroductions.mockImplementationOnce(async () => { await gate; return original(); });
  const first = installer.enroll(id);
  const consented = f.consent(installer);
  release();
  await expect(first).resolves.toMatchObject({ introductionId: id });
  await consented; await installer.whenIdle();
  await expect(installer.enroll(id)).resolves.toMatchObject({ status: 'enrolled' });
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
});

it('non-initiator records consent as an awaiting responder, notifies the initiator and retries undelivered notices', async () => {
  const f = await fixture(undefined, { responder: true }), installer = f.make(), id = f.approve();
  f.authority.notifyIntroductionConsent.mockRejectedValueOnce(new Error('sponsor offline'));
  const first = await installer.enroll(id);
  expect(first).toMatchObject({ introductionId: id, role: 'responder', status: 'awaiting', peerInstanceId: f.peer,
    expiresAt: f.clock.now + INTRODUCTION_APPROVAL_TTL_MS });
  expect(f.authority.notifyIntroductionConsent).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  expect(f.authority.requestIntroductionEnrollment).not.toHaveBeenCalled();
  expect(forwardHosts(f)).toEqual([]);
  // A repeated approval retries the undelivered notice; the initiator may decline to record it.
  f.authority.notifyIntroductionConsent.mockResolvedValueOnce({ recorded: false });
  await installer.enroll(id);
  expect(f.authority.notifyIntroductionConsent).toHaveBeenCalledTimes(2);
  // The sweep re-notifies; once recorded the notice is not repeated.
  expect(await installer.sweep()).toBe(0);
  expect(f.authority.notifyIntroductionConsent).toHaveBeenCalledTimes(3);
  await installer.sweep(); await installer.enroll(id);
  expect(f.authority.notifyIntroductionConsent).toHaveBeenCalledTimes(3);
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'awaiting', role: 'responder' })]);
  // The initiator's install (under its own introduction id) takes over the awaiting link.
  const otherId = randomUUID();
  const offer = await installer.install(f.sponsor, { introductionId: otherId, pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer,
    route: 'http://127.0.0.1:4100/', joinCode: code('r') });
  f.state.ourCode = offer.joinCode;
  await vi.waitFor(async () => expect(await installer.list()).toEqual([expect.objectContaining({ introductionId: otherId, role: 'responder', status: 'enrolled' })]));
  // Approving again after enrollment changes nothing.
  await expect(installer.enroll(id)).resolves.toMatchObject({ status: 'enrolled' });
  expect(f.authority.notifyIntroductionConsent).toHaveBeenCalledTimes(3);
});

it('a failed responder link is replaced by a fresh awaiting consent on re-approval', async () => {
  const f = await fixture(undefined, { responder: true }), installer = f.make(), id = f.approve();
  f.connector.enroll.mockRejectedValueOnce(new Error('unreachable'));
  await installer.install(f.sponsor, { introductionId: randomUUID(), pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer,
    route: 'http://127.0.0.1:4100/', joinCode: code('r') });
  await installer.whenIdle();
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'failed' })]);
  await expect(installer.enroll(id)).resolves.toMatchObject({ introductionId: id, status: 'awaiting' });
  expect(await installer.list()).toHaveLength(1);
  // A foreign channel blocks the consent.
  const g = await fixture(undefined, { responder: true });
  await g.channels.register({ remoteInstanceId: g.peer, hostId: randomUUID(), hostKey: 'x'.repeat(40), capability: 'execution' });
  await expect(g.make().enroll(g.approve())).rejects.toThrow('peer is already enrolled');
});

it('a newer approval replaces an unnotified awaiting responder record so the notice goes through the new introduction', async () => {
  const f = await fixture(undefined, { responder: true }), installer = f.make(), first = f.approve();
  f.authority.notifyIntroductionConsent.mockRejectedValueOnce(new Error('old sponsor offline'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await installer.enroll(first);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('consent notification failed'));
  expect(await installer.list()).toEqual([expect.objectContaining({ introductionId: first, status: 'awaiting' })]);
  const second = f.approve();
  await expect(installer.enroll(second)).resolves.toMatchObject({ introductionId: second, status: 'awaiting' });
  expect(f.authority.notifyIntroductionConsent).toHaveBeenLastCalledWith(second, expect.any(AbortSignal));
  expect(await installer.list()).toEqual([expect.objectContaining({ introductionId: second, status: 'awaiting' })]);
  // Once the notice was delivered the record is left alone.
  const third = f.approve();
  await installer.enroll(third);
  expect(await installer.list()).toEqual([expect.objectContaining({ introductionId: second })]);
  warn.mockRestore();
});

it('a teardown failure never blocks the failed state transition', async () => {
  const f = await fixture(undefined, { responder: true }), installer = f.make();
  f.approve();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(f.joinCodes, 'invalidateHost').mockImplementation(() => { throw new Error('disk gone'); });
  f.connector.enroll.mockRejectedValue(new Error('unreachable'));
  await installer.install(f.sponsor, { introductionId: randomUUID(), pluginId: 'test-plugin', scope: 'opaque-scope', peerInstanceId: f.peer,
    route: 'http://127.0.0.1:4100/', joinCode: code('r') });
  await installer.whenIdle();
  expect(await installer.list()).toEqual([expect.objectContaining({ status: 'failed' })]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('teardown failed'));
  warn.mockRestore();
});

it('half-approved pairs expire cleanly on sweep, along with stale consents, leaving nothing behind', async () => {
  const f = await fixture(), installer = f.make(), id = f.approve();
  const r = await fixture(undefined, { responder: true }), responder = r.make(), rid = r.approve();
  await installer.enroll(id); await responder.enroll(rid);
  await f.consent(installer, higher());
  expect(await installer.sweep()).toBe(0);
  f.clock.now += INTRODUCTION_APPROVAL_TTL_MS; r.clock.now += INTRODUCTION_APPROVAL_TTL_MS;
  const changed = f.options.onChanged.mock.calls.length;
  expect(await installer.sweep()).toBe(1);
  expect(await responder.sweep()).toBe(1);
  expect(await installer.list()).toEqual([]); expect(await responder.list()).toEqual([]);
  expect(f.options.onChanged.mock.calls.length).toBeGreaterThan(changed);
  expect(await installer.sweep()).toBe(0);
  expect(forwardHosts(f)).toEqual([]); expect(forwardHosts(r)).toEqual([]);
  expect(await daemons(f)).toEqual([]);
  // The expired approval itself is refused afterwards.
  await expect(installer.enroll(id)).rejects.toThrow('introduction expired');
});

it('start resumes an awaiting initiator whose peer consent arrived before this owner approved', async () => {
  const f = await fixture(), first = f.make();
  await first.enroll(f.approve());
  // Consent arrives while the approval is momentarily not visible: it is only recorded.
  f.authority.receivedIntroductions.mockResolvedValueOnce([]);
  await f.consent(first); await first.whenIdle();
  expect(await first.list()).toEqual([expect.objectContaining({ status: 'awaiting' })]);
  first.dispose(); await first.whenIdle();
  const restarted = f.make();
  await restarted.start(); await restarted.whenIdle();
  expect(await restarted.list()).toEqual([expect.objectContaining({ status: 'enrolled', role: 'requester' })]);
  expect(f.connector.enroll).toHaveBeenCalledTimes(1);
});

it('expired awaiting links are evictable at capacity', async () => {
  const f = await fixture(), installer = f.make();
  for (let index = 0; index < INSTALLER_MAX_LINKS; index++) await installer.enroll(f.approve(undefined, { peerInstanceId: higher() }));
  await expect(installer.enroll(f.approve(undefined, { peerInstanceId: higher() }))).rejects.toThrow('capacity');
  f.clock.now += INTRODUCTION_APPROVAL_TTL_MS;
  await expect(installer.enroll(f.approve(undefined, { peerInstanceId: higher() }))).resolves.toMatchObject({ status: 'awaiting' });
  expect(await installer.list()).toHaveLength(INSTALLER_MAX_LINKS);
});
