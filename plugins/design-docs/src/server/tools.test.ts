import { describe, expect, it, vi } from 'vitest';
import { createActorResolver, registerDesignDocTools } from './tools.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocSyncStore } from './sync-store.js';

it('exposes expectedHead and forwards tool CAS without stale intents', async () => {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
  sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, joinedAt: 1, sponsorReplicaId: null })));
  const actor = { kind: 'user' as const, label: 'You', threadId: null };
  const doc = store.create({ title: 'Reviewed', template: 'blank' }, actor);
  const tools: any[] = [];
  const changed = vi.fn();
  registerDesignDocTools({ agents: { registerTool: (tool: unknown) => tools.push(tool) } } as never,
    { store, changed, actorFor: async () => actor });
  const update = tools.find((tool) => tool.name === 'design_doc_update');
  expect(update.parameters.properties.expectedHead.type).toEqual(['string', 'null']);
  const write = tools.find((tool) => tool.name === 'design_doc_write');
  expect(write.parameters.properties.baseFileId.type).toEqual(['string', 'null']);
  const file = store.readFile(doc.id, 'README.md');
  await expect(write.execute({ doc: doc.id, path: file.path, content: 'stale', baseRevision: file.revision, baseFileId: 'stale-id' }, {})).rejects.toThrow(/identity changed/);
  const expectedHead = store.summary(doc.id).head;
  store.writeFile(doc.id, { path: 'README.md', content: 'replacement' }, actor);
  await expect(update.execute({ doc: doc.id, status: 'approved', expectedHead }, {})).rejects.toThrow(/head changed/);
  expect(changed).not.toHaveBeenCalled();
  expect(sync.readyIntents('repo')).toEqual([]);
  await update.execute({ doc: doc.id, status: 'approved', expectedHead: store.summary(doc.id).head }, {});
  expect(changed).toHaveBeenCalledExactlyOnceWith(doc.id);
});

describe('createActorResolver', () => {
  it('labels a thread by its title and caches it', async () => {
    const getThread = vi.fn(async () => ({ title: ' Planner ', titleFallback: null }));
    const resolve = createActorResolver(getThread);
    await expect(resolve('t-1')).resolves.toEqual({ kind: 'agent', label: 'Planner', threadId: 't-1' });
    await resolve('t-1');
    expect(getThread).toHaveBeenCalledTimes(1);
    getThread.mockResolvedValueOnce({ title: null, titleFallback: 'Draft the API' });
    expect((await resolve('t-2')).label).toBe('Draft the API');
  });

  it('does not cache fallbacks, so a later title still lands', async () => {
    const getThread = vi.fn(async () => ({ title: '', titleFallback: null }));
    const resolve = createActorResolver(getThread);
    expect(await resolve('t-1')).toEqual({ kind: 'agent', label: 'Agent', threadId: 't-1' });
    getThread.mockRejectedValueOnce(new Error('host down'));
    expect(await resolve('t-1')).toEqual({ kind: 'agent', label: 'Agent', threadId: 't-1' });
    getThread.mockResolvedValueOnce({ title: 'Named now', titleFallback: null });
    expect((await resolve('t-1')).label).toBe('Named now');
    expect(getThread).toHaveBeenCalledTimes(3);
  });

  it('treats an unknown thread as a terminal agent with nothing to link', async () => {
    const resolve = createActorResolver(async () => null);
    expect(await resolve('pty-7')).toEqual({ kind: 'agent', label: 'CLI agent', threadId: null });
  });

  it('evicts the oldest title past the cap', async () => {
    const getThread = vi.fn(async (threadId: string) => ({ title: `T ${threadId}` }));
    const resolve = createActorResolver(getThread, 2);
    await resolve('a');
    await resolve('b');
    await resolve('c');
    await resolve('b');
    expect(getThread).toHaveBeenCalledTimes(3);
    await resolve('a');
    expect(getThread).toHaveBeenCalledTimes(4);
  });
});
