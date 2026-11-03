import { describe, expect, it, vi } from 'vitest';
import type { PluginPeerRequest, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerService } from './peer-service.js';
import { validateSessionOffer, validateTransfer, createScopeHash } from './peer-protocol.js';
import { PEER_PROTOCOL_VERSION } from '../shared/peer-limits.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const members = ['a', 'b'].map((name, index) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`,
  sponsorReplicaId: index ? 'replica-a' : null, joinedAt: index + 1 }));
const expectation = { repoId: 'repo-a', localReplicaId: 'replica-b', remoteReplicaId: 'replica-a', grantEpoch: 1, groupId: 'group-a', rosterEpoch: 1 };

function peer(name: 'a' | 'b') {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  sync.initialize('repo-a', `replica-${name}`);
  sync.setGroup('repo-a', 'group-a', members);
  const service = new DesignDocPeerService(sync);
  service.register({ sdk: { peers: { handle: vi.fn() } }, onDispose: () => {} } as unknown as ZccPluginApi);
  return { db, store, sync, service };
}

function sentDoc(a: ReturnType<typeof peer>, projectId: string | null) {
  a.sync.recordPeerProtocol('replica-b', PEER_PROTOCOL_VERSION);
  const doc = a.store.create({ title: 'Plan', template: 'blank', ...(projectId ? { projectId } : {}) }, actor);
  a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
  const intent = a.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-b')!;
  return { doc, intent };
}

describe('project hint on the wire', () => {
  it('carries the sender project name and tag, and the receiver can suggest a local match', async () => {
    const a = peer('a'), b = peer('b');
    a.store.projectRefs.observe([{ id: 'pa', name: 'Billing', tag: 'bill' }]);
    const { doc, intent } = sentDoc(a, 'pa');
    const offer = a.service.createOffer(intent);
    expect(offer.project).toEqual({ id: 'pa', name: 'Billing', tag: 'bill' });
    // Not part of the scope hash: the hash is identical without the hint.
    const { project: _p, ...bare } = offer;
    expect(createScopeHash(bare)).toBe(offer.scopeHash);
    expect(validateSessionOffer(offer, expectation).project).toEqual(offer.project);
    expect(b.sync.apply(offer).stage).toBe('synced');
    expect(b.store.get(doc.id).projectId).toBeNull();
    const row = b.db.prepare('SELECT name, tag FROM dd_project_refs WHERE project_id = ?').get('pa');
    expect(row).toEqual({ name: 'Billing', tag: 'bill' });
    const out = await b.store.projectRefs.listUnassignedForeignProjects(async () => [{ id: 'local-1', name: 'Other', tag: 'BILL' }]);
    expect(out[0]).toMatchObject({ foreignProjectId: 'pa', suggestion: { projectId: 'local-1', basis: 'tag' } });
  });

  it('is also carried by transfers and kept out of the transfer hash', () => {
    const a = peer('a');
    a.store.projectRefs.observe([{ id: 'pa', name: 'Billing' }]);
    const { intent } = sentDoc(a, 'pa');
    const transfer = a.service.createTransfer(intent, 1);
    expect(transfer.project).toEqual({ id: 'pa', name: 'Billing' });
    expect(validateTransfer(transfer, expectation).project).toEqual({ id: 'pa', name: 'Billing' });
  });

  it('omits the hint for protocol 3 peers, for global docs and for unnamed projects', () => {
    const a = peer('a');
    a.store.projectRefs.observe([{ id: 'pa', name: 'Billing' }, { id: 'pn' }]);
    const { intent } = sentDoc(a, 'pa');
    expect(a.service.createOffer(intent, 3).project).toBeUndefined();
    expect(a.service.createTransfer(intent, 1, 3).project).toBeUndefined();
    const global = peer('a');
    expect(global.service.createOffer(sentDoc(global, null).intent).project).toBeUndefined();
    const unnamed = peer('a');
    unnamed.store.projectRefs.observe([{ id: 'pn' }]);
    expect(unnamed.service.createOffer(sentDoc(unnamed, 'pn').intent).project).toBeUndefined();
  });

  it('rejects oversized or unknown hint fields and a hint on a protocol 3 packet', () => {
    const a = peer('a'), b = peer('b');
    a.store.projectRefs.observe([{ id: 'pa', name: 'Billing' }]);
    const { intent } = sentDoc(a, 'pa');
    const offer = a.service.createOffer(intent);
    expect(() => validateSessionOffer({ ...offer, project: { id: 'pa', name: 'x'.repeat(500) } }, expectation)).toThrow();
    expect(() => validateSessionOffer({ ...offer, project: { id: 'pa', extra: 1 } }, expectation)).toThrow();
    const old = { ...a.service.createOffer(intent, 3), project: { id: 'pa', name: 'Billing' } };
    expect(() => b.sync.apply(old as never)).toThrow();
  });

  it('never overwrites a project registered on the receiver', () => {
    const a = peer('a'), b = peer('b');
    a.store.projectRefs.observe([{ id: 'pa', name: 'Billing' }]);
    b.store.projectRefs.observe([{ id: 'pa', name: 'Mine' }]);
    b.sync.apply(a.service.createOffer(sentDoc(a, 'pa').intent));
    expect(b.db.prepare('SELECT name FROM dd_project_refs WHERE project_id = ?').get('pa')).toEqual({ name: 'Mine' });
  });
});
