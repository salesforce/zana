import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { negotiateProtocol, validateAppliedReceipt, validateHandshake, validateSessionOffer, validateAncestryPage,
  validateTransfer, validateChunk, validateReceiptQuery, transferQuery, validateMissing, validateManualConsent,
  type PeerHandshake, type PeerSessionOffer, type PeerSessionExpectation, type PeerTransfer } from './peer-protocol.js';
import { DesignDocSyncStore, delivered, type FrozenSyncIntent } from './sync-store.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_WINDOW_CHUNKS, PEER_CALL_TIMEOUT_MS, PEER_COMPACTION_BATCH, PEER_MIN_PROTOCOL_VERSION, PEER_PENDING_TICK_MS, PEER_PROTOCOL_VERSION } from '../shared/peer-limits.js';
import { PeerProtocolError, type PeerAppliedReceipt } from '../shared/peer-contract.js';
import type { DocActor, PeerResolutionChoice } from '../shared/contract.js';

type ReceiverFence = Pick<PluginPeerRequest, 'signal' | 'scope' | 'grantEpoch' | 'commitSync'>;

/** Platform authenticates pair/capability; DD verifies store, roster and payload. */
export class DesignDocPeerService {
  private running: Promise<{ attempted: number; synced: number; blocked: number }> | null = null;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduleDelivery: (() => void) | null = null;
  private peers: PluginSdkPeers | null = null;
  private lastWarning = '';

  constructor(private readonly sync: DesignDocSyncStore, private readonly changed: (docId: string) => void = () => {}) {}

  initialize(): void { this.sync.initializeLocal(); }

  register(zcc: ZccPluginApi): void {
    this.peers = zcc.sdk.peers;
    zcc.sdk.peers.handle('manual', async (request) => {
      // Accept the inbound consent, but do NOT eagerly schedule delivery here: the sender follows up with an explicit
      // 'manual-deliver' only after it has completed its own ACK (flipping its inbound session to 'accepted'). Scheduling
      // a background delivery on bare accept races that ACK — the peer would ship a private draft while this side's
      // inbound session is still 'waiting', tripping the strict bilateral-consent gate. 'manual-deliver' is the sanctioned,
      // race-free delivery trigger.
      const { consent, accepted } = await this.acceptManualConsent(request);
      return { manualId: consent.manualId, accepted };
    });
    zcc.sdk.peers.handle('manual-deliver', async (request) => {
      const { accepted } = await this.acceptManualConsent(request);
      if (!accepted || !this.peers) throw new PeerProtocolError('invalid', 'bilateral manual consent missing');
      return this.deliverPending(this.peers);
    });
    zcc.sdk.peers.handle('handshake', (request) => {
      const { peerId, body } = request;
      this.requireFence(request);
      return this.handshake(peerId, body, request.grantEpoch);
    });
    zcc.sdk.peers.handle('offer', (request) => {
      const { peerId, body } = request;
      // Older hosts must not bypass revocation fences. No async work in SQL transaction.
      if (!request.commitSync || !Number.isSafeInteger(request.grantEpoch)) {
        throw new PeerProtocolError('invalid', 'host does not provide durable peer commit fence');
      }
      return this.offer(peerId, body, request);
    });
    zcc.sdk.peers.handle('receipt-query', (request) => {
      const { peerId, body } = request;
      this.requireFence(request);
      return this.receiptQuery(peerId, body, request.grantEpoch);
    });
    for (const method of ['transfer', 'chunk', 'apply', 'missing', 'cancel', 'ancestry'] as const) {
      zcc.sdk.peers.handle(method, (request) => {
        const { peerId, body } = request;
        return this.receiveTransfer(method, peerId, body, request);
      });
    }
    zcc.onDispose(() => {
      this.abort.abort();
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.scheduleDelivery = null;
      this.peers = null;
    });
  }

  /** Validates and durably records a peer's manual consent under the commit fence. */
  private async acceptManualConsent(request: PluginPeerRequest): Promise<{ consent: ReturnType<typeof validateManualConsent>; accepted: boolean }> {
    this.requireFence(request);
    const packet = request.body as Partial<PeerHandshake>;
    this.requireRosterPeer(this.requireGroup().repoId, String(packet.senderReplicaId), request.peerId);
    const consent = validateManualConsent(request.body, this.expectation(String(packet.senderReplicaId), request.grantEpoch));
    const accepted = await request.commitSync(() => {
      this.requireFence(request);
      this.requireRosterPeer(consent.repoId, consent.senderReplicaId, request.peerId);
      validateManualConsent(consent, this.expectation(consent.senderReplicaId, request.grantEpoch));
      return this.sync.acceptManual(consent.senderReplicaId, consent.manualId, consent.heads);
    });
    this.requireCurrentRequest(consent, request.peerId, request);
    return { consent, accepted };
  }

  /** Background failures stay non-fatal but leave a bounded, deduplicated trace. */
  private warnOnce(operation: string, error: unknown): void {
    if (this.abort.signal.aborted) return;
    const text = `${operation}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
    if (text === this.lastWarning) return;
    this.lastWarning = text;
    console.warn(`[design-docs] ${text}`);
  }

  start(peers: PluginSdkPeers): void {
    this.peers = peers;
    if (this.timer || this.abort.signal.aborted) return;
    const deliver = () => {
      if (!this.abort.signal.aborted && this.status().configured) void this.deliverPending(peers).catch((error) => this.warnOnce('scheduled peer delivery failed', error));
    };
    this.scheduleDelivery = () => queueMicrotask(deliver);
    this.timer = setInterval(deliver, PEER_PENDING_TICK_MS);
    this.timer.unref();
    this.scheduleDelivery();
  }

  /** Scheduled callback runs only after synchronous outer SQL transaction returns. */
  mutationCommitted(): void { this.scheduleDelivery?.(); }

  conflicts(docId: string, cursor?: string) { return this.sync.conflicts(docId, cursor); }
  conflictReview(docId: string, remoteHead: string) { return this.sync.conflictReview(docId, remoteHead); }
  conflictFile(docId: string, remoteHead: string, path: string) { return this.sync.conflictFile(docId, remoteHead, path); }
  resolveConflict(input: { docId: string; expectedHead: string; remoteHead: string; choice: PeerResolutionChoice }, actor: DocActor): string {
    const head = this.sync.resolveConflict(input, actor);
    this.changed(input.docId);
    return head;
  }

  status(): { configured: boolean; repoId?: string; replicaId?: string; groupId?: string; rosterEpoch?: number; members: ReturnType<DesignDocSyncStore['members']> } {
    const local = this.sync.localRepository();
    if (!local?.groupId || local.rosterEpoch < 1 || this.sync.isRetiringReplica(local.repoId, local.replicaId)) return { configured: false, members: [] };
    return { configured: true, repoId: local.repoId, replicaId: local.replicaId, groupId: local.groupId,
      rosterEpoch: local.rosterEpoch, members: this.sync.members(local.repoId) };
  }

  /** User invocation authorizes a database-wide persisted snapshot, never buffers. */
  async syncNow(peers: PluginSdkPeers): Promise<{ attempted: number; synced: number; blocked: number }> {
    this.requireGroup();
    this.sync.prepareManual();
    const local = this.requireGroup();
    let awaiting = 0;
    for (const member of this.sync.members(local.repoId).filter((member) => member.replicaId !== local.replicaId)) {
      if (this.sync.isRetiringReplica(local.repoId, local.replicaId)) break;
      const consent = this.sync.manualConsent(member.replicaId);
      if (!consent) continue;
      try {
        const grants = (await peers.list({ signal: this.abort.signal })).filter((grant) => grant.id === member.machineId && grant.scope === local.repoId && grant.connected);
        if (grants.length !== 1) throw new PeerProtocolError('invalid', 'manual peer unavailable');
        // Manual consent packets stay at the oldest supported version; they carry no ancestry.
        const body = { ...this.handshakeFor(member.replicaId, grants[0]!.grantEpoch, PEER_MIN_PROTOCOL_VERSION), ...consent };
        const options = { scope: local.repoId, signal: this.abort.signal, timeoutMs: PEER_CALL_TIMEOUT_MS };
        const reply = await peers.call(member.machineId, 'manual', body, options) as { accepted?: unknown; manualId?: unknown };
        if (reply?.accepted !== true || reply.manualId !== consent.manualId) { awaiting++; continue; }
        await this.completeManualAck(peers, body, member.machineId);
        this.requireCurrentHandshake(body, member.machineId);
        await peers.call(member.machineId, 'manual-deliver', body, options);
      } catch (error) { awaiting++; this.warnOnce(`manual sync with ${member.machineId} awaiting`, error); }
    }
    const result = await this.deliverPending(peers);
    return { ...result, blocked: result.blocked + awaiting };
  }

  /** Reconnect/startup callers may deliver frozen intents only, not current drafts. */
  deliverPending(peers: PluginSdkPeers): Promise<{ attempted: number; synced: number; blocked: number }> {
    if (this.running) return this.running;
    this.running = this.deliver(peers).finally(() => { this.running = null; });
    return this.running;
  }

  private async deliver(peers: PluginSdkPeers): Promise<{ attempted: number; synced: number; blocked: number }> {
    const local = this.requireGroup();
    let attempted = 0, synced = 0, blocked = 0;
    // Retry explicit frozen manual consent after restart/reconnect, never recapture drafts.
    for (const consent of this.sync.manualConsents()) {
      if (this.sync.isRetiringReplica(local.repoId, local.replicaId)) break;
      const member = this.sync.members(local.repoId).find((member) => member.replicaId === consent.memberReplicaId);
      if (!member || this.abort.signal.aborted) continue;
      try {
        const grants = (await peers.list({ signal: this.abort.signal })).filter((grant) => grant.id === member.machineId && grant.scope === local.repoId && grant.connected);
        if (grants.length !== 1) continue;
        const body = { ...this.handshakeFor(member.replicaId, grants[0]!.grantEpoch, PEER_MIN_PROTOCOL_VERSION), manualId: consent.manualId, heads: consent.heads };
        const reply = await peers.call(member.machineId, 'manual', body,
          { scope: local.repoId, timeoutMs: PEER_CALL_TIMEOUT_MS, signal: this.abort.signal }) as { accepted?: unknown; manualId?: unknown };
        if (reply?.accepted === true && reply.manualId === consent.manualId) {
          await this.completeManualAck(peers, body, member.machineId);
        }
      } catch (error) { this.warnOnce(`manual consent retry for ${member.machineId} deferred`, error); /* Durable consent stays waiting for authorized reconnect. */ }
    }
    for (const intent of this.sync.readyIntents(local.repoId)) {
      if (this.abort.signal.aborted || this.sync.isRetiringReplica(local.repoId, local.replicaId)) break;
      attempted++;
      try {
        const member = this.sync.members(local.repoId).find((item) => item.replicaId === intent.memberReplicaId);
        if (!member) throw new PeerProtocolError('invalid', 'intent recipient removed from roster');
        // machineId is the remote owning app instance ID, never a daemon/enrollment ID.
        const grants = (await peers.list({ signal: this.abort.signal })).filter((peer) => peer.id === member.machineId && peer.scope === local.repoId);
        const grant = grants.length === 1 ? grants[0] : undefined;
        if (!grant?.connected || !Number.isSafeInteger(grant.grantEpoch) || grant.grantEpoch < 1) {
          throw new PeerProtocolError('invalid', 'peer grant unavailable');
        }
        // Open at the oldest version and advertise the newest: protocol-2 peers strip the extra key and answer 2.
        const handshake = { ...this.handshakeFor(member.replicaId, grant.grantEpoch, PEER_MIN_PROTOCOL_VERSION), maxProtocolVersion: PEER_PROTOCOL_VERSION };
        const options = { timeoutMs: PEER_CALL_TIMEOUT_MS, signal: this.abort.signal, scope: local.repoId };
        const remote = await peers.call(member.machineId, 'handshake', handshake, options);
        validateHandshake(remote, this.expectation(member.replicaId, grant.grantEpoch));
        const negotiated = Math.min(remote.protocolVersion, PEER_PROTOCOL_VERSION);
        this.sync.recordPeerProtocol(member.replicaId, negotiated);
        const transfer = this.createTransfer(intent, grant.grantEpoch, negotiated);
        const query = transferQuery(transfer);
        this.requireCurrentHandshake(transfer, member.machineId);
        let receipt = await peers.call(member.machineId, 'receipt-query', query, options);
        if (!receipt) {
          try {
            // Older payload-free ancestry first, so the transfer's inline stubs close over rows the receiver holds.
            for (const page of this.sync.outgoingAncestry(intent, transfer)) {
              this.requireCurrentHandshake(page, member.machineId);
              await peers.call(member.machineId, 'ancestry', page, options);
            }
            this.requireCurrentHandshake(transfer, member.machineId);
            await peers.call(member.machineId, 'transfer', transfer, options);
            const maximumWindows = Math.ceil(transfer.blobs.reduce((sum, blob) => sum + Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES), 0) / MAX_PEER_WINDOW_CHUNKS) + 1;
            for (let window = 0; window < maximumWindows; window++) {
              this.requireCurrentHandshake(transfer, member.machineId);
              const missing = validateMissing(await peers.call(member.machineId, 'missing', query, options), transfer);
              if (!missing.chunks.length) break;
              for (const chunk of missing.chunks) await peers.call(member.machineId, 'chunk', this.sync.outgoingChunk(transfer, chunk.blobHash, chunk.index), options);
              if (window === maximumWindows - 1) throw new PeerProtocolError('limit', 'missing chunk windows did not converge');
            }
            this.requireCurrentHandshake(transfer, member.machineId);
            receipt = await peers.call(member.machineId, 'apply', query, options);
          }
          catch (error) {
            // Receiver may have committed before transport lost ACK.
            this.requireCurrentHandshake(transfer, member.machineId);
            receipt = await peers.call(member.machineId, 'receipt-query', query, options);
            if (!receipt) throw error;
          }
        }
        const applied = validateAppliedReceipt(receipt, transfer);
        const currentGrants = (await peers.list({ signal: this.abort.signal })).filter((peer) => peer.id === member.machineId && peer.scope === local.repoId);
        const currentGrant = currentGrants.length === 1 ? currentGrants[0] : undefined;
        const current = this.requireGroup();
        this.requireRosterPeer(current.repoId, member.replicaId, member.machineId);
        if (this.abort.signal.aborted || current.rosterEpoch !== transfer.rosterEpoch ||
          (current.rosterDigest !== null && current.rosterDigest !== transfer.rosterDigest) || current.groupId !== transfer.groupId ||
          currentGrant?.grantEpoch !== transfer.grantEpoch || !currentGrant.connected) {
          throw new PeerProtocolError('invalid', 'authorization changed before receipt');
        }
        this.sync.acceptTransferReceipt(intent, transfer, applied);
        if (delivered(applied.stage)) synced++; else { blocked++; this.sync.deferIntent(intent, applied.stage); }
      } catch (error) { blocked++; this.sync.deferIntent(intent, error instanceof Error ? error.message : 'peer delivery failed'); }
    }
    if (synced > 0) this.compactAfterSync();
    return { attempted, synced, blocked };
  }

  /**
   * Opportunistic retention after a completed sync: one deterministic oldest-first batch, never time-based.
   * The store's own gate (all data members on delta protocol) and pins decide; failures wait for the next sync.
   */
  private compactAfterSync(): void {
    try { this.sync.compact(PEER_COMPACTION_BATCH); } catch (error) { this.warnOnce('peer compaction skipped', error); /* capacity relief still runs before writes */ }
  }

  handshake(peerId: string, input: unknown, grantEpoch = 1): PeerHandshake {
    const local = this.requireGroup();
    const packet = input as Partial<PeerHandshake>;
    this.requireRosterPeer(local.repoId, String(packet?.senderReplicaId ?? ''), peerId);
    // Generic epoch is owned by platform, not supplied payload-as-expectation.
    validateHandshake(input, this.expectation(String(packet.senderReplicaId), grantEpoch));
    return { ...this.handshakeFor(String(packet.senderReplicaId), grantEpoch, negotiateProtocol(input as PeerHandshake)), grantEpoch };
  }

  async offer(peerId: string, input: unknown, fence: ReceiverFence): Promise<PeerAppliedReceipt> {
    const local = this.requireGroup();
    const packet = input as Partial<PeerHandshake>;
    this.requireRosterPeer(local.repoId, String(packet?.senderReplicaId ?? ''), peerId);
    this.requireFence(fence);
    const offer = validateSessionOffer(input, this.expectation(String(packet.senderReplicaId), fence.grantEpoch),
      (operationId) => this.sync.operationDoc(local.repoId, operationId));
    const receipt = await fence.commitSync(() => {
      this.requireFence(fence);
      this.requireRosterPeer(local.repoId, offer.senderReplicaId, peerId);
      validateHandshake(offer, this.expectation(offer.senderReplicaId, fence.grantEpoch));
      return this.sync.apply(offer);
    });
    // Invalidation only: receiver never pushes content into editor buffers.
    for (const docId of Object.keys(receipt.appliedHeads)) this.changed(docId);
    this.mutationCommitted();
    this.requireCurrentRequest(offer, peerId, fence);
    return receipt;
  }

  private requireFence(fence: ReceiverFence): void {
    if (!fence?.commitSync || !fence.signal || !Number.isSafeInteger(fence.grantEpoch) || fence.grantEpoch < 1 || fence.scope !== this.requireGroup().repoId) {
      throw new PeerProtocolError('invalid', 'host does not provide matching durable peer commit fence');
    }
    if (fence.signal.aborted || this.abort.signal.aborted) throw new PeerProtocolError('invalid', 'peer request cancelled');
  }

  async receiveTransfer(method: 'transfer' | 'chunk' | 'apply' | 'missing' | 'cancel' | 'ancestry', peerId: string, input: unknown, fence: ReceiverFence): Promise<unknown> {
    this.requireFence(fence);
    const packet = input as Partial<PeerHandshake>;
    this.requireRosterPeer(this.requireGroup().repoId, String(packet?.senderReplicaId ?? ''), peerId);
    const expected = this.expectation(String(packet?.senderReplicaId ?? ''), fence.grantEpoch);
    if (method === 'ancestry') {
      const page = validateAncestryPage(input, expected, (operationId) => this.sync.operationDoc(expected.repoId, operationId));
      const result = await fence.commitSync(() => {
        this.requireFence(fence);
        this.requireRosterPeer(expected.repoId, expected.remoteReplicaId, peerId);
        validateHandshake(page, this.expectation(expected.remoteReplicaId, fence.grantEpoch));
        return { stage: 'received', stubs: this.sync.recordStubs(page) };
      });
      this.requireCurrentRequest(page, peerId, fence);
      return result;
    }
    if (method === 'transfer') {
      const transfer = validateTransfer(input, expected, (operationId) => this.sync.operationDoc(expected.repoId, operationId));
      const result = await fence.commitSync(() => {
        this.requireFence(fence);
        this.requireRosterPeer(expected.repoId, expected.remoteReplicaId, peerId);
        validateHandshake(transfer, this.expectation(expected.remoteReplicaId, fence.grantEpoch));
        this.sync.stageTransfer(transfer);
        return { stage: 'received', scopeHash: transfer.scopeHash };
      });
      this.requireCurrentRequest(transfer, peerId, fence);
      return result;
    }
    if (method === 'chunk') {
      const { packet, bytes } = validateChunk(input, expected);
      const result = await fence.commitSync(() => {
        this.requireFence(fence);
        this.requireRosterPeer(expected.repoId, expected.remoteReplicaId, peerId);
        validateHandshake(packet, this.expectation(expected.remoteReplicaId, fence.grantEpoch));
        this.sync.stageChunk(packet, bytes);
        return { stage: 'received', index: packet.index };
      });
      this.requireCurrentRequest(packet, peerId, fence);
      return result;
    }
    const query = validateReceiptQuery(input, expected);
    if (method === 'missing' || method === 'cancel') {
      const result = await fence.commitSync(() => {
        this.requireFence(fence);
        this.requireRosterPeer(expected.repoId, expected.remoteReplicaId, peerId);
        validateHandshake(query, this.expectation(expected.remoteReplicaId, fence.grantEpoch));
        if (method === 'missing') return this.sync.missingChunks(query);
        this.sync.cancelStaging(query);
        return { stage: 'cancelled' };
      });
      this.requireCurrentRequest(query, peerId, fence);
      return result;
    }
    // Assemble and verify the staged closures before the fence: the fenced commit has a fixed worker execution budget
    // and only needs to re-check authorization, the unchanged staged header, and write the atomic projection/receipt.
    const prepared = this.sync.prepareTransfer(query);
    const receipt = await fence.commitSync(() => {
      this.requireFence(fence);
      this.requireRosterPeer(expected.repoId, expected.remoteReplicaId, peerId);
      validateHandshake(query, this.expectation(expected.remoteReplicaId, fence.grantEpoch));
      return this.sync.applyTransfer(query, prepared);
    });
    for (const docId of Object.keys(receipt.appliedHeads)) this.changed(docId);
    if (receipt.stage === 'synced') this.compactAfterSync();
    this.mutationCommitted();
    this.requireCurrentRequest(query, peerId, fence);
    return receipt;
  }

  receiptQuery(peerId: string, input: unknown, grantEpoch = 1): PeerAppliedReceipt | null {
    const packet = input as Partial<PeerHandshake> & { sessionId?: unknown; scopeHash?: unknown };
    this.handshake(peerId, input, grantEpoch);
    if (typeof packet.sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(packet.sessionId) ||
      typeof packet.scopeHash !== 'string' || !/^[a-f0-9]{64}$/.test(packet.scopeHash) ||
      Object.keys(packet).some((key) => !['protocolVersion', 'repoId', 'senderReplicaId', 'recipientReplicaId', 'grantEpoch', 'groupId', 'rosterEpoch', 'rosterDigest', 'sessionId', 'scopeHash'].includes(key))) {
      throw new PeerProtocolError('invalid', 'invalid receipt query');
    }
    return this.sync.checkpoint(String(packet.repoId), String(packet.senderReplicaId), packet.sessionId, packet.scopeHash, packet.rosterDigest);
  }

  createTransfer(intent: FrozenSyncIntent, grantEpoch: number, protocolVersion = PEER_PROTOCOL_VERSION): PeerTransfer {
    return this.sync.outgoingTransfer(intent, this.handshakeFor(intent.memberReplicaId, grantEpoch, protocolVersion));
  }

  createOffer(intent: FrozenSyncIntent, protocolVersion = PEER_PROTOCOL_VERSION): PeerSessionOffer {
    return this.sync.outgoing(intent, this.handshakeFor(intent.memberReplicaId, 1, protocolVersion));
  }

  private handshakeFor(recipientReplicaId: string, grantEpoch = 1, protocolVersion = PEER_PROTOCOL_VERSION): PeerHandshake {
    const local = this.requireGroup();
    if (this.sync.isRetiringReplica(local.repoId, recipientReplicaId)) throw new PeerProtocolError('invalid', 'retiring replica cannot exchange document data');
    return { protocolVersion, repoId: local.repoId, senderReplicaId: local.replicaId,
      recipientReplicaId, grantEpoch, groupId: local.groupId, rosterEpoch: local.rosterEpoch,
      ...(local.rosterDigest !== null ? { rosterDigest: local.rosterDigest } : {}) };
  }

  private expectation(remoteReplicaId: string, grantEpoch: number): PeerSessionExpectation {
    const local = this.requireGroup();
    return { repoId: local.repoId, localReplicaId: local.replicaId, remoteReplicaId,
      grantEpoch, groupId: local.groupId, rosterEpoch: local.rosterEpoch,
      ...(local.rosterDigest !== null ? { rosterDigest: local.rosterDigest } : {}) };
  }

  private requireCurrentHandshake(handshake: PeerHandshake, peerId: string): void {
    const local = this.requireGroup();
    validateHandshake(handshake, { repoId: local.repoId, localReplicaId: handshake.recipientReplicaId,
      remoteReplicaId: local.replicaId, grantEpoch: handshake.grantEpoch, groupId: local.groupId,
      rosterEpoch: local.rosterEpoch, ...(local.rosterDigest !== null ? { rosterDigest: local.rosterDigest } : {}) });
    this.requireRosterPeer(local.repoId, handshake.recipientReplicaId, peerId);
  }

  private requireCurrentRequest(handshake: PeerHandshake, peerId: string, fence: ReceiverFence): void {
    this.requireFence(fence);
    this.requireRosterPeer(handshake.repoId, handshake.senderReplicaId, peerId);
    validateHandshake(handshake, this.expectation(handshake.senderReplicaId, fence.grantEpoch));
  }

  private async completeManualAck(peers: PluginSdkPeers, handshake: PeerHandshake & { manualId: string }, peerId: string): Promise<void> {
    this.requireCurrentHandshake(handshake, peerId);
    const grants = (await peers.list({ signal: this.abort.signal })).filter((grant) => grant.id === peerId && grant.scope === handshake.repoId);
    this.requireCurrentHandshake(handshake, peerId);
    if (this.abort.signal.aborted || grants.length !== 1 || !grants[0]!.connected || grants[0]!.grantEpoch !== handshake.grantEpoch) {
      throw new PeerProtocolError('invalid', 'authorization changed before manual ACK');
    }
    this.sync.completeManual(handshake.manualId);
  }

  private requireGroup(): { repoId: string; replicaId: string; groupId: string; rosterEpoch: number; rosterDigest: string | null } {
    const local = this.sync.localRepository();
    if (!local?.groupId || local.rosterEpoch < 1) throw new PeerProtocolError('invalid', 'design docs peer sync is not configured');
    if (this.sync.isRetiringReplica(local.repoId, local.replicaId)) throw new PeerProtocolError('invalid', 'retiring replica cannot exchange document data');
    return { ...local, groupId: local.groupId };
  }

  private requireRosterPeer(repoId: string, replicaId: string, peerId: string): void {
    const member = this.sync.members(repoId).find((candidate) => candidate.replicaId === replicaId);
    if (!member || member.machineId !== peerId) throw new PeerProtocolError('invalid', 'peer identity is not a roster member');
  }
}
