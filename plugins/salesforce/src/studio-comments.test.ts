import { describe, expect, it, vi } from 'vitest';
import { COMMENT_CAP, commentsKey, registerStudioComments, reanchorComment, StudioCommentError, StudioCommentStore } from '../lib/studio-comments.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC } from '../lib/studio-contract.js';

function memoryKv() {
  const data = new Map<string, unknown>();
  return { data, get: async <T,>(k: string) => data.get(k) as T | undefined, set: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); } };
}
const user = { kind: 'user' as const, name: 'You' };
let n = 0;
const store = (kv = memoryKv()) => ({ kv, s: new StudioCommentStore(kv, () => 1000, () => `id${++n}`) });

describe('reanchorComment', () => {
  const lines = ['a', '  b  ', 'c', 'x', 'b', 'c'];
  it('keeps, moves to the nearest match, or orphans', () => {
    expect(reanchorComment({ line: 2, endLine: 3, quote: 'b\nc' }, lines)).toEqual({ line: 2, endLine: 3 });
    expect(reanchorComment({ line: 6, endLine: 6, quote: 'b\nc' }, lines)).toEqual({ line: 5, endLine: 6 });
    expect(reanchorComment({ line: 1, endLine: 1, quote: 'gone' }, lines)).toBeNull();
    expect(reanchorComment({ line: 3, endLine: 3, quote: '  \n' }, lines)).toEqual({ line: 3, endLine: 3 });
  });
});

describe('StudioCommentStore', () => {
  it('adds, derives the quote from source, lists sorted, filters resolved', async () => {
    const { s, kv } = store();
    const b = await s.add('p', { path: 'f.agent', line: 3, body: ' second ', source: 'a\nb\nc\nd' }, user);
    const a = await s.add('p', { path: 'f.agent', line: 1, endLine: 2, body: 'first', quote: 'a\nb' }, { kind: 'agent', threadId: 't', name: 'Agent' });
    expect(b).toMatchObject({ body: 'second', quote: 'c', endLine: 3, createdAt: 1000 });
    expect(kv.data.has(commentsKey('p'))).toBe(true);
    expect((await s.list('p')).map(x => x.id)).toEqual([a.id, b.id]);
    await s.resolve('p', { id: a.id, note: ' done ' }, 'user');
    expect((await s.list('p')).map(x => x.id)).toEqual([b.id]);
    const all = await s.list('p', { includeResolved: true, path: 'f.agent' });
    expect(all[0]!.resolved).toEqual({ at: 1000, note: 'done', by: 'user' });
    expect(await s.list('p', { path: 'other' , includeResolved: true})).toEqual([]);
    expect(await s.list('other')).toEqual([]);
  });
  it('validates input', async () => {
    const { s } = store();
    const bad = (input: object) => expect(s.add('p', { path: 'f', line: 1, body: 'x', ...input } as never, user)).rejects.toMatchObject({ code: 'invalid' });
    await bad({ path: ' ' }); await bad({ path: 'a\0' }); await bad({ body: '  ' }); await bad({ body: 'x'.repeat(4001) });
    await bad({ line: 0 }); await bad({ line: 3, endLine: 2 });
    await expect(s.resolve('p', { id: 'x', note: ' ' }, 'u')).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.resolve('p', { id: 'missing', note: 'n' }, 'u')).rejects.toBeInstanceOf(StudioCommentError);
    const c = await s.add('p', { path: 'f', line: 1, body: 'x' }, user);
    await s.resolve('p', { id: c.id, note: 'n' }, 'u');
    await expect(s.resolve('p', { id: c.id, note: 'n' }, 'u')).rejects.toMatchObject({ code: 'already_resolved' });
  });
  it('serializes concurrent adds', async () => {
    const { s } = store();
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.add('p', { path: 'f', line: i + 1, body: `c${i}` }, user)));
    expect(await s.list('p')).toHaveLength(20);
  });
  it('recovers after a failed step and enforces the cap, evicting the oldest resolved', async () => {
    const kv = memoryKv();
    const { s } = store(kv);
    await expect(s.resolve('p', { id: 'nope', note: 'n' }, 'u')).rejects.toBeDefined();
    const seed = Array.from({ length: COMMENT_CAP }, (_, i) => ({ id: `s${i}`, path: 'f', line: 1, endLine: 1, quote: '', body: 'b', author: user, createdAt: i }));
    kv.data.set(commentsKey('p'), { v: 1, comments: seed });
    await expect(s.add('p', { path: 'f', line: 1, body: 'x' }, user)).rejects.toMatchObject({ code: 'limit' });
    await s.resolve('p', { id: 's7', note: 'ok' }, 'u');
    await s.add('p', { path: 'f', line: 1, body: 'x' }, user);
    const all = await s.list('p', { includeResolved: true });
    expect(all).toHaveLength(COMMENT_CAP);
    expect(all.find(x => x.id === 's7')).toBeUndefined();
  });
  it('re-anchors moved comments by quote and persists once', async () => {
    const { s, kv } = store();
    const c = await s.add('p', { path: 'f', line: 2, body: 'x', quote: 'target' }, user);
    const set = vi.spyOn(kv, 'set');
    const moved = await s.list('p', { path: 'f', source: 'new\nnew\nnew\ntarget' });
    expect(moved[0]).toMatchObject({ id: c.id, line: 4, endLine: 4 });
    expect(set).toHaveBeenCalledTimes(1);
    await s.list('p', { path: 'f', source: 'new\nnew\nnew\ntarget' });
    expect(set).toHaveBeenCalledTimes(1);
    expect((await s.list('p', { path: 'f', source: 'nothing' }))[0]!.line).toBe(4);
  });
  it('tolerates a corrupt document', async () => {
    const kv = memoryKv();
    kv.data.set(commentsKey('p'), { v: 1, comments: 'bad' });
    expect(await store(kv).s.list('p')).toEqual([]);
  });
});

describe('registerStudioComments', () => {
  function setup(opts: { projectId?: string; root?: string; readFile?: (p: string) => string | undefined } = {}) {
    const kv = memoryKv();
    const handlers = new Map<string, (a: unknown) => unknown>();
    const publish = vi.fn();
    const studio = {
      zcc: { storage: { kv }, realtime: { publish } },
      contexts: { current: () => ({ projectId: 'projectId' in opts ? opts.projectId : 'p1', settings: { projectRoot: opts.root ?? '' } }) },
      deps: {},
      registerRpc: (name: string, h: (a: unknown) => unknown) => handlers.set(name, h)
    };
    registerStudioComments(studio as never);
    return { call: (name: string, args: unknown) => handlers.get(name)!(args) as Promise<any>, publish, handlers };
  }
  it('registers all three RPCs and round-trips add/list/resolve with change events', async () => {
    const { call, publish, handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([STUDIO_RPC.commentAdd, STUDIO_RPC.commentResolve, STUDIO_RPC.comments].sort());
    const added = await call(STUDIO_RPC.commentAdd, { path: 'f.agent', line: 2, body: 'hi', content: 'a\nb\nc', threadId: 't9' });
    expect(added).toMatchObject({ ok: true, comment: { quote: 'b', author: { kind: 'agent', threadId: 't9' } } });
    expect(publish).toHaveBeenCalledWith(STUDIO_CHANGED_CHANNEL, { projectId: 'p1', path: 'f.agent', kind: 'comments' });
    const listed = await call(STUDIO_RPC.comments, { path: 'f.agent', content: 'z\na\nb' });
    expect(listed).toMatchObject({ ok: true, openCount: 1, comments: [{ line: 3 }] });
    expect(await call(STUDIO_RPC.commentResolve, { id: added.comment.id })).toMatchObject({ ok: false, code: 'invalid' });
    const done = await call(STUDIO_RPC.commentResolve, { id: added.comment.id, note: 'fixed', threadId: 't9' });
    expect(done.comment.resolved).toMatchObject({ note: 'fixed', by: 'agent:t9' });
    expect(await call(STUDIO_RPC.comments, { includeResolved: true })).toMatchObject({ openCount: 0, comments: [expect.anything()] });
    expect((await call(STUDIO_RPC.commentAdd, { path: 'f', line: 1, body: 'u' })).comment.author).toEqual({ kind: 'user', name: 'You' });
    expect(await call(STUDIO_RPC.commentResolve, { id: 'zzz', note: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('requires a project, ignores oversized or unreadable sources', async () => {
    expect(await setup({ projectId: '' }).call(STUDIO_RPC.comments, {})).toMatchObject({ ok: false, code: 'project_required' });
    const { call } = setup({ root: '/nope' });
    const r = await call(STUDIO_RPC.commentAdd, { path: 'missing.agent', line: 1, body: 'x' });
    expect(r).toMatchObject({ ok: true, comment: { quote: '' } });
    const big = await call(STUDIO_RPC.commentAdd, { path: 'g', line: 1, body: 'x', content: 'x'.repeat(200_000) });
    expect(big.comment.quote).toBe('');
  });
  it('rethrows unexpected errors for the host wrapper', async () => {
    const { call, handlers } = setup();
    const kv = { get: async () => { throw new Error('boom'); }, set: async () => undefined };
    const h = new Map<string, (a: unknown) => unknown>();
    registerStudioComments({ zcc: { storage: { kv }, realtime: { publish: vi.fn() } }, contexts: { current: () => ({ projectId: 'p', settings: {} }) }, deps: {}, registerRpc: (n: string, f: (a: unknown) => unknown) => h.set(n, f) } as never);
    await expect(h.get(STUDIO_RPC.comments)!({})).rejects.toThrow('boom');
    expect(call && handlers).toBeTruthy();
  });
});
