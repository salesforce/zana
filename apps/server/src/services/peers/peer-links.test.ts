import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyHost, getHost, openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { generateSeed, publicKeyLine } from '@zana-ai/zcc-host-daemon/ssh-keys';
import { createJoinCodeStore } from '../hosts/join-codes.js';
import { EnrolledPeerChannels } from './enrolled-peer-channels.js';
import { InvitationError } from './peer-invitation.js';
import { BootstrapRejection } from './peer-link-bootstrap.js';
import {
  LINK_LINE_TTL_MS, PEER_LINK_BOOTSTRAP_SKEW_MS, PEER_LINK_PRE_CONSENT_MAX_MS, PEER_LINK_ROTATION_MS, PEER_OFFLINE_AFTER_MS, PEER_RELINK_ACCEPT_INTERVAL_MS, PEER_RELINK_AFTER_MS, PeerLinks
} from './peer-links.js';
import type { AuthorizedKeyInput, AuthorizedKeyKind, OpenTunnelInput, PeerSshEndpoint, SshReason } from './peer-ssh-contract.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const provider = { getKey: async () => Buffer.alloc(32, 7) };
const joinToken = () => `zcde_${randomBytes(18).toString('base64url')}`;
const F = 41_000;
const LOCAL = 45_000;

const cleanups: Array<() => Promise<void> | void> = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Peer { id: string; host: string }
interface OpenedTunnel { linkId: string; input: OpenTunnelInput; onState: (up: boolean, failure?: SshReason) => void; close: ReturnType<typeof vi.fn>; localPort: number }

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-links-')));
  const db = openDatabase(join(root, 'zcc.db'));
  const self = randomUUID();
  const joinCodes = createJoinCodeStore(db);
  const channels = new EnrolledPeerChannels(join(root, 'channels'), self, provider);
  cleanups.push(async () => { channels.dispose(); await channels.whenIdle(); db.close(); await rm(root, { recursive: true, force: true }); });
  const clock = { t: Date.now() };

  // ---- fake SSH transport ----
  const endpoint: PeerSshEndpoint = { host: 'alice.local', port: 22, user: 'alice', hostKey: publicKeyLine(generateSeed()) };
  const lines = new Map<string, AuthorizedKeyInput>();
  const held = new Set<string>();
  const opened: OpenedTunnel[] = [];
  const keys = new Map<string, string>();
  const ssh = {
    fail: {} as { endpoint?: unknown; acquire?: unknown; upsert?: unknown; remove?: unknown; tunnel?: unknown; port?: number },
    localEndpoint: vi.fn(async (_signal: AbortSignal) => { if (ssh.fail.endpoint) throw ssh.fail.endpoint; return endpoint; }),
    forwarder: {
      acquire: vi.fn(async (id: string) => { if (ssh.fail.acquire) throw ssh.fail.acquire; held.add(id); return ssh.fail.port ?? F; }),
      release: vi.fn(async (id: string) => { held.delete(id); })
    },
    authorizedKeys: {
      upsert: vi.fn(async (input: AuthorizedKeyInput) => { if (ssh.fail.upsert) throw ssh.fail.upsert; lines.set(`${input.linkId}:${input.kind}`, input); }),
      remove: vi.fn(async (linkId: string, kind?: AuthorizedKeyKind) => {
        if (ssh.fail.remove) throw ssh.fail.remove;
        for (const key of [...lines.keys()]) if (key.startsWith(`${linkId}:`) && (!kind || key.endsWith(`:${kind}`))) lines.delete(key);
      }),
      reconcile: vi.fn(async (live: ReadonlySet<string>) => { for (const key of [...lines.keys()]) if (!live.has(key.split(':')[0]!)) lines.delete(key); }),
      list: vi.fn(async () => [...lines.keys()].map(key => ({ linkId: key.split(':')[0]!, kind: key.split(':')[1] as AuthorizedKeyKind })))
    },
    openTunnel: vi.fn(async (linkId: string, input: OpenTunnelInput, onState: OpenedTunnel['onState']) => {
      if (ssh.fail.tunnel) throw ssh.fail.tunnel;
      const localPort = input.localPort ?? LOCAL;
      const close = vi.fn(async () => undefined);
      opened.push({ linkId, input, onState, close, localPort });
      onState(true);
      return { url: `http://127.0.0.1:${localPort}/`, localPort, close };
    }),
    linkKey: vi.fn(async (linkId: string) => { if (!keys.has(linkId)) keys.set(linkId, publicKeyLine(generateSeed())); return keys.get(linkId)!; }),
    dropLinkKey: vi.fn(async (linkId: string) => { keys.delete(linkId); }),
    reconcileLinkKeys: vi.fn(async (live: ReadonlySet<string>) => { for (const id of [...keys.keys()]) if (!live.has(id)) keys.delete(id); })
  };

  const enrollIds = new Map<string, string>();
  const sessions = new Map<string, { instanceId: string; socket: { close: ReturnType<typeof vi.fn> } }>();
  const hostHub = { getSession: vi.fn((id: string) => sessions.get(id)), detach: vi.fn(), callHostOnlineRpc: vi.fn() };
  const state = { pull: undefined as any, exchange: undefined as any };
  const send = vi.fn(async (_host: string, _recipient: string, input: any, _signal: AbortSignal) => {
    if (input.op === 'bootstrap.pull') return state.pull;
    if (input.op === 'bootstrap.abort') return { ok: true };
    return state.exchange ?? {};
  });
  const conns: Array<{ input: any; close: ReturnType<typeof vi.fn>; set(connected: boolean): void }> = [];
  const connector = {
    enroll: vi.fn(async (input: any) => ({ hostId: enrollIds.get(input.joinCode) ?? randomUUID(), hostKey: 'k'.repeat(40) })),
    connect: vi.fn((input: any) => {
      const close = vi.fn(async () => undefined);
      conns.push({ input, close, set: (connected: boolean) => input.onConnectionChange(connected) });
      return { ready: Promise.resolve(), close };
    })
  };
  const inv = {
    fence: vi.fn(), listConsented: vi.fn(async (): Promise<any[]> => []), markConnecting: vi.fn(async () => undefined),
    markReady: vi.fn(async () => undefined), markFailed: vi.fn(async () => undefined), founding: vi.fn(async () => undefined),
    nudge: vi.fn(async () => undefined), terminateRemote: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
    redeemWire: vi.fn(async () => ({ w: 'redeem' })), acceptRedeem: vi.fn(async (): Promise<any> => ({ ok: 1 })),
    acceptExchange: vi.fn(async (): Promise<any> => ({ ok: 2 }))
  };
  const bridge = {
    peerRotate: vi.fn(async (): Promise<any> => ({ accepted: true })),
    peerRelink: vi.fn(async (): Promise<any> => ({ accepted: false })),
    peerRemove: vi.fn(async (): Promise<any> => ({ accepted: true }))
  };
  const onChanged = vi.fn();
  const options = {
    directory: join(root, 'peer-links'), instanceId: self, keyProvider: provider, localAppDataDir: root, db,
    hostHub: hostHub as never, joinCodes, channels, ssh: ssh as never, invitations: () => inv as never, send: send as never, bridge: bridge as never,
    connector: connector as never, pluginLabel: (id: string) => (id === 'test-plugin' ? 'Test Plugin' : undefined), onChanged, now: () => clock.t
  };
  const make = (extra: Record<string, unknown> = {}) => {
    const links = new PeerLinks({ ...options, ...extra } as never);
    cleanups.push(async () => { links.dispose(); await links.whenIdle(); });
    return links;
  };
  const settle = async (links: PeerLinks, ms = 0) => {
    // Storage I/O is real, timers are fake: alternate until the chained lane work and the timers it arms have drained.
    await links.whenIdle(); await vi.advanceTimersByTimeAsync(ms); await links.whenIdle();
    await vi.advanceTimersByTimeAsync(0); await links.whenIdle();
  };
  const seedHost = (hostId: string) => upsertHost(db, { id: hostId, name: 'Peer', hostKeyHash: 'f'.repeat(64), enrollmentCapability: 'peer.forward', isPrimary: false });
  const session = (hostId: string, instanceId: string) => { const entry = { instanceId, socket: { close: vi.fn() } }; sessions.set(hostId, entry); return entry; };
  const newPeer = (): Peer => ({ id: randomUUID(), host: randomUUID() });
  const create = (links: PeerLinks, invitationId = randomUUID()) => links.invitationLinks.create({ invitationId, pluginId: 'test-plugin', scope: 'scope-a' });
  /** The offer the inviter's token would carry for this peer's host. */
  const offerFor = (peer: Peer, over: Record<string, unknown> = {}) => {
    const joinCode = joinToken();
    enrollIds.set(joinCode, peer.host);
    return { v: 1 as const, endpoint, bootstrapSeed: generateSeed(), listenPort: 41_001, targetPort: F, hostId: peer.host, joinCode, ...over };
  };
  const redeem = async (links: PeerLinks, peer: Peer, over: { id?: string; link?: Record<string, unknown>; signal?: AbortSignal } = {}) => {
    const invitationId = over.id ?? randomUUID();
    await links.invitationLinks.redeem({ invitationId, inviterId: peer.id, inviterName: 'Bob', pluginId: 'test-plugin', scope: 'scope-a',
      link: offerFor(peer, over.link) as never }, over.signal ?? new AbortController().signal);
    return invitationId;
  };
  const pairing = (role: 'inviter' | 'redeemer', invitationId: string, remoteId: string, over: Record<string, unknown> = {}) => ({
    invitationId, pairingId: `pair-${invitationId.slice(0, 8)}`, consentDigest: 'd'.repeat(64), generation: 1, role, state: 'consented',
    pluginId: 'test-plugin', scope: 'scope-a', local: { instanceId: self, fingerprint: 'ff' },
    remote: { instanceId: remoteId, name: 'Remote Name', fingerprint: 'ff', ed: 'e', x: 'x', sshKey: publicKeyLine(generateSeed()) }, ...over
  }) as any;
  const answer = (links: PeerLinks, invitationId: string, hostId: string) => links.answerPull(invitationId, hostId, new AbortController().signal);
  const recOf = (links: PeerLinks, id: string): any => (links as any).mirror.get(id);

  /** Redeemer after redeem + the inviter's pull: own inbound H' minted and seeded with the inviter's session. */
  const redeemerPreConsent = async (links: PeerLinks, peer = newPeer()) => {
    const id = await redeem(links, peer);
    const pull = await answer(links, id, peer.host);
    seedHost(pull.reverse.hostId); session(pull.reverse.hostId, peer.id);
    return { id, peer, pull, inboundId: pull.reverse.hostId };
  };
  const redeemerLinked = async (links: PeerLinks, peer = newPeer()) => {
    const ctx = await redeemerPreConsent(links, peer);
    links.onConsented(pairing('redeemer', ctx.id, peer.id));
    await links.whenIdle(); await settle(links, 0);
    return ctx;
  };
  /** Inviter after create + the redeemer's session on H + a successful pull (connector opened, not yet connected). */
  const inviterPulled = async (links: PeerLinks, peer = newPeer()) => {
    const id = randomUUID();
    const mint = await create(links, id);
    seedHost(mint.offer.hostId); session(mint.offer.hostId, peer.id);
    const reverse = joinToken();
    enrollIds.set(reverse, peer.host);
    state.pull = { redeem: { wire: 'redeem' }, reverse: { hostId: peer.host, code: reverse, expiresAt: clock.t + 120_000 } };
    links.onInboundConnected(mint.offer.hostId);
    await settle(links, 2000);
    return { id, peer, mint, reverse };
  };
  const inviterLinked = async (links: PeerLinks, peer = newPeer()) => {
    const ctx = await inviterPulled(links, peer);
    conns[conns.length - 1]!.set(true);
    const p = pairing('inviter', ctx.id, peer.id);
    await links.onFounding(p, { op: 'offer' });
    await links.onFounding(p, { op: 'ack' });
    return { ...ctx, pairing: p };
  };
  return { root, db, joinCodes, channels, clock, enrollIds, sessions, hostHub, state, send, conns, connector, inv, bridge, onChanged, ssh, lines, held, opened, keys,
    endpoint, options, make, settle, seedHost, session, newPeer, create, offerFor, redeem, pairing, answer, recOf, redeemerPreConsent, redeemerLinked,
    inviterPulled, inviterLinked, self };
}
const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;

describe('createInvitationLink (inviter)', () => {
  it('reserves F, authorizes a bootstrap line, mints H and persists the pre-consent record', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    const mint = await f.create(links, id);
    expect(mint.offer).toMatchObject({ v: 1, endpoint: f.endpoint, targetPort: F, hostId: expect.any(String), joinCode: expect.stringMatching(/^zcde_/) });
    expect(mint.offer.bootstrapSeed).toMatch(/^[\w-]{43}$/);
    expect(f.held.has(id)).toBe(true);
    const line = f.lines.get(`${id}:bootstrap`)!;
    expect(line).toMatchObject({ pub: publicKeyLine(mint.offer.bootstrapSeed), listenPort: mint.offer.listenPort, targetPort: F });
    // Token expiry plus skew, not the ~74 minute pre-consent maximum.
    expect(line.expiresAt).toBe(mint.expiresAt + PEER_LINK_BOOTSTRAP_SKEW_MS);
    expect(line.expiresAt!).toBeLessThan(f.clock.t + PEER_LINK_PRE_CONSENT_MAX_MS);
    expect(f.onChanged).toHaveBeenCalled();
    const fresh = f.make(); await fresh.start();
    expect(fresh.isLinkUsable(mint.offer.hostId)).toBe(false);
    expect(await fresh.links()).toEqual([]);
    expect(JSON.stringify(f.recOf(fresh, id))).not.toContain(mint.offer.bootstrapSeed);
  });

  it('maps ssh reasons from the endpoint probe to InvitationErrors and acquires nothing', async () => {
    const f = await fixture(), links = f.make();
    for (const reason of ['ssh_remote_login_off', 'ssh_auth_refused', 'ssh_forwarding_refused', 'ssh_unreachable', 'ssh_host_key_mismatch']) {
      f.ssh.fail.endpoint = new Error(reason);
      await expect(f.create(links)).rejects.toMatchObject({ code: reason });
    }
    f.ssh.fail.endpoint = new Error('secret /Users/alice/.ssh/id');
    const unknown = await f.create(links).catch(error => error);
    expect(unknown).toMatchObject({ code: 'unavailable' });
    expect(String(unknown.message)).not.toContain('alice');
    expect(f.ssh.forwarder.acquire).not.toHaveBeenCalled();
  });

  it('passes an InvitationError from the transport through', async () => {
    const f = await fixture(), links = f.make();
    f.ssh.fail.endpoint = new InvitationError('capacity');
    await expect(f.create(links)).rejects.toMatchObject({ code: 'capacity' });
  });

  it('undoes every step in reverse when the authorized_keys write fails', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    f.ssh.fail.upsert = new Error('ssh_auth_refused');
    await expect(f.create(links, id)).rejects.toMatchObject({ code: 'ssh_auth_refused' });
    expect(f.ssh.forwarder.release).toHaveBeenCalledWith(id);
    expect(f.held.size).toBe(0);
    expect(f.recOf(links, id)).toBeUndefined();
    expect(f.lines.size).toBe(0);
    // The id is reusable once undone.
    f.ssh.fail.upsert = undefined;
    await expect(f.create(links, id)).resolves.toMatchObject({ offer: { hostId: expect.any(String) } });
  });

  it('undoes in reverse (bootstrap line, host, record, forwarder) when the record update fails after the mint', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    const invalidate = vi.spyOn(f.joinCodes, 'invalidateHost');
    vi.spyOn(links as any, 'update').mockImplementationOnce(async () => { throw new Error('disk'); });
    await expect(f.create(links, id)).rejects.toMatchObject({ code: 'unavailable' });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(order(f.ssh.authorizedKeys.remove)).toBeLessThan(order(invalidate));
    expect(order(invalidate)).toBeLessThan(order(f.ssh.forwarder.release));
    expect(f.ssh.authorizedKeys.remove).toHaveBeenCalledWith(id, 'bootstrap');
    expect(f.lines.size).toBe(0);
    expect(f.held.size).toBe(0);
    expect(f.recOf(links, id)).toBeUndefined();
  });

  it('releases the forwarder when the reservation of F succeeds but the host mint fails', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    vi.spyOn(f.joinCodes, 'mintForwardOnly').mockImplementation(() => { throw new Error('too many'); });
    await expect(f.create(links, id)).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.lines.size).toBe(0);
    expect(f.held.size).toBe(0);
    expect(f.recOf(links, id)).toBeUndefined();
  });

  it('fails cleanly when F cannot be acquired', async () => {
    const f = await fixture(), links = f.make();
    f.ssh.fail.acquire = new Error('EADDRINUSE');
    await expect(f.create(links)).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.ssh.authorizedKeys.upsert).not.toHaveBeenCalled();
  });

  it('caps pre-consent links at 4 and rejects duplicate ids, undoing the extra reservation', async () => {
    const f = await fixture(), links = f.make();
    const ids = [1, 2, 3, 4].map(() => randomUUID());
    for (const id of ids) await f.create(links, id);
    const extra = randomUUID();
    await expect(f.create(links, extra)).rejects.toMatchObject({ code: 'capacity' });
    expect(f.held.has(extra)).toBe(false);
    await expect(f.create(links, ids[0]!)).rejects.toMatchObject({ code: 'already_redeemed' });
  });

  it('keeps the existing link\'s forwarder hold and authorized_keys lines when the same id is created twice', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    const first = await f.create(links, id);
    const line = { ...f.lines.get(`${id}:bootstrap`)! };
    f.ssh.forwarder.release.mockClear(); f.ssh.authorizedKeys.remove.mockClear();
    await expect(f.create(links, id)).rejects.toMatchObject({ code: 'already_redeemed' });
    expect(f.ssh.forwarder.release).not.toHaveBeenCalled();
    expect(f.ssh.authorizedKeys.remove).not.toHaveBeenCalled();
    expect(f.held.has(id)).toBe(true);
    expect(f.lines.get(`${id}:bootstrap`)).toEqual(line);
    expect(f.recOf(links, id)).toBeDefined();
    expect(first.offer.hostId).toBeTruthy();
  });

  it('refuses work after dispose', async () => {
    const f = await fixture(), links = f.make();
    links.dispose();
    await expect(f.create(links)).rejects.toThrow('disposed');
    await expect(links.links()).rejects.toThrow('disposed');
    await expect(links.sweep()).resolves.toBeUndefined();
  });
});

describe('redeemInvitationLink (redeemer)', () => {
  it('opens the tunnel with the bootstrap seed, enrolls into H through it and connects over the loopback url', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const link = f.offerFor(peer);
    const id = await f.redeem(links, peer, { link });
    expect(f.ssh.openTunnel).toHaveBeenCalledWith(id, expect.objectContaining({ endpoint: f.endpoint, identity: { seed: link.bootstrapSeed }, listenPort: 41_001, targetPort: F }), expect.any(Function));
    expect(f.connector.enroll).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: `http://127.0.0.1:${LOCAL}/`, joinCode: link.joinCode, instanceId: f.self }));
    expect(f.connector.connect).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: `http://127.0.0.1:${LOCAL}/`, hostId: peer.host, expectedRemoteInstanceId: peer.id }));
    expect(f.recOf(links, id).ssh).toMatchObject({ side: 'client', localPort: LOCAL, bootstrapSeed: link.bootstrapSeed });
    expect(await links.links()).toMatchObject([{ peerInstanceId: peer.id, role: 'redeemer', phase: 'pending', state: 'reconnecting' }]);
  });

  it('is idempotent and reopens the connector of an enrolled link whose connection is gone', async () => {
    const f = await fixture(), first = f.make(), peer = f.newPeer();
    const id = await f.redeem(first, peer);
    await f.redeem(first, peer, { id });
    expect(f.connector.enroll).toHaveBeenCalledTimes(1);
    expect(f.connector.connect).toHaveBeenCalledTimes(1);
    first.dispose(); await first.whenIdle();
    const second = f.make();
    await second.start();
    expect(f.connector.connect).toHaveBeenCalledTimes(2);
    await f.redeem(second, peer, { id }); // already live: nothing reopened
    expect(f.connector.enroll).toHaveBeenCalledTimes(1);
    expect(f.connector.connect).toHaveBeenCalledTimes(2);
  });

  it('rejects an enrollment into a different host and closes the tunnel', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer(), link = f.offerFor(peer);
    f.enrollIds.set(link.joinCode, randomUUID());
    await expect(f.redeem(links, peer, { link })).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(f.opened[0]!.close).toHaveBeenCalled();
  });

  it('surfaces ssh failures as the exact ssh_* reason and reduces anything else', async () => {
    for (const reason of ['ssh_remote_login_off', 'ssh_auth_refused', 'ssh_host_key_mismatch']) {
      const f = await fixture(), links = f.make(); // fresh app each: failed redeems keep a record against the pre-consent cap
      f.ssh.fail.tunnel = new Error(reason);
      await expect(f.redeem(links, f.newPeer())).rejects.toMatchObject({ code: reason });
      expect(f.connector.enroll).not.toHaveBeenCalled();
    }
    const g = await fixture(), other = g.make();
    g.ssh.fail.tunnel = new Error('Permission denied (publickey) for alice@10.0.0.4');
    const error = await g.redeem(other, g.newPeer()).catch(caught => caught);
    expect(error).not.toBeInstanceOf(InvitationError);
    expect(String(error.message)).toBe('peer link step failed');
    const h = await fixture(), third = h.make();
    h.ssh.fail.tunnel = new InvitationError('ssh_unreachable');
    await expect(h.redeem(third, h.newPeer())).rejects.toMatchObject({ code: 'ssh_unreachable' });
  });

  it('turns an enroll failure into a retryable error', async () => {
    const f = await fixture(), links = f.make();
    f.connector.enroll.mockRejectedValueOnce(new Error('boom zcde_leak'));
    const error = await f.redeem(links, f.newPeer()).catch(caught => caught);
    expect(String(error.message)).toBe('peer link enrollment failed');
  });

  it('refuses an inviter that already has an enrolled channel and a reused terminal id', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    vi.spyOn(f.channels, 'remote').mockResolvedValueOnce({ hostId: randomUUID() } as never);
    await expect(f.redeem(links, peer)).rejects.toMatchObject({ code: 'already_connected' });
    const id = await f.redeem(links, peer);
    // A live link to the same inviter refuses a second invitation from it, even without an enrolled channel.
    await expect(f.redeem(links, peer, { id: randomUUID() })).rejects.toMatchObject({ code: 'already_connected' });
    await links.remove(peer.id);
    await expect(f.redeem(links, peer, { id })).rejects.toMatchObject({ code: 'already_redeemed' });
  });

  it('honours an aborted signal and closes a tunnel that opened late', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const controller = new AbortController();
    controller.abort();
    await expect(f.redeem(links, peer, { signal: controller.signal })).rejects.toBeDefined();
    expect(f.connector.enroll).not.toHaveBeenCalled();

    const late = new AbortController();
    let release!: () => void;
    f.ssh.openTunnel.mockImplementationOnce(async (linkId: string, input: OpenTunnelInput, onState: any) => {
      await new Promise<void>(resolve => { release = resolve; });
      const close = vi.fn(async () => undefined);
      f.opened.push({ linkId, input, onState, close, localPort: LOCAL });
      return { url: `http://127.0.0.1:${LOCAL}/`, localPort: LOCAL, close };
    });
    const pending = f.redeem(links, f.newPeer(), { signal: late.signal }).catch(error => error);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    late.abort();
    expect(await pending).toBeInstanceOf(Error);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.opened.at(-1)!.close).toHaveBeenCalled();
  });
});

describe('pull (inviter) and answerPull (redeemer)', () => {
  it('pulls, redeems, enrolls into H\' through the -R port and connects', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    expect(f.inv.acceptRedeem).toHaveBeenCalledWith({ wire: 'redeem' }, { redeemerId: ctx.peer.id });
    const offer = ctx.mint.offer;
    expect(f.connector.enroll).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: `http://127.0.0.1:${offer.listenPort}/`, joinCode: ctx.reverse }));
    expect(f.connector.connect).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: `http://127.0.0.1:${offer.listenPort}/`, hostId: ctx.peer.host, expectedRemoteInstanceId: ctx.peer.id }));
    expect(f.recOf(links, ctx.id).reverse).toBeUndefined();
    expect(f.recOf(links, ctx.id).outbound.url).toBe(`http://127.0.0.1:${offer.listenPort}/`);
  });

  it('drops the reverse code after a lost enroll reply and pulls a fresh one on retry', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const id = randomUUID();
    const mint = await f.create(links, id);
    f.seedHost(mint.offer.hostId); f.session(mint.offer.hostId, peer.id);
    const first = joinToken(), second = joinToken();
    f.enrollIds.set(first, peer.host); f.enrollIds.set(second, peer.host);
    f.state.pull = { redeem: { wire: 'r1' }, reverse: { hostId: peer.host, code: first, expiresAt: f.clock.t + 120_000 } };
    f.connector.enroll.mockRejectedValueOnce(new TypeError('reply lost'));
    links.onInboundConnected(mint.offer.hostId);
    await f.settle(links, 2000);
    expect(f.connector.connect).not.toHaveBeenCalled();
    expect(f.recOf(links, id).reverse).toBeUndefined();
    expect((links as any).wires.has(id)).toBe(false);
    f.state.pull = { redeem: { wire: 'r2' }, reverse: { hostId: peer.host, code: second, expiresAt: f.clock.t + 120_000 } };
    await f.settle(links, 5000);
    expect(f.connector.enroll).toHaveBeenLastCalledWith(expect.objectContaining({ joinCode: second }));
    expect(f.connector.connect).toHaveBeenCalledTimes(1);
  });

  it('re-mints H\' when its code was redeemed but the peer never attached (lost enroll reply)', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const id = await f.redeem(links, peer);
    const first = await f.answer(links, id, peer.host);
    expect(await f.answer(links, id, peer.host)).toMatchObject({ reverse: { code: first.reverse.code } }); // unspent: reused
    f.seedHost(first.reverse.hostId);
    expect(f.joinCodes.redeem(first.reverse.code, f.clock.t)).not.toBeNull(); // redeemed, no session
    const second = await f.answer(links, id, peer.host);
    expect(second.reverse.code).not.toBe(first.reverse.code);
    expect(second.reverse.hostId).not.toBe(first.reverse.hostId);
    expect(getHost(f.db, first.reverse.hostId)?.destroyedAt).toBeTruthy();
  });

  it('keeps the code when the peer redeemed and attached, and rejects unknown or wrong-host pulls', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const id = await f.redeem(links, peer);
    const first = await f.answer(links, id, peer.host);
    f.seedHost(first.reverse.hostId); f.session(first.reverse.hostId, peer.id);
    f.joinCodes.redeem(first.reverse.code, f.clock.t);
    expect((await f.answer(links, id, peer.host)).reverse.code).toBe(first.reverse.code);
    await expect(f.answer(links, id, randomUUID())).rejects.toBeInstanceOf(BootstrapRejection);
    await expect(f.answer(links, randomUUID(), peer.host)).rejects.toBeInstanceOf(BootstrapRejection);
    vi.spyOn(f.joinCodes, 'mintForwardOnly').mockImplementation(() => { throw new Error('full'); });
    f.clock.t += 20 * 60_000;
    await expect(f.answer(links, id, peer.host)).rejects.toBeInstanceOf(BootstrapRejection);
  });

  it('ends the invitation when the redeem is refused with an InvitationError and retries other failures', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer(), id = randomUUID();
    const mint = await f.create(links, id);
    f.seedHost(mint.offer.hostId); f.session(mint.offer.hostId, peer.id);
    const reverse = joinToken(); f.enrollIds.set(reverse, peer.host);
    f.state.pull = { redeem: { wire: 'r' }, reverse: { hostId: peer.host, code: reverse, expiresAt: f.clock.t + 120_000 } };
    f.inv.acceptRedeem.mockRejectedValueOnce(new InvitationError('fenced'));
    links.onInboundConnected(mint.offer.hostId);
    await f.settle(links, 2000);
    expect(f.inv.fail).toHaveBeenCalledWith(id, 'fenced');

    const other = await fixture(), retry = other.make(), p2 = other.newPeer();
    const id2 = randomUUID();
    const m2 = await other.create(retry, id2);
    other.seedHost(m2.offer.hostId); other.session(m2.offer.hostId, p2.id);
    other.state.pull = { redeem: { wire: 'r' }, reverse: { hostId: p2.host, code: joinToken(), expiresAt: other.clock.t + 120_000 } };
    other.enrollIds.set(other.state.pull.reverse.code, randomUUID()); // enrolls into the wrong host
    retry.onInboundConnected(m2.offer.hostId);
    await other.settle(retry, 2000);
    expect(other.inv.fail).toHaveBeenCalledWith(id2, 'identity_mismatch');
  });

  it('ignores inbound sessions with an unusable claim', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    const mint = await f.create(links, id);
    f.seedHost(mint.offer.hostId); f.session(mint.offer.hostId, f.self);
    links.onInboundConnected(mint.offer.hostId);
    await f.settle(links, 2000);
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe('acceptExchange / acceptAbort / onTerminated', () => {
  it('relays exchange replies and maps InvitationErrors', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    const host = ctx.peer.host;
    expect(await links.acceptExchange(ctx.id, ctx.peer.id, host, 'redeem', {}, new AbortController().signal)).toEqual({ ok: 1 });
    expect(await links.acceptExchange(ctx.id, ctx.peer.id, host, 'exchange', {}, new AbortController().signal)).toEqual({ ok: 2 });
    f.inv.acceptExchange.mockRejectedValueOnce(new InvitationError('expired'));
    expect(await links.acceptExchange(ctx.id, ctx.peer.id, host, 'exchange', {}, new AbortController().signal)).toEqual({ error: 'expired' });
    f.inv.acceptExchange.mockRejectedValueOnce(new Error('boom'));
    await expect(links.acceptExchange(ctx.id, ctx.peer.id, host, 'exchange', {}, new AbortController().signal)).rejects.toThrow('boom');
    await expect(links.acceptExchange(ctx.id, randomUUID(), host, 'exchange', {}, new AbortController().signal)).rejects.toBeInstanceOf(BootstrapRejection);
  });

  it('tears the inviter down on termination: bootstrap line removed, forwarder released, abort sent', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    expect(f.lines.has(`${ctx.id}:bootstrap`)).toBe(true);
    links.onTerminated(ctx.id, 'inviter', 'denied');
    await f.settle(links, 0);
    expect(f.lines.size).toBe(0);
    expect(f.held.has(ctx.id)).toBe(false);
    expect(f.send).toHaveBeenCalledWith(ctx.mint.offer.hostId, ctx.peer.id, expect.objectContaining({ op: 'bootstrap.abort', reason: 'denied' }), expect.anything());
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'failed', failure: 'fenced' });
    expect(f.recOf(links, ctx.id).ssh.bootstrapSeed).toBeUndefined();
  });

  it('closes the redeemer tunnel and drops its key on termination (expired maps to expired)', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    links.onTerminated(ctx.id, 'redeemer', 'expired');
    await f.settle(links, 0);
    expect(f.opened[0]!.close).toHaveBeenCalled();
    expect(f.ssh.dropLinkKey).toHaveBeenCalledWith(ctx.id);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'failed', failure: 'expired' });
    expect(f.recOf(links, ctx.id).ssh.bootstrapSeed).toBeUndefined();
  });

  it('tears down silently when the peer aborts', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    await links.acceptAbort(ctx.id, ctx.peer.id, ctx.peer.host, 'denied');
    expect(f.inv.terminateRemote).toHaveBeenCalledWith(ctx.id, 'denied');
    await f.settle(links, 1000);
    expect(f.recOf(links, ctx.id).phase).toBe('failed');
    expect(f.send).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ op: 'bootstrap.abort' }), expect.anything());
    await links.acceptAbort(randomUUID(), ctx.peer.id, ctx.peer.host, 'denied'); // unknown: no-op
  });

  it('keeps teardown best effort when line removal fails', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    f.ssh.fail.remove = new Error('ssh_auth_refused');
    links.onTerminated(ctx.id, 'inviter', 'cancelled');
    await f.settle(links, 0);
    expect(f.held.has(ctx.id)).toBe(false);
    expect(f.recOf(links, ctx.id).phase).toBe('failed');
  });
});

describe('founding and key swap', () => {
  it('redeemer: offer, swap to the link key on the same local port before the ack, then activate', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    const before = f.opened.length;
    links.onConsented(f.pairing('redeemer', ctx.id, ctx.peer.id));
    await f.settle(links, 0);
    expect(f.opened[0]!.close).toHaveBeenCalled();
    expect(f.opened).toHaveLength(before + 1);
    expect(f.opened.at(-1)!.input.identity).toEqual({ linkKey: true });
    expect(f.opened.at(-1)!.input.localPort).toBe(LOCAL);
    const ops = f.inv.founding.mock.calls.map((call: any[]) => call[1].op);
    expect(ops).toEqual(['offer', 'ack']);
    expect(order(f.ssh.openTunnel) < f.inv.founding.mock.invocationCallOrder[1]!).toBe(true);
    expect(f.opened.at(-1)!.linkId).toBe(ctx.id);
    expect(f.inv.markReady).toHaveBeenCalled();
    const rec = f.recOf(links, ctx.id);
    expect(rec).toMatchObject({ phase: 'linked', ssh: { identity: 'link' } });
    expect(rec.ssh.bootstrapSeed).toBeUndefined();
    expect(getHost(f.db, ctx.inboundId)?.purpose).toMatchObject({ kind: 'plugin-link' });
  });

  it('redeemer: a failing tunnel swap retries with backoff and the ack waits', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    f.ssh.fail.tunnel = new Error('ssh_unreachable');
    links.onConsented(f.pairing('redeemer', ctx.id, ctx.peer.id));
    await f.settle(links, 0);
    expect(f.inv.founding.mock.calls.map((call: any[]) => call[1].op)).toEqual(['offer']);
    expect(f.recOf(links, ctx.id).phase).toBe('activating');
    f.ssh.fail.tunnel = undefined;
    await f.settle(links, 1000);
    expect(f.recOf(links, ctx.id).phase).toBe('linked');
  });

  it('redeemer: a fenced founding tears down and fails the invitation', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    f.inv.founding.mockRejectedValueOnce(new InvitationError('fenced'));
    links.onConsented(f.pairing('redeemer', ctx.id, ctx.peer.id));
    await f.settle(links, 0);
    expect(f.inv.fail).toHaveBeenCalledWith(ctx.id, 'fenced');
    expect(f.recOf(links, ctx.id).phase).toBe('failed');
  });

  it('inviter: offer adds the link line next to the bootstrap line, ack drops the bootstrap line', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    f.conns.at(-1)!.set(true);
    const p = f.pairing('inviter', ctx.id, ctx.peer.id);
    await links.onFounding(p, { op: 'offer' });
    expect(f.lines.get(`${ctx.id}:link`)).toMatchObject({ pub: p.remote.sshKey, listenPort: ctx.mint.offer.listenPort, targetPort: F });
    expect(f.lines.has(`${ctx.id}:bootstrap`)).toBe(true);
    await links.onFounding(p, { op: 'offer' }); // idempotent
    await links.onFounding(p, { op: 'ack' });
    expect(f.lines.has(`${ctx.id}:bootstrap`)).toBe(false);
    expect(f.lines.has(`${ctx.id}:link`)).toBe(true);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'linked', ssh: { linkPub: p.remote.sshKey } });
    expect(f.recOf(links, ctx.id).ssh.throwawayPub).toBeUndefined();
    await links.onFounding(p, { op: 'ack' }); // already linked
  });

  it('inviter: refuses an offer without the redeemer key, before the link is up, out of order, or for a redeemer', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    const p = f.pairing('inviter', ctx.id, ctx.peer.id);
    await expect(links.onFounding(p, { op: 'offer' })).rejects.toThrow('not established');
    f.conns.at(-1)!.set(true);
    await expect(links.onFounding({ ...p, remote: { ...p.remote, sshKey: undefined } }, { op: 'offer' })).rejects.toMatchObject({ code: 'fenced' });
    await expect(links.onFounding(p, { op: 'ack' })).rejects.toThrow('out of order');
    await expect(links.onFounding({ ...p, role: 'redeemer' }, { op: 'offer' })).rejects.toMatchObject({ code: 'fenced' });
    await expect(links.onFounding({ ...p, remote: { ...p.remote, instanceId: randomUUID() } }, { op: 'offer' })).rejects.toMatchObject({ code: 'fenced' });
  });

  it('inviter: a failed bootstrap removal is retried by the supervisor', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    f.conns.at(-1)!.set(true);
    const p = f.pairing('inviter', ctx.id, ctx.peer.id);
    await links.onFounding(p, { op: 'offer' });
    f.ssh.fail.remove = new Error('ssh_auth_refused');
    await links.onFounding(p, { op: 'ack' });
    expect(f.recOf(links, ctx.id).ssh.throwawayPub).toBeDefined();
    f.ssh.fail.remove = undefined;
    await links.sweep();
    expect(f.lines.has(`${ctx.id}:bootstrap`)).toBe(false);
    expect(f.recOf(links, ctx.id).ssh.throwawayPub).toBeUndefined();
  });

  it('binds only a matching consented pairing', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    links.onConsented(f.pairing('inviter', ctx.id, ctx.peer.id)); // wrong role
    await f.settle(links, 0);
    expect(f.inv.markFailed).toHaveBeenCalled();
    expect(f.recOf(links, ctx.id).pairingId).toBeUndefined();
  });

  it('inviter nudges the redeemer when it approved last; the redeemer polls on a nudge', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    links.onConsented(f.pairing('inviter', ctx.id, ctx.peer.id));
    await f.settle(links, 0);
    expect(f.send).toHaveBeenCalledWith(ctx.mint.offer.hostId, ctx.peer.id, expect.objectContaining({ op: 'bootstrap.nudge' }), expect.anything());

    const g = await fixture(), redeemer = g.make();
    const r = await g.redeemerPreConsent(redeemer);
    await redeemer.acceptNudge(r.id, r.peer.id, r.peer.host);
    expect(g.inv.nudge).toHaveBeenCalledWith(r.id);
    await redeemer.acceptNudge(r.id, randomUUID(), r.peer.host); // wrong peer: ignored
    expect(g.inv.nudge).toHaveBeenCalledTimes(1);
  });
});

describe('linked lifecycle', () => {
  it('rotateOwn mints a fresh code for the own inbound host and hands it to the peer', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    f.ssh.openTunnel.mockClear();
    await links.rotate(ctx.peer.id);
    expect(f.bridge.peerRotate).toHaveBeenCalledWith(ctx.inboundId, expect.objectContaining({ recipientInstanceId: ctx.peer.id, hostId: ctx.inboundId, code: expect.stringMatching(/^zcde_/) }), expect.anything());
    await expect(links.rotate(randomUUID())).rejects.toThrow('not linked');
    f.bridge.peerRotate.mockResolvedValueOnce({ accepted: false });
    await links.rotate(ctx.peer.id);
  });

  it('acceptRotate stores the code and re-enrolls at the existing loopback url', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const code = joinToken(); f.enrollIds.set(code, ctx.peer.host);
    const outboundHost = f.recOf(links, ctx.id).outbound.hostId;
    expect(await links.acceptRotate(ctx.peer.id, outboundHost, { code, expiresAt: f.clock.t + 60_000 }, new AbortController().signal)).toEqual({ accepted: true });
    const connects = f.connector.connect.mock.calls.length;
    await f.settle(links, 1000);
    expect(f.connector.enroll).toHaveBeenLastCalledWith(expect.objectContaining({ joinCode: code, serverUrl: `http://127.0.0.1:${LOCAL}/` }));
    expect(f.connector.connect.mock.calls.length).toBe(connects + 1);
    expect(f.recOf(links, ctx.id).pendingRotate).toBeUndefined();
  });

  it('acceptRotate refuses bad codes, expired codes and unknown links; a mismatching host drops the pending code', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const outboundHost = f.recOf(links, ctx.id).outbound.hostId;
    const signal = new AbortController().signal;
    expect(await links.acceptRotate(ctx.peer.id, outboundHost, { code: 'nope', expiresAt: f.clock.t + 1000 }, signal)).toEqual({ accepted: false });
    expect(await links.acceptRotate(ctx.peer.id, outboundHost, { code: joinToken(), expiresAt: f.clock.t - 1 }, signal)).toEqual({ accepted: false });
    expect(await links.acceptRotate(randomUUID(), outboundHost, { code: joinToken(), expiresAt: f.clock.t + 1000 }, signal)).toEqual({ accepted: false });
    // Enrolls into a different host: the pending code is dropped.
    expect(await links.acceptRotate(ctx.peer.id, outboundHost, { code: joinToken(), expiresAt: f.clock.t + 60_000 }, signal)).toEqual({ accepted: true });
    await f.settle(links, 1000);
    expect(f.recOf(links, ctx.id).pendingRotate).toBeUndefined();
  });

  it('drops an expired pending rotation without enrolling', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const outboundHost = f.recOf(links, ctx.id).outbound.hostId;
    await links.acceptRotate(ctx.peer.id, outboundHost, { code: joinToken(), expiresAt: f.clock.t + 500 }, new AbortController().signal);
    f.clock.t += 600;
    const enrolls = f.connector.enroll.mock.calls.length;
    await f.settle(links, 1000);
    expect(f.connector.enroll.mock.calls.length).toBe(enrolls);
    expect(f.recOf(links, ctx.id).pendingRotate).toBeUndefined();
  });

  it('acceptRelink mints for the own inbound host, paced, and refuses unknown peers', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const first = await links.acceptRelink(ctx.peer.id, ctx.inboundId, new AbortController().signal);
    expect(first).toMatchObject({ accepted: true, code: expect.stringMatching(/^zcde_/) });
    expect(await links.acceptRelink(ctx.peer.id, ctx.inboundId, new AbortController().signal)).toEqual({ accepted: false });
    f.clock.t += PEER_RELINK_ACCEPT_INTERVAL_MS + 1;
    expect(await links.acceptRelink(ctx.peer.id, ctx.inboundId, new AbortController().signal)).toMatchObject({ accepted: true });
    expect(await links.acceptRelink(randomUUID(), ctx.inboundId, new AbortController().signal)).toEqual({ accepted: false });
    vi.spyOn(f.joinCodes, 'mintForwardOnlyForHost').mockImplementation(() => { throw new Error('gone'); });
    f.clock.t += PEER_RELINK_ACCEPT_INTERVAL_MS + 1;
    expect(await links.acceptRelink(ctx.peer.id, ctx.inboundId, new AbortController().signal)).toEqual({ accepted: false });
  });

  it('redeemer asks the peer to relink when its connector stays down while the peer is reachable', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const code = joinToken(); f.enrollIds.set(code, ctx.peer.host);
    f.bridge.peerRelink.mockResolvedValue({ accepted: true, code, expiresAt: f.clock.t + 60_000 });
    f.conns.at(-1)!.set(false);
    f.opened.at(-1)!.onState(true);
    links.onInboundConnected(ctx.inboundId);
    f.clock.t += PEER_RELINK_AFTER_MS + 1; // the injected clock does not follow fake timers
    await f.settle(links, PEER_RELINK_AFTER_MS + 1);
    expect(f.bridge.peerRelink).toHaveBeenCalledWith(ctx.inboundId, expect.objectContaining({ recipientInstanceId: ctx.peer.id }), expect.anything());
    expect(f.connector.enroll).toHaveBeenLastCalledWith(expect.objectContaining({ joinCode: code }));
  });

  it('never relinks when the redeemer tunnel is down (ssh heals itself) or on the inviter', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    f.conns.at(-1)!.set(false);
    f.opened.at(-1)!.onState(false, 'ssh_unreachable');
    links.onInboundConnected(ctx.inboundId);
    await f.settle(links, PEER_RELINK_AFTER_MS + 1);
    expect(f.bridge.peerRelink).not.toHaveBeenCalled();

    const g = await fixture(), inviter = g.make();
    await g.inviterLinked(inviter);
    g.conns.at(-1)!.set(false);
    await g.settle(inviter, PEER_RELINK_AFTER_MS + PEER_OFFLINE_AFTER_MS);
    expect(g.bridge.peerRelink).not.toHaveBeenCalled();
  });

  it('scheduled rotation fires from the supervisor once the interval elapsed', async () => {
    const f = await fixture(), links = f.make();
    await f.redeemerLinked(links);
    f.bridge.peerRotate.mockClear();
    await links.sweep();
    expect(f.bridge.peerRotate).not.toHaveBeenCalled();
    f.clock.t += PEER_LINK_ROTATION_MS + 1;
    await links.sweep();
    expect(f.bridge.peerRotate).toHaveBeenCalledTimes(1);
  });
});

describe('teardown, remove, release', () => {
  it('inviter remove: tells the peer, removes both lines, releases the forwarder, destroys H', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    expect(f.lines.has(`${ctx.id}:link`)).toBe(true);
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(f.bridge.peerRemove).toHaveBeenCalled();
    expect(f.lines.size).toBe(0);
    expect(f.held.size).toBe(0);
    expect(f.conns.at(-1)!.close).toHaveBeenCalled();
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'removed', removal: 'removed' });
    expect(f.recOf(links, ctx.id).ssh.linkPub).toBeUndefined();
    expect(await links.remove(ctx.peer.id)).toBe(false);
  });

  it('redeemer remove: closes the tunnel and drops the link key', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    await links.remove(ctx.peer.id);
    expect(f.opened.at(-1)!.close).toHaveBeenCalled();
    expect(f.ssh.dropLinkKey).toHaveBeenCalledWith(ctx.id);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'removed' });
    expect(f.recOf(links, ctx.id).ssh.endpoint).toBeUndefined();
  });

  it('removes a pre-consent link as cancelled', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(f.inv.fail).toHaveBeenCalledWith(ctx.id, 'cancelled');
    expect(f.lines.size).toBe(0);
    expect(f.held.size).toBe(0);
  });

  it('acceptRemoval removes the local side and runs grant cleanup after the reply has left', async () => {
    const onRemoved = vi.fn(async () => undefined);
    const f = await fixture(), links = f.make({ onRemoved });
    const ctx = await f.inviterLinked(links);
    const outbound = f.recOf(links, ctx.id).outbound.hostId;
    expect(await links.acceptRemoval(ctx.peer.id, ctx.mint.offer.hostId, { pairingId: ctx.pairing.pairingId, hostId: outbound })).toEqual({ accepted: true });
    expect(await links.acceptRemoval(randomUUID(), ctx.mint.offer.hostId, { pairingId: 'x', hostId: outbound })).toEqual({ accepted: false });
    await f.settle(links, 1000);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'removed', removal: 'revoked' });
    expect(f.lines.size).toBe(0);
    expect(f.bridge.peerRemove).not.toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalledWith(ctx.peer.id);
  });

  it('useRoute names the linked unpaused connection and useRouteFor demands the same sender, host and pairing', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    const route = links.useRoute(ctx.peer.id);
    expect(route).toMatchObject({ pairingId: ctx.pairing.pairingId, hostId: ctx.mint.offer.hostId });
    expect(links.useRouteFor(ctx.peer.id, ctx.mint.offer.hostId, ctx.pairing.pairingId)).toEqual(route);
    expect(links.useRouteFor(ctx.peer.id, ctx.mint.offer.hostId, 'other')).toBeUndefined();
    expect(links.useRouteFor(ctx.peer.id, randomUUID(), ctx.pairing.pairingId)).toBeUndefined();
    expect(links.useRouteFor(randomUUID(), ctx.mint.offer.hostId, ctx.pairing.pairingId)).toBeUndefined();
    expect(links.useRoute(randomUUID())).toBeUndefined();
  });

  it('release drops one plugin use and keeps the link even with the last one', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    expect(await links.release(ctx.peer.id, 'other-plugin', 'x')).toBe(false);
    expect(await links.release(ctx.peer.id, 'test-plugin', 'scope-a')).toBe(true);
    expect(f.recOf(links, ctx.id).phase).toBe('linked');
    expect(f.bridge.peerRemove).not.toHaveBeenCalled();
    expect(await links.release(ctx.peer.id, 'test-plugin', 'scope-a')).toBe(false);
  });

  it('a released founding use stays released across a restart (no use is re-added at startup)', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.redeemerLinked(first);
    expect(getHost(f.db, ctx.inboundId)?.purpose).toMatchObject({ uses: [expect.objectContaining({ pluginId: 'test-plugin' })] });
    expect(await first.release(ctx.peer.id, 'test-plugin', 'scope-a')).toBe(true);
    first.dispose(); await first.whenIdle();
    const second = f.make();
    await second.start();
    expect(f.recOf(second, ctx.id).phase).toBe('linked');
    expect(getHost(f.db, ctx.inboundId)?.purpose).toEqual({ kind: 'plugin-link', uses: [] });
  });

  it('remove is local-first: teardown finishes while the peer notice is still pending', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    f.bridge.peerRemove.mockImplementationOnce(() => new Promise(() => undefined));
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(f.bridge.peerRemove).toHaveBeenCalledTimes(1);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'removed' });
    expect(f.lines.size).toBe(0);
  });

  it('remove survives a rejecting or throwing peer notice', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    f.bridge.peerRemove.mockImplementationOnce(() => { throw new Error('sync boom'); });
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'removed' });
    const g = await fixture(), l2 = g.make();
    const c2 = await g.inviterLinked(l2);
    g.bridge.peerRemove.mockRejectedValueOnce(new Error('offline'));
    expect(await l2.remove(c2.peer.id)).toBe(true);
    expect(g.recOf(l2, c2.id)).toMatchObject({ phase: 'removed' });
  });

  it('remove runs onRemoved for the peer, and a failing hook does not fail removal', async () => {
    const onRemoved = vi.fn(async () => { throw new Error('cleanup boom'); });
    const f = await fixture(), links = f.make({ onRemoved });
    const ctx = await f.inviterLinked(links);
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(onRemoved).toHaveBeenCalledWith(ctx.peer.id);
    expect(await links.remove(ctx.peer.id)).toBe(false);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('remove runs onRemoving before teardown, and a failing hook never vetoes it', async () => {
    const order: string[] = [];
    const onRemoving = vi.fn(async () => { order.push('removing'); throw new Error('plugin boom'); });
    const onRemoved = vi.fn(async () => { order.push('removed'); });
    const f = await fixture(), links = f.make({ onRemoving, onRemoved });
    const ctx = await f.inviterLinked(links);
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(onRemoving).toHaveBeenCalledWith(ctx.peer.id);
    expect(order).toEqual(['removing', 'removed']);
    expect(await links.remove(ctx.peer.id)).toBe(false);
    expect(onRemoving).toHaveBeenCalledTimes(1);
  });

  it('an owner removal that already ran the handlers skips onRemoving but still tears down', async () => {
    const onRemoving = vi.fn(), onRemoved = vi.fn();
    const f = await fixture(), links = f.make({ onRemoving, onRemoved });
    const ctx = await f.inviterLinked(links);
    const hostId = f.recOf(links, ctx.id).inbound!.hostId;
    expect(await links.directory.remove!(hostId, { hooksRan: true })).toEqual({ linkRemoved: true });
    expect(onRemoving).not.toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalledWith(ctx.peer.id);
    expect(f.recOf(links, ctx.id).phase).toBe('removed');
  });

  it('link lines carry a 30 day expiry that each peer connect renews', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    expect(f.lines.get(`${ctx.id}:link`)!.expiresAt).toBe(f.clock.t + LINK_LINE_TTL_MS);
    f.clock.t += 10 * 24 * 60 * 60 * 1000;
    links.onInboundConnected(f.recOf(links, ctx.id).inbound.hostId);
    await f.settle(links, 50);
    expect(f.lines.get(`${ctx.id}:link`)!.expiresAt).toBe(f.clock.t + LINK_LINE_TTL_MS);
  });

  it('release cancels a pending invitation of that scope', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    expect(await links.release(ctx.peer.id, 'test-plugin', 'scope-a')).toBe(true);
    expect(f.inv.fail).toHaveBeenCalledWith(ctx.id, 'cancelled');
  });

  it('directory release and remove act on the inbound host', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    expect(links.directory.describe(ctx.inboundId)).toMatchObject({ peerInstanceId: ctx.peer.id, state: 'linked' });
    expect(await links.directory.release(ctx.inboundId, 'test-plugin', 'scope-a')).toEqual({ linkRemoved: false });
    expect(links.directory.describe(ctx.inboundId)).toMatchObject({ state: 'linked' });
    expect(await links.directory.remove(ctx.inboundId)).toEqual({ linkRemoved: true });
    expect(await links.directory.remove(ctx.inboundId)).toBeUndefined();
    expect(links.directory.describe(randomUUID())).toBeUndefined();
    expect(await links.directory.release(randomUUID(), 'p', 's')).toBeUndefined();
  });

  it('directory remove loads the store first, so a not yet loaded store still tears the link down', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    await links.whenIdle();
    const fresh = f.make();
    expect(await fresh.directory.remove(ctx.inboundId)).toEqual({ linkRemoved: true });
    expect(f.recOf(fresh, ctx.id).phase).toBe('removed');
  });

  it('a computer removed without the store (host gone, link still linked) no longer refuses joining it again', async () => {
    const onRemoved = vi.fn();
    const f = await fixture(), links = f.make({ onRemoved });
    const ctx = await f.redeemerLinked(links);
    const outbound = f.recOf(links, ctx.id).outbound.hostId;
    await f.channels.register({ remoteInstanceId: ctx.peer.id, hostId: outbound, hostKey: 'k'.repeat(40), capability: 'peer.forward' });
    // Generic host teardown: the row is gone but the store never ran its teardown.
    destroyHost(f.db, ctx.inboundId);
    const next = await f.redeem(links, ctx.peer, { id: randomUUID() });
    expect(f.recOf(links, ctx.id).phase).toBe('removed');
    expect(f.recOf(links, next).phase).toBe('pre-consent');
    expect(onRemoved).toHaveBeenCalledWith(ctx.peer.id);
  });

  it('drops a leftover channel owned by a finished link, but not one it does not own', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const outbound = f.recOf(links, ctx.id).outbound.hostId;
    await links.remove(ctx.peer.id);
    // The teardown's own unregister failed earlier: the channel outlived its link.
    await f.channels.register({ remoteInstanceId: ctx.peer.id, hostId: outbound, hostKey: 'k'.repeat(40), capability: 'peer.forward' });
    const next = await f.redeem(links, ctx.peer, { id: randomUUID() });
    expect(f.recOf(links, next).phase).toBe('pre-consent');
    expect(await f.channels.remote(ctx.peer.id)).toBeNull();
    const other = f.newPeer();
    await f.channels.register({ remoteInstanceId: other.id, hostId: randomUUID(), hostKey: 'k'.repeat(40), capability: 'peer.forward' });
    await expect(f.redeem(links, other)).rejects.toMatchObject({ code: 'already_connected' });
  });

  it('the sweep finishes tearing down a linked record whose inbound host is gone', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    destroyHost(f.db, ctx.inboundId);
    await links.sweep();
    expect(f.recOf(links, ctx.id).phase).toBe('removed');
  });
});

describe('bootstrap line expiry', () => {
  it('extends the bootstrap line to cover consent only once the redeem actually arrives', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const id = randomUUID();
    const mint = await f.create(links, id);
    const before = f.lines.get(`${id}:bootstrap`)!.expiresAt!;
    expect(before).toBe(mint.expiresAt + PEER_LINK_BOOTSTRAP_SKEW_MS);
    // No redeem yet: a sweep leaves the short expiry alone.
    await links.sweep();
    expect(f.lines.get(`${id}:bootstrap`)!.expiresAt).toBe(before);
    f.seedHost(mint.offer.hostId); f.session(mint.offer.hostId, peer.id);
    const reverse = joinToken(); f.enrollIds.set(reverse, peer.host);
    f.state.pull = { redeem: { wire: 'redeem' }, reverse: { hostId: peer.host, code: reverse, expiresAt: f.clock.t + 120_000 } };
    links.onInboundConnected(mint.offer.hostId);
    await f.settle(links, 2000);
    const createdAt = f.recOf(links, id).createdAt;
    const after = f.lines.get(`${id}:bootstrap`)!;
    expect(after.expiresAt).toBe(createdAt + PEER_LINK_PRE_CONSENT_MAX_MS + PEER_LINK_BOOTSTRAP_SKEW_MS);
    expect(after.expiresAt!).toBeGreaterThan(before);
    expect(after.pub).toBe(publicKeyLine(mint.offer.bootstrapSeed));
  });

  it('does not accept the redeem when the extension cannot be written', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const mint = await f.create(links);
    f.seedHost(mint.offer.hostId); f.session(mint.offer.hostId, peer.id);
    f.state.pull = { redeem: { wire: 'redeem' }, reverse: { hostId: peer.host, code: joinToken(), expiresAt: f.clock.t + 120_000 } };
    f.ssh.fail.upsert = new Error('ssh_auth_refused');
    links.onInboundConnected(mint.offer.hostId);
    await f.settle(links, 2000);
    expect(f.connector.enroll).not.toHaveBeenCalled();
  });
});

describe('forwarder port fails closed', () => {
  it('blocks a linked inviter link whose F moved: ssh-down, lines removed, connector not reopened', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.inviterLinked(first);
    expect(f.lines.has(`${ctx.id}:link`)).toBe(true);
    first.dispose(); await first.whenIdle();
    f.ssh.fail.port = F + 7; // a squatter holds the old F; the lease would hand out another
    f.connector.connect.mockClear(); f.held.clear();
    const second = f.make();
    await second.start();
    expect(f.lines.has(`${ctx.id}:link`)).toBe(false);
    expect(f.lines.has(`${ctx.id}:bootstrap`)).toBe(false);
    expect(f.held.has(ctx.id)).toBe(false);
    expect(f.connector.connect).not.toHaveBeenCalled();
    expect(await second.links()).toEqual([expect.objectContaining({ phase: 'linked', state: 'disconnected', reason: 'ssh-down' })]);
    expect(second.hasLiveServerLinks()).toBe(false);
    await second.sweep();
    expect(f.lines.has(`${ctx.id}:link`)).toBe(false);
    expect(f.connector.connect).not.toHaveBeenCalled();
  });

  it('restores the link line when F is back on the original port at the next start', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.inviterLinked(first);
    first.dispose(); await first.whenIdle();
    f.ssh.fail.port = F + 7;
    const second = f.make();
    await second.start();
    expect(f.lines.has(`${ctx.id}:link`)).toBe(false);
    second.dispose(); await second.whenIdle();
    f.ssh.fail.port = undefined;
    const third = f.make();
    await third.start();
    expect(f.lines.has(`${ctx.id}:link`)).toBe(true);
    expect(third.hasLiveServerLinks()).toBe(true);
    expect((await third.links())[0]).toMatchObject({ phase: 'linked' });
  });

  it('blocks when the lease refuses to move (acquire throws) and removing the link clears the block', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.inviterLinked(first);
    first.dispose(); await first.whenIdle();
    f.ssh.fail.acquire = new Error('peer forwarder port busy');
    const second = f.make();
    await second.start();
    expect((await second.links())[0]).toMatchObject({ state: 'disconnected', reason: 'ssh-down' });
    f.ssh.fail.acquire = undefined;
    await second.remove(ctx.peer.id, 'removed');
    expect((await second.links())[0]).toMatchObject({ phase: 'removed' });
  });

  it('fails an unfinished inviter attempt outright when F moved', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.inviterPulled(first);
    first.dispose(); await first.whenIdle();
    f.ssh.fail.port = F + 7;
    f.inv.fail.mockClear();
    const second = f.make();
    await second.start();
    expect(f.inv.fail).toHaveBeenCalledWith(ctx.id, 'unreachable');
    expect(f.recOf(second, ctx.id)).toMatchObject({ phase: 'failed', failure: 'unreachable' });
    expect(f.lines.size).toBe(0);
    expect(second.hasLiveServerLinks()).toBe(false);
  });
});

describe('link-key seed reconcile', () => {
  it('passes only live redeemer links to the transport at start and on sweep', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    await f.ssh.linkKey(ctx.id); await f.ssh.linkKey('orphan-link');
    await links.sweep();
    expect(f.ssh.reconcileLinkKeys).toHaveBeenLastCalledWith(new Set([ctx.id]));
    expect(f.keys.has('orphan-link')).toBe(false);
    expect(f.keys.has(ctx.id)).toBe(true);
  });

  it('tolerates a failing seed reconcile', async () => {
    const f = await fixture(), links = f.make();
    f.ssh.reconcileLinkKeys.mockRejectedValueOnce(new Error('disk'));
    await expect(links.start()).resolves.toBeUndefined();
  });
});

describe('startup, reconcile, sweep, views, dispose', () => {
  it('start reconciles authorized_keys with the live A-side links and re-acquires the forwarder', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.inviterLinked(first);
    const gone = randomUUID();
    f.lines.set(`${gone}:bootstrap`, { linkId: gone, kind: 'bootstrap', pub: 'x', listenPort: 1, targetPort: 2 });
    f.held.clear();
    first.dispose(); await first.whenIdle();
    const second = f.make();
    await second.start();
    expect(f.ssh.authorizedKeys.reconcile).toHaveBeenLastCalledWith(new Set([ctx.id]));
    expect(f.lines.has(`${gone}:bootstrap`)).toBe(false);
    expect(f.lines.has(`${ctx.id}:link`)).toBe(true);
    expect(f.held.has(ctx.id)).toBe(true);
    expect(f.connector.connect).toHaveBeenCalledTimes(2);
  });

  it('start reopens the redeemer tunnel on its stable local port before the connector', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.redeemerLinked(first);
    first.dispose(); await first.whenIdle();
    expect(f.opened.at(-1)!.close).toHaveBeenCalled();
    f.ssh.openTunnel.mockClear(); f.connector.connect.mockClear();
    const second = f.make();
    await second.start();
    expect(f.ssh.openTunnel).toHaveBeenCalledWith(ctx.id, expect.objectContaining({ identity: { linkKey: true }, localPort: LOCAL }), expect.any(Function));
    expect(order(f.ssh.openTunnel)).toBeLessThan(order(f.connector.connect));
  });

  it('start still opens the connector when the tunnel cannot be reopened, and the sweep retries the tunnel', async () => {
    const f = await fixture(), first = f.make();
    await f.redeemerLinked(first);
    first.dispose(); await first.whenIdle();
    f.connector.connect.mockClear(); f.ssh.openTunnel.mockClear();
    f.ssh.fail.tunnel = new Error('ssh_unreachable');
    const second = f.make();
    await second.start();
    expect(f.connector.connect).toHaveBeenCalledTimes(1);
    f.ssh.fail.tunnel = undefined;
    const before = f.ssh.openTunnel.mock.calls.length;
    await second.sweep();
    expect(f.ssh.openTunnel.mock.calls.length).toBeGreaterThan(before);
  });

  it('start tolerates a failing reconcile and resumes an unfinished redeemer founding', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.redeemerPreConsent(first);
    f.inv.founding.mockRejectedValueOnce(new InvitationError('unreachable')); // offer sent, ack pending
    first.onConsented(f.pairing('redeemer', ctx.id, ctx.peer.id));
    await f.settle(first, 0);
    first.dispose(); await first.whenIdle();
    f.ssh.authorizedKeys.reconcile.mockRejectedValueOnce(new Error('ssh_auth_refused'));
    const second = f.make();
    await second.start();
    await f.settle(second, 2000);
    expect(f.ssh.authorizedKeys.reconcile).toHaveBeenCalled();
  });

  it('sweep expires stale pre-consent and activating links', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterPulled(links);
    f.clock.t += PEER_LINK_PRE_CONSENT_MAX_MS + 1;
    await links.sweep();
    expect(f.inv.fail).toHaveBeenCalledWith(ctx.id, 'expired');
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'failed', failure: 'expired' });
    expect(f.lines.size).toBe(0);
    expect(f.held.size).toBe(0);
  });

  it('sweep kicks a pull for an inviter whose redeemer attached while no timer is armed', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const mint = await f.create(links);
    f.seedHost(mint.offer.hostId); f.session(mint.offer.hostId, peer.id);
    const reverse = joinToken(); f.enrollIds.set(reverse, peer.host);
    f.state.pull = { redeem: { wire: 'r' }, reverse: { hostId: peer.host, code: reverse, expiresAt: f.clock.t + 120_000 } };
    await links.sweep();
    await f.settle(links, 0);
    expect(f.connector.connect).toHaveBeenCalledTimes(1);
  });

  it('projects connection states: connected, reconnecting, peer-offline, ssh-down and removed', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    const view = async () => (await links.links(ctx.peer.id))[0]!;
    expect(await view()).toMatchObject({ phase: 'linked', state: 'reconnecting' });
    f.conns.at(-1)!.set(true);
    f.opened.at(-1)!.onState(true);
    expect(await view()).toMatchObject({ state: 'connected' });
    f.conns.at(-1)!.set(false);
    expect(await view()).toMatchObject({ state: 'reconnecting' });
    f.opened.at(-1)!.onState(false, 'ssh_forwarding_refused');
    expect(await view()).toMatchObject({ state: 'reconnecting' });
    f.clock.t += PEER_OFFLINE_AFTER_MS + 1;
    expect(await view()).toMatchObject({ state: 'disconnected', reason: 'ssh-down' });
    f.opened.at(-1)!.onState(true);
    expect(await view()).toMatchObject({ state: 'disconnected', reason: 'peer-offline' });
    expect(JSON.stringify(await links.links())).not.toMatch(/zcde_|ssh-ed25519|bootstrapSeed/);
    await links.remove(ctx.peer.id);
    expect(await view()).toMatchObject({ phase: 'removed', state: 'disconnected', reason: 'revoked' });
  });

  it('exposes the peer name learned in pairing, and omits it for records written before names were kept', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    expect((await links.links(ctx.peer.id))[0]).toMatchObject({ peerName: 'Remote Name' });
    f.recOf(links, ctx.id).peerName = undefined;
    const older = (await links.links(ctx.peer.id))[0]!;
    expect(older).not.toHaveProperty('peerName');
    expect(older).toMatchObject({ peerInstanceId: ctx.peer.id, phase: 'linked' });
  });

  it('projects failed links as peer-offline and unfinished ones as reconnecting', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerPreConsent(links);
    expect((await links.links())[0]).toMatchObject({ phase: 'pending', state: 'reconnecting' });
    links.onTerminated(ctx.id, 'redeemer', 'denied');
    await f.settle(links, 0);
    expect((await links.links())[0]).toMatchObject({ phase: 'failed', state: 'disconnected', reason: 'peer-offline' });
    expect(await links.links(randomUUID())).toEqual([]);
  });

  it('answers the sync reads: phase, bootstrapLink, linkRef, isLinkUsable, foundedFor', async () => {
    const f = await fixture(), links = f.make();
    expect(links.isLinkUsable(randomUUID())).toBe(true);
    const ctx = await f.redeemerPreConsent(links);
    expect(links.phase(ctx.peer.id)).toBe('pre-consent');
    expect(links.phase(ctx.peer.id, randomUUID())).toBeUndefined();
    expect(await links.bootstrapLink(ctx.peer.id, ctx.peer.host)).toMatchObject({ invitationId: ctx.id, role: 'redeemer' });
    expect(links.linkRef(ctx.id)).toEqual({ hostId: ctx.inboundId, recipientId: ctx.peer.id });
    expect(links.linkRef(randomUUID())).toBeNull();
    expect(links.isLinkUsable(ctx.inboundId)).toBe(false);
    links.onConsented(f.pairing('redeemer', ctx.id, ctx.peer.id));
    await f.settle(links, 0);
    expect(links.isLinkUsable(ctx.inboundId)).toBe(true);
    expect(await links.foundedFor(ctx.peer.id, ctx.peer.host, 'test-plugin')).toBe(true);
    expect(await links.foundedFor(ctx.peer.id, ctx.peer.host, 'other')).toBe(false);
    expect(await links.foundedFor(randomUUID(), ctx.peer.host, 'test-plugin')).toBe(false);
  });

  it('is unusable for live peer hosts until the store loaded', async () => {
    const f = await fixture(), links = f.make(), hostId = randomUUID();
    f.seedHost(hostId);
    expect(links.isLinkUsable(hostId)).toBe(false);
    await links.start();
    expect(links.isLinkUsable(hostId)).toBe(true);
  });

  it('dispose closes tunnels and connections and refuses further work', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    links.dispose(); await links.whenIdle();
    expect(f.opened.at(-1)!.close).toHaveBeenCalled();
    expect(f.conns.at(-1)!.close).toHaveBeenCalled();
    await expect(links.rotate(ctx.peer.id)).rejects.toThrow('disposed');
    await expect(links.remove(ctx.peer.id)).rejects.toThrow('disposed');
    links.dispose(); // idempotent
  });
});

describe('pause (owner Disconnect) and unpause (Reconnect)', () => {
  it('redeemer pause closes connector and tunnel, keeps record and keys, reports paused (not revoked)', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    expect(await links.pause(ctx.peer.id)).toBe(true);
    expect(f.conns.at(-1)!.close).toHaveBeenCalled();
    expect(f.opened.at(-1)!.close).toHaveBeenCalled();
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'linked', paused: true });
    expect((await links.links(ctx.peer.id))[0]).toMatchObject({ state: 'disconnected', reason: 'paused', phase: 'linked' });
    expect(links.directory.describe(ctx.inboundId)).toMatchObject({ state: 'linked', paused: true });
    expect(f.ssh.dropLinkKey).not.toHaveBeenCalled();
    expect(f.bridge.peerRemove).not.toHaveBeenCalled();
    expect(f.sessions.get(ctx.inboundId)!.socket.close).toHaveBeenCalledWith(1001, 'peer-paused');
  });

  it('inviter pause keeps its authorized key and forwarder but stops its connector and refuses the peer connector', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    expect(await links.pause(ctx.peer.id)).toBe(true);
    expect(await links.pause(ctx.peer.id)).toBe(true); // idempotent
    expect(f.conns.at(-1)!.close).toHaveBeenCalled();
    expect(f.lines.has(`${ctx.id}:link`)).toBe(true);
    expect(f.held.has(ctx.id)).toBe(true);
    const peerSocket = f.sessions.get(ctx.mint.offer.hostId)!.socket;
    peerSocket.close.mockClear();
    links.onInboundConnected(ctx.mint.offer.hostId);
    expect(peerSocket.close).toHaveBeenCalledWith(1001, 'peer-paused');
    expect((await links.links(ctx.peer.id))[0]).toMatchObject({ state: 'disconnected', reason: 'paused' });
  });

  it('refuses a socket close that throws without failing', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    await links.pause(ctx.peer.id);
    f.sessions.get(ctx.mint.offer.hostId)!.socket.close.mockImplementation(() => { throw new Error('closing'); });
    expect(() => links.onInboundConnected(ctx.mint.offer.hostId)).not.toThrow();
    await links.unpause(ctx.peer.id);
    await links.pause(ctx.peer.id);
  });

  it('persists across restart: start does not reopen tunnel or connector while paused', async () => {
    const f = await fixture(), first = f.make();
    const ctx = await f.redeemerLinked(first);
    await first.pause(ctx.peer.id);
    first.dispose(); await first.whenIdle();
    f.ssh.openTunnel.mockClear(); f.connector.connect.mockClear();
    const second = f.make();
    await second.start();
    expect(f.recOf(second, ctx.id).paused).toBe(true);
    expect(f.ssh.openTunnel).not.toHaveBeenCalled();
    expect(f.connector.connect).not.toHaveBeenCalled();
    expect(f.sessions.get(ctx.inboundId)!.socket.close).toHaveBeenCalledWith(1001, 'peer-paused');
  });

  it('the reconnect loop is skipped while paused: sweep, heal, rotation and relink do nothing', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    await links.pause(ctx.peer.id);
    f.ssh.openTunnel.mockClear(); f.connector.connect.mockClear(); f.bridge.peerRotate.mockClear(); f.bridge.peerRelink.mockClear();
    f.clock.t += PEER_LINK_ROTATION_MS + PEER_OFFLINE_AFTER_MS;
    await links.sweep();
    await f.settle(links, PEER_RELINK_AFTER_MS * 3);
    expect(f.ssh.openTunnel).not.toHaveBeenCalled();
    expect(f.connector.connect).not.toHaveBeenCalled();
    expect(f.bridge.peerRotate).not.toHaveBeenCalled();
    expect(f.bridge.peerRelink).not.toHaveBeenCalled();
    // Rotate and the peer's rotate/relink requests are ignored too.
    expect(await links.rotate(ctx.peer.id)).toHaveLength(1);
    expect(f.connector.connect).not.toHaveBeenCalled();
    expect(await links.acceptRotate(ctx.peer.id, f.recOf(links, ctx.id).outbound.hostId, { code: joinToken(), expiresAt: f.clock.t + 60_000 }, new AbortController().signal))
      .toEqual({ accepted: false });
    expect(await links.acceptRelink(ctx.peer.id, ctx.inboundId, new AbortController().signal)).toEqual({ accepted: false });
  });

  it('unpause clears the flag and reopens tunnel and connector; the persisted flag is gone', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    await links.pause(ctx.peer.id);
    f.ssh.openTunnel.mockClear(); f.connector.connect.mockClear();
    expect(await links.unpause(ctx.peer.id)).toBe(true);
    expect(f.recOf(links, ctx.id).paused).toBeUndefined();
    expect(f.ssh.openTunnel).toHaveBeenCalledWith(ctx.id, expect.objectContaining({ localPort: LOCAL }), expect.any(Function));
    expect(f.connector.connect).toHaveBeenCalledTimes(1);
    f.conns.at(-1)!.set(true);
    expect((await links.links(ctx.peer.id))[0]).toMatchObject({ state: 'connected' });
    expect(links.directory.describe(ctx.inboundId)).not.toHaveProperty('paused');
    // Unpausing a link that is not paused is harmless.
    expect(await links.unpause(ctx.peer.id)).toBe(true);
  });

  it('inviter unpause reopens its connector', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    await links.pause(ctx.peer.id);
    f.connector.connect.mockClear();
    await links.unpause(ctx.peer.id);
    expect(f.connector.connect).toHaveBeenCalledTimes(1);
  });

  it('fails for an unknown or unlinked peer and through the directory for unknown hosts', async () => {
    const f = await fixture(), links = f.make();
    expect(await links.pause(randomUUID())).toBe(false);
    expect(await links.unpause(randomUUID())).toBe(false);
    expect(await links.directory.pause(randomUUID())).toBeUndefined();
    expect(await links.directory.resume(randomUUID())).toBeUndefined();
    const pending = await f.inviterPulled(links);
    expect(await links.directory.pause(pending.mint.offer.hostId)).toBeUndefined();
    expect(await links.directory.resume(pending.mint.offer.hostId)).toBeUndefined();
  });

  it('directory pause and resume act on the inbound host', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.redeemerLinked(links);
    expect(await links.directory.pause(ctx.inboundId)).toEqual({ paused: true });
    expect(f.recOf(links, ctx.id).paused).toBe(true);
    expect(await links.directory.resume(ctx.inboundId)).toEqual({ paused: false });
    expect(f.recOf(links, ctx.id).paused).toBeUndefined();
  });

  it('directory repair rotates a linked, unpaused link and declines otherwise', async () => {
    const f = await fixture(), links = f.make();
    expect(await links.directory.repair(randomUUID())).toBeUndefined();
    const ctx = await f.redeemerLinked(links);
    const rotate = vi.spyOn(links, 'rotate');
    expect(await links.directory.repair(ctx.inboundId)).toEqual({ repaired: true });
    expect(rotate).toHaveBeenCalledWith(ctx.peer.id);
    await links.pause(ctx.peer.id);
    rotate.mockClear();
    expect(await links.directory.repair(ctx.inboundId)).toBeUndefined();
    expect(rotate).not.toHaveBeenCalled();
  });

  it('removing a paused link still tears everything down', async () => {
    const f = await fixture(), links = f.make();
    const ctx = await f.inviterLinked(links);
    await links.pause(ctx.peer.id);
    expect(await links.remove(ctx.peer.id)).toBe(true);
    expect(f.lines.size).toBe(0);
    expect(f.held.size).toBe(0);
    expect(f.recOf(links, ctx.id)).toMatchObject({ phase: 'removed' });
    expect(links.directory.describe(ctx.mint.offer.hostId)).not.toHaveProperty('paused');
  });
});

describe('core connection (no plugin, no scope)', () => {
  it('inviter: persists a record without plugin or scope and projects the link without them', async () => {
    const f = await fixture(), links = f.make(), id = randomUUID();
    const mint = await links.invitationLinks.create({ invitationId: id });
    expect(mint.offer.hostId).toEqual(expect.any(String));
    const rec = f.recOf(links, id);
    expect(rec).toMatchObject({ role: 'inviter', phase: 'pre-consent' });
    expect(rec).not.toHaveProperty('pluginId');
    expect(rec).not.toHaveProperty('scope');
    const fresh = f.make(); await fresh.start();
    expect(f.recOf(fresh, id)).toMatchObject({ invitationId: id });
  });

  it('redeemer: links without recording a plugin use and exposes no plugin or scope', async () => {
    const f = await fixture(), links = f.make(), peer = f.newPeer();
    const id = randomUUID();
    await links.invitationLinks.redeem({ invitationId: id, inviterId: peer.id, inviterName: 'Bob', link: f.offerFor(peer) as never }, new AbortController().signal);
    const pull = await f.answer(links, id, peer.host);
    f.seedHost(pull.reverse.hostId); f.session(pull.reverse.hostId, peer.id);
    const { pluginId: _p, scope: _s, ...core } = f.pairing('redeemer', id, peer.id);
    links.onConsented(core);
    await links.whenIdle(); await f.settle(links, 0);
    const rec = f.recOf(links, id);
    expect(rec).toMatchObject({ phase: 'linked' });
    expect(rec).not.toHaveProperty('pluginId');
    expect(getHost(f.db, pull.reverse.hostId)?.purpose).not.toMatchObject({ kind: 'plugin-link', uses: expect.arrayContaining([expect.anything()]) });
    const [view] = await links.links(peer.id);
    expect(view).toMatchObject({ peerInstanceId: peer.id, phase: 'linked' });
    expect(view).not.toHaveProperty('pluginId');
    expect(view).not.toHaveProperty('scope');
    // A restart keeps the link and does not try to record a plugin use for it.
    const fresh = f.make(); await fresh.start();
    expect(f.recOf(fresh, id)).toMatchObject({ phase: 'linked' });
    expect(await fresh.foundedFor(peer.id, f.recOf(fresh, id).outbound.hostId, 'test-plugin')).toBe(false);
  });

  it('counts core and plugin connections together against the linked cap', async () => {
    const f = await fixture(), links = f.make();
    const row = (index: number) => ({ invitationId: randomUUID(), role: 'inviter' as const, phase: 'linked' as const, createdAt: f.clock.t, updatedAt: f.clock.t,
      ...(index % 2 ? { pluginId: 'test-plugin', scope: `scope-${index}` } : {}), ssh: { side: 'server' as const, listenPort: 41_001, targetPort: F } });
    for (let index = 0; index < 16; index++) await (links as any).insert(row(index));
    await expect((links as any).insert(row(16))).rejects.toMatchObject({ code: 'capacity' });
    await expect((links as any).insert(row(17))).rejects.toMatchObject({ code: 'capacity' });
  });
});
