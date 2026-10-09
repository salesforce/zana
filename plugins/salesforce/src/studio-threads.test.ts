import { describe, expect, it, vi } from 'vitest';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC } from '../lib/studio-contract.js';
import { isSafeStudioPath, MAX_THREAD_LINKS, registerStudioAssistant, StudioLinkStore } from '../lib/studio-threads.js';
import { viewStoreFor } from '../lib/studio-view.js';

function harness(projectId = 'p1') {
  const kv = new Map<string, unknown>();
  const handlers = new Map<string, (a: unknown) => any>();
  const events = new Map<string, (e: any) => any>();
  const published: any[] = [];
  let n = 0;
  const spawn = vi.fn(async (_: any) => ({ id: `t${++n}` }));
  const get = vi.fn(async (_: any): Promise<any> => ({ id: 't1', deletedAt: 1 }));
  const zcc: any = {
    storage: { kv: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => { kv.set(k, v); } } },
    realtime: { publish: (c: string, p: unknown) => published.push([c, p]) },
    events: { on: (e: string, h: any) => events.set(e, h) },
    sdk: { threads: { spawn, get } }
  };
  const studio: any = { zcc, registerRpc: (n2: string, h: any) => handlers.set(n2, h), contexts: { current: () => (projectId ? { projectId } : undefined) } };
  registerStudioAssistant(studio);
  return { kv, zcc, spawn, get, events, published, call: (n2: string, a: unknown = {}) => handlers.get(n2)!(a) };
}

describe('isSafeStudioPath', () => {
  it('accepts project-relative paths only', () => {
    expect(isSafeStudioPath('force-app/main/Help.agent')).toBe(true);
    for (const bad of ['', '/abs', '../x', 'a/../b', 'a//b', 'a\\b', 'a\nb', 'c:/x', 'x'.repeat(501), 5, null]) expect(isSafeStudioPath(bad)).toBe(false);
  });
});

describe('StudioLinkStore', () => {
  it('links, lists newest first, filters by path, touches and removes', async () => {
    const kv = new Map<string, any>(); let t = 0;
    const store = new StudioLinkStore({ get: async k => kv.get(k), set: async (k, v) => { kv.set(k, v); } }, () => ++t);
    await store.link('p', { threadId: 'a', title: 'A', role: 'author', path: 'x.agent' });
    await store.link('p', { threadId: 'b', title: 'B', role: 'reviewer', path: 'y.agent' });
    await store.link('p', { threadId: 'a', title: 'A2', role: 'editor', path: 'x.agent' });
    expect((await store.list('p')).map(l => l.threadId)).toEqual(['a', 'b']);
    expect((await store.list('p', 'y.agent')).map(l => l.threadId)).toEqual(['b']);
    expect(await store.touch('p', 'nope')).toBeNull();
    expect((await store.touch('p', 'b', ' New title '))?.title).toBe('New title');
    expect((await store.touch('p', 'b', ''))?.title).toBe('New title');
    expect((await store.list('p'))[0].threadId).toBe('b');
    expect((await store.remove('p', 'b'))?.threadId).toBe('b');
    expect(await store.remove('p', 'b')).toBeNull();
    expect(await store.list('empty')).toEqual([]);
  });

  it('ignores corrupt documents and caps at 200 links, even under concurrent writes', async () => {
    const kv = new Map<string, any>([['studio:links:bad', { links: [null, { threadId: 1 }, 7] }]]);
    let t = 0;
    const store = new StudioLinkStore({ get: async k => { await Promise.resolve(); return kv.get(k); }, set: async (k, v) => { await Promise.resolve(); kv.set(k, v); } }, () => ++t);
    expect(await store.list('bad')).toEqual([]);
    await Promise.all(Array.from({ length: MAX_THREAD_LINKS + 20 }, (_, i) => store.link('p', { threadId: `t${i}`, title: 't', role: 'assistant', path: 'x.agent' })));
    const links = await store.list('p');
    expect(links).toHaveLength(MAX_THREAD_LINKS);
    expect(new Set(links.map(l => l.threadId)).size).toBe(MAX_THREAD_LINKS);
  });

  it('keeps serializing after a failed write', async () => {
    let fail = true; const kv = new Map<string, any>();
    const store = new StudioLinkStore({ get: async k => kv.get(k), set: async (k, v) => { if (fail) { fail = false; throw new Error('disk'); } kv.set(k, v); } });
    await expect(store.link('p', { threadId: 'a', title: 'A', role: 'author', path: 'x' })).rejects.toThrow('disk');
    await store.link('p', { threadId: 'b', title: 'B', role: 'author', path: 'x' });
    expect((await store.list('p')).map(l => l.threadId)).toEqual(['b']);
  });
});

describe('studio.askAgent', () => {
  it('spawns a briefed thread, links it by role and publishes a change', async () => {
    const h = harness();
    viewStoreFor(h.zcc).publish('p1', { surface: 'studio', path: 'force-app/Help.agent', dirty: false, tool: 'code', diagnostics: [{ line: 4, column: 1, endLine: 4, endColumn: 3, severity: 'error', message: 'unknown topic' }], share: true, at: 1 });
    h.kv.set('studio:comments:p1', [{ id: 'c1', path: 'force-app/Help.agent', line: 1, endLine: 1, quote: 'q', body: 'tighten this', author: { kind: 'user', name: 'u' }, createdAt: 1 }]);
    const result = await h.call(STUDIO_RPC.askAgent, { path: 'force-app/Help.agent', action: 'review', providerId: 'prov' });
    expect(result).toEqual({ ok: true, threadId: 't1' });
    const spawned = h.spawn.mock.calls[0][0];
    expect(spawned).toMatchObject({ projectId: 'p1', visibility: 'visible', providerId: 'prov', pluginMetadata: { sfAgentPath: 'force-app/Help.agent', action: 'review' } });
    expect(spawned.title).toBe('Review · Help.agent');
    expect(spawned.prompt).toContain('tighten this');
    expect(spawned.prompt).toContain('unknown topic');
    expect((await h.call(STUDIO_RPC.threads, { path: 'force-app/Help.agent' })).threads[0]).toMatchObject({ threadId: 't1', role: 'reviewer', action: 'review' });
    expect(h.published).toContainEqual([STUDIO_CHANGED_CHANNEL, { projectId: 'p1', path: 'force-app/Help.agent', kind: 'threads' }]);
  });

  it('accepts a free-form request and explicit diagnostics', async () => {
    const h = harness();
    const diagnostics = [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'explicit one' }];
    expect((await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', prompt: 'do X', action: 'fix-problems', diagnostics })).ok).toBe(true);
    expect(h.spawn.mock.calls[0][0].prompt).toContain('explicit one');
    expect(h.spawn.mock.calls[0][0]).not.toHaveProperty('providerId');
    await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', prompt: 'do X' });
    expect((await h.call(STUDIO_RPC.threads)).threads.find((t: any) => t.threadId === 't2')).toMatchObject({ role: 'assistant' });
    expect(h.spawn.mock.calls[1][0].pluginMetadata).toEqual({ sfAgentPath: 'a.agent' });
  });

  it('rejects bad input without spawning', async () => {
    const h = harness();
    expect((await h.call(STUDIO_RPC.askAgent, { path: '../x' })).code).toBe('invalid_input');
    expect((await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', action: 'nope' })).code).toBe('invalid_input');
    expect((await h.call(STUDIO_RPC.askAgent, { path: 'a.agent' })).code).toBe('invalid_input');
    expect((await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', prompt: 'x'.repeat(2000) })).code).toBe('invalid_input');
    expect(h.spawn).not.toHaveBeenCalled();
    const none = harness('');
    expect((await none.call(STUDIO_RPC.askAgent, { path: 'a.agent', action: 'review' })).code).toBe('project_required');
    expect((await none.call(STUDIO_RPC.threads)).code).toBe('project_required');
    expect((await none.call(STUDIO_RPC.unlink, { threadId: 't' })).code).toBe('invalid_input');
  });
});

describe('studio.unlinkThread and lifecycle events', () => {
  it('unlinks and reports whether anything was removed', async () => {
    const h = harness();
    await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', action: 'review' });
    h.published.length = 0;
    expect(await h.call(STUDIO_RPC.unlink, { threadId: 't1' })).toEqual({ ok: true, removed: true });
    expect(h.published).toHaveLength(1);
    expect(await h.call(STUDIO_RPC.unlink, { threadId: 't1' })).toEqual({ ok: true, removed: false });
    expect((await h.call(STUDIO_RPC.threads)).threads).toEqual([]);
  });

  it('thread.idle refreshes title/activity; unrelated threads are ignored', async () => {
    const h = harness();
    await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', action: 'review' });
    h.published.length = 0;
    await h.events.get('thread.idle')!({ thread: { id: 'other', projectId: 'p1', title: 'x' } });
    await h.events.get('thread.idle')!({ thread: { id: 't1' } });
    expect(h.published).toHaveLength(0);
    await h.events.get('thread.idle')!({ thread: { id: 't1', projectId: 'p1', title: 'Renamed' } });
    expect((await h.call(STUDIO_RPC.threads)).threads[0].title).toBe('Renamed');
    expect(h.published).toHaveLength(1);
  });

  it('thread.deleted removes links only for really deleted threads', async () => {
    const h = harness();
    await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', action: 'review' });
    h.get.mockResolvedValueOnce({ id: 't1', deletedAt: null });
    await h.events.get('thread.deleted')!({ thread: { id: 't1', projectId: 'p1' } });
    expect((await h.call(STUDIO_RPC.threads)).threads).toHaveLength(1);
    await h.events.get('thread.deleted')!({ thread: { id: 't1' } });
    expect((await h.call(STUDIO_RPC.threads)).threads).toHaveLength(1);
    h.get.mockRejectedValueOnce(new Error('gone'));
    await h.events.get('thread.deleted')!({ thread: { id: 't1', projectId: 'p1' } });
    expect((await h.call(STUDIO_RPC.threads)).threads).toHaveLength(0);
  });

  it('survives realtime publish failures', async () => {
    const h = harness();
    h.zcc.realtime.publish = () => { throw new Error('ws down'); };
    expect((await h.call(STUDIO_RPC.askAgent, { path: 'a.agent', action: 'review' })).ok).toBe(true);
  });
});
