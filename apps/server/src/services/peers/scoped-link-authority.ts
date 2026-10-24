import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PairStore, type PeerPairGrant, type PeerTransferBinding } from './pair-store.js';
import { PEER_ID, PEER_TOKEN, PrivatePeerStorage, sealPeerBytes, unsealPeerBytes, validScope, type PeerKeyProvider } from './peer-auth.js';
import { enrollmentOffer, type EnrollmentOffer, type RelinkReply } from './peer-control-protocol.js';

const id = z.string().regex(PEER_ID), digest = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.object({ pairId: id, localInstanceId: id, remoteInstanceId: id, pluginId: z.string().regex(PEER_TOKEN),
  scope: z.string().refine(validScope), targetHostId: id, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), proposalId: id }).strict();
export type PairProposal = z.infer<typeof bindingSchema>;
const proofSchema = z.object({ nonce: z.string().regex(/^[a-f0-9]{48}$/), senderInstanceId: id, recipientInstanceId: id,
  hostId: id, reverseHostId: id, reverseKeyHash: digest, reverseCapability: z.enum(['execution', 'peer.forward']) }).strict();
/** Enrollment tiers that may carry the generic control plane. `peer.forward` carries no execution rights. */
export const linkCapable = (capability: string): capability is 'execution' | 'peer.forward' => capability === 'execution' || capability === 'peer.forward';
export interface MutualEnrollmentProof { sealedProof: string }
export interface EnrollmentChannel {
  hostId: string;
  keyHash: string;
  capability: 'execution' | 'peer.forward';
  connected: boolean;
}
/** Core bridge only. Destination comes from the daemon's verified local app registration.
 * The receiving app checks its reciprocal execution enrollment before signing proof.
 * No implementation means no mutual enrollment, never a boolean fallback. */
export interface EnrolledPeerBridge {
  prove(hostId: string, challenge: { nonce: string; senderInstanceId: string; recipientInstanceId?: string }, signal: AbortSignal): Promise<MutualEnrollmentProof>;
  exchange(hostId: string, operation: 'import' | 'activate' | 'revoke', proposal: PairProposal, sealed: Uint8Array | undefined, signal: AbortSignal): Promise<void>;
  introduce(hostId: string, input: { recipientInstanceId: string; capability: 'peer.forward'; pluginId: string; scope: string; peerInstanceId: string; introductionId: string }, signal: AbortSignal): Promise<void>;
  /** Sealed forward-only enrollment offer exchange. Optional: absent means the installer is unavailable. */
  introductionEnrollment?(hostId: string, input: IntroductionEnrollmentInput & { recipientInstanceId: string }, signal: AbortSignal): Promise<EnrollmentOffer>;
  /** Sealed consent notice exchange (carries no code). Optional: absent means the installer is unavailable. */
  introductionConsent?(hostId: string, input: IntroductionConsentInput & { recipientInstanceId: string }, signal: AbortSignal): Promise<{ recorded: boolean }>;
  /** Destination -> peer over the destination's inbound host: a re-minted Connect code for it. Optional: absent means no rotation. */
  peerRotate?(hostId: string, input: PeerRotateInput & { recipientInstanceId: string }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  /** Peer -> destination (sessionless): asks the destination to rotate the peer's host there. Optional: absent means no relink. */
  peerRelink?(hostId: string, input: { hostId: string; recipientInstanceId: string }, signal: AbortSignal): Promise<RelinkReply>;
  /** Tells a linked peer this app removed the link. Optional: absent means only Connect revocation stops the peer. */
  peerRemove?(hostId: string, input: PeerLinkRefInput & { recipientInstanceId: string }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  /** A plugin asks the peer to use the connection / this owner's decision on it. Optional: absent means uses are unavailable. */
  useRequest?(hostId: string, input: { recipientInstanceId: string; pairingId: string; pluginId: string }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  useDecision?(hostId: string, input: { recipientInstanceId: string; pairingId: string; pluginId: string; approved: boolean; revoke?: true }, signal: AbortSignal): Promise<{ accepted: boolean }>;
}
/** A plugin pair over a connection with no approved use for that plugin. Revocation is never gated by it. */
export class PeerUseError extends Error {
  readonly reason = 'use_not_approved' as const;
  constructor() { super('use_not_approved'); this.name = 'PeerUseError'; }
}
export interface PeerLinkRefInput { pairingId: string; hostId: string }
export interface PeerRotateInput { hostId: string; code: string; expiresAt: number }
export type IntroductionConsentInput =
  | { operation: 'introduction.consent'; introductionId: string }
  | { operation: 'introduction.consented'; introductionId: string; pluginId: string; scope: string; peerInstanceId: string };
export type IntroductionEnrollmentInput =
  | ({ operation: 'introduction.enroll'; introductionId: string } & EnrollmentOffer)
  | ({ operation: 'introduction.install'; introductionId: string; pluginId: string; scope: string; peerInstanceId: string } & EnrollmentOffer);
const recordSchema = z.object({ proposal: bindingSchema, channelKeyHash: digest, reverseKeyHash: digest, reverseHostId: id,
  status: z.enum(['proposed', 'imported', 'active', 'revoked']), revokeDelivered: z.boolean() }).strict();
const jobSchema = z.object({ introductionId: id, sponsorPairId: id, targetPairId: id, peerInstanceId: id,
  pluginId: z.string().regex(PEER_TOKEN), scope: z.string().refine(validScope), status: z.enum(['pending', 'complete', 'blocked']) }).strict();
/** An introduction a sponsor delivered to this app. Receiving one only records a consent request; it never enrolls anything. */
const receivedSchema = z.object({ introductionId: id, sponsorInstanceId: id, peerInstanceId: id, pluginId: z.string().regex(PEER_TOKEN),
  scope: z.string().refine(validScope), status: z.enum(['pending', 'approved', 'denied']), receivedAt: z.number().int().nonnegative(),
  /** Approved without an owner decision (covered by an invitation-founded sponsor link); shown so the owner can remove it. */
  autoApproved: z.literal(true).optional() }).strict();
export type ReceivedIntroduction = z.infer<typeof receivedSchema>;
const stateSchema = z.object({ version: z.literal(1), instanceId: id, records: z.array(recordSchema).max(256), revokedIds: z.array(id).max(256), jobs: z.array(jobSchema).max(256),
  received: z.array(receivedSchema).max(64).default([]) }).strict();
type State = z.infer<typeof stateSchema>;

function proposalForGrant(grant: PeerPairGrant): PairProposal {
  const { pairId, localInstanceId, remoteInstanceId, pluginId, scope, targetHostId, epoch, proposalId } = grant;
  return { pairId, localInstanceId, remoteInstanceId, pluginId, scope, targetHostId, epoch, proposalId };
}
/** Called by the receiving app core, not by a plugin or an RPC payload adapter. */
export function signMutualEnrollmentProof(input: z.infer<typeof proofSchema>, enrolledHostKeyHash: string): MutualEnrollmentProof {
  digest.parse(enrolledHostKeyHash);
  const key = Buffer.from(enrolledHostKeyHash, 'hex'), plain = Buffer.from(JSON.stringify(proofSchema.parse(input)));
  try { return { sealedProof: sealPeerBytes(plain, key, 'zcc-mutual-enrollment-v1').toString('base64url') }; }
  finally { key.fill(0); plain.fill(0); }
}

/** Generic control plane. Persistent proposals are retried, never implicitly activated on restart. */
export class ScopedLinkAuthority {
  private readonly storage: PrivatePeerStorage<State>;
  private readonly contexts = new WeakMap<object, { proposal: PairProposal; keyHash: string; reverseKeyHash: string; reverseHostId: string }>();
  private disposed = false;
  private recovery: Promise<{ pending: number; blocked: number }> | undefined;
  private readonly operations = new Set<AbortController>();
  private readonly bridgeWork = new Set<Promise<unknown>>();
  private readonly fences = new Set<string>();
  constructor(private readonly options: {
    directory: string; instanceId: string; keyProvider: PeerKeyProvider; pairs: PairStore;
    enrollment(hostId: string): EnrollmentChannel | null;
    reverseEnrollment(remoteInstanceId: string): Promise<{ hostId: string; keyHash: string; capability: 'execution' | 'peer.forward' } | null>;
    currentReverseEnrollment(remoteInstanceId: string): { hostId: string; keyHash: string; capability: 'execution' | 'peer.forward' } | null;
    bridge?: EnrolledPeerBridge;
    /**
     * False for a host that belongs to an invitation-founded link not yet `linked` (pre-consent / activating / removed).
     * Such a host is treated as not enrolled by `context()`, `enrolled()`, proof exchange and grant validation.
     * Absent means every enrolled host is usable (execution enrollments, introduced links).
     */
    isLinkUsable?(hostId: string): boolean;
    /**
     * Synchronous approved-use check keyed on the pair's `targetHostId` (the local host row for the peer). A use belongs to
     * one connection: a new invitation mints new hosts, so it never inherits an earlier connection's uses. False denies
     * every plugin pair to that host (default deny). Absent means every host carries plugin traffic.
     */
    isUseApproved?(hostId: string, pluginId: string): boolean;
  }) {
    this.storage = new PrivatePeerStorage(options.directory, 'authority-v1', options.keyProvider, options.instanceId,
      () => ({ version: 1, instanceId: options.instanceId, records: [], revokedIds: [], jobs: [], received: [] }), value => {
        const state = stateSchema.parse(value);
        if (state.instanceId !== options.instanceId || new Set(state.records.map(r => r.proposal.pairId)).size !== state.records.length ||
          new Set(state.jobs.map(j => j.introductionId)).size !== state.jobs.length || state.records.some(r => r.proposal.localInstanceId !== options.instanceId) ||
          new Set(state.revokedIds).size !== state.revokedIds.length ||
          new Set([...state.revokedIds, ...state.records.map(r => r.proposal.pairId)]).size > 256) {
          throw new Error('invalid scoped link authority state');
        }
        return state;
      });
  }

  private assertLive(state: State, pairId: string): void {
    if (this.disposed) throw new Error('scoped link authority disposed');
    if (this.fences.has(pairId) || state.revokedIds.includes(pairId) ||
      state.records.some(r => r.proposal.pairId === pairId && r.status === 'revoked')) throw new Error('peer authority revoked or mismatched');
  }

  private generationsCurrent(proposal: PairProposal, keyHash: string, reverseKeyHash: string, reverseHostId: string): boolean {
    const outgoing = this.options.enrollment(proposal.targetHostId), reverse = this.options.currentReverseEnrollment(proposal.remoteInstanceId);
    return !!outgoing && linkCapable(outgoing.capability) && outgoing.keyHash === keyHash && !!reverse &&
      reverse.capability === outgoing.capability && reverse.hostId === reverseHostId && reverse.keyHash === reverseKeyHash &&
      this.usable(proposal.targetHostId) && this.usable(reverseHostId);
  }

  private usable(hostId: string): boolean {
    try { return this.options.isLinkUsable?.(hostId) ?? true; } catch { return false; }
  }

  private approved(proposal: Pick<PairProposal, 'targetHostId' | 'pluginId'>): boolean {
    try { return this.options.isUseApproved?.(proposal.targetHostId, proposal.pluginId) ?? true; } catch { return false; }
  }

  private assertUse(proposal: Pick<PairProposal, 'targetHostId' | 'pluginId'>): void {
    if (!this.approved(proposal)) throw new PeerUseError();
  }

  /** No pair calls under authority mutex. PairStore runs this outside its own mutex. */
  readonly validateGrant = async (grant: Readonly<PeerPairGrant>): Promise<(() => boolean) | null> => {
    const proposal = proposalForGrant(grant);
    const record = await this.storage.transaction(async state => {
      if (this.disposed || this.fences.has(grant.pairId) || state.revokedIds.includes(grant.pairId)) return null;
      return state.records.find(r => r.status !== 'revoked' && JSON.stringify(r.proposal) === JSON.stringify(proposal)) ?? null;
    });
    if (!record) return null;
    await this.options.reverseEnrollment(proposal.remoteInstanceId);
    // Runs synchronously inside the PairStore mutex at commit, so a stopped use fences the very next request.
    const current = () => !this.disposed && !this.fences.has(proposal.pairId) && this.approved(proposal) &&
      this.generationsCurrent(proposal, record.channelKeyHash, record.reverseKeyHash, record.reverseHostId);
    return current() ? current : null;
  };

  private channel(hostId: string): EnrollmentChannel {
    if (this.disposed) throw new Error('scoped link authority disposed');
    const channel = this.options.enrollment(hostId);
    if (!channel || channel.hostId !== hostId || !channel.connected || !/^[a-f0-9]{64}$/.test(channel.keyHash) || !linkCapable(channel.capability) ||
      !this.usable(hostId)) {
      throw new Error('mutual enrollment unavailable');
    }
    return { ...channel };
  }

  private async call<T>(run: (bridge: EnrolledPeerBridge, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.disposed || !this.options.bridge) throw new Error('enrolled peer bridge unavailable');
    if (this.operations.size >= 8) throw new Error('peer authority concurrency exceeded');
    const controller = new AbortController(); this.operations.add(controller);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let onAbort!: () => void;
    try {
      controller.signal.throwIfAborted();
      const work = run(this.options.bridge, controller.signal);
      this.bridgeWork.add(work);
      void work.then(() => this.bridgeWork.delete(work), () => this.bridgeWork.delete(work));
      return await Promise.race([work, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('peer authority operation cancelled or timed out'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      })]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort); this.operations.delete(controller); }
  }

  private async context(proposal: PairProposal, revocation = false, signal?: AbortSignal): Promise<object> {
    signal?.throwIfAborted();
    bindingSchema.parse(proposal);
    if (proposal.localInstanceId !== this.options.instanceId || proposal.localInstanceId === proposal.remoteInstanceId) throw new Error('peer destination mismatch');
    await this.storage.transaction(async state => { if (!revocation) this.assertLive(state, proposal.pairId); });
    const channel = this.channel(proposal.targetHostId), nonce = randomBytes(24).toString('hex');
    const packet = await this.call((bridge, signal) => bridge.prove(channel.hostId, { nonce, senderInstanceId: this.options.instanceId, recipientInstanceId: proposal.remoteInstanceId }, signal), signal);
    signal?.throwIfAborted();
    if (!packet || Object.keys(packet).join(',') !== 'sealedProof' || typeof packet.sealedProof !== 'string' || packet.sealedProof.length > 8192 ||
      !/^[A-Za-z0-9_-]+$/.test(packet.sealedProof)) throw new Error('invalid mutual enrollment proof');
    const key = Buffer.from(channel.keyHash, 'hex');
    let plain: Buffer | undefined;
    let proof: z.infer<typeof proofSchema>;
    try { plain = unsealPeerBytes(Buffer.from(packet.sealedProof, 'base64url'), key, 'zcc-mutual-enrollment-v1'); proof = proofSchema.parse(JSON.parse(plain.toString('utf8'))); }
    finally { key.fill(0); plain?.fill(0); }
    const reverse = await this.options.reverseEnrollment(proposal.remoteInstanceId);
    signal?.throwIfAborted();
    if (proof.nonce !== nonce || proof.senderInstanceId !== proposal.localInstanceId || proof.recipientInstanceId !== proposal.remoteInstanceId ||
      proof.hostId !== channel.hostId ||
      this.channel(channel.hostId).keyHash !== channel.keyHash || !reverse || !linkCapable(reverse.capability) || reverse.capability !== proof.reverseCapability ||
      reverse.hostId !== proof.reverseHostId || reverse.keyHash !== proof.reverseKeyHash || !this.usable(reverse.hostId)) throw new Error('mutual enrollment proof mismatch');
    await this.storage.transaction(async state => {
      signal?.throwIfAborted();
      if (!revocation) this.assertLive(state, proposal.pairId);
      const record = state.records.find(r => r.proposal.pairId === proposal.pairId);
      if (revocation && (!record || record.status !== 'revoked')) throw new Error('peer revocation binding mismatch');
      if (record && ((!revocation && (record.channelKeyHash !== channel.keyHash || record.reverseKeyHash !== proof.reverseKeyHash || record.reverseHostId !== proof.reverseHostId)) ||
        JSON.stringify(record.proposal) !== JSON.stringify(proposal))) throw new Error('peer authority revoked or mismatched');
      if (!this.generationsCurrent(proposal, channel.keyHash, proof.reverseKeyHash, proof.reverseHostId)) throw new Error('mutual enrollment proof mismatch');
    });
    signal?.throwIfAborted();
    const context = Object.freeze({});
    this.contexts.set(context, { proposal: { ...proposal }, keyHash: channel.keyHash, reverseKeyHash: proof.reverseKeyHash, reverseHostId: proof.reverseHostId });
    return context;
  }

  readonly authorizeTransfer = async (context: unknown, binding: Readonly<PeerTransferBinding>): Promise<Uint8Array | null> => {
    if (!context || typeof context !== 'object' || this.disposed) return null;
    const authority = this.contexts.get(context);
    if (!authority) return null;
    const { operation: _operation, ...proposal } = binding;
    if (JSON.stringify(bindingSchema.parse(proposal)) !== JSON.stringify(bindingSchema.parse(authority.proposal)) ||
      this.channel(binding.targetHostId).keyHash !== authority.keyHash) return null;
    const allowed = await this.storage.transaction(async state => !this.fences.has(binding.pairId) && !state.revokedIds.includes(binding.pairId) && state.records.some(record => record.status !== 'revoked' &&
      JSON.stringify(record.proposal) === JSON.stringify(authority.proposal) && record.channelKeyHash === authority.keyHash &&
      record.reverseKeyHash === authority.reverseKeyHash && record.reverseHostId === authority.reverseHostId));
    if (!allowed) return null;
    await this.options.reverseEnrollment(binding.remoteInstanceId);
    if (this.fences.has(binding.pairId) || !this.generationsCurrent(authority.proposal, authority.keyHash, authority.reverseKeyHash, authority.reverseHostId)) return null;
    // Symmetric key bound to both enrollment generations and exact pair identities.
    const generations = [authority.keyHash, authority.reverseKeyHash].sort();
    return createHmac('sha256', Buffer.from(generations[0]!, 'hex')).update(JSON.stringify(['zcc-pair-channel-v1', generations[1],
      ...[binding.localInstanceId, binding.remoteInstanceId].sort(), binding.pairId, binding.proposalId, binding.epoch, binding.pluginId, binding.scope])).digest();
  };

  /** Public binding introspection. Never includes credential generations or transfer contexts. */
  async proposals(pluginId: string, remoteInstanceId: string, scope: string, includeRevoked = false): Promise<PairProposal[]> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    return this.storage.transaction(async state => state.records.filter(r => (includeRevoked || r.status !== 'revoked') &&
      r.proposal.pluginId === pluginId && r.proposal.remoteInstanceId === remoteInstanceId && r.proposal.scope === scope).map(r => ({ ...r.proposal })));
  }

  /** Pair ids of every non-revoked grant with a peer, across plugins and scopes (removing the link revokes them all). */
  async activePairIds(remoteInstanceId: string): Promise<string[]> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    return this.storage.transaction(async state => [...new Set(state.records.filter(r => r.status !== 'revoked' &&
      r.proposal.remoteInstanceId === remoteInstanceId).map(r => r.proposal.pairId))]);
  }

  /** Resolve an app against host-owned candidates using the existing mutual identity proof. */
  async resolveHost(remoteInstanceId: string, hostIds: readonly string[], signal?: AbortSignal): Promise<string | null> {
    id.parse(remoteInstanceId);
    if (hostIds.length > 256) throw new Error('peer enrollment capacity exceeded');
    for (const targetHostId of hostIds) {
      signal?.throwIfAborted();
      try {
        await this.context({ pairId: randomUUID(), proposalId: randomUUID(), localInstanceId: this.options.instanceId,
          remoteInstanceId, targetHostId, pluginId: 'peer-discovery', scope: 'peer-discovery', epoch: 1 }, false, signal);
        signal?.throwIfAborted();
        return targetHostId;
      } catch (error) {
        signal?.throwIfAborted();
        if (this.disposed) throw error;
        // A candidate may serve another app. Only a verified identity becomes a route.
      }
    }
    return null;
  }

  /** Host-generated IDs are persisted before activation; retries and startup reuse the same binding. */
  async ensureProposal(input: { pluginId: string; remoteInstanceId: string; targetHostId: string; scope: string }, signal?: AbortSignal): Promise<PairProposal> {
    signal?.throwIfAborted();
    const existing = await this.proposals(input.pluginId, input.remoteInstanceId, input.scope);
    if (existing.length > 1) throw new Error('peer link binding is ambiguous');
    if (existing[0] && existing[0].targetHostId !== input.targetHostId) throw new Error('peer destination mismatch');
    this.assertUse(input);
    if (existing.length) {
      const proposal = existing[0]!;
      // A re-key (link rotation) supersedes the binding; revoke it now, as recovery would, instead of failing until then.
      if (await this.superseded(proposal)) await this.revoke(proposal.pairId);
      else {
        await this.context(proposal, false, signal);
        return proposal;
      }
    }
    const proposal = bindingSchema.parse({ ...input, localInstanceId: this.options.instanceId, pairId: randomUUID(), proposalId: randomUUID(), epoch: 1 });
    const context = await this.context(proposal, false, signal), auth = this.contexts.get(context)!;
    return this.storage.transaction(async (state, save) => {
      signal?.throwIfAborted();
      this.assertLive(state, proposal.pairId);
      const matches = state.records.filter(r => r.status !== 'revoked' && r.proposal.pluginId === input.pluginId &&
        r.proposal.remoteInstanceId === input.remoteInstanceId && r.proposal.scope === input.scope);
      if (matches.length > 1) throw new Error('peer link binding is ambiguous');
      if (matches.length) {
        if (matches[0]!.proposal.targetHostId !== input.targetHostId) throw new Error('peer destination mismatch');
        return { ...matches[0]!.proposal };
      }
      if (new Set([...state.revokedIds, ...state.records.map(r => r.proposal.pairId)]).size >= 256) throw new Error('peer authority capacity exceeded');
      if (!this.generationsCurrent(proposal, auth.keyHash, auth.reverseKeyHash, auth.reverseHostId)) throw new Error('mutual enrollment proof mismatch');
      this.assertUse(proposal);
      state.records.push({ proposal, channelKeyHash: auth.keyHash, reverseKeyHash: auth.reverseKeyHash, reverseHostId: auth.reverseHostId, status: 'proposed', revokeDelivered: false });
      await save();
      signal?.throwIfAborted();
      this.assertLive(state, proposal.pairId);
      if (!this.generationsCurrent(proposal, auth.keyHash, auth.reverseKeyHash, auth.reverseHostId)) throw new Error('mutual enrollment proof mismatch');
      return { ...proposal };
    });
  }

  /** Positive evidence only: both enrollments are present and at least one is a newer generation than the record's. */
  private async superseded(proposal: PairProposal): Promise<boolean> {
    const record = await this.storage.transaction(async state => state.records.find(r => r.proposal.pairId === proposal.pairId && r.status !== 'revoked') ?? null);
    if (!record) return false;
    const channel = this.options.enrollment(proposal.targetHostId), reverse = await this.options.reverseEnrollment(proposal.remoteInstanceId);
    return !!channel && !!reverse && (channel.keyHash !== record.channelKeyHash || reverse.hostId !== record.reverseHostId || reverse.keyHash !== record.reverseKeyHash);
  }

  async propose(input: PairProposal, signal?: AbortSignal): Promise<PeerPairGrant> {
    const proposal = bindingSchema.parse(input);
    await this.record(proposal, signal);
    signal?.throwIfAborted();
    return this.options.pairs.propose(proposal);
  }

  /** Sender `activate` and receiver `import` both land here: no approved use, no recorded proposal. */
  private async record(proposal: PairProposal, signal?: AbortSignal): Promise<void> {
    this.assertUse(proposal);
    const context = await this.context(proposal, false, signal), auth = this.contexts.get(context)!;
    await this.storage.transaction(async (state, save) => {
      this.assertLive(state, proposal.pairId);
      signal?.throwIfAborted();
      const previous = state.records.find(r => r.proposal.pairId === proposal.pairId);
      if (previous) {
        if (previous.status === 'revoked' || JSON.stringify(previous.proposal) !== JSON.stringify(proposal) || previous.channelKeyHash !== auth.keyHash || previous.reverseKeyHash !== auth.reverseKeyHash) {
          throw new Error('peer authority proposal conflicts');
        }
        return;
      }
      if (new Set([...state.revokedIds, ...state.records.map(r => r.proposal.pairId)]).size >= 256) throw new Error('peer authority capacity exceeded');
      const reverse = this.options.currentReverseEnrollment(proposal.remoteInstanceId);
      if (!reverse || !this.generationsCurrent(proposal, auth.keyHash, auth.reverseKeyHash, reverse.hostId)) throw new Error('mutual enrollment proof mismatch');
      state.records.push({ proposal, channelKeyHash: auth.keyHash, reverseKeyHash: auth.reverseKeyHash, reverseHostId: reverse.hostId, status: 'proposed', revokeDelivered: false });
      await save();
      this.assertLive(state, proposal.pairId);
      if (!this.generationsCurrent(proposal, auth.keyHash, auth.reverseKeyHash, reverse.hostId)) throw new Error('mutual enrollment proof mismatch');
    });
  }

  async import(input: PairProposal, sealed: Uint8Array): Promise<PeerPairGrant> {
    const proposal = bindingSchema.parse(input);
    await this.record(proposal);
    const result = await this.options.pairs.importCredential(proposal, sealed, await this.context(proposal));
    await this.update(proposal, 'imported');
    return result;
  }

  async acceptActivation(input: PairProposal): Promise<PeerPairGrant> {
    const proposal = bindingSchema.parse(input);
    this.assertUse(proposal);
    await this.context(proposal);
    await this.storage.transaction(async state => {
      const record = state.records.find(r => r.proposal.pairId === proposal.pairId);
      if (!record || !['imported', 'active'].includes(record.status)) throw new Error('peer credential not imported');
    });
    const result = await this.options.pairs.activate(proposal.pairId, proposal.proposalId, proposal.epoch);
    await this.update(proposal, 'active');
    return result;
  }

  async activate(input: PairProposal, signal?: AbortSignal): Promise<PeerPairGrant> {
    const proposal = bindingSchema.parse(input);
    this.assertUse(proposal);
    await this.propose(proposal, signal);
    const sealed = await this.options.pairs.exportCredential(proposal.pairId, await this.context(proposal, false, signal));
    await this.call((bridge, signal) => bridge.exchange(proposal.targetHostId, 'import', proposal, sealed, signal), signal);
    await this.context(proposal, false, signal);
    await this.call((bridge, signal) => bridge.exchange(proposal.targetHostId, 'activate', proposal, undefined, signal), signal);
    signal?.throwIfAborted();
    await this.update(proposal, 'active');
    // Last check after every network boundary; restart resumes this same proposal.
    await this.context(proposal, false, signal);
    return this.options.pairs.activate(proposal.pairId, proposal.proposalId, proposal.epoch);
  }

  private async update(proposal: PairProposal, status: 'imported' | 'active'): Promise<void> {
    await this.storage.transaction(async (state, save) => {
      this.assertLive(state, proposal.pairId);
      const record = state.records.find(r => r.proposal.pairId === proposal.pairId);
      if (!record || record.status === 'revoked' || JSON.stringify(record.proposal) !== JSON.stringify(proposal)) throw new Error('peer authority revoked or mismatched');
      if (!this.generationsCurrent(proposal, record.channelKeyHash, record.reverseKeyHash, record.reverseHostId)) throw new Error('peer enrollment changed');
      if (record.status !== 'active' || status === 'active') record.status = status;
      await save();
      this.assertLive(state, proposal.pairId);
      if (!this.generationsCurrent(proposal, record.channelKeyHash, record.reverseKeyHash, record.reverseHostId)) throw new Error('peer enrollment changed');
    });
  }

  async revoke(pairId: string): Promise<void> {
    id.parse(pairId);
    if (this.disposed) throw new Error('scoped link authority disposed');
    if (!this.fences.has(pairId) && this.fences.size >= 256) throw new Error('peer authority fence capacity exceeded');
    this.fences.add(pairId);
    // PairStore fences streams immediately, before any disk or network await.
    const revoked = this.options.pairs.revoke(pairId);
    // Attach a rejection handler immediately while authority storage is serialized.
    const completion = revoked.then(() => null, error => error as Error);
    try { await this.storage.transaction(async (state, save) => {
      if (!state.revokedIds.includes(pairId)) {
        if (!state.records.some(r => r.proposal.pairId === pairId) &&
          new Set([...state.revokedIds, ...state.records.map(r => r.proposal.pairId)]).size >= 256) throw new Error('peer authority capacity exceeded');
        state.revokedIds.push(pairId);
      }
      const record = state.records.find(r => r.proposal.pairId === pairId);
      if (record) record.status = 'revoked';
      for (const job of state.jobs) if (job.sponsorPairId === pairId || job.targetPairId === pairId) job.status = 'blocked';
      await save();
    }); } finally { const error = await completion; if (error) throw error; }
    this.fences.delete(pairId);
  }

  /**
   * Stop using: revokes every live pair one plugin holds with one peer, all scopes. Local grants fence at once; the peer
   * drops its side when `recover()` delivers the revocation. Returns the revoked pair ids.
   */
  async revokeUse(pluginId: string, remoteInstanceId: string): Promise<string[]> {
    id.parse(remoteInstanceId);
    if (this.disposed) throw new Error('scoped link authority disposed');
    const pairIds = await this.storage.transaction(async state => [...new Set(state.records.filter(r => r.status !== 'revoked' &&
      r.proposal.pluginId === pluginId && r.proposal.remoteInstanceId === remoteInstanceId).map(r => r.proposal.pairId))]);
    for (const pairId of pairIds) await this.revoke(pairId);
    return pairIds;
  }

  async acceptRevocation(input: PairProposal): Promise<void> {
    const proposal = bindingSchema.parse(input);
    await this.storage.transaction(async state => {
      const record = state.records.find(r => r.proposal.pairId === proposal.pairId);
      if (!record || JSON.stringify(record.proposal) !== JSON.stringify(proposal)) throw new Error('peer revocation binding mismatch');
    });
    await this.revoke(proposal.pairId);
  }

  async introduce(input: z.infer<typeof jobSchema>): Promise<void> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    const job = jobSchema.parse(input);
    if (job.status !== 'pending') throw new Error('invalid introduction state');
    const sponsor = await this.options.pairs.grant(job.sponsorPairId), target = await this.options.pairs.grant(job.targetPairId);
    if (!sponsor || !target || sponsor.pluginId !== job.pluginId || target.pluginId !== job.pluginId || sponsor.scope !== job.scope || target.scope !== job.scope ||
      sponsor.remoteInstanceId !== job.peerInstanceId || target.remoteInstanceId === job.peerInstanceId) throw new Error('introduction scope or recipient mismatch');
    await this.storage.transaction(async (state, save) => {
      const existing = state.jobs.find(j => j.introductionId === job.introductionId);
      if (existing) {
        if (JSON.stringify({ ...existing, status: 'pending' }) !== JSON.stringify(job)) throw new Error('introduction conflicts');
        return;
      }
      if (state.jobs.length >= 256) throw new Error('introduction capacity exceeded');
      state.jobs.push(job); await save();
    });
  }

  /**
   * Called only by the authenticated control API with the verified sponsor identity. Records a consent request; enrolls
   * nothing. `consented` records it already approved (marked `autoApproved`): the caller asserts the local owner's earlier
   * consent covers it (a sponsor reached over the link this app founded with it from a first-contact invitation for this
   * plugin scope; never a link that itself came from an introduction). Returns
   * the recorded entry, or null when the introduced app is already linked for this scope.
   */
  async receiveIntroduction(sponsorInstanceId: string, input: { pluginId: string; scope: string; peerInstanceId: string; introductionId: string }, now = Date.now(),
    options: { consented?: boolean } = {}): Promise<ReceivedIntroduction | null> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    const entry = receivedSchema.omit({ status: true, receivedAt: true }).parse({ ...input, sponsorInstanceId });
    if (entry.peerInstanceId === this.options.instanceId || entry.peerInstanceId === sponsorInstanceId || sponsorInstanceId === this.options.instanceId) throw new Error('introduction scope or recipient mismatch');
    const grants = await this.options.pairs.list(entry.pluginId);
    if (!grants.some(g => g.status === 'active' && g.remoteInstanceId === sponsorInstanceId && g.scope === entry.scope)) throw new Error('introduction sponsor is not linked');
    // Already linked to the introduced app for this scope: nothing to consent to.
    if (grants.some(g => g.status !== 'revoked' && g.remoteInstanceId === entry.peerInstanceId && g.scope === entry.scope)) return null;
    return this.storage.transaction(async (state, save) => {
      const existing = state.received.find(r => r.introductionId === entry.introductionId);
      if (existing) {
        if (existing.sponsorInstanceId !== entry.sponsorInstanceId || existing.peerInstanceId !== entry.peerInstanceId || existing.pluginId !== entry.pluginId || existing.scope !== entry.scope) throw new Error('introduction conflicts');
        // A redelivery never overrides an owner's decision; it only approves a still-pending covered request.
        if (options.consented && existing.status === 'pending') { existing.status = 'approved'; existing.autoApproved = true; await save(); }
        return { ...existing };
      }
      if (state.received.length >= 64) throw new Error('introduction capacity exceeded');
      const recorded: ReceivedIntroduction = options.consented ? { ...entry, status: 'approved', receivedAt: now, autoApproved: true }
        : { ...entry, status: 'pending', receivedAt: now };
      state.received.push(recorded); await save();
      return { ...recorded };
    });
  }

  async receivedIntroductions(): Promise<ReceivedIntroduction[]> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    return this.storage.transaction(async state => state.received.map(r => ({ ...r })));
  }

  /** Explicit local owner consent. Only a pending request can be decided, once. */
  async decideIntroduction(introductionId: string, decision: 'approved' | 'denied'): Promise<ReceivedIntroduction> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    id.parse(introductionId);
    if (decision !== 'approved' && decision !== 'denied') throw new Error('invalid introduction decision');
    return this.storage.transaction(async (state, save) => {
      const entry = state.received.find(r => r.introductionId === introductionId);
      if (!entry) throw new Error('peer introduction unavailable');
      if (entry.status !== 'pending') throw new Error('introduction already decided');
      entry.status = decision; await save();
      return { ...entry };
    });
  }

  /** The approved received introduction and the single active grant with its sponsor, proven current. */
  private async approvedSponsor(introductionId: string, signal?: AbortSignal): Promise<PeerPairGrant> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    id.parse(introductionId);
    const entry = await this.storage.transaction(async state => state.received.find(r => r.introductionId === introductionId));
    if (!entry || entry.status !== 'approved') throw new Error('introduction is not approved');
    const sponsor = (await this.options.pairs.list(entry.pluginId)).filter(g => g.status === 'active' &&
      g.remoteInstanceId === entry.sponsorInstanceId && g.scope === entry.scope);
    if (sponsor.length !== 1) throw new Error('introduction sponsor is not linked');
    const grant = sponsor[0]!;
    await this.context(proposalForGrant(grant), false, signal);
    return grant;
  }

  /** Requester side: only an owner-approved introduction, through an active link with its sponsor, may offer enrollment. */
  async requestIntroductionEnrollment(introductionId: string, offer: EnrollmentOffer, signal?: AbortSignal): Promise<EnrollmentOffer> {
    const grant = await this.approvedSponsor(introductionId, signal);
    const bridge = this.options.bridge;
    if (!bridge?.introductionEnrollment) throw new Error('enrolled peer bridge unavailable');
    return this.call((current, callSignal) => current.introductionEnrollment!(grant.targetHostId, { recipientInstanceId: grant.remoteInstanceId,
      operation: 'introduction.enroll', introductionId, ...enrollmentOffer(offer) }, callSignal), signal);
  }

  /** Non-initiator side: tells the introduced app, through the sponsor, that this owner approved. Carries no code. */
  async notifyIntroductionConsent(introductionId: string, signal?: AbortSignal): Promise<{ recorded: boolean }> {
    const grant = await this.approvedSponsor(introductionId, signal);
    if (!this.options.bridge?.introductionConsent) throw new Error('enrolled peer bridge unavailable');
    return this.call((bridge, callSignal) => bridge.introductionConsent!(grant.targetHostId, { recipientInstanceId: grant.remoteInstanceId,
      operation: 'introduction.consent', introductionId }, callSignal), signal);
  }

  /** Sponsor side: a delivered job whose requester is the sender, with both grants active. Identities come from the job. */
  private async deliveredJob(requesterInstanceId: string, introductionId: string, signal?: AbortSignal): Promise<{ job: z.infer<typeof jobSchema>; sponsor: PeerPairGrant }> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    const job = await this.storage.transaction(async state => state.jobs.find(j => j.introductionId === introductionId));
    if (!job || job.status !== 'complete') throw new Error('peer introduction unavailable');
    const sponsor = await this.options.pairs.grant(job.sponsorPairId), target = await this.options.pairs.grant(job.targetPairId);
    if (!sponsor || !target || sponsor.status !== 'active' || target.status !== 'active' || target.remoteInstanceId !== requesterInstanceId ||
      sponsor.remoteInstanceId !== job.peerInstanceId || sponsor.pluginId !== job.pluginId || target.pluginId !== job.pluginId ||
      sponsor.scope !== job.scope || target.scope !== job.scope) throw new Error('introduction scope or recipient mismatch');
    await this.context(proposalForGrant(sponsor), false, signal);
    return { job, sponsor };
  }

  /** Sponsor side: relays a delivered job's recipient offer to the introduced app. Identities come from this job, never the packet. */
  async relayIntroductionEnrollment(requesterInstanceId: string, input: { introductionId: string } & EnrollmentOffer, signal?: AbortSignal): Promise<EnrollmentOffer> {
    const { job, sponsor } = await this.deliveredJob(requesterInstanceId, input.introductionId, signal);
    if (!this.options.bridge?.introductionEnrollment) throw new Error('enrolled peer bridge unavailable');
    return this.call((bridge, callSignal) => bridge.introductionEnrollment!(sponsor.targetHostId, { recipientInstanceId: sponsor.remoteInstanceId,
      operation: 'introduction.install', introductionId: job.introductionId, pluginId: job.pluginId, scope: job.scope,
      peerInstanceId: requesterInstanceId, ...enrollmentOffer(input) }, callSignal), signal);
  }

  /** Sponsor side: relays a recipient's consent notice to the introduced app. Identities come from this job, never the packet. */
  async relayIntroductionConsent(requesterInstanceId: string, input: { introductionId: string }, signal?: AbortSignal): Promise<{ recorded: boolean }> {
    const { job, sponsor } = await this.deliveredJob(requesterInstanceId, input.introductionId, signal);
    if (!this.options.bridge?.introductionConsent) throw new Error('enrolled peer bridge unavailable');
    return this.call((bridge, callSignal) => bridge.introductionConsent!(sponsor.targetHostId, { recipientInstanceId: sponsor.remoteInstanceId,
      operation: 'introduction.consented', introductionId: job.introductionId, pluginId: job.pluginId, scope: job.scope,
      peerInstanceId: requesterInstanceId }, callSignal), signal);
  }

  /** Introduced-app side: a relayed install is accepted only from a sponsor this app actively links with in that scope. */
  async authorizeIntroducedInstall(sponsorInstanceId: string, input: { pluginId: string; scope: string; peerInstanceId: string }): Promise<void> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    id.parse(sponsorInstanceId); id.parse(input.peerInstanceId);
    if (!PEER_TOKEN.test(input.pluginId) || !validScope(input.scope)) throw new Error('introduction scope or recipient mismatch');
    if (input.peerInstanceId === this.options.instanceId || input.peerInstanceId === sponsorInstanceId || sponsorInstanceId === this.options.instanceId) {
      throw new Error('introduction scope or recipient mismatch');
    }
    const grants = await this.options.pairs.list(input.pluginId);
    if (!grants.some(g => g.status === 'active' && g.remoteInstanceId === sponsorInstanceId && g.scope === input.scope)) throw new Error('introduction sponsor is not linked');
  }

  async introductionStatus(introductionId: string): Promise<'pending' | 'complete' | 'blocked'> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    return this.storage.transaction(async state => {
      const job = state.jobs.find(j => j.introductionId === introductionId);
      if (!job) throw new Error('peer introduction unavailable');
      return job.status;
    });
  }

  /** Bounded explicit lifecycle tick; offline jobs remain visible and retryable. */
  async recover(): Promise<{ pending: number; blocked: number }> {
    if (this.disposed) throw new Error('scoped link authority disposed');
    if (this.recovery) return this.recovery;
    const recovery = this.recoverOnce();
    this.recovery = recovery;
    try { return await recovery; } finally { if (this.recovery === recovery) this.recovery = undefined; }
  }

  private async recoverOnce(): Promise<{ pending: number; blocked: number }> {
    const snapshot = await this.storage.transaction(async state => structuredClone(state));
    for (const record of snapshot.records) {
      if (this.disposed) throw new Error('scoped link authority disposed');
      if (record.status === 'revoked') { await this.options.pairs.revoke(record.proposal.pairId); continue; }
      // A stopped use revokes at authority level too, so the peer is told (below) and drops its side of the pair.
      if (!this.approved(record.proposal)) { await this.revoke(record.proposal.pairId); continue; }
      const channel = this.options.enrollment(record.proposal.targetHostId), reverse = await this.options.reverseEnrollment(record.proposal.remoteInstanceId);
      if (!channel || channel.keyHash !== record.channelKeyHash || !linkCapable(channel.capability) ||
        !reverse || reverse.hostId !== record.reverseHostId || reverse.keyHash !== record.reverseKeyHash || !linkCapable(reverse.capability)) await this.revoke(record.proposal.pairId);
    }
    for (const pairId of snapshot.revokedIds) {
      if (this.disposed) throw new Error('scoped link authority disposed');
      await this.options.pairs.revoke(pairId);
    }
    const revoked = await this.storage.transaction(async state => state.records.filter(r => r.status === 'revoked' && !r.revokeDelivered).slice(0, 8));
    for (const record of revoked) {
      try {
        await this.context(record.proposal, true);
        await this.call((bridge, signal) => bridge.exchange(record.proposal.targetHostId, 'revoke', record.proposal, undefined, signal));
        if (this.disposed) throw new Error('scoped link authority disposed');
        await this.storage.transaction(async (state, save) => {
          const current = state.records.find(r => r.proposal.pairId === record.proposal.pairId);
          if (current?.status === 'revoked') { current.revokeDelivered = true; await save(); }
        });
      } catch { /* Offline revocations remain durable, local grants stay fenced. */ }
    }
    for (const job of snapshot.jobs.filter(j => j.status === 'pending').slice(0, 8)) {
      if (this.disposed) throw new Error('scoped link authority disposed');
      const sponsor = await this.options.pairs.grant(job.sponsorPairId), target = await this.options.pairs.grant(job.targetPairId);
      if (!sponsor || !target) continue;
      if (!this.options.bridge || !this.options.enrollment(target.targetHostId)?.connected) continue;
      try {
        await this.context(proposalForGrant(target));
        await this.context(proposalForGrant(sponsor));
        await this.call((bridge, signal) => bridge.introduce(target.targetHostId, { recipientInstanceId: target.remoteInstanceId, capability: 'peer.forward', pluginId: job.pluginId, scope: job.scope, peerInstanceId: job.peerInstanceId, introductionId: job.introductionId }, signal));
        await this.storage.transaction(async (state, save) => {
          const current = state.jobs.find(j => j.introductionId === job.introductionId);
          if (current?.status === 'pending') { current.status = 'complete'; await save(); }
        });
      } catch { /* Durable pending state survives failed delivery. */ }
    }
    return this.storage.transaction(async state => ({ pending: state.jobs.filter(j => j.status === 'pending').length, blocked: state.jobs.filter(j => j.status === 'blocked').length }));
  }
  dispose(): void {
    this.disposed = true;
    this.storage.dispose();
    for (const operation of this.operations) operation.abort();
  }
  async whenIdle(): Promise<void> {
    await this.recovery?.catch(() => undefined);
    while (this.bridgeWork.size) await Promise.allSettled([...this.bridgeWork]);
    await this.storage.whenIdle();
  }
}
