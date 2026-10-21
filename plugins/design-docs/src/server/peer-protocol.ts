import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonicalPeerHash, type PeerAppliedReceipt, type PeerOperation, type PeerVersion,
  PeerProtocolError, validateDocumentClosure, validatePeerPacket } from '../shared/peer-contract.js';
import { MAX_PEER_SESSION_OPERATIONS, MAX_PEER_PAGE_OPERATIONS, MAX_PEER_SESSION_BYTES, PEER_PROTOCOL_VERSION, PEER_MIN_PROTOCOL_VERSION, PEER_DELTA_PROTOCOL_VERSION,
   MAX_PEER_CHUNK_BYTES, MAX_PEER_SESSION_BLOBS, MAX_PEER_TRANSFER_BYTES, MAX_PEER_CLOSURE_BYTES } from '../shared/peer-limits.js';

export interface PeerHandshake {
  protocolVersion: number; repoId: string; senderReplicaId: string; recipientReplicaId: string;
  grantEpoch: number; groupId: string; rosterEpoch: number; rosterDigest?: string;
}
/**
 * Protocol-3 ancestor stubs: operation rows of compacted ancestry, carried without payload or blobs so DAG
 * integrity and merge-base search survive compaction. A stub is never readable content on either side.
 */
export interface PeerAncestorStubs { stubs?: PeerOperation[] }
export interface PeerSessionOffer extends PeerHandshake, PeerAncestorStubs {
  sessionId: string; versions: PeerVersion[]; heads: Record<string, string>; scopeHash: string;
  /**
   * Set by the sender when this frozen head belongs to an outbound manual ("private") session for the
   * document. Receiver-visible advisory: it only ADDS the bilateral-consent gate for the no-inbound-session
   * case and is deliberately excluded from scopeHash/transferQuery, so it can never weaken protection
   * (accepted inbound sessions are still gated independently) nor perturb persisted session hashes.
   */
  manual?: boolean;
}
export interface PeerTransfer extends PeerHandshake, PeerAncestorStubs {
  sessionId: string; scopeHash: string; heads: Record<string, string>;
  versions: Array<{ operation: PeerOperation; manifestHash: string }>;
  blobs: Array<{ hash: string; bytes: number }>;
  /** See PeerSessionOffer.manual — same receiver-visible private-session marker, excluded from the transfer hash. */
  manual?: boolean;
}
/** Older stub ancestry that does not fit one inline page; delivered roots-first before the offer or transfer. */
export interface PeerAncestryPage extends PeerHandshake { docId: string; stubs: PeerOperation[] }
export interface PeerChunk extends PeerHandshake {
  sessionId: string; scopeHash: string; blobHash: string; index: number; chunkHash: string; content: string;
}
export type PeerReceiptQuery = PeerHandshake & { sessionId: string; scopeHash: string };
export interface PeerMissing { chunks: Array<{ blobHash: string; index: number }>; }
export interface PeerManualConsent extends PeerHandshake { manualId: string; heads: Record<string, string>; }
/**
 * Resolves an operation the receiver already holds to its document id. Only protocol-3 delta offers consult it:
 * an omitted parent is acceptable solely when the receiver holds that exact operation for the same document.
 */
export type LocalParentResolver = (operationId: string) => string | null;
export interface PeerSessionExpectation {
  repoId: string; localReplicaId: string; remoteReplicaId: string; grantEpoch: number;
  groupId: string; rosterEpoch: number; rosterDigest?: string;
}
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const handshakeSchema = z.object({ protocolVersion: z.number().int().min(PEER_MIN_PROTOCOL_VERSION).max(PEER_PROTOCOL_VERSION), repoId: id,
  senderReplicaId: id, recipientReplicaId: id, grantEpoch: z.number().int().positive().safe(),
  groupId: id, rosterEpoch: z.number().int().positive().safe(), rosterDigest: hash.optional() });
const operationSchema = z.object({ id, replicaId: id, sequence: z.number().int().positive().safe(), docId: id,
  parents: z.array(id).max(8), kind: z.enum(['document', 'delete']), payloadHash: hash,
  origin: z.enum(['local-authoring', 'inbound', 'bootstrap', 'import', 'restore-undo', 'maintenance']) }).strict();
const headsSchema = z.record(id, id).refine((value) => Object.keys(value).length <= MAX_PEER_SESSION_OPERATIONS);
const stubsSchema = z.array(operationSchema).min(1).max(MAX_PEER_PAGE_OPERATIONS);
export function validateManualConsent(input: unknown, expected: PeerSessionExpectation): PeerManualConsent {
  validateHandshake(input, expected);
  const parsed = handshakeSchema.extend({ manualId: id, heads: headsSchema }).strict().safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid manual consent');
  return parsed.data;
}
const offerSchema = handshakeSchema.extend({ sessionId: id, versions: z.array(z.object({
  operation: operationSchema, closure: z.unknown() }).strict()).max(MAX_PEER_SESSION_OPERATIONS),
  heads: headsSchema, scopeHash: hash, stubs: stubsSchema.optional(), manual: z.boolean().optional() }).strict();
const transferSchema = handshakeSchema.extend({ sessionId: id, scopeHash: hash, heads: headsSchema,
  versions: z.array(z.object({ operation: operationSchema, manifestHash: hash }).strict()).min(1).max(MAX_PEER_SESSION_OPERATIONS),
  blobs: z.array(z.object({ hash, bytes: z.number().int().nonnegative().max(MAX_PEER_CLOSURE_BYTES) }).strict()).min(1).max(MAX_PEER_SESSION_BLOBS),
  stubs: stubsSchema.optional(), manual: z.boolean().optional()
}).strict();
const ancestrySchema = handshakeSchema.extend({ docId: id, stubs: stubsSchema }).strict();
const querySchema = handshakeSchema.extend({ sessionId: id, scopeHash: hash }).strict();
const chunkSchema = querySchema.extend({ blobHash: hash, index: z.number().int().nonnegative().max(Math.ceil(MAX_PEER_CLOSURE_BYTES / MAX_PEER_CHUNK_BYTES)),
  chunkHash: hash, content: z.string().max(Math.ceil(MAX_PEER_CHUNK_BYTES / 3) * 4) }).strict();

/**
 * Handshakes open at the oldest shared version and advertise `maxProtocolVersion`; protocol-2 peers ignore the
 * extra key and answer 2, protocol-3 peers answer the highest version both sides speak.
 */
export function negotiateProtocol(packet: { protocolVersion: number; maxProtocolVersion?: unknown }): number {
  const offered = packet.maxProtocolVersion;
  if (!Number.isInteger(offered) || (offered as number) <= packet.protocolVersion) return packet.protocolVersion;
  return Math.min(offered as number, PEER_PROTOCOL_VERSION);
}

/** Delta offers may omit parents; a parent outside the offer must be held locally for the same document. */
function parentDoc(parent: string, offered: string | undefined, protocolVersion: number, local?: LocalParentResolver): string | null | undefined {
  if (offered !== undefined) return offered;
  return protocolVersion >= PEER_DELTA_PROTOCOL_VERSION && local ? local(parent) : undefined;
}

/**
 * Stubs are ancestry-closed and topologically ordered: every parent is an earlier stub or an operation the receiver
 * already holds for the same document. Ordering alone rules out cycles; only delta (protocol-3) packets may carry them.
 */
function validateStubs(stubs: unknown[] | undefined, protocolVersion: number, sequences: Set<string>, local?: LocalParentResolver): Map<string, PeerOperation> {
  const result = new Map<string, PeerOperation>();
  if (stubs === undefined) return result;
  if (protocolVersion < PEER_DELTA_PROTOCOL_VERSION) throw new PeerProtocolError('invalid', 'ancestor stubs require delta protocol');
  for (const input of stubs) {
    const operation = validateOperation(input), sequence = `${operation.replicaId}:${operation.sequence}`;
    if (result.has(operation.id) || sequences.has(sequence)) throw new PeerProtocolError('invalid', 'duplicate ancestor stub identity');
    for (const parent of operation.parents) if ((result.get(parent)?.docId ?? local?.(parent) ?? null) !== operation.docId) {
      throw new PeerProtocolError('invalid', 'ancestor stub parent is missing, out of order or cross-document');
    }
    result.set(operation.id, operation);
    sequences.add(sequence);
  }
  return result;
}

/** Binds stubs into a scope hash only when present, so stub-free hashes stay unchanged. */
function stubScope(carrier: PeerAncestorStubs): PeerAncestorStubs {
  return carrier.stubs !== undefined ? { stubs: carrier.stubs } : {};
}

export function validateAncestryPage(input: unknown, expected: PeerSessionExpectation, local?: LocalParentResolver): PeerAncestryPage {
  validateHandshake(input, expected);
  const parsed = ancestrySchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid ancestor stub page');
  const page = parsed.data;
  const stubs = validateStubs(page.stubs, page.protocolVersion, new Set(), local);
  if ([...stubs.values()].some((stub) => stub.docId !== page.docId)) throw new PeerProtocolError('invalid', 'ancestor stub page spans documents');
  return page;
}

export function peerBlobHash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export function validateReceiptQuery(input: unknown, expected: PeerSessionExpectation): PeerReceiptQuery {
  validateHandshake(input, expected);
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid receipt query');
  return parsed.data;
}

export function transferQuery(transfer: PeerReceiptQuery): PeerReceiptQuery {
  return { protocolVersion: transfer.protocolVersion, repoId: transfer.repoId,
    senderReplicaId: transfer.senderReplicaId, recipientReplicaId: transfer.recipientReplicaId,
    groupId: transfer.groupId, rosterEpoch: transfer.rosterEpoch, grantEpoch: transfer.grantEpoch,
    ...(transfer.rosterDigest !== undefined ? { rosterDigest: transfer.rosterDigest } : {}),
    sessionId: transfer.sessionId, scopeHash: transfer.scopeHash };
}

export function createTransferHash(transfer: Omit<PeerTransfer, 'scopeHash'>): string {
  const { scopeHash: _scopeHash, ...routing } = transferQuery({ ...transfer, scopeHash: '' });
  return canonicalPeerHash({ ...routing,
    versions: transfer.versions, heads: transfer.heads, blobs: transfer.blobs, ...stubScope(transfer) });
}

export function validateTransfer(input: unknown, expected: PeerSessionExpectation, local?: LocalParentResolver): PeerTransfer {
  validateHandshake(input, expected);
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid chunk transfer manifest');
  const transfer = parsed.data;
  const blobs = new Map(transfer.blobs.map((blob) => [blob.hash, blob.bytes]));
  if (blobs.size !== transfer.blobs.length || transfer.blobs.reduce((sum, blob) => sum + blob.bytes, 0) > MAX_PEER_TRANSFER_BYTES) {
    throw new PeerProtocolError('limit', 'transfer aggregate blob budget exceeded');
  }
  const versions = new Map<string, PeerOperation>(), sequences = new Set<string>();
  const stubs = validateStubs(transfer.stubs, transfer.protocolVersion, sequences, local);
  for (const version of transfer.versions) {
    const operation = validateOperation(version.operation);
    if (!blobs.has(version.manifestHash) || versions.has(operation.id) || stubs.has(operation.id) || sequences.has(`${operation.replicaId}:${operation.sequence}`)) {
      throw new PeerProtocolError('invalid', 'missing manifest or duplicate transfer operation');
    }
    for (const parent of operation.parents) if (parentDoc(parent, versions.get(parent)?.docId ?? stubs.get(parent)?.docId, transfer.protocolVersion, local) !== operation.docId) {
      throw new PeerProtocolError('invalid', 'missing or cross-document transfer ancestry');
    }
    versions.set(operation.id, operation);
    sequences.add(`${operation.replicaId}:${operation.sequence}`);
  }
  const reachable = new Set<string>(), pending = Object.entries(transfer.heads).map(([docId, head]) => {
    if (versions.get(head)?.docId !== docId) throw new PeerProtocolError('invalid', 'transfer frozen head mismatch');
    return head;
  });
  while (pending.length) {
    const head = pending.pop()!;
    if (reachable.has(head)) continue;
    // Omitted delta parents were verified above as locally held; traversal stops at the offer boundary.
    const version = versions.get(head) ?? stubs.get(head);
    if (!version) continue;
    reachable.add(head); pending.push(...version.parents);
  }
  if (reachable.size !== versions.size + stubs.size) throw new PeerProtocolError('invalid', 'transfer contains unoffered versions');
  if (transfer.scopeHash !== createTransferHash(transfer)) throw new PeerProtocolError('conflict', 'transfer scope hash mismatch');
  return transfer;
}

export function validateMissing(input: unknown, transfer: PeerTransfer): PeerMissing {
  const parsed = z.object({ chunks: z.array(z.object({ blobHash: hash, index: z.number().int().nonnegative() }).strict())
    .max(MAX_PEER_SESSION_BYTES / MAX_PEER_CHUNK_BYTES) }).strict().safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid missing chunk window');
  const seen = new Set<string>(), blobs = new Map(transfer.blobs.map((blob) => [blob.hash, blob]));
  for (const chunk of parsed.data.chunks) {
    const blob = blobs.get(chunk.blobHash), key = `${chunk.blobHash}:${chunk.index}`;
    if (!blob || chunk.index >= Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES) || seen.has(key)) {
      throw new PeerProtocolError('invalid', 'missing chunk outside frozen transfer');
    }
    seen.add(key);
  }
  return parsed.data;
}

export function validateChunk(input: unknown, expected: PeerSessionExpectation): { packet: PeerChunk; bytes: Buffer } {
  validateHandshake(input, expected);
  const parsed = chunkSchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid peer chunk');
  const packet = parsed.data, bytes = Buffer.from(packet.content, 'base64');
  if (bytes.length > MAX_PEER_CHUNK_BYTES || bytes.toString('base64') !== packet.content) {
    throw new PeerProtocolError('invalid', 'chunk content is not bounded canonical base64');
  }
  if (peerBlobHash(bytes) !== packet.chunkHash) throw new PeerProtocolError('conflict', 'chunk hash mismatch');
  return { packet, bytes };
}

export function validateOperation(input: unknown): PeerOperation {
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid payload operation');
  const operation = parsed.data;
  if (new Set(operation.parents).size !== operation.parents.length || operation.parents.includes(operation.id) ||
    operation.parents.join(',') !== [...operation.parents].sort().join(',')) {
    throw new PeerProtocolError('invalid', 'invalid operation parents');
  }
  return operation;
}

export function validateHandshake(input: unknown, expected: PeerSessionExpectation): asserts input is PeerHandshake {
  validatePeerPacket(input);
  const parsed = handshakeSchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid peer handshake');
  const value = parsed.data;
  if (value.repoId !== expected.repoId || value.senderReplicaId !== expected.remoteReplicaId ||
    value.recipientReplicaId !== expected.localReplicaId || value.grantEpoch !== expected.grantEpoch ||
    value.groupId !== expected.groupId || value.rosterEpoch !== expected.rosterEpoch ||
    (expected.rosterDigest !== undefined && value.rosterDigest !== expected.rosterDigest)) {
    throw new PeerProtocolError('invalid', 'peer handshake identity or authorization does not match');
  }
}

export function validateSessionOffer(input: unknown, expected: PeerSessionExpectation, local?: LocalParentResolver): PeerSessionOffer {
  validateHandshake(input, expected);
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'peer session requires immutable payloads and frozen heads');
  const offer = parsed.data as PeerSessionOffer;
  const versions = new Map<string, PeerVersion>();
  const sequences = new Set<string>();
  const stubs = validateStubs(offer.stubs, offer.protocolVersion, sequences, local);
  let total = 0;
  for (const version of offer.versions) {
    const operation = validateOperation(version.operation);
    version.closure = validateDocumentClosure(version.closure);
    total += version.closure.files.reduce((sum, file) => sum + file.size, 0) +
      version.closure.history.reduce((sum, row) => sum + row.size, 0);
    if (total > MAX_PEER_SESSION_BYTES) throw new PeerProtocolError('limit', 'peer session exceeds decoded content limit');
    if (operation.docId !== version.closure.doc.id || canonicalPeerHash(version.closure) !== operation.payloadHash) {
      throw new PeerProtocolError('conflict', 'document payload hash or identity does not match');
    }
    const sequence = `${operation.replicaId}:${operation.sequence}`;
    if (versions.has(operation.id) || stubs.has(operation.id) || sequences.has(sequence)) throw new PeerProtocolError('invalid', 'duplicate operation identity');
    for (const parent of operation.parents) {
      if (parentDoc(parent, versions.get(parent)?.operation.docId ?? stubs.get(parent)?.docId, offer.protocolVersion, local) !== operation.docId) {
        throw new PeerProtocolError('invalid', 'missing, out-of-order or cross-document parent');
      }
    }
    versions.set(operation.id, version);
    sequences.add(sequence);
  }
  const reachable = new Set<string>();
  // Iterative: a peer-controlled linear history up to MAX_PEER_SESSION_OPERATIONS deep must not overflow the call stack.
  for (const [docId, head] of Object.entries(offer.heads)) {
    if (versions.get(head)?.operation.docId !== docId) throw new PeerProtocolError('invalid', 'frozen head document mismatch');
    const pending = [head];
    while (pending.length) {
      const next = pending.pop()!;
      if (reachable.has(next)) continue;
      const operation = versions.get(next)?.operation ?? stubs.get(next);
      // Heads are checked against the offer above; any other absent node is a verified locally held delta parent.
      if (!operation) continue;
      reachable.add(next);
      pending.push(...operation.parents);
    }
  }
  if (!reachable.size || reachable.size !== versions.size + stubs.size) throw new PeerProtocolError('invalid', 'payload outside frozen closure');
  if (offer.scopeHash !== createScopeHash(offer)) throw new PeerProtocolError('conflict', 'peer session scope hash does not match');
  return offer;
}

export function createScopeHash(offer: Omit<PeerSessionOffer, 'scopeHash'>): string {
  // Each immutable payload is separately hashed; scope binds every routing fence and head.
  return canonicalPeerHash({ protocolVersion: offer.protocolVersion, repoId: offer.repoId,
    senderReplicaId: offer.senderReplicaId, recipientReplicaId: offer.recipientReplicaId,
    grantEpoch: offer.grantEpoch, groupId: offer.groupId, rosterEpoch: offer.rosterEpoch,
    // Omit absent digests so persisted unmanaged session hashes remain unchanged.
    ...(offer.rosterDigest !== undefined ? { rosterDigest: offer.rosterDigest } : {}),
    sessionId: offer.sessionId, heads: offer.heads, versions: offer.versions.map(({ operation }) => operation), ...stubScope(offer) });
}

export function createCheckpointHash(receipt: Omit<PeerAppliedReceipt, 'checkpointHash'>): string {
  return canonicalPeerHash(receipt);
}

export function validateAppliedReceipt(input: unknown, offer: Pick<PeerSessionOffer, 'sessionId' | 'scopeHash' | 'heads'>): PeerAppliedReceipt {
  const parsed = z.object({ sessionId: id, scopeHash: hash, checkpointHash: hash,
    stage: z.enum(['received', 'merged', 'synced', 'conflict', 'blocked']), heads: headsSchema,
    appliedHeads: headsSchema }).strict().safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid durable receipt');
  const receipt = parsed.data;
  const { checkpointHash, ...body } = receipt;
  if (receipt.sessionId !== offer.sessionId || receipt.scopeHash !== offer.scopeHash ||
    canonicalPeerHash(receipt.heads) !== canonicalPeerHash(offer.heads) || checkpointHash !== createCheckpointHash(body) ||
    (receipt.stage === 'synced' && canonicalPeerHash(receipt.appliedHeads) !== canonicalPeerHash(offer.heads))) {
    throw new PeerProtocolError('conflict', 'receipt does not verify applied frozen heads');
  }
  return receipt;
}
