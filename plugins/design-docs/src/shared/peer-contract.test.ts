import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalPeerHash, validateDocumentClosure, validatePeerGroupMembers, validatePeerPacket, type PeerDocumentClosure } from './peer-contract.js';
import { MAX_PEER_PACKET_BYTES, PEER_PROTOCOL_VERSION } from './peer-limits.js';

function closure(): PeerDocumentClosure {
  const actor = JSON.stringify({ kind: 'user', label: 'You', threadId: null });
  return { doc: { id: 'doc', slug: 'doc', title: 'Doc', summary: '', status: 'draft', project_id: null, tags: [],
    entry_path: 'README.md', created_at: 1, updated_at: 1, created_by: actor, updated_by: actor },
    files: [{ sync_id: 'file', path: 'README.md', content: 'body', encoding: 'utf8', size: 4, updated_at: 1, updated_by: actor }],
    history: [], comments: [], threads: [] };
}

describe('bounded canonical peer contract', () => {
  it('freezes canonical SHA-256 bytes across key order and preserves array order', () => {
    expect(canonicalJson({ b: [2, 1], a: 'x' })).toBe('{"a":"x","b":[2,1]}');
    expect(canonicalPeerHash({ b: [2, 1], a: 'x' })).toBe(canonicalPeerHash({ a: 'x', b: [2, 1] }));
    expect(canonicalPeerHash([1, 2])).not.toBe(canonicalPeerHash([2, 1]));
    expect(canonicalJson([null, true, 1])).toBe('[null,true,1]');
  });
  it('rejects non-JSON, invalid Unicode and deeply nested inputs', () => {
    for (const input of [undefined, Number.NaN, Infinity, new Date(), '\ud800', '\udfff', { nested: undefined }]) {
      expect(() => canonicalJson(input)).toThrow();
    }
    let deep: unknown = null;
    for (let i = 0; i < 34; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow('nesting');
    expect(canonicalJson('😀')).toBe('"😀"');
  });
  it('rejects old protocol, nonobjects, oversize packets and invalid rosters', () => {
    expect(() => validatePeerPacket({ protocolVersion: 1 })).toThrow('unsupported');
    expect(() => validatePeerPacket([])).toThrow('object');
    expect(() => validatePeerPacket(null)).toThrow('object');
    expect(() => validatePeerPacket({ protocolVersion: PEER_PROTOCOL_VERSION, content: 'x'.repeat(MAX_PEER_PACKET_BYTES) })).toThrow('exceeds');
    const members = [1, 2].map((i) => ({ replicaId: `r${i}`, machineId: `m${i}`, joinedAt: 1, sponsorReplicaId: null }));
    validatePeerGroupMembers(members);
    expect(() => validatePeerGroupMembers([])).toThrow('2-8');
    expect(() => validatePeerGroupMembers(Array.from({ length: 9 }, (_, i) => ({ ...members[0]!, replicaId: `r${i}` })))).toThrow('2-8');
    expect(() => validatePeerGroupMembers([members[0]!, members[0]!])).toThrow('duplicate replica');
    expect(() => validatePeerGroupMembers([members[0]!, { ...members[1]!, machineId: 'm1' }])).toThrow('duplicate machine');
    expect(() => validatePeerGroupMembers([members[0]!, { ...members[1]!, replicaId: '../bad' }])).toThrow('invalid');
  });
  it('validates closure schema, paths, sizes, encodings and canonical base64', () => {
    expect(validateDocumentClosure(closure())).toEqual(closure());
    for (const mutate of [
      (value: PeerDocumentClosure) => { value.doc.title = ''; },
      (value: PeerDocumentClosure) => { value.doc.status = 'unknown'; },
      (value: PeerDocumentClosure) => { value.files[0]!.path = '../bad'; },
      (value: PeerDocumentClosure) => { value.files[0]!.path = './README.md'; },
      (value: PeerDocumentClosure) => { value.files[0]!.size++; },
      (value: PeerDocumentClosure) => { value.files[0]!.encoding = 'base64'; },
      (value: PeerDocumentClosure) => { value.doc.entry_path = 'missing.md'; },
      (value: PeerDocumentClosure) => { value.files.push({ ...value.files[0]! }); },
      (value: PeerDocumentClosure) => { value.files.push({ ...value.files[0]!, sync_id: 'other', path: 'readme.md' }); }
    ]) {
      const value = closure(); mutate(value);
      expect(() => validateDocumentClosure(value)).toThrow();
    }
    const binary = closure();
    binary.files.push({ ...binary.files[0]!, sync_id: 'image', path: 'asset.png', content: 'AAEC/w==', encoding: 'base64', size: 4 });
    expect(validateDocumentClosure(binary)).toEqual(binary);
    binary.files[1]!.content = 'AAEC/x==';
    expect(() => validateDocumentClosure(binary)).toThrow('noncanonical base64');
    binary.files[1]!.encoding = 'utf8';
    expect(() => validateDocumentClosure(binary)).toThrow('encoding');
  });
  it('rejects dangling/self/nested replies and duplicate thread identities', () => {
    const value = closure(), actor = value.doc.created_by;
    const root = { id: 'root', body: 'comment', path: null, quote: null, author: actor,
      status: 'open' as const, created_at: 1, resolved_at: null, parent_id: null };
    value.comments = [root, { ...root, id: 'reply', parent_id: 'root' }];
    validateDocumentClosure(value);
    for (const parent of ['missing', 'reply']) {
      value.comments[1]!.parent_id = parent;
      expect(() => validateDocumentClosure(value)).toThrow('parent');
    }
    value.comments = [root, root];
    expect(() => validateDocumentClosure(value)).toThrow('duplicate');
    value.comments = [];
    value.threads = [1, 2].map(() => ({ thread_id: 't', title: '', role: 'author', last_activity_at: 1 }));
    expect(() => validateDocumentClosure(value)).toThrow('duplicate');
  });
});
