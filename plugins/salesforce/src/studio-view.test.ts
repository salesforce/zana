import { describe, expect, it, vi } from 'vitest';
import type { StudioViewState } from '../lib/studio-contract.js';
import { STUDIO_RPC } from '../lib/studio-contract.js';
import { buildViewInstructions, describeView, INSTRUCTIONS_MAX_CHARS, readOpenComments, registerStudioContext, StudioViewStore, VIEW_MAX_ENTRIES, VIEW_TTL_MS, viewStoreFor } from '../lib/studio-view.js';

const state = (over: Partial<StudioViewState> = {}): StudioViewState => ({ surface: 'studio', path: 'force-app/Help.agent', dirty: false, tool: 'code', diagnostics: [], share: true, at: 1, ...over });

function harness(projectId = 'p1') {
  const handlers = new Map<string, (args: unknown) => unknown>();
  const providers: any[] = []; const mentions = new Map<string, any>(); const kv = new Map<string, unknown>();
  const zcc: any = {
    agents: { contributeInstructions: vi.fn((p: unknown) => providers.push(p)) },
    ui: { registerMentionProvider: (m: any) => mentions.set(m.id, m) },
    storage: { kv: { get: async (k: string) => kv.get(k) } },
    log: { warn: vi.fn() }
  };
  const studio: any = { zcc, registerRpc: (n: string, h: any) => handlers.set(n, h), contexts: { current: () => (projectId ? { projectId } : undefined) } };
  registerStudioContext(studio);
  return { handlers, providers, mentions, kv, zcc, studio, call: (n: string, a: unknown) => handlers.get(n)!(a) as any };
}

describe('StudioViewStore', () => {
  it('stores only shared views, expires after the TTL and prefers the thread view', () => {
    let t = 1000; const store = new StudioViewStore(() => t);
    expect(store.publish('p', state({ share: false }))).toBe(false);
    expect(store.get('p')).toBeNull();
    store.publish('p', state({ path: 'a.agent' }));
    store.publish('p', state({ path: 'b.agent' }), 't1');
    expect(store.get('p', 't1')?.state.path).toBe('b.agent');
    expect(store.get('p', 'other')?.state.path).toBe('a.agent');
    expect(store.latest('p')?.state.path).toBe('b.agent');
    store.publish('p', state({ share: false }), 't1');
    expect(store.get('p', 't1')?.state.path).toBe('a.agent');
    t += VIEW_TTL_MS + 1;
    expect(store.get('p')).toBeNull();
    expect(store.latest('p')).toBeNull();
  });

  it('bounds the number of entries, dropping the oldest', () => {
    let t = 0; const store = new StudioViewStore(() => ++t);
    for (let i = 0; i < VIEW_MAX_ENTRIES + 10; i++) store.publish(`p${i}`, state());
    expect(store.size).toBe(VIEW_MAX_ENTRIES);
    expect(store.get('p0')).toBeNull();
    expect(store.get(`p${VIEW_MAX_ENTRIES + 9}`)).not.toBeNull();
  });

  it('shares one store per plugin instance', () => {
    const zcc = {};
    expect(viewStoreFor(zcc)).toBe(viewStoreFor(zcc));
    expect(viewStoreFor({})).not.toBe(viewStoreFor(zcc));
  });
});

describe('describeView / instructions', () => {
  const full = state({ dirty: true, orgAlias: 'dev', selection: { startLine: 2, endLine: 4, text: 'a\nb' }, lastRun: { runId: 'r1', engine: 'simulate', turn: 2 }, diagnostics: Array.from({ length: 8 }, (_, i) => ({ line: i + 1, column: 1, endLine: i + 1, endColumn: 2, severity: 'warning' as const, message: 'm' })) });
  it('renders the screen compactly', () => {
    const text = describeView(full, 9000);
    expect(text).toContain('org: dev');
    expect(text).toContain('unsaved edits');
    expect(text).toContain('Selection: lines 2-4: "a b"');
    expect(text).toContain('simulate, turn 2');
    expect(text).toContain('Problems (8):');
    expect(text).toContain('updated 9s ago');
    expect(describeView(state({ path: null, cursor: { line: 4, column: 1 }, tool: null }))).toContain('(unsaved draft)');
    expect(describeView(state({ cursor: { line: 4, column: 1 }, lastRun: { runId: 'r', engine: 'live' } }))).toContain('Cursor: line 4');
  });

  it('builds a bounded instruction section only when a view exists', () => {
    const store = new StudioViewStore();
    expect(buildViewInstructions(store, { projectId: '', threadId: 't' })).toBeNull();
    expect(buildViewInstructions(store, { projectId: 'p', threadId: 't' })).toBeNull();
    store.publish('p', state({ selection: { startLine: 1, endLine: 2, text: 'x'.repeat(2000) }, orgAlias: 'o'.repeat(2000) }));
    const text = buildViewInstructions(store, { projectId: 'p', threadId: 't' })!;
    expect(text).toContain('currently viewing');
    expect(text).toContain('view.state');
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
  });
});

describe('readOpenComments', () => {
  const c = (id: string, path: string, resolved?: object) => ({ id, path, line: 1, endLine: 1, quote: 'q', body: 'b', author: { kind: 'user', name: 'u' }, createdAt: 1, ...(resolved ? { resolved } : {}) });
  it('filters open comments for the path from either doc shape and tolerates junk', async () => {
    const rows = [c('a', 'x.agent'), c('b', 'y.agent'), c('r', 'x.agent', { at: 1, note: 'n', by: 't' }), { junk: true }];
    expect((await readOpenComments({ get: async () => rows as any }, 'p', 'x.agent')).map(x => x.id)).toEqual(['a']);
    expect((await readOpenComments({ get: async () => ({ comments: rows }) as any }, 'p', null)).map(x => x.id)).toEqual(['a', 'b']);
    expect(await readOpenComments({ get: async () => 5 as any }, 'p', null)).toEqual([]);
    expect(await readOpenComments({ get: async () => { throw new Error('x'); } }, 'p', null)).toEqual([]);
  });
});

describe('registerStudioContext', () => {
  it('registers rpc, one instruction provider and two mention providers', () => {
    const h = harness();
    expect([...h.handlers.keys()]).toEqual([STUDIO_RPC.viewPublish, STUDIO_RPC.viewGet]);
    expect(h.providers).toHaveLength(1);
    expect([...h.mentions.keys()]).toEqual(['sf-agent', 'sf-view']);
  });

  it('publishes, reads back and honours share=false and validation', () => {
    const h = harness();
    expect(h.call(STUDIO_RPC.viewGet, {}).shared).toBe(false);
    expect(h.call(STUDIO_RPC.viewPublish, { state: { nope: 1 } }).code).toBe('invalid_input');
    expect(h.call(STUDIO_RPC.viewPublish, { state: state({ diagnostics: Array.from({ length: 51 }, () => ({ line: 1, column: 1, endLine: 1, endColumn: 1, severity: 'error', message: 'x' })) as any }) }).code).toBe('invalid_input');
    expect(h.call(STUDIO_RPC.viewPublish, { state: state(), threadId: 't9' })).toEqual({ ok: true, shared: true });
    const got = h.call(STUDIO_RPC.viewGet, { threadId: 't9' });
    expect(got).toMatchObject({ ok: true, shared: true });
    expect(got.summary).toContain('Help.agent');
    expect(h.providers[0]({ projectId: 'p1', threadId: 't9' })).toContain('Help.agent');
    expect(h.call(STUDIO_RPC.viewPublish, { state: state({ share: false }), threadId: 't9' }).shared).toBe(false);
    expect(h.call(STUDIO_RPC.viewGet, { threadId: 't9' }).shared).toBe(false);
  });

  it('requires a project and swallows provider failures', () => {
    const h = harness('');
    expect(h.call(STUDIO_RPC.viewPublish, { state: state() }).code).toBe('project_required');
    expect(h.call(STUDIO_RPC.viewGet, {}).code).toBe('project_required');
    expect(h.providers[0]({ projectId: '', threadId: 't' })).toBeNull();
  });

  it('logs instead of throwing when instructions are already registered', () => {
    const warn = vi.fn();
    const zcc: any = { agents: { contributeInstructions: () => { throw new Error('already registered'); } }, ui: { registerMentionProvider: () => undefined }, storage: { kv: { get: async () => undefined } }, log: { warn } };
    registerStudioContext({ zcc, registerRpc: () => undefined, contexts: { current: () => undefined } } as any);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already registered'));
  });

  it('mention providers search and resolve file, comments and current screen', async () => {
    const h = harness();
    const agent = h.mentions.get('sf-agent'); const view = h.mentions.get('sf-view');
    expect(agent.search({ query: '', projectId: 'p1' })).toEqual([]);
    expect(view.search({ query: '', projectId: 'p1' })).toEqual([]);
    h.call(STUDIO_RPC.viewPublish, { state: state({ diagnostics: [{ line: 3, column: 1, endLine: 3, endColumn: 2, severity: 'error', message: 'boom' }] }) });
    h.kv.set('studio:comments:p1', [{ id: 'c1', path: 'force-app/Help.agent', line: 1, endLine: 1, quote: 'q', body: 'do it', author: { kind: 'user', name: 'u' }, createdAt: 1 }]);
    expect(agent.search('', )).toEqual([]);
    expect(agent.search({ query: 'zzz', projectId: 'p1' })).toEqual([]);
    expect(agent.search({ query: '', projectId: '' })).toEqual([]);
    const items = agent.search({ query: 'help', projectId: 'p1' });
    expect(items).toHaveLength(2);
    const file = await agent.resolve(items[0].id);
    expect(file.context).toContain('force-app/Help.agent');
    expect(file.context).toContain('do it');
    expect(file.context).toContain('boom');
    expect((await agent.resolve(items[1].id)).context).not.toContain('boom');
    await expect(agent.resolve('bogus')).rejects.toThrow();
    expect(view.search('', )).toEqual([]);
    expect(view.search({ query: 'nothing', projectId: 'p1' })).toEqual([]);
    const [screen] = view.search({ query: 'screen', projectId: 'p1' });
    expect((await view.resolve(screen.id)).context).toContain('Help.agent');
    expect((await view.resolve('view~gone')).context).toContain('not being shared');
    expect((await view.resolve('view')).context).toContain('not being shared');
  });
});
