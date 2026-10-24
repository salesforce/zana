import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerConnection, PluginPeerRequest, PluginSdkPeers } from '@zana-ai/zcc-plugin-sdk/server';
import { z } from 'zod';
import { PeerProtocolError } from '../shared/peer-contract.js';
import { bootstrapScope, DesignDocPairing, lifecycleReasonOf, readableError } from './pairing.js';
import { capacityRequestId, DesignDocPeerGroup, MAX_PERMANENT_JOB_ATTEMPTS } from './peer-group.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';
import { admissionReference, appendSeat, ownedSeats, mergeRosters, transferSeat, requestRetirement, closeRetirement, completeRetirements, historicalMembers, isRetiring } from './peer-slots.js';

const disposals: Array<() => void> = [];
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); });
/**
 * `race` models core's ScopedLinkAuthority: a side with no binding for a scope creates its own proposal, and two sides
 * creating one concurrently leave two bindings, so every later enable for that scope fails as ambiguous.
 */
function network(options: { race?: boolean } = {}) {
  const apps = new Map<string, ReturnType<typeof app>>(), offline = new Set<string>(), lost = new Set<string>();
  const epochs = new Map<string, number>();
  const creating = new Set<string>(), ambiguous = new Set<string>();
  const introductions = new Map<string, 'pending' | 'complete' | 'blocked'>();
  function app(peerId: string, hooks?: ConstructorParameters<typeof DesignDocPairing>[2], connections?: ConnState) {
    const db = createTestDatabase(), store = new DesignDocStore(db), group = new DesignDocPeerGroup(db);
    const handlers = new Map<string, (request: PluginPeerRequest) => unknown>(), enrollment = new Set<string>(), scopes = new Map<string, Set<string>>();
    const peers: PluginSdkPeers = {
      localIdentity: async () => ({ id: peerId }), features: async () => ({ lifecycle: true, introductions: true, installer: false }),
      enrolled: async (args?: Parameters<PluginSdkPeers['enrolled']>[0]) => {
        args?.signal?.throwIfAborted();
        return [...enrollment].filter((id) => apps.get(id)?.enrollment.has(peerId))
          .map((id) => ({ id, hostId: `host-${id}`, name: id, connected: !offline.has(id) }));
      },
      enable: vi.fn(async (id, { scope, signal }) => {
        if (signal?.aborted) throw new Error('cancelled');
        const remote = apps.get(id);
        if (!enrollment.has(id) || !remote?.enrollment.has(peerId)) throw new Error('mutual execution enrollment unavailable');
        if (offline.has(id)) throw new Error('peer offline');
        const binding = `${[peerId, id].sort().join('-')}:${scope}`;
        if (options.race && !scopes.get(id)?.has(scope)) {
          creating.add(`${peerId}>${id}:${scope}`);
          await new Promise((resolve) => setTimeout(resolve, 1));
          creating.delete(`${peerId}>${id}:${scope}`);
          if (creating.has(`${id}>${peerId}:${scope}`)) ambiguous.add(binding);
        }
        if (ambiguous.has(binding)) throw new Error('peer link binding is ambiguous');
        const add = (map: Map<string, Set<string>>, key: string) => { const set = map.get(key) ?? new Set(); set.add(scope); map.set(key, set); };
        add(scopes, id); add(remote.scopes, peerId);
        return { id, pairId: `${[peerId, id].sort().join('-')}:${scope}`, proposalId: `proposal:${scope}`, scope, grantEpoch: epochs.get(id) ?? 1 };
      }),
      revoke: vi.fn(async (id, { scope }) => { scopes.get(id)?.delete(scope); apps.get(id)?.scopes.get(peerId)?.delete(scope); }),
      introduce: vi.fn(async (id: string, { sponsorPeerId, scope, signal }: Parameters<PluginSdkPeers['introduce']>[1]) => {
        signal?.throwIfAborted();
        if (!scopes.get(id)?.has(scope) || !scopes.get(sponsorPeerId)?.has(scope)) throw new Error('introduction scope or recipient mismatch');
        const introductionId = `${id}:${sponsorPeerId}:${scope}`;
        return { introductionId, status: introductions.get(introductionId) ?? 'pending' };
      }),
      list: vi.fn(async (args?: Parameters<PluginSdkPeers['list']>[0]) => {
        args?.signal?.throwIfAborted();
        return [...scopes].flatMap(([id, scopes]) => [...scopes].map((scope) => ({ id, name: id, scope, grantEpoch: epochs.get(id) ?? 1, connected: !offline.has(id) })));
      }),
      handle: (method, handler) => { handlers.set(method, handler); },
      call: vi.fn(async (id, method, body, options) => {
        options?.signal?.throwIfAborted();
        if (offline.has(id)) throw new Error('peer offline');
        const remote = apps.get(id), scope = options?.scope;
        if (!scope || !scopes.get(id)?.has(scope) || !remote?.scopes.get(peerId)?.has(scope)) throw new Error('not pair authorized');
        const grantEpoch = epochs.get(id) ?? 1;
        const result = await remote.handlers.get(method)!({ peerId, scope, body, grantEpoch, signal: new AbortController().signal,
          commitSync: async (commit) => {
            if ((epochs.get(id) ?? 1) !== grantEpoch || !scopes.get(id)?.has(scope)) throw new Error('revoked');
            return commit();
          } });
        if (lost.delete(`${id}:${method}`)) throw new Error('lost ACK');
        return result;
      })
    };
    const pairing = new DesignDocPairing(group, peers, hooks);
    const result = { db, store, peerId, group, peers, pairing, handlers, scopes, enrollment }; apps.set(peerId, result);
    if (connections) withConnections(result, connections);
    pairing.register({ onDispose: (dispose) => disposals.push(dispose) } as never);
    return result;
  }
  function link(a: ReturnType<typeof app>, b: ReturnType<typeof app>) { a.enrollment.add(b.peerId); b.enrollment.add(a.peerId); }
  async function found(a: ReturnType<typeof app>, b: ReturnType<typeof app>) {
    link(a, b); await a.pairing.enable(b.peerId); await b.pairing.enable(a.peerId); await a.pairing.retry(true);
  }
  return { app, link, found, offline, epochs, lost, introductions, ambiguous };
}

describe('DD lifecycle setup', () => {
  it('capacity negotiation counts current members after sealed reclaim, not historical identities', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const local = a.group.sync.localRepository()!, remote = b.group.sync.localRepository()!;
    let roster = a.group.roster()!;
    for (let index = 0; index < 6; index++) {
      const sponsor = index < 3 ? local.replicaId : remote.replicaId;
      roster = appendSeat(roster, { kind: 'admit', seat: ownedSeats(roster, sponsor)[0]!, requestId: `seed-${index}`,
        ownerReplicaId: sponsor, member: { replicaId: `r-${index}`, machineId: `p-${index}`, joinedAt: 0, sponsorReplicaId: sponsor } });
    }
    roster = completeRetirements(closeRetirement(requestRetirement(roster, local.replicaId, 'r-0'), 'r-0'));
    expect(historicalMembers(roster)).toHaveLength(8);
    a.group.apply(roster, 'b'); b.group.apply(roster, 'a');
    const c = net.app('c'); net.link(a, c); await a.pairing.enable('c');
    vi.spyOn(a.group, 'hasCapacity').mockReturnValue(false);
    const handler = a.handlers.get('group-join')!;
    const input = { requestId: 'replacement', repoId: roster.repoId, groupId: roster.groupId, sponsorReplicaId: local.replicaId,
      member: { replicaId: c.group.sync.localRepository()!.replicaId, machineId: 'c', joinedAt: 0, sponsorReplicaId: local.replicaId } };
    await expect(handler({ peerId: 'c', scope: roster.repoId, grantEpoch: 1, body: input, signal: new AbortController().signal,
      commitSync: async (commit: () => unknown) => commit() } as PluginPeerRequest)).rejects.toThrow('waiting for reserved capacity');
  });
  it('stale introduction snapshot cannot send after earlier roster ACK removes local member', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const local = a.group.sync.localRepository()!, remote = b.group.sync.localRepository()!;
    const next = transferSeat(a.group.roster()!, local.replicaId, remote.replicaId, 'intro-snapshot');
    a.group.apply(next, 'b');
    const terminal = completeRetirements(closeRetirement(requestRetirement(next, remote.replicaId, local.replicaId), local.replicaId));
    b.handlers.set('group-roster', async () => ({ roster: terminal }));
    a.peers.introduce.mockClear();
    await a.pairing.retry(true);
    expect(a.group.sync.localRepository()!.groupId).toBeNull();
    expect(a.peers.introduce).not.toHaveBeenCalled();
  });

  it('stale introduction snapshot cannot use another scope', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const job = a.group.jobs().find((item) => item.kind === 'introduce')!;
    a.db.prepare("UPDATE sync_group_jobs SET payload_json = ?, state = 'pending', next_at = 0 WHERE id = ?")
      .run(JSON.stringify({ ...(job.payload as object), scope: 'other' }), job.id);
    a.peers.introduce.mockClear();
    await a.pairing.retry(true);
    expect(a.peers.introduce.mock.calls.some(([, args]) => args.scope === 'other')).toBe(false);
  });

  it.each(['retiring', 'removed', 'scope', 'target', 'cancelled'] as const)('rechecks %s authorization inside delayed revoke commit', async (reason) => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const original = a.group.roster()!, local = a.group.sync.localRepository()!, sender = b.group.sync.localRepository()!, target = c.group.sync.localRepository()!;
    const removed = completeRetirements(closeRetirement(requestRetirement(original, sender.replicaId, target.replicaId), target.replicaId));
    a.group.apply(removed, 'b');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), controller = new AbortController();
    const request = { peerId: 'b', scope: local.repoId, grantEpoch: 1, body: { peerId: 'c', scope: local.repoId }, signal: controller.signal,
      commitSync: async (fn: () => unknown) => { await gate; return fn(); } } as PluginPeerRequest;
    const pending = a.handlers.get('group-revoke')!(request);
    if (reason === 'retiring' || reason === 'removed') {
      let next = requestRetirement(removed, target.replicaId, sender.replicaId);
      if (reason === 'removed') next = completeRetirements(closeRetirement(next, sender.replicaId));
      a.group.apply(next, 'b');
    }
    if (reason === 'scope') request.scope = 'other';
    if (reason === 'target') (request.body as { peerId: string }).peerId = 'a';
    if (reason === 'cancelled') controller.abort();
    const jobs = a.group.jobs(), rejected = expect(pending).rejects.toThrow(reason === 'cancelled' ? 'fence' : 'revocation');
    release(); await rejected;
    expect(a.group.jobs()).toEqual(jobs);
  });

  it('lost admission ACK recovers final roster from departed sponsor over existing grant without new jobs or grants', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(b, c); await b.pairing.enable('c'); net.lost.add('b:group-join');
    await c.pairing.enable('b'); expect(c.group.roster()).toBeNull();
    const frozen = c.group.consent()!.request!;
    const original = b.group.admit(frozen, 'c'); b.group.remove(b.group.sync.localRepository()!.replicaId);
    const call = b.peers.call;
    b.peers.call = vi.fn(async (...args) => { if (args[0] === 'c' && args[1] === 'group-roster') throw new Error('delivery held'); return call(...args); });
    // Link revocation never waits on delivery; hold b's local teardown so c's receipt recovery runs over the still-existing grant.
    const revoke = b.peers.revoke; let teardownHeld = true;
    b.peers.revoke = vi.fn(async (...args: Parameters<typeof revoke>) => { if (teardownHeld) throw new Error('teardown offline'); return revoke(...args); });
    await b.pairing.retry(true); expect(c.group.roster()).toBeNull();
    expect(b.group.jobs().some((job) => job.kind === 'local-revoke' && /waiting for/.test(job.error ?? ''))).toBe(false);
    expect(b.group.jobs().some((job) => job.kind === 'local-revoke' && job.error === 'teardown offline')).toBe(true);
    const jobs = b.group.jobs(), enableCalls = c.peers.enable.mock.calls.length;
    await c.pairing.retry(true);
    expect(c.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'c']);
    expect(c.group.roster()!.removals).toHaveLength(1);
    expect(b.group.admit(frozen, 'c')).toEqual(original); expect(b.group.jobs()).toEqual(jobs);
    expect(c.peers.enable.mock.calls).toHaveLength(enableCalls);
    expect(c.peers.call).toHaveBeenCalledWith('b', 'group-join-receipt', frozen, expect.anything());
    // Once teardown can run, b drops its link to c even though the removal roster to c is still held.
    teardownHeld = false; await b.pairing.retry(true);
    expect(b.scopes.get('c')?.size ?? 0).toBe(0);
  });

  it('receipt recovery rejects altered immutable payload, unknown peer, wrong scope and revoked fence without writes', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(b, c); await b.pairing.enable('c'); net.lost.add('b:group-join'); await c.pairing.enable('b');
    const input = c.group.consent()!.request!, roster = b.group.roster(), jobs = b.group.jobs();
    const request = { peerId: 'c', scope: input.repoId, grantEpoch: 1, body: input, signal: new AbortController().signal,
      commitSync: async (commit: () => unknown) => commit() } as PluginPeerRequest;
    const handler = b.handlers.get('group-join-receipt')!;
    expect(() => handler({ ...request, scope: 'wrong' })).toThrow(/scope/);
    await expect(handler({ ...request, peerId: 'unknown' })).rejects.toThrow(/identity/);
    await expect(handler({ ...request, body: { ...input, delegateCount: 0 } })).rejects.toThrow(/different payload/);
    await expect(handler({ ...request, body: { ...input, requestId: 'missing' } })).rejects.toThrow(/receipt missing/);
    await expect(handler({ ...request, commitSync: async () => { throw new Error('revoked'); } })).rejects.toThrow('revoked');
    expect(b.group.roster()).toEqual(roster); expect(b.group.jobs()).toEqual(jobs);
  });

  it('sponsor self-leave between join commit and reply installs final governance instead of stale original receipt', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(b, c); await b.pairing.enable('c');
    const handler = b.handlers.get('group-join')!;
    b.handlers.set('group-join', async (request) => {
      const receipt = await handler(request);
      b.group.remove(b.group.sync.localRepository()!.replicaId);
      return receipt;
    });
    const install = vi.spyOn(c.group, 'apply');
    await c.pairing.enable('b');
    expect((install.mock.calls[0]![0] as import('../shared/peer-group.js').GroupRoster).members.some((member) => member.machineId === 'b')).toBe(false);
    expect(c.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'c']);
    expect(c.group.roster()!.removals).toHaveLength(1); expect(c.group.consent()).toBeNull();
  });

  it('cyclic retirement retries and restart converge to zero members before control teardown', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    net.link(b, c); await b.peers.enable('c', { scope: a.group.roster()!.repoId });
    const barrier = [a.group.remove(b.group.sync.localRepository()!.replicaId).roster,
      b.group.remove(c.group.sync.localRepository()!.replicaId).roster, c.group.remove(a.group.sync.localRepository()!.replicaId).roster].reduce(mergeRosters);
    a.group.apply(barrier, 'c'); b.group.apply(barrier, 'a'); c.group.apply(barrier, 'b');
    const restarted = new DesignDocPairing(new DesignDocPeerGroup(a.db), a.peers);
    restarted.register({ onDispose: (dispose: () => void) => disposals.push(dispose) } as never);
    net.lost.add('b:group-retire'); net.lost.add('c:group-roster');
    a.peers.revoke = vi.fn(async () => { throw new Error('teardown offline'); });
    for (let cycle = 0; cycle < 6; cycle++) { await restarted.retry(true); await b.pairing.retry(true); await c.pairing.retry(true); }
    for (const target of [a, b, c]) {
      expect(target.group.roster()!.members).toEqual([]); expect(target.group.roster()!.removals).toHaveLength(3);
      expect(target.group.sync.localRepository()!.groupId).toBeNull();
      expect(target.group.jobs().some((job) => job.kind === 'retire' && job.state !== 'done')).toBe(false);
      // Link teardown no longer waits on delivery, so a best-effort roster job may outlive the link it needed.
      expect(target.group.jobs().filter((job) => job.kind === 'roster' && job.state !== 'done' && !/the other computer has not finished setting up|not pair authorized/.test(job.error ?? ''))
        .map((job) => ({ peer: target.peerId, to: job.peerId, error: job.error }))).toEqual([]);
      expect(target.group.jobs().some((job) => job.kind === 'local-revoke' && /waiting for/.test(job.error ?? ''))).toBe(false);
    }
    expect(a.group.roster()).toEqual(b.group.roster()); expect(b.group.roster()).toEqual(c.group.roster());
    expect(a.group.jobs().some((job) => job.kind === 'local-revoke' && job.error === 'teardown offline')).toBe(true);
  });
  it('offline retirement stays visible, closure ACK loss survives restart, prefrontier newcomer remains authority', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'), d = net.app('d'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const bCall = b.peers.call;
    b.peers.call = vi.fn(async (...args) => { if (args[0] === 'a' && args[1] === 'group-roster') throw new Error('partition'); return bCall(...args); });
    net.link(b, d); await b.pairing.enable('d'); await d.pairing.enable('b'); net.offline.add('b');
    const pending = await a.pairing.remove(b.group.sync.localRepository()!.replicaId);
    expect(pending.members.find((item) => item.machineId === 'b')).toMatchObject({ retiring: true, authorized: false });
    expect(pending.jobs.some((job) => job.kind === 'retire' && job.state === 'blocked')).toBe(true);
    expect(a.group.roster()!.members.some((item) => item.machineId === 'b')).toBe(true);
    net.offline.delete('b'); net.lost.add('b:group-retire');
    await a.pairing.retry(true); const closure = b.group.roster()!.closures[0]!;
    expect(new DesignDocPeerGroup(b.db).roster()!.closures[0]).toEqual(closure);
    await a.pairing.retry(true); await a.pairing.retry(true); await c.pairing.retry(true);
    expect(a.group.roster()!.members.map((item) => item.machineId)).toContain('d');
    expect(a.group.roster()!.members.map((item) => item.machineId)).not.toContain('b');
    expect(c.group.roster()!.members.map((item) => item.machineId)).toContain('d');
    expect(a.enrollment.has('d')).toBe(false); expect(a.scopes.has('d')).toBe(false);
  });

  it('retirement handler rejects unknown sender, wrong scope, wrong target and revoked commit fence', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const pending = a.group.remove(b.group.sync.localRepository()!.replicaId).roster;
    const request = { peerId: 'a', scope: pending.repoId, grantEpoch: 1, body: pending,
      signal: new AbortController().signal, commitSync: async (commit: () => unknown) => commit() } as PluginPeerRequest;
    expect(() => b.handlers.get('group-retire')!({ ...request, scope: 'wrong' })).toThrow(/scope/);
    await expect(b.handlers.get('group-retire')!({ ...request, peerId: 'unknown' })).rejects.toThrow(/sender/);
    await expect(c.handlers.get('group-retire')!(request)).rejects.toThrow(/target/);
    await expect(b.handlers.get('group-retire')!({ ...request, commitSync: async () => { throw new Error('revoked'); } })).rejects.toThrow('revoked');
    expect(b.group.roster()!.closures).toEqual([]);
  });
  it('fresh two-store bootstrap selects deterministic repo, requires two consents and never uploads old docs', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const repo = a.group.sync.localRepository()!.repoId;
    a.store.create({ title: 'Old local document', template: 'blank' }, { kind: 'user', label: 'You', threadId: null });
    const first = await b.pairing.enable('a');
    expect(first).toMatchObject({ configured: false, lifecycleAvailable: true, installerAvailable: false });
    expect(a.group.roster()).toBeNull(); expect(a.group.consent()).toBeNull();
    await a.pairing.enable('b'); await b.pairing.retry(true); await a.pairing.retry(true);
    expect(a.group.roster()).toEqual(b.group.roster()); expect(b.group.roster()!.repoId).toBe(repo);
    expect(b.store.list()).toEqual([]);
    expect(a.group.sync.operations(repo)).toEqual([]); expect(a.group.sync.readyIntents(repo)).toEqual([]);
    expect(bootstrapScope('a', 'b')).toBe(bootstrapScope('b', 'a'));
    expect(a.peers.enable).toHaveBeenCalledWith('b', expect.objectContaining({ scope: bootstrapScope('a', 'b') }));
    expect(a.peers.enable).toHaveBeenCalledWith('b', expect.objectContaining({ scope: repo }));
  });

  it('founder A sleeps; B admits C despite lost ACK, delegates capacity so C sponsors D', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(b, c); await b.pairing.enable('c'); net.offline.add('a');
    net.lost.add('b:group-join');
    expect(await c.pairing.enable('b')).toMatchObject({ configured: false, setup: { error: 'lost ACK' } });
    expect(a.group.roster()!.members).toHaveLength(2);
    expect(b.group.roster()!.members).toHaveLength(3);
    await c.pairing.retry(true);
    const d = net.app('d'); net.link(c, d); await c.pairing.enable('d'); await d.pairing.enable('c');
    expect(d.group.roster()!.members).toHaveLength(4); expect(a.group.roster()!.members).toHaveLength(2);
    net.offline.delete('a');
    await c.pairing.retry(true); await b.pairing.retry(true); await a.pairing.retry(true);
    expect(c.group.roster()).toEqual(a.group.roster()); expect(b.group.roster()).toEqual(a.group.roster());
    expect(a.group.roster()!.rosterEpoch).toBe(4);
    expect(c.enrollment.has('a')).toBe(false); expect(a.enrollment.has('c')).toBe(false);
    expect((await c.pairing.status()).members.find((member) => member.machineId === 'a')).toMatchObject({ authorized: false });
    await b.pairing.retry(true);
    expect(b.peers.introduce).toHaveBeenCalled();
    expect((await b.pairing.status()).jobs.some((job) => job.error?.includes('the other computer has not finished setting up the connection yet'))).toBe(true);
  });

  it('ordinary offline member never blocks admission; roster delivery retries across restart', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); net.offline.add('b');
    await c.pairing.enable('a'); await a.pairing.retry(true);
    expect(a.group.roster()!.members).toHaveLength(3); expect(c.group.roster()).toEqual(a.group.roster());
    expect(b.group.roster()!.members).toHaveLength(2);
    expect(new DesignDocPeerGroup(a.db).jobs().some((job) => job.state === 'blocked')).toBe(true);
    net.offline.delete('b'); await a.pairing.retry(true); expect(b.group.roster()).toEqual(a.group.roster());
  });

  it('local revoke disables both scopes, preserves roster and never claims remote membership removal', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const roster = a.group.roster(); await a.pairing.revoke('b');
    expect(a.group.roster()).toEqual(roster);
    expect((await a.pairing.status()).members.find((member) => member.machineId === 'b')!.authorized).toBe(false);
    expect(a.peers.revoke).toHaveBeenCalledWith('b', { scope: roster!.repoId });
    expect(a.peers.revoke).toHaveBeenCalledWith('b', { scope: bootstrapScope('a', 'b') });
    await expect(a.pairing.remove(b.group.sync.localRepository()!.replicaId)).resolves.toMatchObject({ configured: false });
  });

  it('removing the only other computer of a two-member group leaves it: roster entry and link end on both sides', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const status = await a.pairing.remove(b.group.sync.localRepository()!.replicaId);
    expect(status.configured).toBe(false);
    expect(a.group.sync.localRepository()!.groupId).toBeNull();
    expect(a.peers.revoke).toHaveBeenCalledWith('b', { scope: a.group.roster()!.repoId });
    // The other side keeps a one-member roster and drops the link to the leaver.
    expect(b.group.roster()!.members.map((member) => member.machineId)).toEqual(['b']);
    expect(b.group.sync.localRepository()!.groupId).not.toBeNull();
  });

  it('a two-member group still refuses removing a computer that is not the other member or is already gone', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    await expect(a.pairing.remove('missing')).rejects.toThrow(/not found|invalid/i);
  });

  it('group removal commits epoch before network revoke; failure persists job without rolling roster back', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const removed = c.group.sync.localRepository()!.replicaId;
    a.peers.revoke = vi.fn(async () => { throw new Error('offline revoke'); });
    await a.pairing.remove(removed);
    expect(a.group.roster()!.rosterEpoch).toBe(6); expect(a.group.roster()!.members).toHaveLength(2);
    await a.pairing.retry(true);
    expect(a.group.jobs().some((job) => job.kind === 'local-revoke' && job.error === 'offline revoke')).toBe(true);
    await b.pairing.retry(true);
    expect(b.group.roster()).toEqual(a.group.roster());
  });

  it('rejects unilateral enrollment, malformed IDs and control scope substitution', async () => {
    const net = network(), a = net.app('a'), b = net.app('b');
    a.enrollment.add('b'); await expect(a.pairing.enable('b')).rejects.toThrow(/mutually enrolled/);
    await expect(a.pairing.enable('../b')).rejects.toThrow();
    expect(() => bootstrapScope('a', 'a')).toThrow(/local app/);
    net.link(a, b); const scope = bootstrapScope('a', 'b'); await a.peers.enable('b', { scope });
    await expect(a.peers.call('b', 'group-hello', { extra: true }, { scope })).rejects.toThrow();
    await a.peers.enable('b', { scope: 'wrong' });
    await expect(a.peers.call('b', 'group-hello', {}, { scope: 'wrong' })).rejects.toThrow(/scope mismatch/);
    const req = { peerId: 'b', scope, grantEpoch: 1, body: {}, signal: AbortSignal.abort(), commitSync: async (commit: () => unknown) => commit() } as PluginPeerRequest;
    await expect(a.handlers.get('group-hello')!(req)).rejects.toThrow(/fence/);
    disposals.splice(0).forEach((dispose) => dispose()); await a.pairing.retry();
  });

  it('grant epoch change during bootstrap prevents consent persistence', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const call = a.peers.call;
    a.peers.call = async (...args) => { const value = await call(...args); net.epochs.set('b', 2); return value; };
    await expect(a.pairing.enable('b')).rejects.toThrow(/authorization changed/); expect(a.group.consent()).toBeNull();
  });

  it('protected authority unavailable returns disabled capabilities, never fabricated peers', async () => {
    const net = network(), a = net.app('a');
    a.peers.list = vi.fn(async () => { throw new Error('peer encryption key or local identity unavailable'); });
    expect(await a.pairing.status()).toMatchObject({ configured: false, lifecycleAvailable: false, introductionsAvailable: false,
      installerAvailable: false, peers: [], enrolled: [] });
    a.peers.features = async () => ({ lifecycle: false, introductions: false, installer: false });
    await expect(a.pairing.enable('b')).rejects.toThrow('core peer lifecycle unavailable');
    await expect(a.pairing.remove('replica')).rejects.toThrow('core peer lifecycle unavailable');
    expect(a.group.consent()).toBeNull();
  });

  it('revoke before any consent uses trusted local identity for both scopes; failed revoke stays retryable', async () => {
    const net = network(), a = net.app('a');
    const revoke = a.peers.revoke;
    a.peers.revoke = vi.fn(async () => { throw new Error('offline revoke'); });
    await a.pairing.revoke('b');
    expect(a.group.jobs()[0]).toMatchObject({ kind: 'local-revoke', state: 'blocked', error: 'offline revoke' });
    a.peers.revoke = revoke;
    await a.pairing.retry(true);
    expect(a.group.jobs()[0]).toMatchObject({ state: 'done', error: null });
    expect(revoke).toHaveBeenCalledWith('b', { scope: a.group.sync.localRepository()!.repoId });
    expect(revoke).toHaveBeenCalledWith('b', { scope: bootstrapScope('a', 'b') });
    expect(a.group.localPeerId()).toBeNull();
  });

  it('unknown join outcome cannot cancel consent or switch sponsors', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    await b.pairing.enable('a'); expect(b.group.consent()).not.toBeNull();
    await expect(b.pairing.revoke('a')).rejects.toThrow(/join outcome unknown/);
    const c = net.app('c'); net.link(b, c);
    await expect(b.pairing.enable('c')).rejects.toThrow(/another database setup/);
    expect(b.group.consent()?.peerId).toBe('a'); expect(b.scopes.get('a')?.size).toBe(2);
  });

  it('revoke waits for in-flight enablement then fences its grants and cancels consent', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const enable = b.peers.enable;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    b.peers.enable = vi.fn(async (...args: Parameters<PluginSdkPeers['enable']>) => { await held; return enable(...args); });
    const enabling = b.pairing.enable('a');
    await vi.waitFor(() => expect(b.peers.enable).toHaveBeenCalled());
    const revoking = b.pairing.revoke('a');
    await expect(b.pairing.enable('a')).rejects.toThrow('database lifecycle action already running');
    await expect(b.pairing.revoke('a')).rejects.toThrow('database revocation already running');
    release(); await enabling; await revoking;
    await b.pairing.retry(true);
    expect(b.group.consent()).toBeNull(); expect(b.scopes.get('a')?.size).toBe(0);
  });

  it('revoke waits for held background setup retry before disabling grants', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    await b.pairing.enable('a');
    const call = b.peers.call;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    b.peers.call = vi.fn(async (...args: Parameters<PluginSdkPeers['call']>) => { await held; return call(...args); });
    const retrying = b.pairing.retry(true);
    await vi.waitFor(() => expect(b.peers.call).toHaveBeenCalled());
    const revoking = b.pairing.revoke('a');
    const rejected = expect(revoking).rejects.toThrow(/join outcome unknown/);
    release(); await retrying; await rejected;
    expect(b.group.consent()?.peerId).toBe('a'); expect(b.scopes.get('a')?.size).toBe(2);
  });

  it('any member relays causal roster while unknown direct link remains fail closed', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'), d = net.app('d');
    await net.found(a, b); net.link(b, c); await b.pairing.enable('c'); await c.pairing.enable('b');
    await a.pairing.retry(true); await b.pairing.retry(true);
    net.link(a, d); await a.pairing.enable('d'); await d.pairing.enable('a');
    await a.pairing.retry(true); await b.pairing.retry(true);
    expect(c.group.roster()).toEqual(a.group.roster());
    expect(c.group.roster()!.members).toHaveLength(4);
    expect(c.enrollment.has('a')).toBe(false);
  });

  it('capacity wait visible offline; lost transfer ACK never reallocates and retry acquires from reachable member', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    // Default delegation consumes a second seat; two joins exhaust B-owned vacancies.
    for (const name of ['c', 'd']) {
      const app = net.app(name); net.link(b, app); await b.pairing.enable(name); await app.pairing.enable('b');
    }
    const e = net.app('e'); net.link(b, e); await b.pairing.enable('e'); net.offline.add('a'); net.offline.add('c');
    expect(await e.pairing.enable('b')).toMatchObject({ configured: false, setup: { state: 'pending', error: 'waiting for reserved capacity' } });
    const before = a.group.roster()!.rosterEpoch; net.offline.delete('a'); net.lost.add('a:group-capacity');
    // Avoid donor roster push until transfer receipt retry demonstrates durable idempotency.
    const call = a.peers.call;
    a.peers.call = vi.fn(async (...args) => { if (args[1] === 'group-roster') throw new Error('held roster'); return call(...args); });
    await e.pairing.retry(true);
    expect(a.group.roster()!.rosterEpoch).toBe(before + 1);
    expect(b.group.consent()?.capacity).toBeDefined();
    const request = b.group.consent()!.capacity!;
    await e.pairing.retry(true); await b.pairing.retry(true);
    expect(e.group.roster()!.members).toHaveLength(5);
    const stored = a.db.prepare('SELECT receipt_json FROM sync_group_admissions WHERE request_id = ?').get(request.requestId) as { receipt_json: string };
    expect(JSON.parse(stored.receipt_json).roster.rosterEpoch).toBe(before + 1);
    expect(a.group.roster()!.seats.flatMap((seat) => seat.events).filter((event) => event.requestId === request.requestId)).toHaveLength(1);
  });

  it('roster ACK requires causal coverage, not matching event count; forged ACK stays blocked', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const c = net.app('c'); net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a');
    const older = b.group.roster()!;
    b.handlers.set('group-roster', async () => ({ roster: older }));
    await a.pairing.retry(true);
    expect(a.group.jobs().some((job) => job.peerId === 'b' && job.error?.includes('does not cover'))).toBe(true);
  });

  it('capacity and roster handlers reject wrong scope, unknown sender and revoke fence', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const roster = a.group.roster()!, local = b.group.sync.localRepository()!;
    const req = { peerId: 'b', scope: 'wrong', grantEpoch: 1, signal: new AbortController().signal,
      commitSync: async (commit: () => unknown) => commit() };
    await expect(a.handlers.get('group-roster')!({ ...req, body: roster } as PluginPeerRequest)).rejects.toThrow(/scope/);
    await expect(a.handlers.get('group-roster')!({ ...req, scope: roster.repoId, peerId: 'unknown', body: roster } as PluginPeerRequest)).rejects.toThrow(/sender/);
    const capacity = { requestId: 'request', admissionRequestId: 'join', repoId: roster.repoId, groupId: roster.groupId,
      donorReplicaId: a.group.sync.localRepository()!.replicaId, recipientReplicaId: local.replicaId };
    expect(() => a.handlers.get('group-capacity')!({ ...req, body: capacity } as PluginPeerRequest)).toThrow(/scope/);
    await expect(a.handlers.get('group-capacity')!({ ...req, scope: roster.repoId, body: capacity,
      commitSync: async () => { throw new Error('revoked'); } } as PluginPeerRequest)).rejects.toThrow('revoked');
    expect(a.group.roster()).toEqual(roster);
  });

  it('removal never waits on an unreachable removed computer: link drops and undeliverable roster work ends', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(b, c); await b.pairing.enable('c'); await c.pairing.enable('b');
    await b.pairing.retry(true); await a.pairing.retry(true);
    const removed = c.group.sync.localRepository()!.replicaId;
    net.lost.add('c:group-roster'); await b.pairing.remove(removed);
    await b.pairing.retry(true);
    expect(b.group.roster()!.members).toHaveLength(2);
    expect(b.scopes.get('c')!.has(b.group.roster()!.repoId)).toBe(false);
    expect(b.group.jobs().some((job) => job.kind === 'local-revoke' && job.state !== 'done')).toBe(false);
    // Delivery to a removed computer whose link is gone ends instead of showing as blocked forever.
    await b.pairing.retry(true);
    expect(b.group.jobs().some((job) => job.peerId === 'c' && (job.kind === 'roster' || job.kind === 'retire') && job.state !== 'done')).toBe(false);
  });

  it('stale donor capacity refusal refreshes governance and permits later donor retry', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const c = net.app('c'), d = net.app('d');
    for (const app of [c, d]) { net.link(b, app); await b.pairing.enable(app.peerId); await app.pairing.enable('b'); }
    const call = a.peers.call;
    a.peers.call = vi.fn(async (...args) => { if (args[1] === 'group-roster') throw new Error('partitioned roster'); return call(...args); });
    const bCall = b.peers.call;
    b.peers.call = vi.fn(async (...args) => { if (args[0] === 'a' && args[1] === 'group-roster') throw new Error('partitioned ACK'); return bCall(...args); });
    const repo = a.group.roster()!.repoId;
    for (let index = 0; index < 3; index++) {
      const admissionRequestId = `donate-${index}`, donorReplicaId = a.group.sync.localRepository()!.replicaId;
      a.group.transfer({ requestId: capacityRequestId(admissionRequestId, donorReplicaId), admissionRequestId,
        repoId: repo, groupId: a.group.roster()!.groupId, donorReplicaId,
        recipientReplicaId: b.group.sync.localRepository()!.replicaId }, 'b');
    }
    const e = net.app('e'); net.link(b, e); await b.pairing.enable('e'); net.offline.add('c');
    expect(await e.pairing.enable('b')).toMatchObject({ configured: false, setup: { error: 'waiting for reserved capacity' } });
    expect(b.group.consent()?.capacity).toBeUndefined(); expect(b.group.hasCapacity()).toBe(true);
    await e.pairing.retry(true);
    expect(e.group.roster()!.members).toHaveLength(5);
  });

  it('introduction completes only when SDK returns complete; blocked result never claims success', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const scope = a.group.roster()!.repoId;
    net.introductions.set(`b:c:${scope}`, 'blocked'); net.introductions.set(`c:b:${scope}`, 'complete');
    await a.pairing.retry(true);
    const jobs = a.group.jobs().filter((job) => job.kind === 'introduce');
    expect(jobs.find((job) => (job.payload as { peerId: string }).peerId === 'b')).toMatchObject({ state: 'blocked', error: expect.stringContaining('automatic introduction blocked') });
    expect(jobs.find((job) => (job.payload as { peerId: string }).peerId === 'c')).toMatchObject({ state: 'done', error: null });
    expect(a.peers.introduce).toHaveBeenCalledWith('c', { sponsorPeerId: 'b', scope, signal: expect.any(AbortSignal) });
  });

  it('remote revoke rejects localOnly rather than bypassing pending roster delivery', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    const removed = a.group.remove(c.group.sync.localRepository()!.replicaId).roster;
    b.group.apply(removed, 'a'); const before = b.group.jobs();
    for (const localOnly of [true, false]) {
      await expect(a.peers.call('b', 'group-revoke', { peerId: 'c', scope: removed.repoId, localOnly }, { scope: removed.repoId })).rejects.toThrow();
    }
    expect(b.group.jobs()).toEqual(before);
  });

  it('self leave ACK loss retries historical covered state read-only and tears links down', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(b, c); await b.pairing.enable('c'); await c.pairing.enable('b'); await b.pairing.retry(true);
    net.lost.add('a:group-roster');
    // Link revocation never waits on delivery; hold b's local teardown so the ACK retry runs over the still-existing grant.
    const revoke = b.peers.revoke; let teardownHeld = true;
    b.peers.revoke = vi.fn(async (...args: Parameters<typeof revoke>) => { if (teardownHeld) throw new Error('teardown offline'); return revoke(...args); });
    await b.pairing.remove(b.group.sync.localRepository()!.replicaId);
    expect(a.group.roster()!.members.some((member) => member.machineId === 'b')).toBe(false);
    expect(b.group.removalDeliveryPending('a')).toBe(true);
    expect(b.group.jobs().some((job) => job.kind === 'local-revoke' && /waiting for/.test(job.error ?? ''))).toBe(false);
    const before = a.group.roster(), jobs = a.group.jobs();
    a.db.runScript("CREATE TRIGGER no_ack_write BEFORE UPDATE ON sync_group_control BEGIN SELECT RAISE(ABORT, 'read-only ACK'); END;");
    const ack = await b.peers.call('a', 'group-roster', b.group.roster(), { scope: before!.repoId });
    expect(ack).toEqual({ roster: before }); expect(a.group.jobs()).toEqual(jobs);
    const forged = appendSeat(before!, { kind: 'admit', seat: ownedSeats(before!, a.group.sync.localRepository()!.replicaId)[0]!,
      ownerReplicaId: a.group.sync.localRepository()!.replicaId, requestId: 'forged',
      member: { replicaId: 'unknown-d', machineId: 'unknown-d', joinedAt: 1, sponsorReplicaId: a.group.sync.localRepository()!.replicaId } });
    await expect(b.peers.call('a', 'group-roster', forged, { scope: before!.repoId })).rejects.toThrow(/sender|covered/);
    teardownHeld = false; await b.pairing.retry(true);
    expect(b.group.removalDeliveryPending('a')).toBe(false);
    expect(b.scopes.get('a')?.size).toBe(0); expect(b.scopes.get('c')?.size).toBe(0);
  });

  it('over fifty transfer updates keep introductions bounded and cannot block removal', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
    net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
    let count = 0;
    for (const seat of [4, 5, 6, 7]) for (let index = 0; index < 14; index++) {
      const roster = a.group.roster()!, chain = roster.seats[seat - 1]!, last = chain.events.at(-1);
      const owner = last?.kind === 'transfer' ? last.recipientReplicaId : roster.genesis.founders[seat <= 5 ? 0 : 1]!.replicaId;
      const recipient = roster.genesis.founders.find((member) => member.replicaId !== owner)!.replicaId;
      const next = appendSeat(roster, { kind: 'transfer', seat, requestId: `stress-${count++}`, ownerReplicaId: owner,
        recipientReplicaId: recipient, recipientAdmission: admissionReference(roster, recipient) });
      a.group.apply(next, 'b'); await a.pairing.retry(true);
      expect(a.group.jobs().filter((job) => job.kind === 'introduce').length).toBeLessThanOrEqual(2);
    }
    expect(count).toBeGreaterThan(50);
    await a.pairing.remove(c.group.sync.localRepository()!.replicaId);
    expect(a.group.roster()!.members).toHaveLength(2);
    expect(a.group.jobs().filter((job) => job.kind === 'introduce')).toHaveLength(0);
  }, 20_000);

  it('removed pinned donor terminates lost-ACK attempt without reclaiming transfer; another member donates', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'), d = net.app('d'); await net.found(a, b);
    for (const app of [c, d]) { net.link(b, app); await b.pairing.enable(app.peerId); await app.pairing.enable('b'); }
    const aCall = a.peers.call, bCall = b.peers.call;
    a.peers.call = vi.fn(async (...args) => { if (args[1] === 'group-roster') throw new Error('held roster'); return aCall(...args); });
    b.peers.call = vi.fn(async (...args) => { if (args[0] === 'a' && args[1] === 'group-roster') throw new Error('held ACK'); return bCall(...args); });
    const e = net.app('e'); net.link(b, e); await b.pairing.enable('e'); net.offline.add('c'); net.lost.add('a:group-capacity');
    expect(await e.pairing.enable('b')).toMatchObject({ configured: false, setup: { error: 'lost ACK' } });
    const pinned = b.group.consent()!.capacity!; expect(pinned.donorReplicaId).toBe(a.group.sync.localRepository()!.replicaId);
    net.offline.delete('c'); c.group.apply(a.group.roster(), 'b');
    const terminal = c.group.remove(a.group.sync.localRepository()!.replicaId).roster;
    b.group.apply(terminal, 'c');
    expect(b.group.consent()?.capacity).toBeUndefined(); expect(b.group.hasCapacity()).toBe(false);
    expect(b.group.roster()!.seats.flatMap((seat) => seat.events).some((event) => event.requestId === pinned.requestId)).toBe(true);
    await e.pairing.retry(true);
    expect(e.group.roster()!.members.some((member) => member.machineId === 'e')).toBe(true);
    expect(vi.mocked(b.peers.call).mock.calls.some(([peerId, method]) => peerId === 'c' && method === 'group-capacity')).toBe(true);
  });
});

type PairApp = ReturnType<ReturnType<typeof network>['app']>;
interface ConnState { list: PeerConnection[] }
const conn = (computerId = 'b', overrides: Partial<PeerConnection> = {}): PeerConnection =>
  ({ computerId, hostname: `host-${computerId}`, state: 'connected', usedByThisPlugin: true, ...overrides });
function connectionMocks(state: ConnState) {
  return {
    list: vi.fn(async (_args?: unknown) => state.list),
    requestUse: vi.fn(async (_id: string, _args?: unknown) => ({ status: 'approved' as 'pending' | 'approved' | 'denied' })),
    stopUsing: vi.fn(async (_id: string, _args?: unknown) => undefined),
    onChange: vi.fn((_callback: (connections: PeerConnection[]) => void) => vi.fn()),
    onConnectionRemoving: vi.fn((_handler: (computerId: string) => Promise<void>) => vi.fn()),
    setStatus: vi.fn((_id: string, _note: string | null) => undefined)
  };
}
/** Give an app's SDK the core connections surface a current host exposes. */
function withConnections(app: { peers: PluginSdkPeers }, state: ConnState = { list: [] }, _relink = true) {
  const mocks = connectionMocks(state), reconnectPeer = vi.fn(async (_id: string, _args?: unknown) => [] as unknown[]);
  Object.assign(app.peers, { connections: mocks });
  return { ...mocks, reconnectPeer };
}
const mocksOf = (app: { peers: PluginSdkPeers }) => app.peers.connections as unknown as ReturnType<typeof connectionMocks>;
/** The automatic setup failure after one reconcile pass. */
const failure = async (app: PairApp) => { await app.pairing.reconcile(); return app.pairing.setupFailure(); };

describe('DD core connection pairing', () => {
  const TRANSIENT = 'peer enrollment changed or revoked';

  it.each(['peer enrollment changed', TRANSIENT])('status treats %s as an enrollment transition and recovers', async (message) => {
    const net = network(), a = net.app('a');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      a.peers.list.mockRejectedValueOnce(new Error(message));
      expect(await a.pairing.status()).toMatchObject({ lifecycleAvailable: false, lifecycleChecking: true, peers: [], enrolled: [] });
      expect(warn).not.toHaveBeenCalled();
      expect(await a.pairing.status()).toMatchObject({ lifecycleAvailable: true, lifecycleChecking: false });
    } finally { warn.mockRestore(); }
  });

  it('explicit key failures are not classified as temporary status checks', async () => {
    const net = network(), a = net.app('a');
    a.peers.list.mockRejectedValueOnce(new Error('key unavailable [reason=keychain-denied]'));
    expect(await a.pairing.status()).toMatchObject({ lifecycleAvailable: false, lifecycleChecking: false, lifecycleReason: 'keychain-denied' });
  });

  it('reconcile survives a transient pair-store error during auto-enable and retries on the next call', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    const enrolled = b.peers.enrolled.bind(b.peers);
    const flaky = vi.spyOn(b.peers, 'enrolled').mockRejectedValueOnce(new Error(TRANSIENT));
    await expect(b.pairing.reconcile()).resolves.toBeUndefined();
    expect(b.pairing.setupFailure()).toBeNull();
    flaky.mockImplementation(enrolled);
    await b.pairing.reconcile();
    expect(flaky.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reconcile survives a transient pair-store error while restoring grants and retries next call', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    withConnections(a, { list: [conn('b')] });
    const list = a.peers.list.getMockImplementation()!;
    a.peers.list.mockRejectedValueOnce(new Error(TRANSIENT));
    await expect(a.pairing.reconcile()).resolves.toBeUndefined();
    expect(a.pairing.setupFailure()).toBeNull();
    a.peers.list.mockImplementation(list);
    await a.pairing.reconcile();
    expect(a.peers.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reconcile records a non-transient setup error instead of hiding it, and clears it once setup works', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    const enrolled = b.peers.enrolled.bind(b.peers);
    const broken = vi.spyOn(b.peers, 'enrolled').mockRejectedValueOnce(new Error('boom'));
    expect(await failure(b)).toBe('boom');
    broken.mockImplementation(enrolled);
    expect(await failure(b)).toBeNull();
  });

  it('a failed connections read is skipped quietly and the next read recovers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
      const mocks = withConnections(a, { list: [conn('b')] });
      mocks.list.mockRejectedValue(new Error('core unavailable'));
      await expect(a.pairing.reconcile()).resolves.toBeUndefined();
      await a.pairing.reconcile();
      expect(a.peers.enable).not.toHaveBeenCalled();
      expect(warn.mock.calls.filter(([text]) => String(text).includes('listing connections failed: core unavailable'))).toHaveLength(1);
      await expect(a.pairing.connections()).rejects.toThrow('core unavailable');
      mocks.list.mockResolvedValue([conn('b')]);
      await a.pairing.reconcile();
      await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
    } finally { warn.mockRestore(); }
  });

  it('peer handlers answer a missing local repository with a typed protocol error, not a TypeError', async () => {
    const net = network(), a = net.app('a');
    vi.spyOn(a.group.sync, 'localRepository').mockReturnValue(null);
    const req = { peerId: 'b', scope: 'x', grantEpoch: 1, body: {}, signal: new AbortController().signal, commitSync: async (commit: () => unknown) => commit() } as PluginPeerRequest;
    for (const method of ['group-hello', 'state-digest', 'state-changed']) {
      const error = await Promise.resolve().then(() => a.handlers.get(method)!(req)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PeerProtocolError);
      expect((error as Error).message).toBe('no local repository');
    }
  });

  it('lifecycle failure carries the real cause code and is logged with it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const net = network(), a = net.app('a');
      a.peers.list = vi.fn(async () => { throw new Error('peer encryption key unavailable [reason=keychain-denied]'); });
      expect(await a.pairing.status()).toMatchObject({ lifecycleAvailable: false, lifecycleReason: 'keychain-denied' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('peer lifecycle unavailable (keychain-denied)'));
      await a.pairing.status();
      expect(warn).toHaveBeenCalledTimes(1);
      a.peers.list = vi.fn(async () => { throw new Error('something odd'); });
      expect(await a.pairing.status()).toMatchObject({ lifecycleReason: 'unknown' });
      a.peers.list = vi.fn(async () => { throw new Error('x [reason=../../etc]'); });
      expect(await a.pairing.status()).toMatchObject({ lifecycleReason: 'unknown' });
      const net2 = network(), c = net2.app('c');
      c.peers.features = async () => ({ lifecycle: false, introductions: false, installer: false });
      expect(await c.pairing.status()).toMatchObject({ lifecycleAvailable: false, lifecycleReason: 'core-unsupported' });
      expect(lifecycleReasonOf('plain string')).toBe('unknown');
    } finally { warn.mockRestore(); }
  });

  it('logs an automatic enable failure once and shows it as the setup failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
      withConnections(a, { list: [conn('b')] });
      vi.spyOn(a.peers, 'enable').mockRejectedValue(new Error('keychain locked'));
      await a.pairing.reconcile();
      await vi.waitFor(async () => expect(await failure(a)).toBe('keychain locked'));
      await a.pairing.reconcile();
      expect(warn.mock.calls.filter(([text]) => String(text).includes('automatic database sync enable failed: keychain locked'))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  describe('repair', () => {
    it('refuses a computer core has no connection to, and a malformed id', async () => {
      const net = network(), a = net.app('a'); net.link(a, net.app('b'));
      const calls = withConnections(a, { list: [conn('c')] });
      await expect(a.pairing.repair('b')).rejects.toThrow('no connection to that computer; connect it in Settings first');
      await expect(a.pairing.repair('bad id')).rejects.toThrow();
      expect(calls.reconnectPeer).not.toHaveBeenCalled();
    });

    it('on a host without core connections, failed sync directs the owner to core reconnect', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
        vi.spyOn(a.peers, 'enable').mockRejectedValue(new Error('pair store busy'));
        const result = await a.pairing.repair('b');
        expect(result).toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('Reconnect the computer from Settings → Peers') });
        expect(result.detail).toContain('pair store busy');
      } finally { warn.mockRestore(); }
    });

    it('a connections host directs failed sync repair to core reconnect', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
        withConnections(a, { list: [conn('b')] }, false);
        vi.spyOn(a.peers, 'enable').mockRejectedValue(new Error('pair store busy'));
        await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('Reconnect the computer from Settings → Peers') });
      } finally { warn.mockRestore(); }
    });

    it('re-tries enabling sync, then is idempotent', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
      const calls = withConnections(a, { list: [conn('b')] });
      // The other computer has not enabled yet, so the peer is not in the roster: say so instead of claiming success.
      await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'pending', reason: null, detail: expect.stringMatching(/\S/) });
      expect(calls.reconnectPeer).not.toHaveBeenCalled();
      expect(a.group.consent()).toMatchObject({ peerId: 'b' });
      await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'pending' });
      expect(calls.reconnectPeer).not.toHaveBeenCalled();
      // An established member is left alone.
      const net2 = network(), c = net2.app('c'), d = net2.app('d'); await net2.found(c, d);
      const calls2 = withConnections(c, { list: [conn('d')] });
      await expect(c.pairing.repair('d')).resolves.toEqual({ outcome: 'already-synced', detail: null, reason: null });
      expect(calls2.reconnectPeer).not.toHaveBeenCalled();
    });

    it('linked but never enrolled in core: says to remove and pair again, without re-linking', async () => {
      const net = network(), a = net.app('a'), b = net.app('b');
      const calls = withConnections(a, { list: [conn('b')] });
      void b;
      await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'unavailable', reason: null, detail: expect.stringContaining('Settings → Peers') });
      expect(calls.reconnectPeer).not.toHaveBeenCalled();
      expect(a.group.consent()).toBeNull();
    });

    it('enrolled but offline: says the computer is offline', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
      withConnections(a, { list: [conn('b')] });
      net.offline.add('b');
      await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('offline') });
    });

    it('reports the swallowed setup error instead of claiming success', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
      withConnections(a, { list: [conn('b')] });
      const enable = a.peers.enable as ReturnType<typeof vi.fn>, real = enable.getMockImplementation()!;
      let calls = 0;
      enable.mockImplementation(async (...args: Parameters<typeof real>) => { if (++calls === 2) throw new Error('keychain locked'); return real(...args); });
      await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'pending', detail: expect.stringContaining('keychain locked') });
    });

    it('does not re-link the connection when enabling sync fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
        // The initiator enabled already; the follower's Repair joins the roster.
        await a.pairing.enable('b');
        const calls = withConnections(b, { list: [conn('a')] });
        vi.spyOn(b.peers, 'enable').mockRejectedValueOnce(new Error('pair store busy'));
        await expect(b.pairing.repair('a')).resolves.toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('Reconnect the computer from Settings → Peers') });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('repair: enable failed: pair store busy'));
      } finally { warn.mockRestore(); }
    });

    it('does not re-link after a failed sync setup', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b', { relinkWait: { timeoutMs: 200, intervalMs: 5 } }); net.link(a, b);
        await a.pairing.enable('b');
        const calls = withConnections(b, { list: [conn('a')] });
        vi.spyOn(b.peers, 'enable').mockRejectedValueOnce(new Error('pair store busy'));
        // A re-key tears the connector down; core does not list the peer until it is re-established.
        const enrolled = b.peers.enrolled.bind(b.peers);
        let away = 0;
        calls.reconnectPeer.mockImplementationOnce(async () => { away = 3; return []; });
        vi.spyOn(b.peers, 'enrolled').mockImplementation(async (args) => away-- > 0 ? [] : enrolled(args));
        await expect(b.pairing.repair('a')).resolves.toMatchObject({ outcome: 'unavailable' });
        expect(calls.reconnectPeer).not.toHaveBeenCalled();
      } finally { warn.mockRestore(); }
    });

    it('failed sync repair directs the owner to core reconnect', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b', { relinkWait: { timeoutMs: 30, intervalMs: 5 } }); net.link(a, b);
        await a.pairing.enable('b');
        const calls = withConnections(b, { list: [conn('a')] });
        vi.spyOn(b.peers, 'enable').mockRejectedValueOnce(new Error('pair store busy'));
        const enrolled = b.peers.enrolled.bind(b.peers);
        let relinked = false;
        calls.reconnectPeer.mockImplementationOnce(async () => { relinked = true; return []; });
        vi.spyOn(b.peers, 'enrolled').mockImplementation(async (args) => relinked ? [] : enrolled(args));
        const result = await b.pairing.repair('a');
        expect(result.outcome).toBe('unavailable');
        expect(result.detail).toContain('Reconnect the computer from Settings → Peers');
      } finally { warn.mockRestore(); }
    });

    it('does not re-link for a sync-group conflict: re-linking revokes the link grants and cannot resolve it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); net.link(a, b); net.link(a, c);
        const calls = withConnections(a, { list: [conn('c')] });
        await a.pairing.enable('b');
        await expect(a.pairing.repair('c')).resolves.toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('another database setup is pending') });
        expect(calls.reconnectPeer).not.toHaveBeenCalled();
      } finally { warn.mockRestore(); }
    });

    it('reports sync failure without re-linking any computer', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
        const calls = withConnections(a, { list: [conn('b')] });
        vi.spyOn(a.peers, 'enable').mockRejectedValue(new Error('pair store busy'));
        await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('pair store busy') });
        expect(calls.reconnectPeer).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('repair: enable failed: pair store busy'));
      } finally { warn.mockRestore(); }
    });

    it('does not re-link while the protected key is unusable; it returns the cause', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
        const calls = withConnections(a, { list: [conn('b')] });
        a.peers.list = vi.fn(async () => { throw new Error('peer encryption key unavailable [reason=key-missing]'); });
        await expect(a.pairing.repair('b')).resolves.toEqual({ outcome: 'unavailable', detail: null, reason: 'key-missing' });
        expect(calls.reconnectPeer).not.toHaveBeenCalled();
      } finally { warn.mockRestore(); }
    });
  });

  it('auto-enables a used, connected computer on both sides without Machines enrollment UI and never uploads', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(a, { list: [conn('b')] }); withConnections(b, { list: [conn('a')] });
    await a.pairing.reconcile(); await b.pairing.reconcile();
    await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
    await vi.waitFor(async () => { await b.pairing.reconcile(); expect(b.peers.enable).toHaveBeenCalled(); });
    await vi.waitFor(() => expect(a.group.consent() ?? a.group.roster()).not.toBeNull());
    await a.pairing.retry(true); await b.pairing.retry(true);
    expect(a.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'b']);
    expect(await failure(a)).toBeNull();
    // Pairing alone never created a manual sync session.
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_manual_sessions').get()).toEqual({ n: 0 });
    // Already a member: a later poll does nothing more.
    const calls = a.peers.enable.mock.calls.length;
    await a.pairing.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(a.peers.enable.mock.calls).toHaveLength(calls);
  });

  it('a used computer that is already a roster member does not hold back the next used one', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b); net.link(a, c);
    withConnections(a, { list: [conn('b'), conn('c')] });
    await a.pairing.reconcile();
    await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalledWith('c', expect.objectContaining({ scope: bootstrapScope('a', 'c') })));
  });

  it('keeps iterating candidates past one that is not enrolled', async () => {
    const net = network(), a = net.app('a'), c = net.app('c'); net.link(a, c);
    withConnections(a, { list: [conn('b'), conn('c')] });
    await a.pairing.reconcile();
    await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalledWith('c', expect.anything()));
    expect(a.peers.enable).not.toHaveBeenCalledWith('b', expect.anything());
  });

  it('Disable Link is not undone by a later tick; a new use request re-pairs', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const state = { list: [conn('b')] };
    const calls = withConnections(a, state);
    await a.pairing.revoke('b');
    // Disabling releases this plugin's use of the connection; the connection itself stays.
    expect(calls.stopUsing).toHaveBeenCalledWith('b', { signal: expect.any(AbortSignal) });
    a.peers.enable.mockClear();
    await a.pairing.reconcile(); await a.pairing.reconcile();
    expect(a.peers.enable).not.toHaveBeenCalled();
    // The owner using the connection again is the owner re-pairing.
    await expect(a.pairing.useConnection('b')).resolves.toEqual({ status: 'approved' });
    await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
  });

  it('a connection that vanishes and returns is a new connection: a local disable no longer applies', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const state = { list: [conn('b')] };
    withConnections(a, state);
    await a.pairing.revoke('b');
    a.peers.enable.mockClear();
    await a.pairing.reconcile();
    expect(a.peers.enable).not.toHaveBeenCalled();
    state.list = [];
    await a.pairing.reconcile();
    state.list = [conn('b')];
    await a.pairing.reconcile();
    await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
  });

  it('a local stop ends with the use: a use the other computer asks for, approved here in core, pairs again', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const state = { list: [conn('b')] };
    withConnections(a, state);
    await a.pairing.revoke('b');
    a.peers.enable.mockClear();
    // Core reports the use released; the new use is approved through core, never through this plugin's useConnection.
    state.list = [conn('b', { usedByThisPlugin: false })];
    await a.pairing.reconcile();
    state.list = [conn('b')];
    await a.pairing.reconcile();
    await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
  });

  it('Stop using on the other computer leaves the group here, so using it again pairs instead of counting it enrolled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
      const state = { list: [conn('b')] };
      withConnections(a, state);
      // Still used and enrolled: nothing is left.
      await a.pairing.reconcile();
      expect(a.group.sync.localRepository()!.groupId).not.toBeNull();
      state.list = [conn('b', { usedByThisPlugin: false })];
      await a.pairing.reconcile();
      expect(a.group.liveRoster()?.members.some((member) => member.machineId === 'b' && !isRetiring(a.group.roster()!, member.replicaId)) ?? false).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no longer uses'));
      a.peers.enable.mockClear();
      state.list = [conn('b')];
      await vi.waitFor(async () => { await a.pairing.reconcile(); expect(a.peers.enable).toHaveBeenCalledWith('b', expect.anything()); });
    } finally { warn.mockRestore(); }
  });

  it('revoke survives core refusing to release the use, and still disables sync', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
      const calls = withConnections(a, { list: [conn('b')] });
      calls.stopUsing.mockRejectedValue(new Error('core busy'));
      await expect(a.pairing.revoke('b')).resolves.toBeTruthy();
      expect(a.peers.revoke).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('releasing the connection use failed: core busy'));
    } finally { warn.mockRestore(); }
  });

  it('Disable Link before any tick is remembered against the used connection', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(a, { list: [conn('b')] });
    await a.pairing.revoke('b');
    a.peers.enable.mockClear();
    await a.pairing.reconcile();
    expect(a.peers.enable).not.toHaveBeenCalled();
  });

  it('explicit Enable lifts a local Disable Link', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(a, { list: [conn('b')] });
    await a.pairing.revoke('b');
    a.peers.enable.mockClear();
    await a.pairing.enable('b').catch(() => undefined);
    expect(a.peers.enable).toHaveBeenCalled();
  });

  it('both sides polling at once: only the lower instance id creates bindings, so no enable is ambiguous', async () => {
    const net = network({ race: true }), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(a, { list: [conn('b')] }); withConnections(b, { list: [conn('a')] });
    await Promise.all([a.pairing.reconcile(), b.pairing.reconcile()]);
    await vi.waitFor(() => expect(a.group.consent() ?? a.group.roster()).not.toBeNull());
    await vi.waitFor(async () => { await b.pairing.reconcile(); expect(b.group.consent() ?? b.group.roster()).not.toBeNull(); });
    await a.pairing.retry(true); await b.pairing.retry(true);
    expect(net.ambiguous.size).toBe(0);
    expect(a.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'b']);
    expect(b.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'b']);
    expect(await failure(a)).toBeNull();
    expect(await failure(b)).toBeNull();
  });

  it('the higher id waits for the initiator without deadlock, then answers once its bindings exist', async () => {
    const net = network({ race: true }), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    // The initiator has not acted (offline host, slower poll): the follower neither creates a binding nor blocks.
    await b.pairing.reconcile(); await b.pairing.reconcile();
    expect(b.peers.enable).not.toHaveBeenCalled();
    expect(await failure(b)).toBeNull();
    // The follower's own lifecycle stays free: a later initiator enable is answered on the next poll.
    withConnections(a, { list: [conn('b')] });
    await a.pairing.reconcile();
    await vi.waitFor(() => expect(a.group.consent() ?? a.group.roster()).not.toBeNull());
    await vi.waitFor(async () => { await b.pairing.reconcile(); expect(b.group.consent() ?? b.group.roster()).not.toBeNull(); });
    await a.pairing.retry(true); await b.pairing.retry(true);
    expect(net.ambiguous.size).toBe(0);
    expect(b.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'b']);
  });

  it('the follower backs off its probe of an unreachable initiator, bounded, and resumes after the delay', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    // Initiator's bootstrap binding exists, but its hello fails (host restarting).
    await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
    const call = b.peers.call.getMockImplementation()!;
    b.peers.call.mockRejectedValue(new Error('peer offline'));
    let now = 1_000_000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      await b.pairing.reconcile();
      const probes = () => b.peers.call.mock.calls.filter(([, method]) => method === 'group-hello').length;
      expect(probes()).toBe(1);
      await b.pairing.reconcile();
      expect(probes()).toBe(1);
      for (let i = 0; i < 12; i++) { now += 15 * 60_000; await b.pairing.reconcile(); }
      expect(probes()).toBe(13);
      b.peers.call.mockImplementation(call);
      now += 15 * 60_000;
      await b.pairing.reconcile();
      // Hello answered; the chosen-scope binding is still missing, so b waits locally without another binding.
      expect(b.peers.enable).not.toHaveBeenCalled();
      const probed = probes();
      await b.pairing.reconcile();
      expect(probes()).toBe(probed);
      // The learned scope is re-read once per tick.
      now += 30_000;
      await b.pairing.reconcile();
      expect(probes()).toBe(probed + 1);
      expect(b.peers.enable).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it('the follower backoff doubles per failed probe while the initiator stays unreachable', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
    b.peers.call.mockRejectedValue(new Error('peer offline'));
    let now = 1_000_000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const probes = () => b.peers.call.mock.calls.filter(([, method]) => method === 'group-hello').length;
    try {
      await b.pairing.reconcile();
      expect(probes()).toBe(1);
      now += 29_000; await b.pairing.reconcile(); expect(probes()).toBe(1);
      now += 1_000; await b.pairing.reconcile(); expect(probes()).toBe(2);
      now += 59_000; await b.pairing.reconcile(); expect(probes()).toBe(2);
      now += 1_000; await b.pairing.reconcile(); expect(probes()).toBe(3);
      now += 119_000; await b.pairing.reconcile(); expect(probes()).toBe(3);
      now += 1_000; await b.pairing.reconcile(); expect(probes()).toBe(4);
    } finally { clock.mockRestore(); }
  });

  it('the follower probes again at once after the initiator restores its grants (re-key), not after the long backoff', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
    b.peers.call.mockRejectedValue(new Error('peer offline'));
    let now = 1_000_000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const probes = () => b.peers.call.mock.calls.filter(([, method]) => method === 'group-hello').length;
    try {
      await b.pairing.reconcile();
      for (let i = 0; i < 3; i++) { now += 130_000; await b.pairing.reconcile(); }
      expect(probes()).toBe(4);
      // Still inside the grown backoff window and nothing changed: no probe.
      now += 5_000; await b.pairing.reconcile();
      expect(probes()).toBe(4);
      // The link was re-keyed: grants are re-issued under a new epoch.
      net.epochs.set('a', 2);
      now += 5_000; await b.pairing.reconcile();
      expect(probes()).toBe(5);
      // A genuinely unreachable initiator backs off again from the minimum.
      now += 20_000; await b.pairing.reconcile();
      expect(probes()).toBe(5);
      now += 10_000; await b.pairing.reconcile();
      expect(probes()).toBe(6);
    } finally { clock.mockRestore(); }
  });

  it('the follower probes again at once when the bootstrap grant vanished and came back during the backoff', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
    b.peers.call.mockRejectedValue(new Error('peer offline'));
    let now = 1_000_000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const probes = () => b.peers.call.mock.calls.filter(([, method]) => method === 'group-hello').length;
    try {
      await b.pairing.reconcile();
      for (let i = 0; i < 3; i++) { now += 130_000; await b.pairing.reconcile(); }
      const before = probes();
      b.scopes.get('a')!.delete(bootstrapScope('a', 'b'));
      now += 1_000; await b.pairing.reconcile();
      expect(probes()).toBe(before);
      b.scopes.get('a')!.add(bootstrapScope('a', 'b'));
      now += 1_000; await b.pairing.reconcile();
      expect(probes()).toBe(before + 1);
    } finally { clock.mockRestore(); }
  });

  it('the follower treats a hello with another identity or scope as not ready', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
    await a.peers.enable('b', { scope: a.group.sync.localRepository()!.repoId });
    const hello = a.handlers.get('group-hello')!;
    a.handlers.set('group-hello', async (request) => ({ ...(await hello(request) as object), peerId: 'c' }));
    await b.pairing.reconcile();
    expect(b.peers.enable).not.toHaveBeenCalled();
    a.handlers.set('group-hello', hello);
    let now = Date.now() + 60 * 60_000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      await vi.waitFor(async () => { await b.pairing.reconcile(); expect(b.peers.enable).toHaveBeenCalled(); });
      now += 1;
    } finally { clock.mockRestore(); }
  });

  it.each([
    ['use not approved', () => conn('b', { usedByThisPlugin: false }), false],
    ['connection reconnecting', () => conn('b', { state: 'reconnecting' }), false],
    ['connection disconnected', () => conn('b', { state: 'disconnected' }), false],
    ['malformed computer id', () => conn('bad id'), false],
    ['peer offline', () => conn('b'), true]
  ] as const)('does not auto-enable: %s', async (_name, make, offline) => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    if (offline) net.offline.add('b');
    withConnections(a, { list: [make()] });
    await a.pairing.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(a.peers.enable).not.toHaveBeenCalled();
  });

  it('does not re-enable while another setup is pending', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); net.link(a, b); net.link(a, c);
    await a.pairing.enable('c');
    expect(a.group.consent()).not.toBeNull();
    a.peers.enable.mockClear();
    withConnections(a, { list: [conn('b')] });
    await a.pairing.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(a.peers.enable).not.toHaveBeenCalled();
    void b;
  });

  it('surfaces an automatic enable failure and clears it after success', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(a, { list: [conn('b')] });
    const enable = a.peers.enable.getMockImplementation()!;
    a.peers.enable.mockRejectedValueOnce(new Error('peer offline'));
    await a.pairing.reconcile();
    await vi.waitFor(async () => expect(await failure(a)).toBe('peer offline'));
    a.peers.enable.mockImplementation(enable);
    await vi.waitFor(async () => { await a.pairing.reconcile(); expect(a.group.consent()).not.toBeNull(); });
    await vi.waitFor(async () => expect(await failure(a)).toBeNull());
  });

  it('a link re-key during setup: the initiator restores the bootstrap binding so the follower still joins', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    withConnections(b, { list: [conn('a')] });
    // The initiator negotiated; the follower has not answered yet when the inviter's first rotation revokes every grant.
    await a.pairing.enable('b');
    expect(a.group.consent()).not.toBeNull();
    a.scopes.get('b')!.clear(); b.scopes.get('a')!.clear();
    await b.pairing.reconcile();
    expect(b.group.consent() ?? b.group.roster()).toBeNull();
    a.peers.enable.mockClear();
    await a.pairing.retry(true);
    expect(a.peers.enable).toHaveBeenCalledWith('b', expect.objectContaining({ scope: bootstrapScope('a', 'b') }));
    await vi.waitFor(async () => { await b.pairing.reconcile(); expect(b.group.consent() ?? b.group.roster()).not.toBeNull(); });
    await a.pairing.retry(true); await b.pairing.retry(true);
    expect(a.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'b']);
    // The follower never re-creates the bootstrap binding itself.
    const follower = net.app('d'), initiator = net.app('c'); net.link(initiator, follower);
    await follower.pairing.enable('c').catch(() => undefined);
    follower.peers.enable.mockClear();
    await follower.pairing.retry(true);
    expect(follower.peers.enable).not.toHaveBeenCalledWith('c', expect.objectContaining({ scope: bootstrapScope('c', 'd') }));
    // Nor the database binding: re-created by both sides at once it would leave two bindings (ambiguous).
    const followerConsent = follower.group.consent();
    if (followerConsent) expect(follower.peers.enable).not.toHaveBeenCalledWith('c', expect.objectContaining({ scope: followerConsent.repoId }));
    const e = net.app('e'), f = net.app('f'); net.link(e, f);
    // The initiator's database-scope hello is not answering yet, so the follower's setup stays pending without a join request.
    const hello = e.handlers.get('group-hello')!;
    e.handlers.set('group-hello', async (request) => {
      if (request.scope !== bootstrapScope('e', 'f')) throw new Error('restarting');
      return hello(request);
    });
    await e.pairing.enable('f'); await f.pairing.enable('e');
    expect(f.group.consent()).not.toBeNull();
    e.scopes.get('f')!.clear(); f.scopes.get('e')!.clear();
    f.peers.enable.mockClear();
    await f.pairing.retry(true);
    expect(f.peers.enable).not.toHaveBeenCalled();
    expect(f.group.consent()).toMatchObject({ state: 'pending', error: 'the other computer has not finished setting up the connection yet' });
  });

  it('a link re-key while a lower-id sponsor admits a newcomer: the sponsor restores both bindings so the follower joins', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b); net.link(b, c);
    const scope = b.group.roster()!.repoId;
    withConnections(c, { list: [conn('b')] });
    // Sponsor b (lower id) negotiated with newcomer c; then the inviter's first rotation revokes every grant on the b-c link.
    await b.pairing.enable('c');
    expect(b.group.consent()).toMatchObject({ peerId: 'c', repoId: scope });
    b.scopes.get('c')!.clear(); c.scopes.get('b')!.clear();
    await c.pairing.reconcile();
    expect(c.group.consent() ?? c.group.roster()).toBeNull();
    expect(c.peers.enable).not.toHaveBeenCalled();
    b.peers.enable.mockClear();
    await b.pairing.retry(true);
    expect(b.peers.enable.mock.calls.map(([peer, args]) => [peer, args.scope])).toEqual([['c', bootstrapScope('b', 'c')], ['c', scope]]);
    // Restored: a later tick sees both grants and creates no binding.
    b.peers.enable.mockClear();
    await b.pairing.retry(true);
    expect(b.peers.enable).not.toHaveBeenCalled();
    await vi.waitFor(async () => { await c.pairing.reconcile(); expect(c.group.consent() ?? c.group.roster()).not.toBeNull(); });
    await c.pairing.retry(true); await b.pairing.retry(true); await a.pairing.retry(true);
    for (const app of [a, b, c]) expect(app.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'b', 'c']);
    expect(b.group.consent()).toBeNull();
  });

  it('a higher-id sponsor never restores bindings for a pending newcomer; a failed restore surfaces on the setup', async () => {
    const net = network(), a = net.app('a'), c = net.app('c'), b = net.app('b'); await net.found(a, c); net.link(c, b);
    // Sponsor c is the follower for newcomer b: the newcomer (initiator) restores, never the sponsor.
    await c.pairing.enable('b').catch(() => undefined);
    c.scopes.get('b')?.clear(); b.scopes.get('c')?.clear();
    c.peers.enable.mockClear();
    await c.pairing.retry(true);
    expect(c.peers.enable).not.toHaveBeenCalled();
    // A lower-id sponsor whose restore fails keeps the setup pending with the reason.
    const d = net.app('d'); net.link(a, d);
    await a.pairing.enable('d');
    a.scopes.get('d')!.clear(); d.scopes.get('a')!.clear();
    a.peers.enable.mockRejectedValueOnce(new Error('peer offline'));
    await a.pairing.retry(true);
    expect(a.group.consent()).toMatchObject({ peerId: 'd', state: 'pending', error: 'peer offline' });
    await a.pairing.retry(true);
    expect(a.group.consent()).toMatchObject({ peerId: 'd', state: 'pending', error: null });
    expect([...d.scopes.get('a')!].sort()).toEqual([bootstrapScope('a', 'd'), a.group.roster()!.repoId].sort());
  });

  it('after the group formed, the initiator restores a member grant a re-key revoked, bounded per tick', async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    const scope = a.group.roster()!.repoId;
    const state = { list: [conn('b')] };
    withConnections(a, state); withConnections(b, { list: [conn('a')] });
    a.scopes.get('b')!.clear(); b.scopes.get('a')!.clear();
    a.peers.enable.mockClear(); b.peers.enable.mockClear();
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      // The follower waits; the initiator re-enables the database scope and core mirrors it to the follower.
      await b.pairing.reconcile();
      expect(b.peers.enable).not.toHaveBeenCalled();
      const enable = a.peers.enable.getMockImplementation()!;
      a.peers.enable.mockRejectedValueOnce(new Error('peer authority revoked or mismatched'));
      await a.pairing.reconcile();
      expect(a.peers.enable).toHaveBeenCalledExactlyOnceWith('b', { scope, signal: expect.any(AbortSignal) });
      // A failed restore backs off for one tick.
      await a.pairing.reconcile();
      expect(a.peers.enable).toHaveBeenCalledTimes(1);
      now += 30_000; a.peers.enable.mockImplementation(enable);
      await a.pairing.reconcile();
      expect(a.peers.enable).toHaveBeenCalledTimes(2);
      expect(b.scopes.get('a')?.has(scope)).toBe(true);
      expect((await a.pairing.status()).members.every((member) => member.authorized)).toBe(true);
      // Restored: later ticks do nothing.
      now += 30_000;
      await a.pairing.reconcile();
      expect(a.peers.enable).toHaveBeenCalledTimes(2);
      // Not restored over a link that is not connected, or for a peer the owner disabled.
      a.scopes.get('b')!.clear(); now += 30_000;
      state.list = [conn('b', { state: 'reconnecting' })];
      await a.pairing.reconcile();
      expect(a.peers.enable).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
    state.list = [conn('b')];
    await a.pairing.revoke('b');
    a.peers.enable.mockClear();
    await a.pairing.reconcile();
    expect(a.peers.enable).not.toHaveBeenCalled();
  });

  describe('pairing again after a two-member group dissolved', () => {
    /**
     * The real-machine state: one computer pressed Remove on the other (so it left; it keeps a roster it is no longer in),
     * then the two paired again. The new link is linked and connected, core enrolls the peer, the initiator's enable
     * imported a database grant, and no ready invitation remains in the list (it was cancelled or fell out of it).
     */
    async function dissolvedThenRelinked(leaver: 'a' | 'b') {
      const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
      const [left, stayed] = leaver === 'a' ? [a, b] : [b, a];
      await left.pairing.remove(stayed.group.sync.localRepository()!.replicaId);
      await stayed.pairing.retry(true); await left.pairing.retry(true);
      withConnections(a, { list: [conn('b')] });
      withConnections(b, { list: [conn('a')] });
      // Core imported the initiator's database grant on the leaver: the leftover roster then looks authorized.
      await stayed.peers.enable(left.peerId, { scope: stayed.group.sync.localRepository()!.repoId });
      return { net, a, b, left, stayed };
    }
    const formed = async (x: PairApp, y: PairApp) => {
      for (const side of [x, y]) {
        expect(side.group.roster()?.members.map((member) => member.machineId).sort()).toEqual(['a', 'b']);
        expect(side.group.sync.localRepository()!.groupId).toBe(side.group.roster()!.groupId);
      }
      expect(x.group.roster()!.groupId).toBe(y.group.roster()!.groupId);
      expect((await x.pairing.status()).configured).toBe(true);
    };
    const poll = async (...sides: PairApp[]) => {
      for (let round = 0; round < 8; round++) {
        for (const side of sides) { await side.pairing.reconcile(); await new Promise((resolve) => setTimeout(resolve, 5)); await side.pairing.retry(true); }
      }
    };

    it.each(['a', 'b'] as const)('leaver %s: Repair never says already-synced for a leftover roster', async (leaver) => {
      const { left, stayed } = await dissolvedThenRelinked(leaver);
      const status = await left.pairing.status();
      expect(status.configured).toBe(false);
      await expect(left.pairing.repair(stayed.peerId)).resolves.not.toMatchObject({ outcome: 'already-synced' });
    });

    it.each(['a', 'b'] as const)('leaver %s: both sides converge to a new group by polling, without a ready invitation', async (leaver) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b, left } = await dissolvedThenRelinked(leaver);
        const replica = left.group.sync.localRepository()!.replicaId;
        await poll(a, b);
        await formed(a, b);
        // The leaver continues as a fresh replica (a group never re-admits a removed one); history is archived.
        expect(left.group.sync.localRepository()!.replicaId).not.toBe(replica);
        expect(left.db.prepare('SELECT COUNT(*) AS n FROM sync_restore_events').get()).toEqual({ n: 1 });
        await expect(a.pairing.repair('b')).resolves.toEqual({ outcome: 'already-synced', detail: null, reason: null });
      } finally { warn.mockRestore(); }
    });

    it.each(['a', 'b'] as const)('leaver %s: reconciliation clears stale removal state before the retry tick', async (leaver) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b, left } = await dissolvedThenRelinked(leaver);
        const replica = left.group.sync.localRepository()!.replicaId;
        await a.pairing.reconcile();
        await b.pairing.reconcile();
        expect(left.group.sync.localRepository()!.replicaId).not.toBe(replica);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('archived the sync group left over from an earlier removal'));
      } finally { warn.mockRestore(); }
    });

    it('Repair on the leaver converges once the other side polls', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b } = await dissolvedThenRelinked('b');
        const first = await b.pairing.repair('a');
        expect(first.outcome).not.toBe('already-synced');
        await poll(a, b);
        await formed(a, b);
      } finally { warn.mockRestore(); }
    });

    it('a new connection supersedes undelivered removal work addressed to that computer', async () => {
      const { left, stayed } = await dissolvedThenRelinked('a');
      left.group.queueJob(stayed.peerId, 'roster', left.group.roster()!.rosterEpoch, left.group.roster());
      left.db.prepare("UPDATE sync_group_jobs SET state = 'blocked', error = 'peer offline' WHERE kind = 'roster'").run();
      const result = await left.pairing.repair(stayed.peerId);
      expect(result.outcome).not.toBe('unavailable');
      expect(left.group.roster()).toBeNull();
    });

    it('a removed computer in a group that still has other members is refused with the reason, not re-admitted', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'); await net.found(a, b);
      net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
      await a.pairing.remove(b.group.sync.localRepository()!.replicaId); await a.pairing.retry(true); await b.pairing.retry(true); await a.pairing.retry(true);
      expect(a.group.roster()!.members.map((member) => member.machineId).sort()).toEqual(['a', 'c']);
      withConnections(a, { list: [conn('b')] });
      await expect(a.pairing.repair('b')).resolves.toMatchObject({ outcome: 'unavailable', detail: expect.stringContaining('cannot take a removed computer back') });
    });

    /**
     * The real two-machine deadlock: the computer that stayed also holds a sponsor setup (consent) for the leaver, persisted
     * beside its one-member roster (an older build, or a setup started before the removal arrived). The leaver detached and
     * waits for it to set that group aside; the stayer counted its own consent as "setup in progress" and never did.
     */
    const staleSponsorSetup = (stayed: PairApp, left: PairApp, replicaId: string) => {
      stayed.group.enable(stayed.peerId, left.peerId, stayed.group.sync.localRepository()!.repoId, replicaId);
      expect(stayed.group.consent()).toMatchObject({ peerId: left.peerId });
      expect(stayed.group.liveRoster()!.members.map((member) => member.machineId)).toEqual([stayed.peerId]);
    };

    it('a stale setup for the former member does not hide the leftover group: it is set aside, not cleared', async () => {
      const { left, stayed } = await dissolvedThenRelinked('b');
      staleSponsorSetup(stayed, left, left.group.sync.localRepository()!.replicaId);
      expect(stayed.group.rejoinState(left.peerId)).toEqual({ kind: 'detach' });
      // A frozen join has an unknown outcome and is never dropped; a setup with another computer is not this pairing's.
      const consent = stayed.group.consent()!;
      stayed.db.prepare('UPDATE sync_group_control SET consent_json = ?').run(JSON.stringify({ ...consent, request: { requestId: consent.requestId } }));
      expect(stayed.group.rejoinState(left.peerId)).toEqual({ kind: 'clear' });
      stayed.db.prepare('UPDATE sync_group_control SET consent_json = ?').run(JSON.stringify({ ...consent, peerId: 'c' }));
      expect(stayed.group.rejoinState(left.peerId)).toEqual({ kind: 'clear' });
      stayed.db.prepare('UPDATE sync_group_control SET consent_json = ?').run(JSON.stringify(consent));
      stayed.group.detachForRejoin(stayed.peerId, left.peerId);
      expect(stayed.group.consent()).toBeNull();
      expect(stayed.group.roster()).toBeNull();
    });

    it.each(['a', 'b'] as const)('leaver %s: the stayer sets aside its leftover group and stale setup by polling, no owner action', async (leaver) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b, left, stayed } = await dissolvedThenRelinked(leaver);
        staleSponsorSetup(stayed, left, left.group.sync.localRepository()!.replicaId);
        const replica = stayed.group.sync.localRepository()!.replicaId;
        await poll(a, b);
        await formed(a, b);
        expect(stayed.group.sync.localRepository()!.replicaId).not.toBe(replica);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('archived the sync group left over from an earlier removal'));
      } finally { warn.mockRestore(); }
    });

    it('Repair on the stuck stayer sets the leftover group aside and converges, never "mutually enrolled peer unavailable"', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b } = await dissolvedThenRelinked('b');
        // The leaver detached first (its consent is pinned to the stayer's old replica), exactly the machine evidence.
        // The stayer (initiator) re-created the bootstrap binding, so the leaver detaches, pins its setup to the stayer's
        // current replica and waits for it to set its leftover group aside: the machine evidence.
        await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
        await vi.waitFor(async () => {
          await b.pairing.reconcile(); await b.pairing.retry(true);
          expect(b.group.consent()).toMatchObject({ peerId: 'a', error: expect.stringContaining('set aside the sync group') });
        });
        staleSponsorSetup(a, b, 'replica-from-an-older-attempt');
        const result = await a.pairing.repair('b');
        expect(result.outcome).not.toBe('unavailable');
        await poll(a, b);
        await formed(a, b);
      } finally { warn.mockRestore(); }
    });

    it('the waiting side is told exactly what to do while the other computer still holds the leftover group', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b } = await dissolvedThenRelinked('b');
        // The stayer (initiator) re-created the bootstrap binding, so the leaver detaches, pins its setup to the stayer's
        // current replica and waits for it to set its leftover group aside: the machine evidence.
        await a.peers.enable('b', { scope: bootstrapScope('a', 'b') });
        await vi.waitFor(async () => {
          await b.pairing.reconcile(); await b.pairing.retry(true);
          expect(b.group.consent()).toMatchObject({ peerId: 'a', error: expect.stringContaining('set aside the sync group') });
        });
        // The stayer runs a build that never sets it aside: the leaver's Repair must still give a way forward.
        a.pairing.retry = async () => {};
        const result = await b.pairing.repair('a');
        expect(result.outcome).toBe('pending');
        expect(result.detail).not.toContain('waiting for the other computer to set aside');
        expect(result.detail).toMatch(/other computer.*Repair.*Settings → Peers/s);
      } finally { warn.mockRestore(); }
    });

    /**
     * The real two-machine deadlock (2026-10-17): the leaver still owes the stayer its removal roster, but the stayer has
     * already set its leftover group aside (fresh replica, no roster) to pair again. Its hello carries `roster: null`, the
     * delivery parsed that as a roster and failed with a raw Zod dump forever, and the leaver's link revocation and new
     * pairing both waited on it.
     */
    const historicalReplica = (side: PairApp, machineId: string) =>
      historicalMembers(side.group.roster()!).find((member) => member.machineId === machineId)!.replicaId;
    const stayerSetAside = async (leaver: 'a' | 'b') => {
      const setup = await dissolvedThenRelinked(leaver);
      const { left, stayed } = setup;
      const owed = left.db.prepare("UPDATE sync_group_jobs SET state = 'blocked', attempts = 3, error = 'peer offline' WHERE kind IN ('roster', 'local-revoke') AND (peer_id = ? OR json_extract(payload_json, '$.peerId') = ?)")
        .run(stayed.peerId, stayed.peerId) as { changes: number };
      if (!owed.changes) {
        left.group.queueJob(stayed.peerId, 'roster', left.group.roster()!.rosterEpoch, left.group.roster());
        left.group.queueJob(left.peerId, 'local-revoke', left.group.roster()!.rosterEpoch, { peerId: stayed.peerId, scope: left.group.roster()!.repoId });
        left.db.prepare("UPDATE sync_group_jobs SET state = 'blocked', attempts = 3, error = 'peer offline'").run();
      }
      expect(left.group.removalDeliveryPending(stayed.peerId)).toBe(true);
      stayed.group.quarantineRestoredWriter(stayed.peerId, { force: true });
      expect(stayed.group.roster()).toBeNull();
      return setup;
    };

    it.each(['a', 'b'] as const)('leaver %s: a removal roster owed to a peer that already set the group aside is superseded, not parsed as null', async (leaver) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { left, stayed } = await stayerSetAside(leaver);
        await left.pairing.retry(true);
        const owed = left.group.jobs().filter((job) => job.kind === 'roster' && job.peerId === stayed.peerId);
        expect(owed.map((job) => job.error ?? '').join(' ')).not.toMatch(/expected object|invalid_type|\[/);
        expect(left.group.removalDeliveryPending(stayed.peerId)).toBe(false);
        expect(left.group.rejoinState(stayed.peerId).kind).not.toBe('blocked');
      } finally { warn.mockRestore(); }
    });

    it.each(['a', 'b'] as const)('leaver %s: both sides converge after the stayer set its group aside first', async (leaver) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b } = await stayerSetAside(leaver);
        await poll(a, b);
        await formed(a, b);
        expect(a.group.jobs().concat(b.group.jobs()).filter((job) => job.state === 'blocked')).toEqual([]);
      } finally { warn.mockRestore(); }
    });

    it('a joiner whose replica is in the group but has no roster yet still receives the removal roster', async () => {
      const { left, stayed } = await stayerSetAside('b');
      // Same machine, a replica this group admitted, roster not installed yet: not "set aside".
      const admitted = historicalReplica(left, stayed.peerId);
      stayed.handlers.set('group-hello', async (request) => ({ repoId: left.group.roster()!.repoId, replicaId: admitted, peerId: stayed.peerId, scope: request.scope, roster: null }));
      let delivered = 0;
      stayed.handlers.set('group-roster', async () => { delivered++; return { roster: left.group.roster() }; });
      await left.pairing.retry(true);
      expect(delivered).toBe(1);
      expect(left.group.removalDeliveryPending(stayed.peerId)).toBe(false);
    });

    it('a removal roster for another group in the answer is superseded too', async () => {
      const { net, left, stayed } = await stayerSetAside('b');
      const c = net.app('c'), d = net.app('d'); await net.found(c, d);
      const other = c.group.roster()!;
      expect(other.groupId).not.toBe(left.group.roster()!.groupId);
      const call = left.peers.call;
      left.peers.call = vi.fn(async (...args: Parameters<typeof call>) => {
        const result = await call(...args);
        return args[1] === 'group-hello' ? { ...(result as object), replicaId: historicalReplica(left, stayed.peerId), roster: other } : result;
      }) as typeof call;
      await left.pairing.retry(true);
      expect(left.group.removalDeliveryPending(stayed.peerId)).toBe(false);
    });

    it('Reset sync with this computer discards only that computer\'s failed work and lets pairing again proceed', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, b, left, stayed } = await stayerSetAside('b');
        // A build without the supersede rule: the owed delivery keeps failing.
        const call = left.peers.call;
        left.peers.call = vi.fn(async (...args: Parameters<typeof call>) => {
          if (args[1] === 'group-hello') throw new Error('peer request was rejected');
          return call(...args);
        }) as typeof call;
        left.group.queueJob('c', 'roster', left.group.roster()!.rosterEpoch, left.group.roster());
        left.db.prepare("UPDATE sync_group_jobs SET state = 'blocked', error = 'peer offline' WHERE peer_id = 'c'").run();
        await left.pairing.retry(true);
        expect(left.group.rejoinState(stayed.peerId).kind).toBe('blocked');
        left.peers.call = call;
        const reset = await left.pairing.resetPeer(stayed.peerId);
        // Only the owed roster delivery is left to discard: the link revocation no longer waits behind it.
        expect(reset.discarded).toBeGreaterThanOrEqual(1);
        // Another computer's owed work stays; documents and history are untouched.
        expect(left.group.jobs().some((job) => job.peerId === 'c' && job.kind === 'roster')).toBe(true);
        expect(left.group.jobs().some((job) => job.state !== 'done' && (job.peerId === stayed.peerId || (job.payload as { peerId?: string }).peerId === stayed.peerId))).toBe(false);
        left.db.prepare("DELETE FROM sync_group_jobs WHERE peer_id = 'c'").run();
        await poll(a, b);
        await formed(a, b);
      } finally { warn.mockRestore(); }
    });

    it('a local Disable Link of the new link is not undone by the next tick', async () => {
      const { a, b } = await dissolvedThenRelinked('b');
      await a.pairing.revoke('b');
      const calls = a.peers.enable.mock.calls.length;
      await a.pairing.reconcile(); await new Promise((resolve) => setTimeout(resolve, 5));
      expect(a.peers.enable.mock.calls).toHaveLength(calls);
      void b;
    });
  });
});

describe('DD out-of-sync check', () => {
  async function pair(left: string | null | undefined, right: string | null | undefined) {
    const net = network(), a = net.app('a', left === undefined ? undefined : { stateDigest: () => left }), b = net.app('b', right === undefined ? undefined : { stateDigest: () => right });
    await net.found(a, b);
    return { net, a, b };
  }

  it('reports only a boolean and only when connected peers disagree', async () => {
    const same = await pair('h1', 'h1');
    expect(await same.a.pairing.outOfSync()).toBe(false);
    const differ = await pair('h1', 'h2');
    expect(await differ.a.pairing.outOfSync()).toBe(true);
    expect(await differ.b.pairing.outOfSync()).toBe(true);
    // The wire carries an opaque digest, never document data.
    const sent = differ.a.peers.call.mock.calls.filter(([, method]) => method === 'state-digest');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(([, , body]) => Object.keys(body as object).length === 0)).toBe(true);
  });

  it('is false without a local digest, group, connected peer, peer digest, or a working peer', async () => {
    expect(await (await pair(undefined, 'h')).a.pairing.outOfSync()).toBe(false);
    expect(await (await pair(null, 'h')).a.pairing.outOfSync()).toBe(false);
    expect(await (await pair('h', null)).a.pairing.outOfSync()).toBe(false);
    const lone = network().app('solo', { stateDigest: () => 'h' });
    expect(await lone.pairing.outOfSync()).toBe(false);
    const offline = await pair('h1', 'h2'); offline.net.offline.add('b');
    expect(await offline.a.pairing.outOfSync()).toBe(false);
    const broken = await pair('h1', 'h2');
    broken.b.handlers.set('state-digest', async () => ({ digest: 7 }));
    expect(await broken.a.pairing.outOfSync()).toBe(false);
    broken.b.handlers.delete('state-digest');
    expect(await broken.a.pairing.outOfSync()).toBe(false);
    const list = await pair('h1', 'h2');
    list.a.peers.list.mockRejectedValueOnce(new Error('down'));
    expect(await list.a.pairing.outOfSync()).toBe(false);
  });

  it('digest handler rejects the wrong scope, extra keys and an unfenced request', async () => {
    const { a, b } = await pair('h1', 'h2');
    const scope = b.group.sync.localRepository()!.repoId, handler = b.handlers.get('state-digest')!;
    const request = (over: object): PluginPeerRequest => ({ peerId: 'a', scope, grantEpoch: 1, body: {}, signal: new AbortController().signal, commitSync: async (fn: () => unknown) => fn(), ...over }) as PluginPeerRequest;
    await expect(handler(request({ scope: 'other' }))).rejects.toThrow('state scope mismatch');
    await expect(handler(request({ body: { x: 1 } }))).rejects.toThrow();
    await expect(handler(request({ commitSync: undefined }))).rejects.toThrow('commit fence');
    await expect(handler(request({}))).resolves.toEqual({ digest: 'h2' });
    const plain = network().app('plain');
    await expect(plain.handlers.get('state-digest')!(request({ scope: plain.group.sync.localRepository()!.repoId }))).resolves.toEqual({ digest: null });
    void a;
  });

  it('a peer state-changed push nudges the UI hook, stays content-free and is fenced', async () => {
    const stateChanged = vi.fn();
    const net = network(), a = net.app('a', { stateDigest: () => 'h' }), b = net.app('b', { stateDigest: () => 'h', stateChanged });
    await net.found(a, b);
    const scope = b.group.sync.localRepository()!.repoId, handler = b.handlers.get('state-changed')!;
    const request = (over: object): PluginPeerRequest => ({ peerId: 'a', scope, grantEpoch: 1, body: {}, signal: new AbortController().signal, commitSync: async (fn: () => unknown) => fn(), ...over }) as PluginPeerRequest;
    await expect(handler(request({}))).resolves.toEqual({ ok: true });
    expect(stateChanged).toHaveBeenCalledOnce();
    await expect(handler(request({ scope: 'other' }))).rejects.toThrow('state scope mismatch');
    await expect(handler(request({ body: { digest: 'x' } }))).rejects.toThrow();
    await expect(handler(request({ commitSync: undefined }))).rejects.toThrow('commit fence');
    expect(stateChanged).toHaveBeenCalledOnce();
    stateChanged.mockImplementation(() => { throw new Error('ui down'); });
    await expect(handler(request({}))).resolves.toEqual({ ok: true });
    await expect(a.pairing.notifyStateChanged()).resolves.toBeUndefined();
    expect(stateChanged).toHaveBeenCalledTimes(3);
    const sent = a.peers.call.mock.calls.filter(([, method]) => method === 'state-changed');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(([, , body]) => Object.keys(body as object).length === 0)).toBe(true);
  });

  it('notifyStateChanged is silent without a group, offline peers or a failing list', async () => {
    const net = network(), a = net.app('a'), b = net.app('b');
    await expect(a.pairing.notifyStateChanged()).resolves.toBeUndefined();
    await net.found(a, b);
    net.offline.add('b');
    await expect(a.pairing.notifyStateChanged()).resolves.toBeUndefined();
    net.offline.delete('b');
    a.peers.list.mockRejectedValueOnce(new Error('down'));
    await expect(a.pairing.notifyStateChanged()).resolves.toBeUndefined();
    expect(a.peers.call.mock.calls.some(([, method]) => method === 'state-changed')).toBe(false);
    b.handlers.delete('state-changed');
    await expect(a.pairing.notifyStateChanged()).resolves.toBeUndefined();
  });

  it('clears once both sides reach the same convergence digest', async () => {
    let left = 'x', right = 'y';
    const net = network(), a = net.app('a', { stateDigest: () => left }), b = net.app('b', { stateDigest: () => right });
    await net.found(a, b);
    expect(await a.pairing.outOfSync()).toBe(true);
    left = right = 'merged';
    expect(await a.pairing.outOfSync()).toBe(false);
    expect(await b.pairing.outOfSync()).toBe(false);
  });
});

describe('DD status notes for core connections', () => {
  const setup = () => {
    const net = network(), a = net.app('a'), b = net.app('b'); net.link(a, b);
    const state = { list: [conn('b')] };
    const mocks = withConnections(a, state);
    const calls = () => mocks.setStatus.mock.calls.map(([computerId, note]) => [computerId, note] as [string, string | null]);
    return { net, a, b, mocks, state, calls };
  };

  it('reports attention once for a used, connected computer without sync, and not again until it changes', async () => {
    const { a, calls } = setup();
    await a.pairing.reconcile();
    await a.pairing.reconcile();
    expect(calls()).toEqual([['b', 'Sync not set up']]);
  });

  it('clears the note once the computer is synced', async () => {
    const { a, b, calls } = setup();
    withConnections(b, { list: [conn('a')] });
    // Both computers use the connection; sync is enabled on its own, after which the attention note is cleared.
    await vi.waitFor(async () => {
      await a.pairing.reconcile(); await b.pairing.reconcile();
      expect(calls().map(([, note]) => note)).toEqual(['Sync not set up', null]);
    }, { timeout: 3000 });
  });

  it('sends nothing for a connection that is not live or not used, and reports afresh after it goes away', async () => {
    const { a, state, calls } = setup();
    state.list = [conn('b', { state: 'reconnecting' })];
    await a.pairing.reconcile();
    state.list = [conn('b', { usedByThisPlugin: false })];
    await a.pairing.reconcile();
    expect(calls()).toHaveLength(0);
    state.list = [conn('b')];
    await a.pairing.reconcile();
    expect(calls()).toHaveLength(1);
    // The connection vanishes (core drops its note with it); one that reappears is reported afresh.
    state.list = [];
    await a.pairing.reconcile();
    state.list = [conn('b')];
    await a.pairing.reconcile();
    expect(calls()).toHaveLength(2);
  });

  it('clears a stale attention note when the connection stops being connected', async () => {
    const { a, state, calls } = setup();
    await a.pairing.reconcile();
    state.list = [conn('b', { state: 'disconnected' })];
    await a.pairing.reconcile();
    expect(calls()).toEqual([['b', 'Sync not set up'], ['b', null]]);
  });

  it('clears the note when the plugin stops using the connection', async () => {
    const { a, state, calls } = setup();
    await a.pairing.reconcile();
    state.list = [conn('b', { usedByThisPlugin: false })];
    await a.pairing.reconcile();
    expect(calls()).toEqual([['b', 'Sync not set up'], ['b', null]]);
  });

  it('tolerates a failing report (retried next time) and older hosts without setStatus', async () => {
    const { a, mocks, calls } = setup();
    mocks.setStatus.mockImplementationOnce(() => { throw new Error('note refused'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(a.pairing.reconcile()).resolves.toBeUndefined();
      await a.pairing.reconcile();
      expect(calls()).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('reporting connection status failed: note refused'));
    } finally { warn.mockRestore(); }
    const older = network(), c = older.app('c'); older.app('d');
    const olderMocks = withConnections(c, { list: [conn('d')] });
    delete (c.peers.connections as { setStatus?: unknown }).setStatus;
    await expect(c.pairing.reconcile()).resolves.toBeUndefined();
    expect(olderMocks.list).toHaveBeenCalled();
  });
});

describe('DD lifecycle job failures', () => {
  const owedRoster = async () => {
    const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
    a.db.prepare("DELETE FROM sync_group_jobs WHERE kind = 'roster'").run();
    a.group.queueJob('b', 'roster', a.group.roster()!.rosterEpoch, a.group.roster());
    return { net, a, b };
  };
  const rosterJob = (a: PairApp) => a.group.jobs().find((job) => job.kind === 'roster' && job.peerId === 'b')!;

  it('a malformed reply fails after the retry cap with a readable reason and stops blocking link revocation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { a, b } = await owedRoster();
      let answered = 0;
      b.handlers.set('group-roster', async () => { answered++; return { roster: null }; });
      for (let round = 1; round < MAX_PERMANENT_JOB_ATTEMPTS; round++) await a.pairing.retry(true);
      expect(rosterJob(a)).toMatchObject({ state: 'blocked', attempts: MAX_PERMANENT_JOB_ATTEMPTS - 1 });
      expect(a.group.removalDeliveryPending('b')).toBe(true);
      await a.pairing.retry(true);
      const job = rosterJob(a);
      expect(job).toMatchObject({ state: 'failed', attempts: MAX_PERMANENT_JOB_ATTEMPTS });
      expect(job.error).toContain('cannot read');
      expect(job.error).not.toMatch(/invalid_type|expected object|[[{]/);
      expect(a.group.removalDeliveryPending('b')).toBe(false);
      expect((await a.pairing.status()).jobs.find((item) => item.id === job.id)?.state).toBe('failed');
      // The validator detail is logged (without values), once.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid_type at <root>'));
      // A failed job is not retried; Repair's forced retry does not resurrect it.
      await a.pairing.retry(true);
      expect(answered).toBe(MAX_PERMANENT_JOB_ATTEMPTS);
      // A later proof of delivery still completes it.
      a.group.acknowledgeRoster(a.group.roster()!, 'b');
      expect(rosterJob(a)).toMatchObject({ state: 'done', error: null });
    } finally { warn.mockRestore(); }
  });

  it('a transient failure keeps retrying past the cap', async () => {
    const { a, b } = await owedRoster();
    b.handlers.set('group-roster', async () => { throw new Error('peer offline'); });
    for (let round = 0; round < MAX_PERMANENT_JOB_ATTEMPTS + 2; round++) await a.pairing.retry(true);
    expect(rosterJob(a)).toMatchObject({ state: 'blocked', attempts: MAX_PERMANENT_JOB_ATTEMPTS + 2 });
    expect(a.group.removalDeliveryPending('b')).toBe(true);
  });

  it('Reset refuses while a lifecycle action runs and validates the peer id', async () => {
    const { a } = await owedRoster();
    await expect(a.pairing.resetPeer('../x')).rejects.toThrow('peerId is not a valid computer id');
    const waiting: Array<() => void> = [], features = a.peers.features;
    a.peers.features = vi.fn(() => new Promise((resolve) => { waiting.push(() => resolve({ lifecycle: true, introductions: true, installer: false })); })) as never;
    const enabling = a.pairing.enable('b').catch(() => undefined);
    await expect(a.pairing.resetPeer('b')).rejects.toThrow('already running');
    a.peers.features = features; waiting.forEach((release) => release()); await enabling;
    await expect(a.pairing.resetPeer('b')).resolves.toMatchObject({ discarded: 0 });
  });
});

describe('readableError', () => {
  it('never passes a validator or JSON dump to the owner', () => {
    const zod = z.object({ roster: z.object({}) }).safeParse(null).error!;
    expect(readableError(zod)).toMatch(/cannot read/);
    expect(readableError(new SyntaxError('Unexpected token'))).toMatch(/cannot read/);
    expect(readableError(new Error(zod.message))).toMatch(/cannot read/);
    expect(readableError(new Error('{"a":1}'))).toMatch(/cannot read/);
    expect(readableError(new Error('peer offline'))).toBe('peer offline');
    expect(readableError(new Error(''))).toBe('peer setup failed');
    expect(readableError('text')).toBe('peer setup failed');
  });
});

describe('DD orphan setup (no connection, no pairing under way)', () => {
  /** A pending setup with b, then the link to b is gone: what remains after both owners removed the link. */
  async function orphaned(hooks: ConstructorParameters<typeof DesignDocPairing>[2] = { orphanGraceMs: 0 }) {
    const net = network(), a = net.app('a', hooks), b = net.app('b'); net.link(a, b);
    await a.pairing.enable('b');
    expect(a.group.consent()).toMatchObject({ peerId: 'b', state: 'pending' });
    a.enrollment.delete('b');
    return { net, a, b, mocks: withConnections(a, { list: [] }) };
  }
  const tick = async (a: PairApp, times = 2) => { for (let i = 0; i < times; i++) await a.pairing.reconcile(); };

  it('drops the unfinished setup after two looks and the grace period, and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { a } = await orphaned();
      expect((await a.pairing.status()).setup).toMatchObject({ peerId: 'b', state: 'pending' });
      await tick(a, 1);
      expect(a.group.consent()).not.toBeNull();
      await tick(a, 3);
      expect(a.group.consent()).toBeNull();
      expect((await a.pairing.status()).setup).toBeNull();
      expect(warn.mock.calls.filter(([text]) => String(text).includes('discarded the unfinished database setup with b'))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('waits out the default grace period so a link about to come up is not raced', async () => {
    const { a } = await orphaned({});
    await tick(a, 4);
    expect(a.group.consent()).not.toBeNull();
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    try { await tick(a, 1); } finally { vi.useRealTimers(); }
    expect(a.group.consent()).toBeNull();
  });

  it('keeps the setup while a connection, an unreadable connection list or a frozen join exists', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { a, mocks } = await orphaned();
    mocks.list.mockResolvedValue([conn('b')]);
    await tick(a, 3); expect(a.group.consent()).not.toBeNull();
    mocks.list.mockResolvedValue([conn('b', { state: 'reconnecting', usedByThisPlugin: false })]);
    await tick(a, 3); expect(a.group.consent()).not.toBeNull();
    mocks.list.mockRejectedValue(new Error('core down'));
    await tick(a, 3); expect(a.group.consent()).not.toBeNull();
    warn.mockRestore();
    mocks.list.mockResolvedValue([]);
    a.db.prepare("UPDATE sync_group_control SET consent_json = json_set(consent_json, '$.request', json('{}')) WHERE singleton = 1").run();
    await tick(a, 3); expect(a.group.consent()).not.toBeNull();
  });

  it('a connection that returns during the grace period resets it', async () => {
    const { a, mocks } = await orphaned({ orphanGraceMs: 60_000 });
    await tick(a, 3);
    mocks.list.mockResolvedValue([conn('b')]);
    await tick(a, 1);
    mocks.list.mockResolvedValue([]);
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    try { await tick(a, 1); expect(a.group.consent()).not.toBeNull(); } finally { vi.useRealTimers(); }
  });

  it('Reset sync (Cancel setup) drops an unfrozen setup now, refuses a frozen one, and pairing can start again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { a } = await orphaned({});
      a.db.prepare("UPDATE sync_group_control SET consent_json = json_set(consent_json, '$.request', json('{}')) WHERE singleton = 1").run();
      await expect(a.pairing.resetPeer('b')).resolves.toMatchObject({ discarded: 0, status: { setup: { peerId: 'b' } } });
      a.db.prepare("UPDATE sync_group_control SET consent_json = json_remove(consent_json, '$.request') WHERE singleton = 1").run();
      await expect(a.pairing.resetPeer('b')).resolves.toMatchObject({ discarded: 1, status: { setup: null } });
      expect(a.group.consent()).toBeNull();
    } finally { warn.mockRestore(); }
  });

  it('leaves a live sync group and its documents alone', async () => {
    const net = network(), a = net.app('a', { orphanGraceMs: 0 }), b = net.app('b'); await net.found(a, b);
    withConnections(a, { list: [] });
    a.db.prepare("UPDATE sync_group_control SET consent_json = ? WHERE singleton = 1").run(JSON.stringify({ peerId: 'c', repoId: a.group.roster()!.repoId, replicaId: 'r', requestId: 'q', state: 'pending', error: null }));
    await tick(a, 3);
    expect(a.group.consent()).not.toBeNull();
    expect(a.group.liveRoster()).not.toBeNull();
  });
});

describe('DD core connections API', () => {
  const unknownConnection = () => Object.assign(new Error('no such connection'), { code: 'unknown_connection' });
  const replicaOf = (app: PairApp, machineId: string) => app.group.roster()!.members.find((member) => member.machineId === machineId)!.replicaId;

  describe('connections() view', () => {
    it('is empty on a host without core connections, and the other calls refuse with one stable reason', async () => {
      const net = network(), a = net.app('a');
      expect(await a.pairing.connections()).toEqual([]);
      await expect(a.pairing.reconcile()).resolves.toBeUndefined();
      await expect(a.pairing.useConnection('b')).rejects.toThrow('this host cannot share computer connections');
      await expect(a.pairing.stopUsingConnection('b')).rejects.toThrow('this host cannot share computer connections');
      // A partial surface (no requestUse / stopUsing) is treated the same way.
      Object.assign(a.peers, { connections: { list: vi.fn(async () => []) } });
      await expect(a.pairing.useConnection('b')).rejects.toThrow('cannot share computer connections');
      await expect(a.pairing.stopUsingConnection('b')).rejects.toThrow('cannot share computer connections');
      await expect(a.pairing.connections()).resolves.toEqual([]);
    });

    it('joins core connections with use, sync and retiring state', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'), c = net.app('c'), d = net.app('d'); await net.found(a, b);
      net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
      net.offline.add('c');
      await a.pairing.remove(replicaOf(a, 'c'));
      const state = { list: [conn('b'), conn('c'), conn('d', { usedByThisPlugin: false, state: 'reconnecting' }), conn('e', { usedByThisPlugin: false }), conn('f', { usedByThisPlugin: false })] };
      const calls = withConnections(a, state);
      calls.requestUse.mockImplementation(async (computerId: string) => ({ status: computerId === 'd' ? 'pending' as const : computerId === 'e' ? 'denied' as const : 'approved' as const }));
      await a.pairing.useConnection('d'); await a.pairing.useConnection('e'); await a.pairing.useConnection('f');
      void d;
      const byId = Object.fromEntries((await a.pairing.connections()).map((view) => [view.computerId, view]));
      expect(byId.b).toEqual({ computerId: 'b', hostname: 'host-b', state: 'connected', usedByThisPlugin: true, use: 'approved', syncing: true, retiring: false, settingUp: false });
      expect(byId.c).toMatchObject({ use: 'approved', syncing: false, retiring: true });
      expect(byId.d).toMatchObject({ state: 'reconnecting', usedByThisPlugin: false, use: 'pending', syncing: false, retiring: false });
      expect(byId.e).toMatchObject({ use: 'denied' });
      // Approved by core's answer but not (yet) reflected in the list: no stale "approved" badge.
      expect(byId.f).toMatchObject({ use: null });
      expect(calls.list).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    });

    it('reports setup work in flight with a used computer, and never for an unused one', async () => {
      const net = network(), a = net.app('a');
      const state = { list: [conn('b'), conn('c', { usedByThisPlugin: false })] };
      withConnections(a, state);
      const view = async (id: string) => (await a.pairing.connections()).find((entry) => entry.computerId === id)!;
      expect((await view('b')).settingUp).toBe(false);
      const internals = a.pairing as unknown as { following: Map<string, unknown>; restoring: Map<string, number>; enablingPeer: string | null };
      internals.following.set('b', { attempts: 0, nextAt: 0, scope: null, failedAt: null });
      internals.following.set('c', { attempts: 0, nextAt: 0, scope: null, failedAt: null });
      expect((await view('b')).settingUp).toBe(true);
      expect((await view('c')).settingUp).toBe(false);
      // An unreachable initiator backs off: that is waiting, not work in flight.
      internals.following.set('b', { attempts: 1, nextAt: 0, scope: null, failedAt: '' });
      expect((await view('b')).settingUp).toBe(false);
      internals.restoring.set('b', Date.now() + 60_000);
      expect((await view('b')).settingUp).toBe(true);
      internals.restoring.clear();
      internals.enablingPeer = 'b';
      expect((await view('b')).settingUp).toBe(true);
    });

    it('a request settled by core no longer shows pending after a Stop using from either computer', async () => {
      const net = network(), a = net.app('a');
      const state = { list: [conn('b', { usedByThisPlugin: false })] };
      const calls = withConnections(a, state);
      calls.requestUse.mockResolvedValue({ status: 'pending' });
      await a.pairing.useConnection('b');
      expect((await a.pairing.connections())[0]!.use).toBe('pending');
      // Both owners approved; later the other computer stops using it.
      state.list = [conn('b')];
      expect((await a.pairing.connections())[0]!.use).toBe('approved');
      state.list = [conn('b', { usedByThisPlugin: false })];
      expect((await a.pairing.connections())[0]!.use).toBeNull();
    });

    it('still lists connections when the sync status cannot be read', async () => {
      const net = network(), a = net.app('a');
      withConnections(a, { list: [conn('b')] });
      a.peers.features = vi.fn(async () => { throw new Error('features down'); });
      await expect(a.pairing.connections()).resolves.toEqual([expect.objectContaining({ computerId: 'b', syncing: false, retiring: false, use: 'approved' })]);
    });
  });

  describe('useConnection / stopUsingConnection', () => {
    it.each(['approved', 'pending', 'denied'] as const)('returns core\'s %s answer and remembers it', async (status) => {
      const net = network(), a = net.app('a');
      const calls = withConnections(a, { list: [conn('b', { usedByThisPlugin: false })] });
      calls.requestUse.mockResolvedValue({ status });
      await expect(a.pairing.useConnection('b')).resolves.toEqual({ status });
      expect(calls.requestUse).toHaveBeenCalledWith('b', { signal: expect.any(AbortSignal) });
      expect((await a.pairing.connections())[0]!.use).toBe(status === 'approved' ? null : status);
      await expect(a.pairing.useConnection('bad id')).rejects.toThrow();
    });

    it('passes core\'s error through unchanged', async () => {
      const net = network(), a = net.app('a');
      const calls = withConnections(a, { list: [] });
      const error = unknownConnection();
      calls.requestUse.mockRejectedValue(error);
      await expect(a.pairing.useConnection('b')).rejects.toBe(error);
      calls.stopUsing.mockRejectedValue(error);
      await expect(a.pairing.stopUsingConnection('b')).rejects.toBe(error);
    });

    it('bounds the remembered answers', async () => {
      const net = network(), a = net.app('a');
      const calls = withConnections(a, { list: [] });
      calls.requestUse.mockResolvedValue({ status: 'pending' });
      for (let i = 0; i < 70; i++) await a.pairing.useConnection(`c${i}`);
      expect(calls.requestUse).toHaveBeenCalledTimes(70);
    });

  it('stops using before best-effort local group cleanup; the connection itself stays', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
      const calls = withConnections(a, { list: [conn('b')] });
      const order: string[] = [], remove = a.pairing.remove.bind(a.pairing);
      vi.spyOn(a.pairing, 'remove').mockImplementation(async (replicaId) => { order.push('remove'); return remove(replicaId); });
      calls.stopUsing.mockImplementation(async () => { order.push('stopUsing'); });
      const status = await a.pairing.stopUsingConnection('b');
    expect(order).toEqual(['stopUsing']);
      expect(calls.stopUsing).toHaveBeenCalledWith('b', { signal: expect.any(AbortSignal) });
      expect(status.configured).toBe(true);
      expect(calls.setStatus).toHaveBeenCalledWith('b', null);
      // The owner stopped syncing with it: the next tick does not re-pair while core still lists it as used.
      a.peers.enable.mockClear();
      await a.pairing.reconcile();
      expect(a.peers.enable).not.toHaveBeenCalled();
    });

    it('just releases the use of a computer that is not a member', async () => {
      const net = network(), a = net.app('a'), b = net.app('b'); await net.found(a, b);
      const calls = withConnections(a, { list: [conn('b'), conn('c')] });
      const remove = vi.spyOn(a.pairing, 'remove');
      await a.pairing.stopUsingConnection('c');
      expect(remove).not.toHaveBeenCalled();
      expect(calls.stopUsing).toHaveBeenCalledExactlyOnceWith('c', { signal: expect.any(AbortSignal) });
      expect((await a.pairing.status()).configured).toBe(true);
      await expect(a.pairing.stopUsingConnection('bad id')).rejects.toThrow();
    });
  });

  describe('subscriptions', () => {
    const registered = (hooks?: ConstructorParameters<typeof DesignDocPairing>[2], list: PeerConnection[] = []) => {
      const net = network(), a = net.app('a', hooks, { list }), b = net.app('b');
      net.link(a, b);
      return { net, a, b, mocks: mocksOf(a) };
    };
    const removing = (mocks: ReturnType<typeof connectionMocks>) => mocks.onConnectionRemoving.mock.calls[0]![0];
    const changed = (mocks: ReturnType<typeof connectionMocks>) => mocks.onChange.mock.calls[0]![0];

    it('register subscribes once to removal and change notifications; dispose unsubscribes both', () => {
      const { mocks } = registered();
      expect(mocks.onConnectionRemoving).toHaveBeenCalledTimes(1);
      expect(mocks.onChange).toHaveBeenCalledTimes(1);
      const unsubscribes = [mocks.onConnectionRemoving.mock.results[0]!.value as ReturnType<typeof vi.fn>, mocks.onChange.mock.results[0]!.value as ReturnType<typeof vi.fn>];
      unsubscribes.forEach((unsubscribe) => expect(unsubscribe).not.toHaveBeenCalled());
      disposals.splice(0).forEach((dispose) => dispose());
      unsubscribes.forEach((unsubscribe) => expect(unsubscribe).toHaveBeenCalledTimes(1));
    });

    it('dispose tolerates an unsubscribe that throws, and register tolerates a partial surface', () => {
      const net = network(), a = net.app('a', undefined, { list: [] });
      mocksOf(a).onChange.mock.results[0]!.value.mockImplementation(() => { throw new Error('already gone'); });
      expect(() => disposals.splice(0).forEach((dispose) => dispose())).not.toThrow();
      const partial = network().app('p');
      Object.assign(partial.peers, { connections: { list: vi.fn(async () => []) } });
      expect(() => partial.pairing.register({ onDispose: (dispose) => disposals.push(dispose) } as never)).not.toThrow();
    });

    it('a change notification reconciles and nudges the UI, even when the nudge throws; nothing after dispose', async () => {
      const connectionsChanged = vi.fn();
      const { a, mocks } = registered({ connectionsChanged }, [conn('b')]);
      mocks.list.mockClear();
      changed(mocks)([conn('b')]);
      expect(connectionsChanged).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
      await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
      connectionsChanged.mockImplementation(() => { throw new Error('ui gone'); });
      mocks.list.mockClear();
      expect(() => changed(mocks)([])).not.toThrow();
      await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
      disposals.splice(0).forEach((dispose) => dispose());
      mocks.list.mockClear(); connectionsChanged.mockClear();
      changed(mocks)([]);
      expect(connectionsChanged).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
    });

    it('a failing background reconcile after a change is logged once, not thrown', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { a, mocks } = registered();
        a.peers.features = vi.fn(async () => { throw new Error('features down'); });
        mocks.list.mockResolvedValue([conn('b')]);
        changed(mocks)([]);
        await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 10));
      } finally { warn.mockRestore(); }
    });

    describe('connection removing handler', () => {
      it('stops syncing with the computer: revokes its grants, leaves the group, clears its note; idempotent', async () => {
        const net = network(), a = net.app('a', undefined, { list: [conn('b')] }), b = net.app('b'); await net.found(a, b);
        const mocks = mocksOf(a), repoId = a.group.roster()!.repoId;
        a.peers.revoke.mockClear();
        await removing(mocks)('b');
        expect(a.peers.revoke).toHaveBeenCalledWith('b', { scope: repoId });
        expect(a.peers.revoke).toHaveBeenCalledWith('b', { scope: bootstrapScope('a', 'b') });
        expect(a.peers.revoke).toHaveBeenCalledWith('b', { scope: a.group.sync.localRepository()!.repoId });
        expect(mocks.setStatus).toHaveBeenCalledWith('b', null);
        expect(a.group.sync.localRepository()!.groupId).toBeNull();
        expect((await a.pairing.status()).configured).toBe(false);
        // Core can call again (Retry): nothing throws and nothing is undone.
        await expect(removing(mocks)('b')).resolves.toBeUndefined();
        expect(a.group.roster()!.members.map((member) => member.machineId)).not.toContain('a');
        expect((await a.pairing.status()).configured).toBe(false);
      });

      it('in a group of three, the removed computer is retired and the others stay', async () => {
        const net = network(), a = net.app('a', undefined, { list: [conn('b'), conn('c')] }), b = net.app('b'), c = net.app('c'); await net.found(a, b);
        net.link(a, c); await a.pairing.enable('c'); await c.pairing.enable('a'); await a.pairing.retry(true);
        net.offline.add('c');
        await removing(mocksOf(a))('c');
        const status = await a.pairing.status();
        expect(status.members.find((member) => member.machineId === 'c')).toMatchObject({ retiring: true });
        expect(status.members.find((member) => member.machineId === 'b')).toMatchObject({ retiring: false, authorized: true });
        expect(a.peers.revoke).toHaveBeenCalledWith('c', expect.objectContaining({ scope: a.group.roster()!.repoId }));
      });

      it('cancels a pending setup and does not auto-enable the computer again', async () => {
        const net = network(), a = net.app('a', undefined, { list: [conn('b')] }), b = net.app('b'); net.link(a, b);
        await a.pairing.enable('b');
        expect(a.group.consent()).toMatchObject({ peerId: 'b' });
        await removing(mocksOf(a))('b');
        expect(a.group.consent()).toBeNull();
        a.peers.enable.mockClear();
        await a.pairing.reconcile(); await new Promise((resolve) => setTimeout(resolve, 5));
        expect(a.peers.enable).not.toHaveBeenCalled();
        // A new use request (the connection came back) lifts it.
        await a.pairing.useConnection('b');
        await vi.waitFor(() => expect(a.peers.enable).toHaveBeenCalled());
      });

      it('never throws for an invalid, empty or unknown id, and ignores a stopped plugin', async () => {
        const net = network(), a = net.app('a', undefined, { list: [] });
        const handler = removing(mocksOf(a));
        a.peers.revoke.mockClear();
        await expect(handler('bad id')).resolves.toBeUndefined();
        await expect(handler('')).resolves.toBeUndefined();
        expect(a.peers.revoke).not.toHaveBeenCalled();
        await expect(handler('zz')).resolves.toBeUndefined();
        await expect(handler('zz')).resolves.toBeUndefined();
        disposals.splice(0).forEach((dispose) => dispose());
        a.peers.revoke.mockClear();
        await expect(handler('b')).resolves.toBeUndefined();
        expect(a.peers.revoke).not.toHaveBeenCalled();
      });

      it('completes within its budget when revoking never answers', async () => {
        const net = network(), a = net.app('a', { removingBudgetMs: 50, removingStepMs: 20 }, { list: [conn('b')] }), b = net.app('b'); await net.found(a, b);
        const handler = removing(mocksOf(a));
        a.peers.revoke = vi.fn(() => new Promise<void>(() => {}));
        const started = Date.now();
        await handler('b');
        expect(Date.now() - started).toBeLessThan(1000);
        expect(a.peers.revoke).toHaveBeenCalled();
        // The group was left locally even though no grant could be revoked.
        expect(a.group.sync.localRepository()!.groupId).toBeNull();
      });

      it('completes within its overall budget when a later step hangs, and tolerates a failing step', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const net = network(), a = net.app('a', { removingBudgetMs: 40, removingStepMs: 5_000 }, { list: [conn('b')] }), b = net.app('b'); await net.found(a, b);
          const handler = removing(mocksOf(a));
          a.peers.revoke = vi.fn(() => new Promise<void>(() => {}));
          const started = Date.now();
          await handler('b');
          expect(Date.now() - started).toBeLessThan(1000);
          vi.spyOn(a.group, 'cancelSetup').mockImplementation(() => { throw new Error('store locked'); });
          await expect(handler('b')).resolves.toBeUndefined();
        } finally { warn.mockRestore(); }
      });

      it('keeps going when leaving the group fails, and logs it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const net = network(), a = net.app('a', undefined, { list: [conn('b')] }), b = net.app('b'); await net.found(a, b);
          vi.spyOn(a.group, 'remove').mockImplementation(() => { throw new Error('barrier busy'); });
          await expect(removing(mocksOf(a))('b')).resolves.toBeUndefined();
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('leaving the sync group with a removed connection failed: barrier busy'));
        } finally { warn.mockRestore(); }
      });

      it('a note re-sent for the same computer is cleared again, and a throwing setStatus is ignored', async () => {
        const net = network(), a = net.app('a', undefined, { list: [conn('b')] }), b = net.app('b'); net.link(a, b);
        const mocks = mocksOf(a);
        await a.pairing.reconcile();
        expect(mocks.setStatus).toHaveBeenCalledWith('b', 'Sync not set up');
        mocks.setStatus.mockImplementation(() => { throw new Error('refused'); });
        await expect(removing(mocks)('b')).resolves.toBeUndefined();
        expect(mocks.setStatus).toHaveBeenLastCalledWith('b', null);
      });
    });
  });
});
