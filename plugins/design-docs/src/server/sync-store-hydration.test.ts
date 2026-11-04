import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerService } from './peer-service.js';
import { createTestDatabase } from './test-db.js';
import { canonicalJson, type PeerDocumentClosure } from '../shared/peer-contract.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_CLOSURE_BYTES } from '../shared/peer-limits.js';
import { MAX_TEXT_FILE_BYTES } from '../shared/limits.js';
import { createTransferHash, peerBlobHash, transferQuery, type PeerTransfer } from './peer-protocol.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const members = ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 }));
afterEach(() => vi.restoreAllMocks());

function fixture(name: string) {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  sync.initialize('repo', `replica-${name}`);
  sync.setGroup('repo', 'group', members);
  return { db, store, sync, service: new DesignDocPeerService(sync) };
}

type ManifestRow = Record<string, unknown> & { blob_hash: string };
type Manifest = Omit<PeerDocumentClosure, 'files' | 'history'> & { files: ManifestRow[]; history: ManifestRow[] };
function transfer(a: ReturnType<typeof fixture>, docId: string) {
  const intent = a.sync.freezeManual().find((candidate) => candidate.frozenHead === a.sync.head('repo', docId))!;
  const header = a.service.createTransfer(intent, 1);
  const blobs = new Map(header.blobs.map(({ hash }) => [hash,
    (a.db.prepare('SELECT content FROM sync_blobs WHERE hash = ?').get(hash) as { content: Buffer }).content]));
  return { header, blobs };
}

/** Rebuild an otherwise genuine transfer around adversarial manifest bytes, retaining real blob/chunk hashing. */
function rewrite(input: ReturnType<typeof transfer>, edit: (manifest: Manifest) => void, noncanonical = false) {
  const blobs = new Map(input.blobs);
  for (const version of input.header.versions) blobs.delete(version.manifestHash);
  const versions = input.header.versions.map((version) => {
    const manifest = JSON.parse(input.blobs.get(version.manifestHash)!.toString('utf8')) as Manifest;
    edit(manifest);
    const bytes = Buffer.from(`${noncanonical ? ' ' : ''}${canonicalJson(manifest)}`), manifestHash = peerBlobHash(bytes);
    blobs.set(manifestHash, bytes);
    return { ...version, manifestHash };
  });
  const { scopeHash: _scope, ...prior } = input.header;
  const body = { ...prior, versions, blobs: [...blobs].map(([hash, bytes]) => ({ hash, bytes: bytes.length })) };
  return { header: { ...body, scopeHash: createTransferHash(body) }, blobs };
}

function stage(b: ReturnType<typeof fixture>, input: { header: PeerTransfer; blobs: Map<string, Buffer> }) {
  b.sync.stageTransfer(input.header);
  const query = transferQuery(input.header);
  for (const [blobHash, bytes] of input.blobs) {
    for (let index = 0; index * MAX_PEER_CHUNK_BYTES < bytes.length; index++) {
      const chunk = bytes.subarray(index * MAX_PEER_CHUNK_BYTES, (index + 1) * MAX_PEER_CHUNK_BYTES);
      b.sync.stageChunk({ ...query, blobHash, index, chunkHash: peerBlobHash(chunk), content: chunk.toString('base64') }, chunk);
    }
  }
  return query;
}

describe('transfer-local immutable content reuse', () => {
  it.each(['shared UTF-8 content é', ''])('decodes a shared blob once across files, history and versions (%j)', (content) => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Shared versions', status: 'approved', files: [
      { path: 'README.md', content }, { path: 'copy.md', content }
    ] }, actor);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'rewritten' }, actor);
    const input = transfer(a, doc.id), query = stage(b, input);
    expect(input.header.versions.length).toBeGreaterThan(1);
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    const prepared = b.sync.prepareTransfer(query)!;
    const matchingDecodes = () => decode.mock.calls.filter(([bytes]) => Buffer.from(bytes as Uint8Array).equals(Buffer.from(content))).length;
    expect(matchingDecodes()).toBe(1);
    const closures = prepared.versions.map((version) => version.closure);
    expect(closures.every((closure) => closure.files.find((file) => file.path === 'copy.md')!.content === content)).toBe(true);
    expect(closures.flatMap((closure) => closure.history).filter((row) => row.content === content).length).toBeGreaterThan(1);
    // A later preparation verifies/decodes afresh: no content survives through a store/global cache.
    expect(b.sync.prepareTransfer(query)!.versions).toEqual(prepared.versions);
    expect(matchingDecodes()).toBe(2);
    expect(b.sync.applyTransfer(query, prepared).stage).toBe('synced');
    expect(b.store.readFile(doc.id, 'copy.md').content).toBe(content);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('rewritten');
  });

  it('keeps UTF-8 and base64 representations of the same blob distinct', () => {
    const a = fixture('a'), b = fixture('b'), content = 'identical bytes';
    const doc = a.store.create({ title: 'Two encodings', status: 'approved', files: [
      { path: 'README.md', content }, { path: 'asset.png', content: Buffer.from(content).toString('base64'), encoding: 'base64' }
    ] }, actor);
    const input = transfer(a, doc.id), query = stage(b, input), prepared = b.sync.prepareTransfer(query)!;
    expect(input.header.blobs.filter((blob) => blob.hash === peerBlobHash(Buffer.from(content)))).toHaveLength(1);
    expect(prepared.versions[0]!.closure.files.map((file) => file.content)).toEqual([content, Buffer.from(content).toString('base64')]);
    expect(b.sync.applyTransfer(query, prepared).stage).toBe('synced');
    expect(b.store.readFile(doc.id, 'asset.png').content).toBe(Buffer.from(content).toString('base64'));
  });

  it.each([
    ['size', (row: ManifestRow) => { row.size = Number(row.size) + 1; }, 'blob size or encoding mismatch'],
    ['encoding', (row: ManifestRow) => { row.encoding = 'unknown'; }, 'blob size or encoding mismatch'],
    ['path', (row: ManifestRow) => { row.path = 'asset.png'; }, 'file encoding does not match path']
  ] as const)('still validates %s on a later reference to a decoded blob', (_name, edit, message) => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Repeated reference validation', status: 'approved', files: [
      { path: 'README.md', content: 'shared' }, { path: 'copy.md', content: 'shared' }
    ] }, actor);
    const input = rewrite(transfer(a, doc.id), (manifest) => edit(manifest.files[1]!)), query = stage(b, input);
    expect(() => b.sync.prepareTransfer(query)).toThrow(message);
    expect(b.store.find(doc.id)).toBeNull();
  });

  it('rejects invalid UTF-8 even when those bytes were first decoded as base64', () => {
    const a = fixture('a'), b = fixture('b'), bytes = Buffer.from([0xff]);
    const doc = a.store.create({ title: 'Fatal text decoding', status: 'approved', files: [
      { path: 'README.md', content: 'x' }, { path: 'asset.png', content: bytes.toString('base64'), encoding: 'base64' }
    ] }, actor);
    const input = rewrite(transfer(a, doc.id), (manifest) => {
      const binary = manifest.files.find((file) => file.path === 'asset.png')!, text = manifest.files.find((file) => file.path === 'README.md')!;
      text.blob_hash = binary.blob_hash;
      manifest.files = [binary, text];
    }), query = stage(b, input);
    expect(() => b.sync.prepareTransfer(query)).toThrow(/encoded data|encoding/i);
    expect(b.store.find(doc.id)).toBeNull();
  });

  it('charges every repeated reference against the closure cap, including history', () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Logical closure bound', status: 'approved', files: [
      { path: 'README.md', content: 'x'.repeat(MAX_TEXT_FILE_BYTES) }
    ] }, actor);
    const input = rewrite(transfer(a, doc.id), (manifest) => {
      const row = manifest.history[0]!;
      manifest.history = Array.from({ length: MAX_PEER_CLOSURE_BYTES / MAX_TEXT_FILE_BYTES }, (_, index) => ({ ...row, sync_id: `revision-${index}` }));
    }), query = stage(b, input);
    expect(() => b.sync.prepareTransfer(query)).toThrow('hydrated closure exceeds frozen cap');
    expect(b.store.find(doc.id)).toBeNull();
  });

  it('rechecks blob integrity on each new hydration rather than retaining an earlier decoded value', () => {
    const a = fixture('a'), b = fixture('b'), content = 'immutable';
    const doc = a.store.create({ title: 'Fresh integrity check', status: 'approved', files: [{ path: 'README.md', content }] }, actor);
    const query = stage(b, transfer(a, doc.id));
    expect(b.sync.prepareTransfer(query)).not.toBeNull();
    b.db.prepare("UPDATE sync_transfer_chunks SET content = ? WHERE direction = 'in' AND blob_hash = ?")
      .run(Buffer.from('corrupted'), peerBlobHash(Buffer.from(content)));
    expect(() => b.sync.prepareTransfer(query)).toThrow('assembled blob hash mismatch');
    expect(b.store.find(doc.id)).toBeNull();
  });

  it('continues requiring canonical manifest bytes before any content reuse', () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Canonical manifest', status: 'approved', files: [{ path: 'README.md', content: 'shared' }] }, actor);
    const input = rewrite(transfer(a, doc.id), () => {}, true), query = stage(b, input);
    expect(() => b.sync.prepareTransfer(query)).toThrow('noncanonical staged manifest');
    expect(b.store.find(doc.id)).toBeNull();
  });
});
