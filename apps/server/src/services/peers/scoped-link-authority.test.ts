import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PairStore } from './pair-store.js';
import { PeerUseError, ScopedLinkAuthority, signMutualEnrollmentProof, type EnrolledPeerBridge, type EnrollmentChannel, type PairProposal } from './scoped-link-authority.js';
import { unsealPeerBytes, sealPeerBytes } from './peer-auth.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const proposal: PairProposal = { pairId: 'pair-1', localInstanceId: 'app-a', remoteInstanceId: 'app-b', pluginId: 'test-plugin',
  scope: 'opaque-scope', targetHostId: 'host-b', epoch: 1, proposalId: 'proposal-1' };
const reverse: PairProposal = { ...proposal, localInstanceId: 'app-b', remoteInstanceId: 'app-a', targetHostId: 'host-a' };
async function fixture(gated = false, uses?: Set<string>) {
  const blocked = new Set<string>(); let throwing = false, usesThrowing = false;
  const isUseApproved = uses ? (hostId: string, pluginId: string) => { if (usesThrowing) throw new Error('lookup failed'); return uses.has(`${hostId}/${pluginId}`); } : undefined;
  const isLinkUsable = gated ? (hostId: string) => { if (throwing) throw new Error('lookup failed'); return !blocked.has(hostId); } : undefined;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'scoped-authority-'))); roots.push(root);
  const provider = { getKey: async () => Buffer.alloc(32, 17) };
  const channels = new Map<string, EnrollmentChannel>([
    ['host-a', { hostId: 'host-a', keyHash: hash('key-a'), capability: 'execution', connected: true }],
    ['host-b', { hostId: 'host-b', keyHash: hash('key-b'), capability: 'execution', connected: true }],
    ['host-c', { hostId: 'host-c', keyHash: hash('key-c'), capability: 'execution', connected: true }]
  ]);
  let a!: ScopedLinkAuthority, b!: ScopedLinkAuthority;
  const pairOptions = (instanceId: string) => ({ localInstanceId: instanceId, keyProvider: provider,
    authorizeTransfer: (ctx: unknown, bind: Parameters<ScopedLinkAuthority['authorizeTransfer']>[1]) => (instanceId === 'app-a' ? a : b).authorizeTransfer(ctx, bind),
    validateGrant: (grant: Parameters<ScopedLinkAuthority['validateGrant']>[0]) => (instanceId === 'app-a' ? a : b).validateGrant(grant) });
  let pairsA = new PairStore(join(root, 'pairs-a'), pairOptions('app-a'));
  const pairsB = new PairStore(join(root, 'pairs-b'), pairOptions('app-b'));
  const prove = vi.fn(async (hostId: string, challenge: { nonce: string; senderInstanceId: string }) => {
    const outgoing = channels.get(hostId)!, reverseHostId = hostId === 'host-a' ? 'host-b' : 'host-a', reciprocal = channels.get(reverseHostId)!;
    if (!reciprocal.connected) throw new Error('reciprocal unavailable');
    return signMutualEnrollmentProof({ nonce: challenge.nonce, senderInstanceId: challenge.senderInstanceId, recipientInstanceId: hostId === 'host-a' ? 'app-a' : hostId === 'host-b' ? 'app-b' : 'app-c',
      hostId, reverseHostId, reverseKeyHash: reciprocal.keyHash, reverseCapability: reciprocal.capability }, outgoing.keyHash);
  });
  const exchange = vi.fn(async (_hostId: string, op: 'import' | 'activate' | 'revoke', input: PairProposal, sealed?: Uint8Array) => {
    const target = input.localInstanceId === 'app-a' ? b : a;
    const inverse = { ...input, localInstanceId: input.remoteInstanceId, remoteInstanceId: input.localInstanceId, targetHostId: input.localInstanceId === 'app-a' ? 'host-a' : 'host-b' };
    if (op === 'import') await target.import(inverse, sealed!);
    if (op === 'activate') await target.acceptActivation(inverse);
    if (op === 'revoke') await target.revoke(input.pairId);
  });
  const introduce = vi.fn(async () => {});
  const bridge: EnrolledPeerBridge = { prove, exchange, introduce };
  const options = (instanceId: string, pairs: PairStore) => ({ directory: join(root, `authority-${instanceId}`), instanceId, keyProvider: provider, pairs,
    enrollment: (hostId: string) => channels.get(hostId) ?? null,
    reverseEnrollment: async (remote: string) => channels.get(remote === 'app-a' ? 'host-b' : 'host-a') ?? null,
    currentReverseEnrollment: (remote: string) => channels.get(remote === 'app-a' ? 'host-b' : 'host-a') ?? null, bridge, isLinkUsable, isUseApproved });
  a = new ScopedLinkAuthority(options('app-a', pairsA)); b = new ScopedLinkAuthority(options('app-b', pairsB));
  return { blocked, setThrowing: (v: boolean) => { throwing = v; }, setUsesThrowing: (v: boolean) => { usesThrowing = v; }, root, get a() { return a; }, b, get pairsA() { return pairsA; }, pairsB, channels, prove, exchange, introduce, bridge,
    restart: () => { a.dispose(); a = new ScopedLinkAuthority(options('app-a', pairsA)); return a; },
    restartAll: () => { a.dispose(); pairsA.dispose(); pairsA = new PairStore(join(root, 'pairs-a'), pairOptions('app-a')); a = new ScopedLinkAuthority(options('app-a', pairsA)); return a; }, options };
}

it('exchanges sealed credentials, activates both peers and authenticates after authority restart', async () => {
  const f = await fixture();
  await f.a.propose(proposal);
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await f.a.activate(proposal);
  expect(await f.pairsA.grant(proposal.pairId)).toMatchObject({ status: 'active' });
  expect(await f.pairsB.grant(proposal.pairId)).toMatchObject({ status: 'active' });
  const body = Buffer.from('{}'), envelope = (await f.pairsA.signRequest(proposal.pairId, { pluginId: proposal.pluginId, scope: proposal.scope, method: 'sync', body }))!;
  const lease = await f.pairsB.authenticateRequest({ envelope, body, pluginId: proposal.pluginId, scope: proposal.scope, route: envelope.route, httpMethod: 'POST' });
  expect(lease).not.toBeNull(); lease?.release();
  await expect(f.restart().recover()).resolves.toEqual({ pending: 0, blocked: 0 });
  await expect(f.a.activate(proposal)).resolves.toMatchObject({ status: 'active' });
});

it('cannot forge transfer context with caller booleans or plugin-supplied identities', async () => {
  const f = await fixture(); await f.a.propose(proposal);
  for (const context of [null, true, {}, { authenticated: true, capability: 'peer.forward', hostId: 'host-b' }]) {
    await expect(f.pairsA.exportCredential(proposal.pairId, context)).rejects.toThrow('authenticated host credential channel unavailable');
  }
  await expect(f.a.propose({ ...proposal, localInstanceId: 'other' })).rejects.toThrow('destination');
  await expect(f.a.propose({ ...proposal, remoteInstanceId: 'app-a' })).rejects.toThrow('destination');
  await expect(f.a.propose({ ...proposal, capability: 'execution' } as PairProposal)).rejects.toThrow();
});

it.each(['offline', 'missing', 'mixed-capability', 'one-direction', 'recipient', 'nonce', 'signature'])('rejects %s enrollment proof', async mode => {
  const f = await fixture();
  if (mode === 'offline') f.channels.get('host-b')!.connected = false;
  if (mode === 'missing') f.channels.delete('host-b');
  if (mode === 'mixed-capability') f.channels.get('host-b')!.capability = 'peer.forward';
  if (mode === 'one-direction') f.channels.get('host-a')!.capability = 'peer.forward';
  if (['recipient', 'nonce', 'signature'].includes(mode)) {
    f.prove.mockImplementation(async (hostId, challenge) => {
      if (mode === 'signature') return { sealedProof: '0'.repeat(100) };
      return signMutualEnrollmentProof({ senderInstanceId: challenge.senderInstanceId, nonce: mode === 'nonce' ? '0'.repeat(48) : challenge.nonce,
        recipientInstanceId: mode === 'recipient' ? 'app-c' : 'app-b', hostId, reverseHostId: 'host-a',
        reverseKeyHash: hash('key-a'), reverseCapability: 'execution' }, hash('key-b'));
    });
  }
  await expect(f.a.propose(proposal)).rejects.toThrow();
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  expect(f.exchange).not.toHaveBeenCalled();
});

it('carries a forward-only link end to end without any execution tier', async () => {
  const f = await fixture();
  for (const host of ['host-a', 'host-b']) f.channels.get(host)!.capability = 'peer.forward';
  await f.a.activate(proposal);
  expect(await f.pairsA.grant(proposal.pairId)).toMatchObject({ status: 'active' });
  expect(await f.pairsB.grant(proposal.pairId)).toMatchObject({ status: 'active' });
  await expect(f.restart().recover()).resolves.toEqual({ pending: 0, blocked: 0 });
  // Tier change after activation fences the pair (enrollment changed).
  f.channels.get('host-b')!.capability = 'execution';
  await expect(f.a.activate(proposal)).rejects.toThrow();
});

it('rejects a proof that claims a different reverse tier or an unknown tier', async () => {
  const f = await fixture();
  for (const host of ['host-a', 'host-b']) f.channels.get(host)!.capability = 'peer.forward';
  f.prove.mockImplementation(async (hostId, challenge) => signMutualEnrollmentProof({ senderInstanceId: challenge.senderInstanceId, nonce: challenge.nonce,
    recipientInstanceId: 'app-b', hostId, reverseHostId: 'host-a', reverseKeyHash: hash('key-a'), reverseCapability: 'execution' }, hash('key-b')));
  await expect(f.a.propose(proposal)).rejects.toThrow('mutual enrollment proof mismatch');
  expect(() => signMutualEnrollmentProof({ senderInstanceId: 'app-a', nonce: '0'.repeat(48), recipientInstanceId: 'app-b', hostId: 'host-b', reverseHostId: 'host-a',
    reverseKeyHash: hash('key-a'), reverseCapability: 'admin' as never }, hash('key-b'))).toThrow();
  expect(f.exchange).not.toHaveBeenCalled();
});

it('fails closed with no bridge, malformed proof, or closed authority', async () => {
  const f = await fixture();
  const absent = new ScopedLinkAuthority({ ...f.options('app-a', f.pairsA), bridge: undefined });
  await expect(absent.propose(proposal)).rejects.toThrow('bridge unavailable');
  f.prove.mockResolvedValue({} as never);
  await expect(f.a.propose(proposal)).rejects.toThrow();
  f.a.dispose(); await expect(f.a.propose(proposal)).rejects.toThrow('disposed');
  await expect(f.a.recover()).rejects.toThrow('disposed');
});

it('fences revoked proposals, epoch substitutions, and enrollment rotation on startup', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  await expect(f.a.activate({ ...proposal, epoch: 2 })).rejects.toThrow('mismatched');
  await expect(f.a.activate({ ...proposal, pluginId: 'other-plugin' })).rejects.toThrow('mismatched');
  const lease = await f.pairsA.acquireGrant(proposal.pairId, 1, proposal.pluginId, proposal.scope);
  f.channels.get('host-b')!.keyHash = hash('rotated-key');
  await f.restart().recover();
  expect(lease?.signal.aborted).toBe(true);
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await expect(f.a.propose(proposal)).rejects.toThrow('revoked');
});

it('ensureProposal replaces a binding superseded by a re-key, and keeps one whose enrollment is only missing', async () => {
  const f = await fixture();
  const input = { pluginId: proposal.pluginId, remoteInstanceId: 'app-b', targetHostId: 'host-b', scope: proposal.scope };
  const first = await f.a.ensureProposal(input);
  await f.a.activate(first);
  expect(await f.a.ensureProposal(input)).toEqual(first);
  // Missing enrollment is not evidence of a newer generation: the binding stays and the proof fails closed.
  const saved = f.channels.get('host-a')!; f.channels.delete('host-a');
  await expect(f.a.ensureProposal(input)).rejects.toThrow();
  f.channels.set('host-a', saved);
  expect(await f.a.proposals(proposal.pluginId, 'app-b', proposal.scope)).toEqual([first]);
  // A link rotation re-keys the outgoing host: the old binding is revoked and a fresh one is created at once.
  f.channels.get('host-b')!.keyHash = hash('rotated-key');
  const next = await f.a.ensureProposal(input);
  expect(next.pairId).not.toBe(first.pairId);
  expect(await f.pairsA.grant(first.pairId)).toBeNull();
  expect(await f.a.activePairIds('app-b')).toEqual([next.pairId]);
  expect(await f.a.activePairIds('app-other')).toEqual([]);
  expect((await f.a.proposals(proposal.pluginId, 'app-b', proposal.scope, true)).map(p => p.pairId).sort()).toEqual([first.pairId, next.pairId].sort());
  await expect(f.a.activate(next)).resolves.toMatchObject({ status: 'active' });
  // The reverse direction re-keyed instead: same replacement.
  f.channels.get('host-a')!.keyHash = hash('rotated-reverse');
  expect((await f.a.ensureProposal(input)).pairId).not.toBe(next.pairId);
});

it('lost ACK remains proposed and retry reuses imported secret after restart', async () => {
  const f = await fixture(); const original = f.exchange.getMockImplementation()!;
  f.exchange.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('lost ACK'); });
  await expect(f.a.activate(proposal)).rejects.toThrow('lost ACK');
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await expect(f.restart().activate(proposal)).resolves.toMatchObject({ status: 'active' });
});

it('revocation during network exchange cancels activation and survives startup', async () => {
  const f = await fixture(); const original = f.exchange.getMockImplementation()!;
  f.exchange.mockImplementationOnce(async (...args) => { await original(...args); await f.a.revoke(proposal.pairId); });
  await expect(f.a.activate(proposal)).rejects.toThrow('revoked');
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await expect(f.restart().recover()).resolves.toEqual({ pending: 0, blocked: 0 });
});

it('introductions persist offline, retry on startup, use only peer.forward and reject wrong scope/recipient', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const third = { ...proposal, pairId: 'pair-c', remoteInstanceId: 'app-c', targetHostId: 'host-c', proposalId: 'proposal-c' };
  await f.a.propose(third); await f.pairsA.activate(third.pairId, third.proposalId, third.epoch);
  const job = { introductionId: 'intro-1', sponsorPairId: proposal.pairId, targetPairId: third.pairId,
    peerInstanceId: 'app-b', pluginId: proposal.pluginId, scope: proposal.scope, status: 'pending' as const };
  for (const patch of [{ scope: 'other' }, { peerInstanceId: 'app-c' }, { pluginId: 'other' }, { status: 'complete' as const }]) {
    await expect(f.a.introduce({ ...job, ...patch })).rejects.toThrow();
  }
  f.channels.get('host-c')!.connected = false;
  await f.a.introduce(job); await f.a.introduce(job);
  await expect(f.a.recover()).resolves.toEqual({ pending: 1, blocked: 0 });
  expect(f.introduce).not.toHaveBeenCalled();
  f.channels.get('host-c')!.connected = true;
  f.introduce.mockRejectedValueOnce(new Error('offline'));
  await expect(f.restart().recover()).resolves.toEqual({ pending: 1, blocked: 0 });
  await expect(f.a.recover()).resolves.toEqual({ pending: 0, blocked: 0 });
  expect(f.introduce).toHaveBeenLastCalledWith('host-c', { recipientInstanceId: 'app-c', capability: 'peer.forward', pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-b', introductionId: 'intro-1' }, expect.any(AbortSignal));
  await expect(f.a.introduce({ ...job, targetPairId: proposal.pairId })).rejects.toThrow();
  await f.a.revoke(proposal.pairId);
  await expect(f.restart().recover()).resolves.toEqual({ pending: 0, blocked: 1 });
});

it('records received introductions as consent requests only, then decides once', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const intro = { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', introductionId: 'intro-r1' };
  await f.b.receiveIntroduction('app-a', intro, 5); await f.b.receiveIntroduction('app-a', intro, 9);
  expect(await f.b.receivedIntroductions()).toEqual([{ ...intro, sponsorInstanceId: 'app-a', status: 'pending', receivedAt: 5 }]);
  expect(f.exchange).toHaveBeenCalledTimes(2); // enrolls nothing: only the original import/activate
  for (const bad of [{ peerInstanceId: 'app-b' }, { peerInstanceId: 'app-a' }, { scope: 'other-scope' }, { pluginId: 'other-plugin' }, { peerInstanceId: 'bad id' }]) {
    await expect(f.b.receiveIntroduction('app-a', { ...intro, introductionId: 'intro-x', ...bad })).rejects.toThrow();
  }
  await expect(f.b.receiveIntroduction('app-z', { ...intro, introductionId: 'intro-y' })).rejects.toThrow('not linked');
  await expect(f.b.receiveIntroduction('app-a', { ...intro, peerInstanceId: 'app-d' })).rejects.toThrow('conflicts');
  await expect(f.b.decideIntroduction('missing', 'approved')).rejects.toThrow('unavailable');
  await expect(f.b.decideIntroduction('intro-r1', 'maybe' as never)).rejects.toThrow('invalid');
  await expect(f.b.decideIntroduction('intro-r1', 'denied')).resolves.toMatchObject({ status: 'denied' });
  await expect(f.b.decideIntroduction('intro-r1', 'approved')).rejects.toThrow('already decided');
  f.b.dispose();
  await expect(f.b.receivedIntroductions()).rejects.toThrow('disposed');
  await expect(f.b.receiveIntroduction('app-a', intro)).rejects.toThrow('disposed');
  await expect(f.b.decideIntroduction('intro-r1', 'denied')).rejects.toThrow('disposed');
});

it('records an owner-covered introduction as approved, upgrades only a pending redelivery and never overrides a decision', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const intro = { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', introductionId: 'intro-auto' };
  await expect(f.b.receiveIntroduction('app-a', intro, 5, { consented: true })).resolves.toEqual({ ...intro, sponsorInstanceId: 'app-a', status: 'approved', receivedAt: 5, autoApproved: true });
  await expect(f.b.receiveIntroduction('app-a', intro, 9)).resolves.toMatchObject({ status: 'approved', receivedAt: 5, autoApproved: true });
  // The owner sees the auto-approval marked in the received list.
  expect((await f.b.receivedIntroductions()).find(r => r.introductionId === 'intro-auto')).toMatchObject({ status: 'approved', autoApproved: true });
  await expect(f.b.decideIntroduction('intro-auto', 'denied')).rejects.toThrow('already decided');
  const later = { ...intro, peerInstanceId: 'app-d', introductionId: 'intro-later' };
  await expect(f.b.receiveIntroduction('app-a', later, 5)).resolves.toEqual({ ...later, sponsorInstanceId: 'app-a', status: 'pending', receivedAt: 5 });
  await expect(f.b.receiveIntroduction('app-a', later, 6, { consented: true })).resolves.toMatchObject({ status: 'approved', receivedAt: 5, autoApproved: true });
  const denied = { ...intro, peerInstanceId: 'app-e', introductionId: 'intro-denied' };
  await f.b.receiveIntroduction('app-a', denied, 5); await f.b.decideIntroduction('intro-denied', 'denied');
  await expect(f.b.receiveIntroduction('app-a', denied, 6, { consented: true })).resolves.toEqual(expect.objectContaining({ status: 'denied' }));
  expect((await f.b.receivedIntroductions()).find(r => r.introductionId === 'intro-denied')).not.toHaveProperty('autoApproved');
  expect(f.exchange).toHaveBeenCalledTimes(2);
});

it('owner-covered consent never stands in for the sponsor grant: an ungranted scope is refused and nothing is recorded', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const intro = { pluginId: proposal.pluginId, scope: 'scope-not-granted', peerInstanceId: 'app-c', introductionId: 'intro-ungranted' };
  await expect(f.b.receiveIntroduction('app-a', intro, 5, { consented: true })).rejects.toThrow('not linked');
  await expect(f.b.receiveIntroduction('app-a', { ...intro, pluginId: 'other-plugin', scope: proposal.scope }, 5, { consented: true })).rejects.toThrow('not linked');
  expect((await f.b.receivedIntroductions()).some(r => r.introductionId === 'intro-ungranted')).toBe(false);
});

it('ignores an introduction to an app already linked for the scope and caps pending requests', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  await f.b.receiveIntroduction('app-a', { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-a', introductionId: 'self' }).catch(() => undefined);
  for (let i = 0; i < 64; i++) await f.b.receiveIntroduction('app-a', { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: `app-${i}x`, introductionId: `intro-${i}` });
  await expect(f.b.receiveIntroduction('app-a', { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-over', introductionId: 'intro-over' })).rejects.toThrow('capacity');
});

it('accept activation requires imported credentials, validates transfer recipient and immutable proposal', async () => {
  const f = await fixture(); await f.b.propose(reverse);
  await expect(f.b.acceptActivation(reverse)).rejects.toThrow('not imported');
  await f.a.propose(proposal);
  await expect(f.a.propose({ ...proposal, targetHostId: 'host-c', remoteInstanceId: 'app-c' })).rejects.toThrow('mismatched');
  await expect(f.b.import(reverse, Buffer.from('invalid'))).rejects.toThrow('transfer');
});

it('remote revocation stays durable offline and retries only once after acknowledgement', async () => {
  const f = await fixture(); await f.a.activate(proposal); await f.a.revoke(proposal.pairId);
  f.channels.get('host-b')!.connected = false;
  await f.restart().recover(); expect(await f.pairsB.grant(proposal.pairId)).not.toBeNull();
  f.channels.get('host-b')!.connected = true;
  await Promise.all([f.a.recover(), f.a.recover()]);
  expect(await f.pairsB.grant(proposal.pairId)).toBeNull();
  const revokes = f.exchange.mock.calls.filter(call => call[1] === 'revoke').length;
  await f.a.recover(); expect(f.exchange.mock.calls.filter(call => call[1] === 'revoke')).toHaveLength(revokes);
});

it('shutdown cancels pending bridge proof without creating a grant', async () => {
  const f = await fixture(); f.prove.mockImplementation(() => new Promise(() => {}));
  const pending = f.a.propose(proposal);
  await vi.waitFor(() => expect(f.prove).toHaveBeenCalled());
  f.a.dispose(); await expect(pending).rejects.toThrow('cancelled');
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
});

it('idle waits for aborted bridge cleanup, not only its cancellation race', async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.prove.mockImplementationOnce(async () => { await held; throw new Error('cancelled transport'); });
  const pending = f.a.propose(proposal).catch(error => error as Error);
  await vi.waitFor(() => expect(f.prove).toHaveBeenCalled());
  f.a.dispose(); expect((await pending).message).toMatch(/cancelled/);
  let idle = false;
  const closing = f.a.whenIdle().then(() => { idle = true; });
  await Promise.resolve(); expect(idle).toBe(false);
  release(); await closing;
  await expect(f.a.proposals(proposal.pluginId, proposal.remoteInstanceId, proposal.scope)).rejects.toThrow('disposed');
});

it.each(['propose', 'activate', 'import', 'acceptActivation'] as const)('absent revoke fences delayed %s proof across full restart', async operation => {
  const f = await fixture(), original = f.prove.getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.prove.mockImplementationOnce(async (...args) => { await held; return original(...args); });
  const pending = (operation === 'import' ? f.a.import(proposal, Buffer.from('bad')) : f.a[operation](proposal))
    .then(() => null, error => error as Error);
  await vi.waitFor(() => expect(f.prove).toHaveBeenCalled());
  await f.a.revoke(proposal.pairId);
  release(); expect((await pending)?.message).toMatch(/revoked/);
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await f.restartAll().recover();
  await expect(f.a.activate(proposal)).rejects.toThrow('revoked');
  await expect(f.pairsA.create(proposal)).rejects.toThrow('revoked');
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
});

it.each(['host-a', 'host-b'])('either generation %s invalidates signing, authentication and held commits without recover tick', async host => {
  const f = await fixture(); await f.a.activate(proposal);
  const body = Buffer.from('{}'), input = { pluginId: proposal.pluginId, scope: proposal.scope, method: 'sync', body };
  const oldA = (await f.pairsA.signRequest(proposal.pairId, input))!, oldB = (await f.pairsB.signRequest(proposal.pairId, input))!;
  const lease = (await f.pairsA.acquireGrant(proposal.pairId, 1, proposal.pluginId, proposal.scope))!;
  f.channels.get(host)!.keyHash = hash('new-generation');
  const commit = vi.fn(); await expect(lease.commitSync(commit)).rejects.toThrow('no longer active'); expect(commit).not.toHaveBeenCalled();
  expect(await f.pairsA.signRequest(proposal.pairId, input)).toBeNull();
  expect(await f.pairsB.signRequest(proposal.pairId, input)).toBeNull();
  for (const [store, envelope] of [[f.pairsB, oldA], [f.pairsA, oldB]] as const) {
    expect(await store.authenticateRequest({ envelope, body, pluginId: proposal.pluginId, scope: proposal.scope, route: envelope.route, httpMethod: 'POST' })).toBeNull();
  }
  await f.a.recover(); await f.b.recover();
  expect(f.exchange.mock.calls.some(call => call[1] === 'revoke')).toBe(true);
  await expect(f.restartAll().activate(proposal)).rejects.toThrow('revoked');
});
it('authority ID-only tombstones enforce shared bounded capacity and persist no fabricated proposal', async () => {
  const f = await fixture(); await f.a.revoke('absent');
  const file = join(f.root, 'authority-app-a', 'authority-v1.bin'), key = Buffer.alloc(32, 17);
  const state = JSON.parse(unsealPeerBytes(await readFile(file), key, 'authority-v1:app-a').toString());
  expect(state.records).toEqual([]); expect(state.revokedIds).toEqual(['absent']);
  state.revokedIds = Array.from({ length: 256 }, (_, i) => `revoked-${i}`);
  await writeFile(file, sealPeerBytes(Buffer.from(JSON.stringify(state)), key, 'authority-v1:app-a'));
  await expect(f.a.revoke('overflow')).rejects.toThrow('capacity');
  await expect(f.a.propose(proposal)).rejects.toThrow('capacity');
  expect(await f.pairsA.grant('overflow')).toBeNull();
  state.revokedIds.push('revoked-0');
  await writeFile(file, sealPeerBytes(Buffer.from(JSON.stringify(state)), key, 'authority-v1:app-a'));
  await expect(f.restart().recover()).rejects.toThrow('corrupt');
});

it('relays code-free consent notices only along the approved, actively linked introduction path', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const third = { ...proposal, pairId: 'pair-c', remoteInstanceId: 'app-c', targetHostId: 'host-c', proposalId: 'proposal-c' };
  await f.a.propose(third); await f.pairsA.activate(third.pairId, third.proposalId, third.epoch);
  const introductionConsent = vi.fn(async () => ({ recorded: true }));
  // Sponsor side: unknown/incomplete jobs, a sender that is not the job's target, and a missing bridge are refused.
  await expect(f.a.relayIntroductionConsent('app-c', { introductionId: 'intro-1' })).rejects.toThrow('unavailable');
  await f.a.introduce({ introductionId: 'intro-1', sponsorPairId: proposal.pairId, targetPairId: third.pairId, peerInstanceId: 'app-b',
    pluginId: proposal.pluginId, scope: proposal.scope, status: 'pending' });
  await f.a.recover();
  await expect(f.a.relayIntroductionConsent('app-b', { introductionId: 'intro-1' })).rejects.toThrow('mismatch');
  await expect(f.a.relayIntroductionConsent('app-c', { introductionId: 'intro-1' })).rejects.toThrow('bridge unavailable');
  f.bridge.introductionConsent = introductionConsent;
  await expect(f.a.relayIntroductionConsent('app-c', { introductionId: 'intro-1' })).resolves.toEqual({ recorded: true });
  // Identities come from the job, never the packet.
  expect(introductionConsent).toHaveBeenLastCalledWith('host-b', { recipientInstanceId: 'app-b', operation: 'introduction.consented',
    introductionId: 'intro-1', pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c' }, expect.any(AbortSignal));

  // Recipient side: only an owner-approved introduction may notify its sponsor.
  await expect(f.b.notifyIntroductionConsent('intro-r')).rejects.toThrow('not approved');
  await f.b.receiveIntroduction('app-a', { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', introductionId: 'intro-r' });
  await expect(f.b.notifyIntroductionConsent('intro-r')).rejects.toThrow('not approved');
  await f.b.decideIntroduction('intro-r', 'approved');
  introductionConsent.mockResolvedValueOnce({ recorded: false });
  await expect(f.b.notifyIntroductionConsent('intro-r')).resolves.toEqual({ recorded: false });
  expect(introductionConsent).toHaveBeenLastCalledWith('host-a', { recipientInstanceId: 'app-a', operation: 'introduction.consent',
    introductionId: 'intro-r' }, expect.any(AbortSignal));
  introductionConsent.mockRejectedValueOnce(new Error('offline'));
  await expect(f.b.notifyIntroductionConsent('intro-r')).rejects.toThrow();
  f.bridge.introductionConsent = undefined;
  await expect(f.b.notifyIntroductionConsent('intro-r')).rejects.toThrow('bridge unavailable');
  await expect(f.b.notifyIntroductionConsent('bad id')).rejects.toThrow();
  f.bridge.introductionConsent = introductionConsent;
  // Revoking the sponsor link fences both sides.
  await f.a.revoke(proposal.pairId); await f.b.revoke(proposal.pairId);
  await expect(f.a.relayIntroductionConsent('app-c', { introductionId: 'intro-1' })).rejects.toThrow();
  await expect(f.b.notifyIntroductionConsent('intro-r')).rejects.toThrow('not linked');
  f.a.dispose(); f.b.dispose();
  await expect(f.a.relayIntroductionConsent('app-c', { introductionId: 'intro-1' })).rejects.toThrow('disposed');
  await expect(f.b.notifyIntroductionConsent('intro-r')).rejects.toThrow('disposed');
});

it('relays introduction enrollment offers only along the approved, actively linked introduction path', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const third = { ...proposal, pairId: 'pair-c', remoteInstanceId: 'app-c', targetHostId: 'host-c', proposalId: 'proposal-c' };
  await f.a.propose(third); await f.pairsA.activate(third.pairId, third.proposalId, third.epoch);
  const offer = { route: 'http://127.0.0.1:9/', joinCode: `zcde_${'a'.repeat(24)}` };
  const introductionEnrollment = vi.fn(async () => ({ route: 'http://127.0.0.1:8/', joinCode: `zcde_${'b'.repeat(24)}` }));
  // Sponsor side: unknown/incomplete jobs and a requester that is not the job's target are refused.
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', ...offer })).rejects.toThrow('unavailable');
  await f.a.introduce({ introductionId: 'intro-1', sponsorPairId: proposal.pairId, targetPairId: third.pairId, peerInstanceId: 'app-b',
    pluginId: proposal.pluginId, scope: proposal.scope, status: 'pending' });
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', ...offer })).rejects.toThrow('unavailable');
  await f.a.recover();
  await expect(f.a.relayIntroductionEnrollment('app-b', { introductionId: 'intro-1', ...offer })).rejects.toThrow('mismatch');
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', ...offer })).rejects.toThrow('bridge unavailable');
  f.bridge.introductionEnrollment = introductionEnrollment;
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', ...offer })).resolves.toMatchObject({ route: 'http://127.0.0.1:8/' });
  // Identities come from the job, never the packet.
  expect(introductionEnrollment).toHaveBeenLastCalledWith('host-b', { recipientInstanceId: 'app-b', operation: 'introduction.install',
    introductionId: 'intro-1', pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', ...offer }, expect.any(AbortSignal));

  // Requester side (app-b received an introduction to app-c from sponsor app-a).
  const intro = { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', introductionId: 'intro-r' };
  await expect(f.b.requestIntroductionEnrollment('intro-r', offer)).rejects.toThrow('not approved');
  await f.b.receiveIntroduction('app-a', intro);
  await expect(f.b.requestIntroductionEnrollment('intro-r', offer)).rejects.toThrow('not approved');
  await f.b.decideIntroduction('intro-r', 'approved');
  await expect(f.b.requestIntroductionEnrollment('intro-r', offer)).resolves.toMatchObject({ joinCode: `zcde_${'b'.repeat(24)}` });
  expect(introductionEnrollment).toHaveBeenLastCalledWith('host-a', { recipientInstanceId: 'app-a', operation: 'introduction.enroll',
    introductionId: 'intro-r', ...offer }, expect.any(AbortSignal));
  f.bridge.introductionEnrollment = undefined;
  await expect(f.b.requestIntroductionEnrollment('intro-r', offer)).rejects.toThrow('bridge unavailable');
  await expect(f.b.requestIntroductionEnrollment('bad id', offer)).rejects.toThrow();

  // Introduced side: only an actively linked sponsor in the exact scope may relay an install.
  const install = { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c' };
  await expect(f.b.authorizeIntroducedInstall('app-a', install)).resolves.toBeUndefined();
  for (const [sponsor, patch] of [['app-a', { scope: 'other-scope' }], ['app-a', { pluginId: 'bad plugin' }], ['app-a', { scope: '' }],
    ['app-a', { peerInstanceId: 'app-b' }], ['app-a', { peerInstanceId: 'app-a' }], ['app-b', {}], ['app-z', {}]] as const) {
    await expect(f.b.authorizeIntroducedInstall(sponsor, { ...install, ...patch })).rejects.toThrow();
  }
  // Revoking the sponsor link fences both sides.
  await f.a.revoke(proposal.pairId); await f.b.revoke(proposal.pairId);
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', ...offer })).rejects.toThrow();
  await expect(f.b.requestIntroductionEnrollment('intro-r', offer)).rejects.toThrow('not linked');
  await expect(f.b.authorizeIntroducedInstall('app-a', install)).rejects.toThrow('not linked');
  f.a.dispose(); f.b.dispose();
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', ...offer })).rejects.toThrow('disposed');
  await expect(f.b.requestIntroductionEnrollment('intro-r', offer)).rejects.toThrow('disposed');
  await expect(f.b.authorizeIntroducedInstall('app-a', install)).rejects.toThrow('disposed');
});

it('treats a pre-consent (unusable) target host as not enrolled, and proceeds once usable', async () => {
  const f = await fixture(true);
  f.blocked.add('host-b');
  await expect(f.a.propose(proposal)).rejects.toThrow('mutual enrollment unavailable');
  expect(f.prove).not.toHaveBeenCalled();
  expect(f.exchange).not.toHaveBeenCalled();
  f.blocked.delete('host-b');
  await expect(f.a.propose(proposal)).resolves.toBeDefined();
  expect(f.prove).toHaveBeenCalled();
});

it('treats a throwing isLinkUsable callback as unusable', async () => {
  const f = await fixture(true);
  f.setThrowing(true);
  await expect(f.a.propose(proposal)).rejects.toThrow('mutual enrollment unavailable');
  expect(f.prove).not.toHaveBeenCalled();
  f.setThrowing(false);
  await expect(f.a.propose(proposal)).resolves.toBeDefined();
});

it('rejects a proof whose reverse host is unusable', async () => {
  const f = await fixture(true);
  f.blocked.add('host-a');
  // target host-b usable; reverse host-a (from the reverse enrollment) is not.
  await expect(f.a.propose(proposal)).rejects.toThrow('mutual enrollment proof mismatch');
  expect(f.prove).toHaveBeenCalled();
  expect(f.exchange).not.toHaveBeenCalled();
});

it.each(['host-b', 'host-a'])('active grant validation flips false when %s becomes unusable', async blockedHost => {
  const f = await fixture(true);
  await f.a.activate(proposal);
  const grant = (await f.pairsA.grant(proposal.pairId))!;
  expect(grant.status).toBe('active');
  const current = await f.a.validateGrant(grant);
  expect(current).not.toBeNull();
  expect(current!()).toBe(true);
  f.blocked.add(blockedHost);
  expect(current!()).toBe(false);
  await expect(f.a.validateGrant(grant)).resolves.toBeNull();
  f.blocked.delete(blockedHost);
  expect(current!()).toBe(true);
  f.setThrowing(true);
  expect(current!()).toBe(false);
});

it('forwards the connect offer form through introduction enrollment relays', async () => {
  const f = await fixture(); await f.a.activate(proposal);
  const third = { ...proposal, pairId: 'pair-c', remoteInstanceId: 'app-c', targetHostId: 'host-c', proposalId: 'proposal-c' };
  await f.a.propose(third); await f.pairsA.activate(third.pairId, third.proposalId, third.epoch);
  const connect = { code: 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234', accountUrl: 'https://account.example.com', serverId: '11111111-1111-4111-8111-111111111111' };
  const reply = { connect: { ...connect, code: 'DCBA-4321-DCBA-4321-DCBA-4321-DCBA-4321' } };
  const introductionEnrollment = vi.fn(async () => reply);
  f.bridge.introductionEnrollment = introductionEnrollment;
  await f.a.introduce({ introductionId: 'intro-1', sponsorPairId: proposal.pairId, targetPairId: third.pairId, peerInstanceId: 'app-b',
    pluginId: proposal.pluginId, scope: proposal.scope, status: 'pending' });
  await f.a.recover();
  await expect(f.a.relayIntroductionEnrollment('app-c', { introductionId: 'intro-1', connect })).resolves.toEqual(reply);
  expect(introductionEnrollment).toHaveBeenLastCalledWith('host-b', { recipientInstanceId: 'app-b', operation: 'introduction.install',
    introductionId: 'intro-1', pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', connect }, expect.any(AbortSignal));
  const intro = { pluginId: proposal.pluginId, scope: proposal.scope, peerInstanceId: 'app-c', introductionId: 'intro-r' };
  await f.b.receiveIntroduction('app-a', intro);
  await f.b.decideIntroduction('intro-r', 'approved');
  await expect(f.b.requestIntroductionEnrollment('intro-r', { connect })).resolves.toEqual(reply);
  expect(introductionEnrollment).toHaveBeenLastCalledWith('host-a', { recipientInstanceId: 'app-a', operation: 'introduction.enroll',
    introductionId: 'intro-r', connect }, expect.any(AbortSignal));
  // An offer carrying neither or both forms is refused before any bridge call.
  introductionEnrollment.mockClear();
  await expect(f.b.requestIntroductionEnrollment('intro-r', {} as never)).rejects.toThrow();
  expect(introductionEnrollment).not.toHaveBeenCalled();
});

// Use enforcement: `host-b` is app-a's host for app-b, `host-a` is app-b's host for app-a; a use is `${hostId}/${pluginId}`.
const both = (pluginId = proposal.pluginId) => new Set([`host-b/${pluginId}`, `host-a/${pluginId}`]);
const sync = (f: Awaited<ReturnType<typeof fixture>>) => f.pairsA.signRequest(proposal.pairId, { pluginId: proposal.pluginId, scope: proposal.scope, method: 'sync', body: Buffer.from('{}') });
const deliver = async (f: Awaited<ReturnType<typeof fixture>>, envelope: NonNullable<Awaited<ReturnType<typeof sync>>>) =>
  f.pairsB.authenticateRequest({ envelope, body: Buffer.from('{}'), pluginId: proposal.pluginId, scope: proposal.scope, route: envelope.route, httpMethod: 'POST' });

it('sender refuses a zero-use connection at ensureProposal, propose and activate, before any proof or exchange', async () => {
  const f = await fixture(false, new Set());
  const input = { pluginId: proposal.pluginId, remoteInstanceId: 'app-b', targetHostId: 'host-b', scope: proposal.scope };
  await expect(f.a.ensureProposal(input)).rejects.toBeInstanceOf(PeerUseError);
  await expect(f.a.propose(proposal)).rejects.toThrow('use_not_approved');
  await expect(f.a.activate(proposal)).rejects.toMatchObject({ reason: 'use_not_approved' });
  expect(f.prove).not.toHaveBeenCalled();
  expect(f.exchange).not.toHaveBeenCalled();
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await expect(f.a.proposals(proposal.pluginId, 'app-b', proposal.scope)).resolves.toEqual([]);
});

it('a link used by plugin X carries no pair for plugin Y on either side', async () => {
  const f = await fixture(false, both('plugin-x'));
  const y = { ...proposal, pluginId: 'plugin-y' };
  await expect(f.a.ensureProposal({ pluginId: 'plugin-y', remoteInstanceId: 'app-b', targetHostId: 'host-b', scope: proposal.scope })).rejects.toThrow('use_not_approved');
  await expect(f.a.activate(y)).rejects.toThrow('use_not_approved');
  await expect(f.b.import({ ...reverse, pluginId: 'plugin-y' }, Buffer.alloc(16))).rejects.toThrow('use_not_approved');
  await expect(f.b.acceptActivation({ ...reverse, pluginId: 'plugin-y' })).rejects.toThrow('use_not_approved');
  await expect(f.a.activate({ ...proposal, pluginId: 'plugin-x' })).resolves.toMatchObject({ status: 'active' });
});

it('receiver refuses import and activation without its own approved use; the sender never activates', async () => {
  const uses = new Set([`host-b/${proposal.pluginId}`]);
  const f = await fixture(false, uses);
  await expect(f.a.activate(proposal)).rejects.toThrow('use_not_approved');
  expect(f.exchange).toHaveBeenCalledWith('host-b', 'import', proposal, expect.anything(), expect.anything());
  expect(f.exchange).not.toHaveBeenCalledWith('host-b', 'activate', expect.anything(), undefined, expect.anything());
  expect(await f.pairsB.grant(proposal.pairId)).toBeNull();
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  await expect(f.b.acceptActivation(reverse)).rejects.toThrow('use_not_approved');
});

it('Stop using on the receiver denies the next request inside the commit guard and revokes both sides', async () => {
  const uses = both(), f = await fixture(false, uses);
  await f.a.activate(proposal);
  const before = (await sync(f))!, lease = await deliver(f, before);
  expect(lease).not.toBeNull(); lease!.release();
  const envelope = (await sync(f))!;
  uses.delete(`host-a/${proposal.pluginId}`);
  await expect(deliver(f, envelope)).resolves.toBeNull();
  expect(await f.pairsB.grant(proposal.pairId)).toBeNull();
  await f.b.recover();
  expect(f.exchange).toHaveBeenCalledWith('host-a', 'revoke', reverse, undefined, expect.anything());
  expect(await f.pairsA.grant(proposal.pairId)).toBeNull();
  // Approving the use again never revives the revoked pair: a new grant needs a new binding.
  uses.add(`host-a/${proposal.pluginId}`);
  expect(await f.pairsB.grant(proposal.pairId)).toBeNull();
  await expect(f.a.activate(proposal)).rejects.toThrow();
});

it('Stop using on the sender stops signing and revokeUse revokes every scope of that plugin only', async () => {
  const uses = new Set([...both(), ...both('other-plugin')]), f = await fixture(false, uses);
  const second = { ...proposal, pairId: 'pair-2', proposalId: 'proposal-2', scope: 'second-scope' };
  const other = { ...proposal, pairId: 'pair-3', proposalId: 'proposal-3', pluginId: 'other-plugin' };
  for (const p of [proposal, second, other]) await f.a.activate(p);
  uses.delete(`host-b/${proposal.pluginId}`);
  await expect(sync(f)).resolves.toBeNull();
  uses.add(`host-b/${proposal.pluginId}`);
  await expect(f.a.revokeUse(proposal.pluginId, 'app-b')).resolves.toEqual(['pair-1', 'pair-2']);
  await expect(f.a.revokeUse(proposal.pluginId, 'app-b')).resolves.toEqual([]);
  expect(await f.pairsA.grant('pair-1')).toBeNull();
  expect(await f.pairsA.grant('pair-2')).toBeNull();
  expect(await f.pairsA.grant('pair-3')).toMatchObject({ status: 'active' });
  await f.a.recover();
  expect(await f.pairsB.grant('pair-1')).toBeNull();
  expect(await f.pairsB.grant('pair-2')).toBeNull();
  expect(await f.pairsB.grant('pair-3')).toMatchObject({ status: 'active' });
  await expect(f.a.revokeUse(proposal.pluginId, 'bad id')).rejects.toThrow();
  f.a.dispose();
  await expect(f.a.revokeUse(proposal.pluginId, 'app-b')).rejects.toThrow('disposed');
});

it('a rotation mints a fresh pair and never revives the pre-rotation grant, even with the use kept', async () => {
  const f = await fixture(false, both());
  const input = { pluginId: proposal.pluginId, remoteInstanceId: 'app-b', targetHostId: 'host-b', scope: proposal.scope };
  const first = await f.a.ensureProposal(input);
  await f.a.activate(first);
  f.channels.get('host-b')!.keyHash = hash('rotated-key-b');
  const next = await f.a.ensureProposal(input);
  expect(next.pairId).not.toBe(first.pairId);
  expect(next.epoch).toBe(1);
  expect(await f.pairsA.grant(first.pairId)).toBeNull();
  await expect(f.a.activate(first)).rejects.toThrow();
});

it('treats a throwing use lookup as not approved', async () => {
  const f = await fixture(false, both());
  await f.a.activate(proposal);
  f.setUsesThrowing(true);
  await expect(sync(f)).resolves.toBeNull();
  await expect(f.a.propose({ ...proposal, pairId: 'pair-9', proposalId: 'proposal-9' })).rejects.toThrow('use_not_approved');
});
