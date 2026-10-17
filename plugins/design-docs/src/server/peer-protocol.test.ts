import { describe, expect, it } from 'vitest';
import { createScopeHash, createCheckpointHash, createTransferHash, peerBlobHash, transferQuery,
    validateChunk, validateTransfer, validateAppliedReceipt, validateHandshake, validateSessionOffer, validateMissing, validateManualConsent, validateReceiptQuery } from './peer-protocol.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_SESSION_BYTES } from '../shared/peer-limits.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';
import { createTestDatabase } from './test-db.js';
import { canonicalPeerHash } from '../shared/peer-contract.js';

function fixture() {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
  sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, joinedAt: 1, sponsorReplicaId: null })));
  store.create({ title: 'Payload', status: 'approved', template: 'blank' }, { kind: 'user', label: 'You', threadId: null });
  const offer = new DesignDocPeerService(sync).createOffer(sync.readyIntents('repo')[0]!);
  return { offer, expected: { repoId: 'repo', localReplicaId: 'replica-b', remoteReplicaId: 'replica-a', grantEpoch: 1, groupId: 'group', rosterEpoch: 1 } };
}

describe('payload protocol', () => {
  it('requires exact managed digest across every routing schema, including missing and malformed values', () => {
    const { offer, expected } = fixture(), rosterDigest = 'a'.repeat(64);
    const managed = { ...offer, rosterDigest }, expectation = { ...expected, rosterDigest };
    managed.scopeHash = createScopeHash(managed);
    const query = transferQuery(managed);
    const manual = { ...query, manualId: 'manual', heads: managed.heads };
    const { sessionId: _session, scopeHash: _scope, ...consent } = manual;
    const bytes = Buffer.from('chunk');
    const chunk = { ...query, blobHash: peerBlobHash(bytes), chunkHash: peerBlobHash(bytes), index: 0, content: bytes.toString('base64') };
    const transfer = { ...managed, versions: managed.versions.map(({ operation }) => ({ operation, manifestHash: 'b'.repeat(64) })),
      blobs: [{ hash: 'b'.repeat(64), bytes: 1 }] };
    transfer.scopeHash = createTransferHash(transfer);
    for (const [packet, validate] of [
      [managed, validateHandshake], [managed, validateSessionOffer], [query, validateReceiptQuery],
      [consent, validateManualConsent], [chunk, validateChunk], [transfer, validateTransfer]
    ] as const) {
      expect(() => validate(packet, expectation)).not.toThrow();
      const { rosterDigest: _digest, ...omitted } = packet;
      expect(() => validate(omitted, expectation)).toThrow('authorization');
      expect(() => validate({ ...packet, rosterDigest: 'c'.repeat(64) }, expectation)).toThrow('authorization');
      for (const invalid of [null, 42, '', 'A'.repeat(64), 'a'.repeat(63)]) {
        expect(() => validate({ ...packet, rosterDigest: invalid }, expected)).toThrow('handshake');
      }
    }
  });
  it('binds offer and transfer scope hashes to digest without changing absent-digest persisted hashes', () => {
    const { offer } = fixture();
    const legacy = { protocolVersion: offer.protocolVersion, repoId: offer.repoId, senderReplicaId: offer.senderReplicaId,
      recipientReplicaId: offer.recipientReplicaId, grantEpoch: offer.grantEpoch, groupId: offer.groupId,
      rosterEpoch: offer.rosterEpoch, sessionId: offer.sessionId, heads: offer.heads, versions: offer.versions.map(({ operation }) => operation) };
    expect(createScopeHash(offer)).toBe(canonicalPeerHash(legacy));
    const transfer = { ...offer, versions: offer.versions.map(({ operation }) => ({ operation, manifestHash: 'b'.repeat(64) })),
      blobs: [{ hash: 'b'.repeat(64), bytes: 1 }] };
    const { scopeHash: _scope, ...routing } = transferQuery(transfer);
    expect(createTransferHash(transfer)).toBe(canonicalPeerHash({ ...routing, versions: transfer.versions, heads: transfer.heads, blobs: transfer.blobs }));
    const left = { ...offer, rosterDigest: 'a'.repeat(64) }, right = { ...offer, rosterDigest: 'b'.repeat(64) };
    expect(transferQuery(left)).toHaveProperty('rosterDigest', left.rosterDigest);
    expect(transferQuery(offer)).not.toHaveProperty('rosterDigest');
    expect(createScopeHash(left)).not.toBe(createScopeHash(right));
    expect(createScopeHash(left)).not.toBe(createScopeHash(offer));
    expect(createTransferHash({ ...transfer, rosterDigest: left.rosterDigest })).not.toBe(createTransferHash({ ...transfer, rosterDigest: right.rosterDigest }));
  });
  it('strictly validates bounded chunk bytes, canonical base64 and hashes', () => {
    const { offer, expected } = fixture();
    const bytes = Buffer.alloc(MAX_PEER_CHUNK_BYTES, 17);
    const chunk = { ...transferQuery(offer), blobHash: peerBlobHash(bytes), index: 0,
      chunkHash: peerBlobHash(bytes), content: bytes.toString('base64') };
    expect(validateChunk(chunk, expected).bytes).toEqual(bytes);
    for (const patch of [{ index: -1 }, { content: chunk.content + '=' }, { content: '!!!!' },
      { chunkHash: 'f'.repeat(64) }, { unknown: true }, { content: Buffer.alloc(MAX_PEER_CHUNK_BYTES + 1).toString('base64') }]) {
      expect(() => validateChunk({ ...chunk, ...patch }, expected)).toThrow();
    }
  });
  it('binds transfer descriptor budget, identity, operation closure and frozen heads', () => {
    const { offer, expected } = fixture();
    const { versions: _versions, ...routing } = offer;
    const base = { ...routing, versions: offer.versions.map(({ operation }) => ({ operation, manifestHash: 'a'.repeat(64) })),
      blobs: [{ hash: 'a'.repeat(64), bytes: 123 }] };
    const transfer = { ...base, scopeHash: createTransferHash(base) };
    expect(validateTransfer(transfer, expected)).toEqual(transfer);
    for (const patch of [{ blobs: [{ hash: 'a'.repeat(64), bytes: MAX_PEER_SESSION_BYTES }, { hash: 'b'.repeat(64), bytes: 1 }] },
      { blobs: [base.blobs[0], base.blobs[0]] }, { blobs: [{ hash: 'b'.repeat(64), bytes: 1 }] },
      { versions: [...base.versions, ...base.versions] }, { heads: {} }, { scopeHash: 'f'.repeat(64) }, { extra: true }]) {
      expect(() => validateTransfer({ ...transfer, ...patch }, expected)).toThrow();
    }
  });
  it('accepts exact closure and independently validates scope hash', () => {
    const { offer, expected } = fixture();
    expect(validateSessionOffer(offer, expected)).toEqual(offer);
    expect(() => validateSessionOffer({ ...offer, scopeHash: 'f'.repeat(64) }, expected)).toThrow('scope hash');
  });
  it('walks a linear parent chain iteratively and rejects payloads outside the frozen closure', () => {
    const { offer, expected } = fixture();
    const DEEP = 300, base = offer.versions[0]!, docId = base.operation.docId;
    const versions = Array.from({ length: DEEP }, (_, i) => ({ ...base,
      operation: { ...base.operation, id: `deep-${i}`, sequence: i + 1, parents: i ? [`deep-${i - 1}`] : [] } }));
    const deep = { ...offer, versions, heads: { [docId]: `deep-${DEEP - 1}` } };
    deep.scopeHash = createScopeHash(deep);
    expect(validateSessionOffer(deep, expected).versions).toHaveLength(DEEP);
    const stray = { ...base, operation: { ...base.operation, id: 'stray', sequence: DEEP + 1, parents: [] } };
    const orphan = { ...deep, versions: [stray, ...versions] };
    orphan.scopeHash = createScopeHash(orphan);
    expect(() => validateSessionOffer(orphan, expected)).toThrow('payload outside frozen closure');
  });
  it('bounds missing windows and rejects unoffered, duplicate, overflowing chunks', () => {
    const { offer } = fixture();
    const transfer = { ...offer, versions: offer.versions.map(({ operation }) => ({ operation, manifestHash: 'a'.repeat(64) })),
      blobs: [{ hash: 'a'.repeat(64), bytes: MAX_PEER_CHUNK_BYTES + 1 }] };
    expect(validateMissing({ chunks: [{ blobHash: 'a'.repeat(64), index: 1 }] }, transfer).chunks).toHaveLength(1);
    for (const chunks of [
      [{ blobHash: 'b'.repeat(64), index: 0 }], [{ blobHash: 'a'.repeat(64), index: 2 }],
      [{ blobHash: 'a'.repeat(64), index: 0 }, { blobHash: 'a'.repeat(64), index: 0 }],
      Array.from({ length: 129 }, (_, index) => ({ blobHash: 'a'.repeat(64), index })),
      [{ blobHash: 'a'.repeat(64), index: -1 }]
    ]) expect(() => validateMissing({ chunks }, transfer)).toThrow();
    expect(() => validateMissing({ chunks: [], extra: true }, transfer)).toThrow();
  });
  it('binds manual consent to strict routing and frozen head declaration', () => {
    const { offer, expected } = fixture();
    const { versions: _versions, scopeHash: _hash, sessionId: _session, ...body } = offer;
    const manual = { ...body, manualId: 'manual' };
    expect(validateManualConsent(manual, expected)).toEqual(manual);
    expect(() => validateManualConsent({ ...manual, manualId: '../bad' }, expected)).toThrow('manual consent');
    expect(() => validateManualConsent({ ...manual, grantEpoch: 2 }, expected)).toThrow('authorization');
  });
  it.each(['repoId', 'senderReplicaId', 'recipientReplicaId', 'groupId', 'grantEpoch', 'rosterEpoch'])('rejects substituted %s', (field) => {
    const { offer, expected } = fixture();
    expect(() => validateHandshake({ ...offer, [field]: typeof offer[field as keyof typeof offer] === 'number' ? 7 : 'substitute' }, expected)).toThrow('identity');
  });
  it('rejects old metadata-only protocol and unknown fields/kinds', () => {
    const { offer, expected } = fixture();
    expect(() => validateSessionOffer({ ...offer, protocolVersion: 1 }, expected)).toThrow('unsupported');
    expect(() => validateSessionOffer({ ...offer, sql: 'DROP TABLE docs' }, expected)).toThrow();
    expect(() => validateSessionOffer({ ...offer, versions: undefined, operations: [] }, expected)).toThrow();
    const invalid = structuredClone(offer); invalid.versions[0]!.operation.kind = 'delete';
    expect(() => validateSessionOffer(invalid, expected)).toThrow();
  });
  it('rejects invalid sequence, self/missing parents, duplicate ops and doc/heads mismatch', () => {
    const { offer, expected } = fixture();
    for (const patch of [{ sequence: 0 }, { parents: [offer.versions[0]!.operation.id] }, { parents: ['missing'] }, { docId: 'other' }]) {
      const bad = structuredClone(offer); Object.assign(bad.versions[0]!.operation, patch);
      bad.scopeHash = createScopeHash(bad);
      expect(() => validateSessionOffer(bad, expected)).toThrow();
    }
    expect(() => validateSessionOffer({ ...offer, versions: [...offer.versions, ...offer.versions] }, expected)).toThrow('duplicate');
    expect(() => validateSessionOffer({ ...offer, heads: { other: offer.versions[0]!.operation.id } }, expected)).toThrow('mismatch');
    expect(() => validateSessionOffer({ ...offer, heads: {} }, expected)).toThrow('outside');
  });
  it('checks actual payload bytes even when attacker recomputes scope hash', () => {
    const { offer, expected } = fixture();
    const bad = structuredClone(offer);
    bad.versions[0]!.closure.doc.title = 'changed';
    bad.scopeHash = createScopeHash(bad);
    expect(() => validateSessionOffer(bad, expected)).toThrow('payload hash');
    bad.versions[0]!.operation.payloadHash = canonicalPeerHash(bad.versions[0]!.closure);
    bad.scopeHash = createScopeHash(bad);
    expect(validateSessionOffer(bad, expected)).toEqual(bad);
  });
  it('accepts only verified frozen-head durable receipts, never received/merged as synced', () => {
    const { offer } = fixture();
    const body = { sessionId: offer.sessionId, scopeHash: offer.scopeHash, stage: 'synced' as const, heads: offer.heads, appliedHeads: offer.heads };
    const receipt = { ...body, checkpointHash: createCheckpointHash(body) };
    expect(validateAppliedReceipt(receipt, offer)).toEqual(receipt);
    for (const patch of [{ sessionId: 'wrong' }, { scopeHash: 'f'.repeat(64) }, { heads: {} }, { appliedHeads: {} }]) {
      const changed = { ...body, ...patch };
      expect(() => validateAppliedReceipt({ ...changed, checkpointHash: createCheckpointHash(changed) }, offer)).toThrow('verify');
    }
    expect(() => validateAppliedReceipt({ received: 1 }, offer)).toThrow('invalid durable receipt');
    const received = { ...body, stage: 'received' as const, appliedHeads: {} };
    expect(validateAppliedReceipt({ ...received, checkpointHash: createCheckpointHash(received) }, offer).stage).toBe('received');
  });
});
