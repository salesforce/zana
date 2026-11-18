import { describe, expect, it } from 'vitest';
import { UI_USER, createRpcHandlers } from './rpc.js';
import { MAX_PIN_ITEM_KEY_LENGTH, resolvePinnedDoc } from './resolve-pin.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const sdk = { threads: {}, projects: { list: async () => [{ id: 'p1', name: 'App' }, { id: 'p2', name: 'Site' }] } };
  const rpc = createRpcHandlers({ store, changed: () => undefined, sdk: sdk as never });
  const resolve = (args: unknown) => rpc.resolvePin!(args) as Promise<unknown>;
  return { store, resolve };
}

describe('resolvePin', () => {
  it('reports a project doc and a global doc as available with their title only', async () => {
    const { store, resolve } = setup();
    const mine = store.create({ title: 'Mine', projectId: 'p1', template: 'blank' }, UI_USER);
    const global = store.create({ title: 'Everywhere', template: 'blank' }, UI_USER);
    await expect(resolve({ itemKey: mine.id, projectId: 'p1' })).resolves.toEqual({ available: true, title: 'Mine' });
    await expect(resolve({ itemKey: global.id, projectId: 'p1' })).resolves.toEqual({ available: true, title: 'Everywhere' });
  });

  it('returns the new title after a rename', async () => {
    const { store, resolve } = setup();
    const doc = store.create({ title: 'Before', projectId: 'p1', template: 'blank' }, UI_USER);
    store.update(doc.id, { title: 'After', expectedHead: doc.head }, UI_USER);
    await expect(resolve({ itemKey: doc.id, projectId: 'p1' })).resolves.toEqual({ available: true, title: 'After' });
  });

  it('reports unknown, deleted, other-project and template ids as unavailable without a title', async () => {
    const { store, resolve } = setup();
    const doc = store.create({ title: 'Gone', projectId: 'p1', template: 'blank' }, UI_USER);
    const other = store.create({ title: 'Elsewhere', projectId: 'p2', template: 'blank' }, UI_USER);
    await expect(resolve({ itemKey: 'nope', projectId: 'p1' })).resolves.toEqual({ available: false });
    await expect(resolve({ itemKey: other.id, projectId: 'p1' })).resolves.toEqual({ available: false });
    store.remove(doc.id, UI_USER);
    await expect(resolve({ itemKey: doc.id, projectId: 'p1' })).resolves.toEqual({ available: false });
  });

  it('rejects an unregistered project before looking anything up', async () => {
    const { store, resolve } = setup();
    const doc = store.create({ title: 'Mine', projectId: 'p1', template: 'blank' }, UI_USER);
    await expect(resolve({ itemKey: doc.id, projectId: 'nope' })).rejects.toThrow('unknown project nope');
  });

  it('rejects malformed input', async () => {
    const { resolve } = setup();
    await expect(resolve({ itemKey: 5, projectId: 'p1' })).rejects.toThrow('itemKey is required');
    await expect(resolve({ itemKey: '', projectId: 'p1' })).rejects.toThrow('itemKey is required');
    await expect(resolve({ itemKey: 'x'.repeat(MAX_PIN_ITEM_KEY_LENGTH + 1), projectId: 'p1' })).rejects.toThrow('at most');
    await expect(resolve({ itemKey: 'x' })).rejects.toThrow('projectId is required');
    await expect(resolve({ itemKey: 'x', projectId: 'p1', extra: 1 })).rejects.toThrow('accepts only');
    await expect(resolve(null)).rejects.toThrow();
  });

  it('treats an unassigned received doc as available from any project', () => {
    const store = new DesignDocStore(createTestDatabase());
    const doc = store.create({ title: 'Global', template: 'blank' }, UI_USER);
    expect(resolvePinnedDoc(store, 'p1', doc.id)).toEqual({ available: true, title: 'Global' });
    const scopeOf = store.scopeOf.bind(store);
    store.scopeOf = (id: string) => (id === doc.id ? { projectId: null, global: false, unassigned: true } : scopeOf(id));
    expect(resolvePinnedDoc(store, 'p1', doc.id)).toEqual({ available: true, title: 'Global' });
  });
});

describe('resolvePinnedDoc store races', () => {
  it('reports unavailable when the doc vanishes between the scope lookup and the read', () => {
    const store = { scopeOf: () => ({ global: false, unassigned: false, projectId: 'p1' }), find: () => null } as unknown as DesignDocStore;
    expect(resolvePinnedDoc(store, 'p1', 'doc')).toEqual({ available: false });
  });

  it('treats an unassigned doc that has vanished as unavailable', () => {
    const store = { scopeOf: () => ({ global: false, unassigned: true, projectId: null }), find: () => null } as unknown as DesignDocStore;
    expect(resolvePinnedDoc(store, 'p1', 'doc')).toEqual({ available: false });
  });
});
