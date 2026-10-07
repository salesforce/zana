import { describe, expect, it, vi } from 'vitest';
import { createRpcHandlers, registerRpc, titleFromMarkdown, UI_USER } from './rpc.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const changed = vi.fn();
  const spawn = vi.fn(async () => ({ id: 'thread-42' }));
  const get = vi.fn(async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: 'p1', title: 'Planner' }));
  const sdk = {
    threads: { spawn, get },
    projects: { list: async () => [{ id: 'p1', name: 'App', path: '/secret/path' }] }
  };
  const rpc = createRpcHandlers({ store, changed, sdk: sdk as never });
  const call = (name: string, args?: unknown) => rpc[name]!(args) as any;
  return { store, changed, spawn, get, call };
}

describe('Design Docs RPC', () => {
  it('serves templates and projects without leaking paths', async () => {
    const { call } = setup();
    expect(call('templates').map((template: { id: string }) => template.id)).toEqual(['technical', 'product', 'adr', 'api', 'blank']);
    expect(call('templates')[0].files).toContain('README.md');
    await expect(call('projects')).resolves.toEqual([{ id: 'p1', name: 'App' }]);
  });

  it('creates, lists, gets, updates and removes docs as the user', () => {
    const { call, changed } = setup();
    const doc = call('create', { title: 'Search', projectId: 'p1', tags: ['ux'], status: 'review', template: 'adr' });
    expect(doc).toMatchObject({ projectId: 'p1', status: 'review', createdBy: UI_USER });
    expect(changed).toHaveBeenLastCalledWith(doc.id);
    expect(call('create', { title: 'Global', projectId: '' }).projectId).toBeNull();
    expect(() => call('create', { title: 'x', status: 'nope' })).toThrow(/unknown status/);
    expect(() => call('create', { title: 'x', tags: 'a' })).toThrow(/array of strings/);

    expect(call('list', { projectId: 'p1' })).toHaveLength(2);
    expect(call('list', { status: 'active', query: 'search', limit: 5 })).toHaveLength(1);
    expect(() => call('list', { status: 'weird' })).toThrow(/unknown status filter/);
    expect(() => call('list', { limit: 'ten' })).toThrow(/integer/);
    expect(call('get', { doc: doc.slug }).id).toBe(doc.id);

    expect(call('update', { doc: doc.id, title: 'Search v2', projectId: null }).projectId).toBeNull();
    expect(call('update', { doc: doc.id, projectId: 'p1' }).projectId).toBe('p1');
    expect(() => call('update', { doc: doc.id, projectId: 5 })).toThrow(/string or null/);
    expect(() => call('update', { doc: doc.id, status: 'nope' })).toThrow(/unknown status/);

    expect(call('remove', { doc: doc.id })).toEqual({ ok: true });
    expect(call('list', {})).toHaveLength(1);
  });

  it('edits files with optimistic concurrency and restores history', () => {
    const { call } = setup();
    const doc = call('create', { title: 'Doc', template: 'blank' });
    const written = call('writeFile', { doc: doc.id, path: 'README.md', content: '# One', baseRevision: 1, note: 'n' });
    expect(written.revision).toBe(2);
    expect(() => call('writeFile', { doc: doc.id, path: 'README.md', content: 5 })).toThrow(/content must be a string/);
    expect(() => call('writeFile', { doc: doc.id, path: 'README.md', content: 'x', baseRevision: 1 })).toThrow(/changed since/);
    call('writeFile', { doc: doc.id, path: 'pic.png', content: 'iVBORw0K', encoding: 'base64' });

    expect(call('editFile', { doc: doc.id, path: 'README.md', edits: [{ oldText: 'One', newText: 'Two' }] }).revision).toBe(3);
    expect(() => call('editFile', { doc: doc.id, path: 'README.md', edits: {} })).toThrow(/edits must be an array/);
    expect(call('readFile', { doc: doc.id, path: 'README.md' }).content).toBe('# Two');

    expect(call('renameFile', { doc: doc.id, from: 'pic.png', to: 'img/pic.png' }).path).toBe('img/pic.png');
    expect(call('deleteFile', { doc: doc.id, path: 'img/pic.png' })).toEqual({ ok: true });

    const history = call('history', { doc: doc.id, path: 'README.md', limit: 10 });
    const first = history.at(-1);
    expect(call('revision', { doc: doc.id, id: first.id }).content).toContain('# Doc');
    expect(call('restore', { doc: doc.id, id: first.id }).revision).toBe(4);
  });

  it('manages comments and linked threads', () => {
    const { call, store } = setup();
    const doc = call('create', { title: 'Doc', template: 'blank' });
    const comment = call('addComment', { doc: doc.id, body: 'Why?', path: 'README.md', quote: '# Doc' });
    expect(comment.author).toEqual(UI_USER);
    expect(call('setCommentStatus', { doc: doc.id, id: comment.id, status: 'resolved' }).status).toBe('resolved');
    expect(call('deleteComment', { doc: doc.id, id: comment.id })).toEqual({ ok: true });

    store.linkThread(doc.id, 't-1', 'Agent', 'assistant');
    expect(call('unlinkThread', { doc: doc.id, threadId: 't-1' })).toEqual({ ok: true });
    expect(store.get(doc.id).threads).toEqual([]);
  });

  it('starts a briefed agent thread and links it to the doc', async () => {
    const { call, spawn, store } = setup();
    const doc = call('create', { title: 'Sync', projectId: 'p1', template: 'blank' });

    await expect(call('askAgent', { doc: doc.id, action: 'review', path: 'README.md', providerId: 'codex' })).resolves.toEqual({
      threadId: 'thread-42',
      projectId: 'p1'
    });
    const request = (spawn.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(request).toMatchObject({
      projectId: 'p1',
      title: 'Review · Sync',
      providerId: 'codex',
      visibility: 'visible',
      pluginMetadata: { designDocId: doc.id, action: 'review' }
    });
    expect(request.prompt).toContain('Focus on README.md.');
    expect(request.prompt).toContain(`::design-doc{id="${doc.id}"}`);
    expect(store.get(doc.id).threads[0]).toMatchObject({ threadId: 'thread-42', role: 'reviewer' });

    await call('askAgent', { doc: doc.id, prompt: '  Add a rollout section  ' });
    const custom = (spawn.mock.calls[1] as unknown[])[0] as Record<string, any>;
    expect(custom).toMatchObject({ title: 'Design doc · Sync', pluginMetadata: { designDocId: doc.id } });
    expect(custom).not.toHaveProperty('providerId');
    expect(custom.prompt).toContain('Add a rollout section');
  });

  it('saves a chat message as a doc in the thread\'s project', async () => {
    const { call, get, store, changed } = setup();
    const summary = await call('createFromMessage', { threadId: 't-9', text: 'Intro\n\n## Caching plan\n\nUse an LRU.' });
    expect(get).toHaveBeenCalledWith({ threadId: 't-9' });
    expect(summary).toMatchObject({ title: 'Caching plan', projectId: 'p1', fileCount: 1 });
    expect(store.readFile(summary.id, 'README.md').content).toContain('Use an LRU.');
    expect(store.get(summary.id).threads[0]).toMatchObject({ threadId: 't-9', title: 'Planner', role: 'assistant' });
    expect(changed).toHaveBeenLastCalledWith(summary.id);

    get.mockResolvedValueOnce({ id: 't-10', projectId: null, title: '  ' } as never);
    const global = await call('createFromMessage', { threadId: 't-10', text: 'x', title: ' Named ' });
    expect(global).toMatchObject({ title: 'Named', projectId: null });
    expect(store.get(global.id).threads[0]!.title).toBe('Agent thread');
    await expect(call('createFromMessage', { threadId: 't-9', text: ' ' })).rejects.toThrow(/text is required/);
  });

  it('derives a title from markdown', () => {
    expect(titleFromMarkdown('# **Event** `bus`\nbody')).toBe('Event bus');
    expect(titleFromMarkdown('- first point\n- second')).toBe('first point');
    expect(titleFromMarkdown('w'.repeat(100))).toHaveLength(80);
    expect(titleFromMarkdown('#\n***')).toBe('Design doc from chat');
    expect(titleFromMarkdown('', 'Fallback')).toBe('Fallback');
  });

  it('validates agent requests', async () => {
    const { call, spawn } = setup();
    const global = call('create', { title: 'Global', template: 'blank' });
    await expect(call('askAgent', { doc: global.id, action: 'dance' })).rejects.toThrow(/unknown agent action/);
    await expect(call('askAgent', { doc: global.id })).rejects.toThrow(/pick an action/);
    await expect(call('askAgent', { doc: global.id, prompt: 'x'.repeat(4001) })).rejects.toThrow(/at most 4000/);
    await expect(call('askAgent', { doc: global.id, action: 'plan' })).rejects.toThrow(/choose a project/);
    await expect(call('askAgent', { doc: global.id, action: 'plan', projectId: 'p1' })).resolves.toMatchObject({ projectId: 'p1' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('registers every handler as an rpc method', () => {
    const method = vi.fn();
    const { store } = setup();
    registerRpc({ rpc: { method } } as never, { store, changed: () => {}, sdk: {} as never });
    expect(method.mock.calls.map(([name]) => name)).toContain('askAgent');
    expect(method).toHaveBeenCalledTimes(21);
  });
});
