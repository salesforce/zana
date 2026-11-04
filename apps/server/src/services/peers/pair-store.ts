import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import {
  canonicalPeerMac, parsePeerMac, PEER_DIGEST, PEER_ID, PEER_TOKEN, peerBodyHash, peerRoute,
  PrivatePeerStorage, sealPeerBytes, unsealPeerBytes, validScope, validatePeerFields,
  type PeerKeyProvider, type PeerRequestEnvelope, type PeerRequestFields
} from './peer-auth.js';
import {
  consumeAuthenticatedNonce, PEER_FUTURE_SKEW_MS, PEER_REQUEST_TTL_MS,
  replayCapacity, validateReplayState, type PeerReplayState
} from './peer-replay-window.js';

export type { PeerKeyProvider, PeerRequestEnvelope } from './peer-auth.js';
export const MAX_PEER_PAIRS = 256;
const MAX_ACTIVE_LEASES = 128;
const MAX_CREDENTIAL_TRANSFER_BYTES = 8192;
const PEER_SECRET_BYTES = 32;
const PEER_NONCE_BYTES = 24;
const CREDENTIAL_TRANSFER_AAD = 'zcc-peer-transfer-v2';
export const PEER_COMMIT_LEASE_TIMEOUT_MS = 10_000;

export interface PeerPairGrant {
  pairId: string;
  localInstanceId: string;
  remoteInstanceId: string;
  pluginId: string;
  scope: string;
  targetHostId: string;
  epoch: number;
  proposalId: string;
  status: 'proposed' | 'active' | 'revoked';
  /** Compatibility aliases; never independently authorize a request. */
  peerId: string;
  capability: 'peer.forward';
}

// Legacy callers still compile, but missing identity/plugin/scope/host fields fail closed.
export type PeerPairInput = Partial<PeerPairGrant> & { pairId: string };
interface StoredPair extends PeerPairGrant { secret: string | null }
interface PairState { version: 2; localInstanceId: string; pairs: StoredPair[]; revokedIds: string[]; replay: PeerReplayState }
export interface PeerTransferBinding {
  operation: 'import' | 'export';
  pairId: string;
  localInstanceId: string;
  remoteInstanceId: string;
  pluginId: string;
  scope: string;
  targetHostId: string;
  epoch: number;
  proposalId: string;
}
export interface PairStoreOptions {
  localInstanceId: string;
  keyProvider: PeerKeyProvider;
  /** Host enrollment/channel authority returns its shared transfer key, never an SDK boolean. */
  authorizeTransfer?: (context: unknown, binding: Readonly<PeerTransferBinding>) => Promise<Uint8Array | null>;
  /** Runs outside the pair mutex; returned guard rechecks current enrollment synchronously at commit. */
  validateGrant?: (grant: Readonly<PeerPairGrant>) => Promise<(() => boolean) | null>;
  now?: () => number;
  maxPairs?: number;
  maxNonces?: number;
}
export interface PeerGrantLease {
  grant: PeerPairGrant;
  signal: AbortSignal;
  assertActive(): Promise<void>;
  /** Synchronous host transaction/apply/receipt commit under the same mutex as revoke. No I/O or awaits. */
  commitSync<T>(commit: () => T extends PromiseLike<unknown> ? never : T): Promise<T>;
  /** Host bridge only: await bounded execution observation, never a plugin Promise. */
  commitWorkerSync<T>(observe: (gate: SharedArrayBuffer, preflight: () => void) => Promise<{ asynchronous: boolean; value: T }>, signal: AbortSignal): Promise<T>;
  release(): void;
}

const leases = new Map<string, Map<AbortController, { pairId: string; epoch: number }>>();
const revocations = new Map<string, { pending: Map<string, number>; failed: Set<string> }>();

/** Legacy name now emits only the full v2 canonical encoding, never newline MACs. */
export function peerMacPayload(input: {
  pairId: string; senderId: string; pluginId: string; method: string; nonce: string; epoch: number; body: Uint8Array;
  recipientId?: string; scope?: string; route?: string; httpMethod?: 'POST'; issuedAt?: number; protocolVersion?: 2;
}): Buffer {
  return canonicalPeerMac({ protocolVersion: input.protocolVersion ?? 2, pairId: input.pairId, senderId: input.senderId,
    recipientId: input.recipientId!, pluginId: input.pluginId, scope: input.scope!,
    route: input.route ?? peerRoute(input.pluginId, input.method), httpMethod: input.httpMethod ?? 'POST',
    payloadHash: peerBodyHash(input.body), nonce: input.nonce, issuedAt: input.issuedAt!, epoch: input.epoch });
}

function publicGrant({ secret: _secret, ...grant }: StoredPair): PeerPairGrant { return { ...grant }; }

function normalizeGrant(input: PeerPairInput, localInstanceId: string, status: PeerPairGrant['status']): PeerPairGrant {
  if (!input || Object.keys(input).some((key) => !['pairId', 'localInstanceId', 'remoteInstanceId', 'pluginId', 'scope',
    'targetHostId', 'epoch', 'proposalId', 'status', 'peerId', 'capability'].includes(key)) ||
    (input.status !== undefined && input.status !== status)) throw new Error('invalid peer pair grant');
  const grant = {
    pairId: input.pairId, localInstanceId: input.localInstanceId ?? localInstanceId,
    remoteInstanceId: input.remoteInstanceId!, pluginId: input.pluginId!, scope: input.scope!,
    targetHostId: input.targetHostId!, epoch: input.epoch ?? 1, proposalId: input.proposalId!, status,
    peerId: input.remoteInstanceId!, capability: 'peer.forward'
  } as PeerPairGrant;
  validateGrant(grant);
  if (grant.localInstanceId !== localInstanceId || (input.peerId !== undefined && input.peerId !== grant.peerId) ||
    (input.capability !== undefined && input.capability !== grant.capability)) throw new Error('peer grant identity mismatch');
  return grant;
}

function validateGrant(grant: PeerPairGrant): void {
  if (!grant || [grant.pairId, grant.localInstanceId, grant.remoteInstanceId, grant.targetHostId, grant.proposalId, grant.pluginId]
    .some((item) => typeof item !== 'string') || !PEER_ID.test(grant.pairId) || !PEER_ID.test(grant.localInstanceId) || !PEER_ID.test(grant.remoteInstanceId) ||
    grant.localInstanceId === grant.remoteInstanceId || !PEER_ID.test(grant.targetHostId) || !PEER_ID.test(grant.proposalId) ||
    !PEER_TOKEN.test(grant.pluginId) || !validScope(grant.scope) || !Number.isSafeInteger(grant.epoch) || grant.epoch < 1 ||
    grant.peerId !== grant.remoteInstanceId || grant.capability !== 'peer.forward' ||
    !['proposed', 'active', 'revoked'].includes(grant.status)) throw new Error('invalid peer pair grant');
}

function sameGrant(a: PeerPairGrant, b: PeerPairGrant): boolean {
  return ['pairId', 'localInstanceId', 'remoteInstanceId', 'pluginId', 'scope', 'targetHostId', 'epoch', 'proposalId']
    .every((key) => a[key as keyof PeerPairGrant] === b[key as keyof PeerPairGrant]);
}

function nonceFrom(fields: PeerRequestFields) {
  return { pairId: fields.pairId, senderId: fields.senderId, epoch: fields.epoch, nonce: fields.nonce, issuedAt: fields.issuedAt };
}

/** Only trusted host core owns this object. No credentials or transfer methods belong in the plugin SDK. */
export class PairStore {
  private readonly storage: PrivatePeerStorage<PairState>;
  private readonly localInstanceId: string;
  private readonly now: () => number;
  private readonly maxPairs: number;
  private readonly maxNonces: number;
  private disposed = false;
  constructor(private readonly directory: string, private readonly options?: PairStoreOptions) {
    this.localInstanceId = options?.localInstanceId ?? '';
    this.now = options?.now ?? Date.now;
    this.maxPairs = options?.maxPairs ?? MAX_PEER_PAIRS;
    this.maxNonces = replayCapacity(options?.maxNonces);
    if (!Number.isSafeInteger(this.maxPairs) || this.maxPairs < 1 || this.maxPairs > MAX_PEER_PAIRS) throw new Error('invalid peer pair capacity');
    this.storage = new PrivatePeerStorage(directory, 'pairs-v2', options?.keyProvider, this.localInstanceId,
      () => ({ version: 2, localInstanceId: this.localInstanceId, pairs: [], revokedIds: [], replay: { clock: 0, nonces: [] } }),
      (value) => this.validateState(value));
  }

  async create(input: PeerPairInput): Promise<PeerPairGrant> { return this.put(input, 'active'); }
  async propose(input: PeerPairInput): Promise<PeerPairGrant> { return this.put(input, 'proposed'); }

  private async put(input: PeerPairInput, status: 'active' | 'proposed'): Promise<PeerPairGrant> {
    const grant = normalizeGrant(input, this.localInstanceId, status);
    return this.transaction(async (state, save) => {
      if (state.revokedIds.includes(grant.pairId)) throw new Error('peer pair is revoked');
      if (this.isFenced(grant.pairId)) throw new Error('peer pair revocation pending or failed');
      const existing = state.pairs.find((pair) => pair.pairId === grant.pairId);
      if (existing && existing.status !== 'revoked') {
        if (!sameGrant(existing, grant)) throw new Error('peer pair proposal conflicts');
        return publicGrant(existing);
      }
      if (existing && (status !== 'proposed' || grant.epoch !== existing.epoch || grant.proposalId === existing.proposalId ||
        !sameGrant({ ...existing, epoch: grant.epoch, proposalId: grant.proposalId }, grant))) throw new Error('peer pair is revoked');
      if (!existing && state.pairs.length + state.revokedIds.length >= this.maxPairs) throw new Error('peer pair capacity exceeded');
      const record: StoredPair = { ...grant, secret: randomBytes(PEER_SECRET_BYTES).toString('base64url') };
      if (existing) state.pairs[state.pairs.indexOf(existing)] = record; else state.pairs.push(record);
      await save();
      if (this.isFenced(grant.pairId)) throw new Error('peer pair is revoked');
      return publicGrant(record);
    }, { pairId: grant.pairId });
  }

  async activate(pairId: string, proposalId: string, epoch: number): Promise<PeerPairGrant> {
    return this.transaction(async (state, save) => {
      const pair = state.pairs.find((item) => item.pairId === pairId);
      if (!pair || this.isFenced(pairId) || pair.status === 'revoked' || pair.proposalId !== proposalId || pair.epoch !== epoch) throw new Error('peer proposal no longer valid');
      if (pair.status !== 'active') { pair.status = 'active'; await save(); }
      if (this.isFenced(pairId)) throw new Error('peer proposal no longer valid');
      return publicGrant(pair);
    }, { pairId });
  }

  async grant(pairId: string): Promise<PeerPairGrant | null> {
    if (!PEER_ID.test(pairId)) return null;
    return this.transaction(async (state) => {
      const record = state.pairs.find((pair) => pair.pairId === pairId && pair.status === 'active');
      return record && !this.isFenced(pairId) ? publicGrant(record) : null;
    }, { pairId });
  }

  async revoke(pairId: string): Promise<void> {
    if (!PEER_ID.test(pairId)) throw new Error('invalid peer pair id');
    const id = resolve(this.directory);
    let fence = revocations.get(id);
    if (!fence) { fence = { pending: new Map(), failed: new Set() }; revocations.set(id, fence); }
    if (!fence.pending.has(pairId) && !fence.failed.has(pairId) && fence.pending.size + fence.failed.size >= MAX_PEER_PAIRS) {
      throw new Error('peer revocation fence capacity exceeded');
    }
    fence.pending.set(pairId, (fence.pending.get(pairId) ?? 0) + 1);
    this.abortLeases(pairId);
    try {
      await this.transaction(async (state, save) => {
        const pair = state.pairs.find((item) => item.pairId === pairId);
        if (!pair) {
          if (!state.revokedIds.includes(pairId)) {
            if (state.pairs.length + state.revokedIds.length >= this.maxPairs) throw new Error('peer pair capacity exceeded');
            state.revokedIds.push(pairId);
          }
          await save();
          return;
        }
        if (pair.status !== 'revoked') {
          if (pair.epoch === Number.MAX_SAFE_INTEGER) throw new Error('peer epoch exhausted');
          pair.epoch++;
          pair.status = 'revoked';
          pair.secret = null;
        }
        // Retry uncertain writes durably, even if rename committed before fsync failed.
        await save();
        this.abortLeases(pairId);
      }, { validate: false, pairId });
      fence.failed.delete(pairId);
    } catch (error) { fence.failed.add(pairId); throw error; }
    finally {
      const pending = fence.pending.get(pairId)! - 1;
      if (pending) fence.pending.set(pairId, pending); else fence.pending.delete(pairId);
      if (fence.pending.size === 0 && fence.failed.size === 0) revocations.delete(id);
    }
  }

  async findForHost(targetHostId: string, pluginId?: string, scope?: string): Promise<PeerPairGrant | null> {
    if (!PEER_ID.test(targetHostId)) return null;
    return this.transaction(async (state) => {
      const matches = state.pairs.filter((pair) => pair.status === 'active' && !this.isFenced(pair.pairId) && pair.targetHostId === targetHostId &&
        (pluginId === undefined || pair.pluginId === pluginId) && (scope === undefined || pair.scope === scope));
      if (matches.length !== 1) return null;
      return publicGrant(matches[0]!);
    });
  }

  async list(pluginId: string): Promise<PeerPairGrant[]> {
    if (!PEER_TOKEN.test(pluginId)) throw new Error('invalid peer plugin');
    return this.transaction(async state => state.pairs
      .filter(pair => pair.status === 'active' && pair.pluginId === pluginId && !this.isFenced(pair.pairId))
      .map(publicGrant));
  }

  async signRequest(pairId: string, input: { pluginId: string; scope: string; method: string; body: Uint8Array }): Promise<PeerRequestEnvelope | null> {
    const pluginId = input.pluginId, payloadHash = peerBodyHash(input.body), route = peerRoute(pluginId, input.method), scope = input.scope;
    return this.transaction(async (state) => {
      const pair = state.pairs.find((item) => item.pairId === pairId && item.status === 'active');
      if (!pair || this.isFenced(pairId) || pair.pluginId !== pluginId || pair.scope !== scope) return null;
      const fields: PeerRequestFields = { protocolVersion: 2, pairId, senderId: pair.localInstanceId,
        recipientId: pair.remoteInstanceId, pluginId: pair.pluginId, scope: pair.scope, route, httpMethod: 'POST',
        payloadHash, nonce: randomBytes(PEER_NONCE_BYTES).toString('base64url'), issuedAt: this.now(), epoch: pair.epoch };
      validatePeerFields(fields);
      if (fields.issuedAt < state.replay.clock) throw new Error('peer clock moved backwards');
      return { ...fields, signature: this.mac(pair, fields).toString('base64url') };
    }, { pairId });
  }

  /** Sender obtains an epoch-bound cancellation lease for its public signed envelope. */
  async acquireGrant(pairId: string, epoch: number, pluginId: string, scope: string): Promise<PeerGrantLease | null> {
    return this.transaction(async (state) => {
      const pair = state.pairs.find((item) => item.pairId === pairId && item.status === 'active');
      if (!pair || this.isFenced(pairId) || pair.epoch !== epoch || pair.pluginId !== pluginId || pair.scope !== scope) return null;
      if ((leases.get(resolve(this.directory))?.size ?? 0) >= MAX_ACTIVE_LEASES) throw new Error('peer active stream capacity exceeded');
      return this.lease(pair);
    }, { pairId });
  }

  /** Validate host-selected route/plugin/scope and exact body before durable replay commit or dispatch. */
  async authenticateRequest(input: { envelope: PeerRequestEnvelope; body: Uint8Array; pluginId: string; scope: string; route: string; httpMethod: string }): Promise<PeerGrantLease | null> {
    const envelope = { ...input.envelope }, expected = { pluginId: input.pluginId, scope: input.scope, route: input.route, httpMethod: input.httpMethod };
    try {
      validatePeerFields(envelope);
      if (Object.keys(envelope).sort().join(',') !== 'epoch,httpMethod,issuedAt,nonce,pairId,payloadHash,pluginId,protocolVersion,recipientId,route,scope,senderId,signature' ||
        envelope.payloadHash !== peerBodyHash(input.body)) return null;
    } catch { return null; }
    return this.authenticateFields(envelope, expected);
  }

  private async authenticateFields(envelope: PeerRequestEnvelope, expected: { pluginId: string; scope: string; route: string; httpMethod: string }): Promise<PeerGrantLease | null> {
    return this.transaction(async (state, save) => {
      const pair = state.pairs.find((item) => item.pairId === envelope.pairId && item.status === 'active');
      if (!pair || this.isFenced(pair.pairId) || pair.localInstanceId !== envelope.recipientId || pair.remoteInstanceId !== envelope.senderId ||
        pair.pluginId !== envelope.pluginId || pair.scope !== envelope.scope || pair.epoch !== envelope.epoch ||
        expected.pluginId !== envelope.pluginId || expected.scope !== envelope.scope || expected.route !== envelope.route ||
        expected.httpMethod !== 'POST' || typeof envelope.signature !== 'string' || !PEER_DIGEST.test(envelope.signature)) return null;
      const actual = Buffer.from(envelope.signature, 'base64url');
      if (actual.toString('base64url') !== envelope.signature || !timingSafeEqual(this.mac(pair, envelope), actual)) return null;
      const id = resolve(this.directory);
      if ((leases.get(id)?.size ?? 0) >= MAX_ACTIVE_LEASES) throw new Error('peer active stream capacity exceeded');
      if (!consumeAuthenticatedNonce(state.replay, nonceFrom(envelope), this.now(), this.maxNonces)) return null;
      await save();
      if (this.disposed || this.isFenced(pair.pairId)) return null;
      return this.lease(pair);
    }, { pairId: envelope.pairId });
  }

  /** Compatibility adapter: raw signing is allowed only for validated outbound canonical bytes. */
  async sign(pairId: string, payload: Uint8Array): Promise<string | null> {
    let fields: PeerRequestFields;
    try { fields = parsePeerMac(payload); } catch { return null; }
    return this.transaction(async (state) => {
      const pair = state.pairs.find((item) => item.pairId === pairId && item.status === 'active');
      const now = this.now();
      if (!pair || this.isFenced(pairId) || fields.pairId !== pairId || fields.senderId !== pair.localInstanceId || fields.recipientId !== pair.remoteInstanceId ||
        fields.pluginId !== pair.pluginId || fields.scope !== pair.scope || fields.epoch !== pair.epoch || now < state.replay.clock ||
        fields.issuedAt <= now - PEER_REQUEST_TTL_MS || fields.issuedAt > now + PEER_FUTURE_SKEW_MS) return null;
      return this.mac(pair, fields).toString('base64url');
    }, { pairId });
  }

  /** Compatibility only. Receiving HTTP must migrate to authenticateRequest and retain its lease. */
  async verify(input: { pairId: string; peerId: string; capability: string; epoch: number; payload: Uint8Array; signature: string }): Promise<boolean> {
    let fields: PeerRequestFields;
    try { fields = parsePeerMac(input.payload); } catch { return false; }
    if (input.pairId !== fields.pairId || input.peerId !== fields.senderId || input.capability !== 'peer.forward' || input.epoch !== fields.epoch) return false;
    const lease = await this.authenticateFields({ ...fields, signature: input.signature }, fields);
    lease?.release();
    return lease !== null;
  }

  async exportCredential(pairId: string, context: unknown): Promise<Buffer> {
    return this.transaction(async (state) => {
      const pair = state.pairs.find((item) => item.pairId === pairId && item.status !== 'revoked');
      if (!pair || this.isFenced(pairId)) throw new Error('peer credential unavailable');
      const key = await this.transferKey(context, pair, 'export');
      const plain = Buffer.from(JSON.stringify({ pairId: pair.pairId, senderId: pair.localInstanceId, recipientId: pair.remoteInstanceId,
        pluginId: pair.pluginId, scope: pair.scope, epoch: pair.epoch, proposalId: pair.proposalId, secret: pair.secret }));
      try { return sealPeerBytes(plain, key, CREDENTIAL_TRANSFER_AAD); } finally { key.fill(0); plain.fill(0); }
    }, { pairId });
  }

  async importCredential(input: PeerPairInput, sealed: Uint8Array, context: unknown): Promise<PeerPairGrant> {
    const grant = normalizeGrant(input, this.localInstanceId, 'proposed');
    if (sealed.byteLength > MAX_CREDENTIAL_TRANSFER_BYTES) throw new Error('peer credential transfer too large');
    const bytes = Buffer.from(sealed);
    return this.transaction(async (state, save) => {
      if (state.revokedIds.includes(grant.pairId)) throw new Error('peer pair is revoked');
      if (this.isFenced(grant.pairId)) throw new Error('peer pair revocation pending or failed');
      const key = await this.transferKey(context, grant, 'import');
      let transfer;
      let plain: Buffer | undefined;
      try {
        plain = unsealPeerBytes(bytes, key, CREDENTIAL_TRANSFER_AAD);
        transfer = JSON.parse(plain.toString('utf8')) as Record<string, unknown>;
      } catch { throw new Error('invalid peer credential transfer'); } finally { key.fill(0); plain?.fill(0); }
      if (!transfer || Array.isArray(transfer) || Object.keys(transfer).sort().join(',') !== 'epoch,pairId,pluginId,proposalId,recipientId,scope,secret,senderId' ||
        transfer.pairId !== grant.pairId || transfer.senderId !== grant.remoteInstanceId || transfer.recipientId !== grant.localInstanceId ||
        transfer.pluginId !== grant.pluginId || transfer.scope !== grant.scope || transfer.epoch !== grant.epoch ||
        transfer.proposalId !== grant.proposalId || typeof transfer.secret !== 'string' || !validSecret(transfer.secret)) {
        throw new Error('peer credential transfer binding mismatch');
      }
      const existing = state.pairs.find((pair) => pair.pairId === grant.pairId);
      if (existing && existing.status !== 'revoked') {
        if (!sameGrant(existing, grant) || existing.secret !== transfer.secret) throw new Error('peer pair proposal conflicts');
        return publicGrant(existing);
      }
      if (existing && (grant.epoch !== existing.epoch || grant.proposalId === existing.proposalId ||
        !sameGrant({ ...existing, proposalId: grant.proposalId }, grant))) throw new Error('peer pair is revoked');
      if (!existing && state.pairs.length + state.revokedIds.length >= this.maxPairs) throw new Error('peer pair capacity exceeded');
      const record: StoredPair = { ...grant, secret: transfer.secret };
      if (existing) state.pairs[state.pairs.indexOf(existing)] = record; else state.pairs.push(record);
      await save();
      if (this.isFenced(grant.pairId)) throw new Error('peer pair is revoked');
      return publicGrant(record);
    }, { pairId: grant.pairId });
  }

  private async transferKey(context: unknown, grant: PeerPairGrant, operation: 'export' | 'import'): Promise<Buffer> {
    const { pairId, localInstanceId, remoteInstanceId, pluginId, scope, targetHostId, epoch, proposalId } = grant;
    let key;
    try {
      key = await this.options?.authorizeTransfer?.(context, Object.freeze({ operation, pairId, localInstanceId, remoteInstanceId,
        pluginId, scope, targetHostId, epoch, proposalId }));
    } catch { throw new Error('authenticated host credential channel unavailable'); }
    if (!key || key.byteLength !== 32) throw new Error('authenticated host credential channel unavailable');
    if (this.disposed || this.isFenced(pairId)) throw new Error('peer credential unavailable');
    return Buffer.from(key);
  }

  private mac(pair: StoredPair, fields: PeerRequestFields): Buffer {
    const secret = Buffer.from(pair.secret!, 'base64url');
    try { return createHmac('sha256', secret).update(canonicalPeerMac(fields)).digest(); } finally { secret.fill(0); }
  }

  private lease(pair: StoredPair): PeerGrantLease {
    const id = resolve(this.directory), controller = new AbortController(), grant = publicGrant(pair);
    let active = leases.get(id);
    if (!active) { active = new Map(); leases.set(id, active); }
    active.set(controller, { pairId: pair.pairId, epoch: pair.epoch });
    let released = false;
    return { grant, signal: controller.signal,
      assertActive: async () => {
        if (released || controller.signal.aborted) throw new Error('peer grant lease no longer active');
        const current = await this.grant(grant.pairId);
        if (!current || !sameGrant(current, grant) || controller.signal.aborted) {
          controller.abort();
          throw new Error('peer grant lease no longer active');
        }
      },
      commitSync: async (commit) => this.transaction(async (state) => {
        const current = state.pairs.find((item) => item.pairId === grant.pairId && item.status === 'active');
        if (released || controller.signal.aborted || this.isFenced(grant.pairId) || !current || !sameGrant(current, grant)) {
          controller.abort();
          throw new Error('peer grant lease no longer active');
        }
        if (commit.constructor.name === 'AsyncFunction') throw new Error('peer commit fence requires synchronous callback');
        const result = commit();
        if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('peer commit fence requires synchronous callback');
        return result;
      }, { pairId: grant.pairId }),
      commitWorkerSync: async (observe, signal) => this.transaction(async (state, _save, assertCurrent) => {
        const current = state.pairs.find(item => item.pairId === grant.pairId && item.status === 'active');
        if (released || controller.signal.aborted || signal.aborted || this.isFenced(grant.pairId) || !current || !sameGrant(current, grant)) {
          throw new Error('peer grant lease no longer active');
        }
        // QUEUED=0, RUNNING=1, CANCELLED=2. CAS admission is the linearization point.
        const gate = new SharedArrayBuffer(16), word = new Int32Array(gate);
        // Wall clock, not this.now: the worker thread checks this deadline with its own Date.now().
        Atomics.store(new BigInt64Array(gate, 8), 0, BigInt(Date.now() + PEER_COMMIT_LEASE_TIMEOUT_MS));
        const cancel = () => { Atomics.compareExchange(word, 0, 0, 2); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await observe(gate, () => {
            assertCurrent();
            if (released || controller.signal.aborted || signal.aborted || this.isFenced(grant.pairId) || Date.now() >= Number(Atomics.load(new BigInt64Array(gate, 8), 0)) ||
              Atomics.compareExchange(word, 0, 0, 1) !== 0) throw new Error('peer grant lease no longer active');
          });
          if (Atomics.load(word, 0) !== 1) throw new Error('peer grant lease no longer active');
          if (result.asynchronous) throw new Error('peer commit fence requires synchronous callback');
          return result.value;
        } finally {
          cancel();
          controller.signal.removeEventListener('abort', cancel);
          signal.removeEventListener('abort', cancel);
        }
      }, { pairId: grant.pairId }),
      release: () => {
        released = true;
        controller.abort(new Error('peer grant lease no longer active'));
        active!.delete(controller);
        if (active!.size === 0 && leases.get(id) === active) leases.delete(id);
      }
    };
  }

  private abortLeases(pairId?: string): void {
    const id = resolve(this.directory), active = leases.get(id);
    if (!active) return;
    for (const [controller, lease] of active) {
      if (pairId === undefined || lease.pairId === pairId) { controller.abort(); active.delete(controller); }
    }
    if (active.size === 0) leases.delete(id);
  }

  /**
   * `pairId` scopes lease aborts for errors raised by `run` (ordinary rejections such as conflicts or
   * capacity); storage, authority and enrollment-guard failures still abort every lease in the directory.
   * A newly inserted grant is not authority-checked here: it stays unusable until authority approves it, and
   * the next transaction revokes it if it does not.
   */
  private async transaction<T>(run: (state: PairState, save: () => Promise<void>, assertCurrent: () => void) => Promise<T>,
    { validate = true, pairId }: { validate?: boolean; pairId?: string } = {}): Promise<T> {
    if (this.disposed) throw new Error('peer pair store disposed');
    let inRun = false;
    try {
      const guards = new Map<string, { grant: PeerPairGrant; current: (() => boolean) | null }>();
      if (validate && this.options?.validateGrant) {
        // Never call authority while holding the pair mutex: authority invalidation may revoke this store.
        const snapshot = await this.storage.transaction(async state => state.pairs.filter(pair => pair.status !== 'revoked').map(publicGrant));
        for (const grant of snapshot) guards.set(grant.pairId, { grant, current: await this.options.validateGrant(grant) });
      }
      return await this.storage.transaction(async (state, save) => {
        if (this.disposed) throw new Error('peer pair store disposed');
        if (validate && this.options?.validateGrant) {
          const current = (pair: StoredPair) => {
            const guard = guards.get(pair.pairId);
            return !!guard?.current && sameGrant(pair, guard.grant) && guard.current();
          };
          // Invalid generations persist as revoked before any sign/auth/lease/commit callback.
          let changed = false;
          for (const pair of state.pairs) if (pair.status !== 'revoked' && guards.has(pair.pairId) && !current(pair)) {
            if (pair.epoch < Number.MAX_SAFE_INTEGER) pair.epoch++;
            pair.status = 'revoked'; pair.secret = null; this.abortLeases(pair.pairId); changed = true;
          }
          if (changed) await save();
          // Storage save yields; a rotation during it must not reach a synchronous consumer.
          for (const pair of state.pairs) if (pair.status !== 'revoked' && !current(pair)) throw new Error('peer enrollment changed');
        }
        const assertCurrent = () => {
          if (this.disposed) throw new Error('peer pair store disposed');
          if (validate && this.options?.validateGrant) for (const pair of state.pairs) {
            const guard = guards.get(pair.pairId);
            if (pair.status !== 'revoked' && (!guard?.current || !sameGrant(pair, guard.grant) || !guard.current())) {
              this.abortLeases(pair.pairId); throw new Error('peer enrollment changed');
            }
          }
        };
        inRun = true;
        const result = await run(state, save, assertCurrent);
        inRun = false;
        if (validate && this.options?.validateGrant) for (const pair of state.pairs) {
          const guard = guards.get(pair.pairId);
          if ((pair.status !== 'revoked' && guard && (!guard.current || !guard.current())) || this.isFenced(pair.pairId)) {
            this.abortLeases(pair.pairId); throw new Error('peer enrollment changed or revoked');
          }
        }
        return result;
      });
    }
    catch (error) { this.abortLeases(inRun ? pairId : undefined); throw error; }
  }

  dispose(): void { this.disposed = true; this.abortLeases(); this.storage.dispose(); }
  whenIdle(): Promise<void> { return this.storage.whenIdle(); }

  private isFenced(pairId: string): boolean {
    const fence = revocations.get(resolve(this.directory));
    return !!fence && (fence.pending.has(pairId) || fence.failed.has(pairId));
  }

  private validateState(value: unknown): PairState {
    const state = value as PairState;
    if (!state || Object.keys(state).sort().join(',') !== 'localInstanceId,pairs,replay,revokedIds,version' || state.version !== 2 ||
      state.localInstanceId !== this.localInstanceId || !Array.isArray(state.pairs) || state.pairs.length > MAX_PEER_PAIRS ||
      !Array.isArray(state.revokedIds) || state.pairs.length + state.revokedIds.length > MAX_PEER_PAIRS ||
      state.revokedIds.some(id => typeof id !== 'string' || !PEER_ID.test(id)) || new Set(state.revokedIds).size !== state.revokedIds.length ||
      !state.replay || Object.keys(state.replay).sort().join(',') !== 'clock,nonces') throw new Error('invalid peer pair storage');
    const ids = new Set<string>();
    const epochs = new Map<string, { senderId: string; epoch: number }>();
    for (const pair of state.pairs) {
      if (!pair || Object.keys(pair).sort().join(',') !== 'capability,epoch,localInstanceId,pairId,peerId,pluginId,proposalId,remoteInstanceId,scope,secret,status,targetHostId') throw new Error('invalid peer pair record');
      validateGrant(pair);
      if (pair.localInstanceId !== this.localInstanceId || ids.has(pair.pairId) || state.revokedIds.includes(pair.pairId) ||
        (pair.status === 'revoked' ? pair.secret !== null : !validSecret(pair.secret))) throw new Error('invalid peer pair record');
      ids.add(pair.pairId);
      epochs.set(pair.pairId, { senderId: pair.remoteInstanceId, epoch: pair.epoch });
    }
    validateReplayState(state.replay);
    if (state.replay.nonces.some((nonce) => {
      const pair = epochs.get(nonce.pairId);
      return !pair || pair.senderId !== nonce.senderId || nonce.epoch > pair.epoch;
    })) throw new Error('invalid peer replay binding');
    return state;
  }
}

function validSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && PEER_DIGEST.test(secret) && Buffer.from(secret, 'base64url').toString('base64url') === secret;
}
