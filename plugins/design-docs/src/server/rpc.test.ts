import { describe, expect, it, vi } from 'vitest';
import { RenderReports } from './render-reports.js';
import { createRpcHandlers, registerRpc, titleFromMarkdown, UI_USER } from './rpc.js';
import { DesignDocError, DesignDocStore } from './store.js';
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
    expect(call('templates').map((template: { id: string }) => template.id)).toEqual(['technical', 'product', 'adr', 'api', 'report', 'html-design', 'blank']);
    expect(call('templates')[0].files).toContain('README.md');
    await expect(call('projects')).resolves.toEqual([{ id: 'p1', name: 'App' }]);
  });

  it('creates, lists, gets, updates and removes docs as the user', async () => {
    const { call, changed } = setup();
    const doc = await call('create', { title: 'Search', projectId: 'p1', tags: ['ux'], status: 'review', template: 'adr' });
    expect(doc).toMatchObject({ projectId: 'p1', status: 'review', createdBy: UI_USER });
    expect(changed).toHaveBeenLastCalledWith(doc.id);
    expect((await call('create', { title: 'Global', projectId: '' })).projectId).toBeNull();
    await expect(call('create', { title: 'x', status: 'nope' })).rejects.toThrow(/unknown status/);
    await expect(call('create', { title: 'x', tags: 'a' })).rejects.toThrow(/array of strings/);

    expect(call('list', { projectId: 'p1' })).toHaveLength(2);
    expect(call('list', { status: 'active', query: 'search', limit: 5 })).toHaveLength(1);
    expect(() => call('list', { status: 'weird' })).toThrow(/unknown status filter/);
    expect(() => call('list', { limit: 'ten' })).toThrow(/integer/);
    expect(call('get', { doc: doc.slug }).id).toBe(doc.id);

    expect((await call('update', { doc: doc.id, title: 'Search v2', projectId: null })).projectId).toBeNull();
    expect((await call('update', { doc: doc.id, projectId: 'p1' })).projectId).toBe('p1');
    await expect(call('update', { doc: doc.id, projectId: 5 })).rejects.toThrow(/string or null/);
    await expect(call('update', { doc: doc.id, status: 'nope' })).rejects.toThrow(/unknown status/);
    // Rule 1: the renderer picks a project, the host's list decides if it exists.
    await expect(call('update', { doc: doc.id, projectId: 'p-unknown' })).rejects.toThrow(/unknown project p-unknown/);
    await expect(call('create', { title: 'x', projectId: 'p-unknown' })).rejects.toThrow(/unknown project/);

    expect(call('remove', { doc: doc.id })).toEqual({ ok: true });
    expect(call('list', {})).toHaveLength(1);
  });

  it('edits files with optimistic concurrency and restores history', async () => {
    const { call } = setup();
    const doc = await call('create', { title: 'Doc', template: 'blank' });
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

  it('renders HTML pages, saved or drafted, with the site kit behind zcc-kit/', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const kit = vi.fn((path: string) => (path === 'site.css' ? { path: `zcc-kit/${path}`, kind: 'code' as const, content: 'p{}', encoding: 'utf8' as const, revision: 0 } : null));
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, kit });
    const doc = await rpc.create!({ title: 'Site', template: 'blank' }) as { id: string };
    store.writeFile(doc.id, { path: 'index.html', content: '<link rel="stylesheet" href="zcc-kit/site.css"><p>hi</p>' }, UI_USER);
    const page = rpc.renderPage!({ doc: doc.id, path: 'index.html' }) as { html: string; revision: number; deps: unknown[] };
    expect(page.html).toContain('<style data-dd-href="zcc-kit/site.css">p{}</style>');
    expect(page.deps).toEqual([{ path: 'zcc-kit/site.css', revision: 0 }]);
    expect((rpc.renderPage!({ doc: doc.id, path: 'index.html', draft: '<p>new</p>' }) as { html: string }).html).toContain('<p>new</p>');
    expect(() => rpc.renderPage!({ doc: doc.id, path: 'index.html', draft: 4 })).toThrow(/draft must be a string/);
    const plain = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never });
    expect((plain.renderPage!({ doc: doc.id, path: 'index.html' }) as { missing: string[] }).missing).toEqual(['zcc-kit/site.css']);
  });

  it('reads the files a page fetches, the site kit included', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const kit = vi.fn((path: string) => (path === 'site.js' ? { path: `zcc-kit/${path}`, kind: 'code' as const, content: 'go()', encoding: 'utf8' as const, revision: 0 } : null));
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, kit });
    const doc = await rpc.create!({ title: 'Site', template: 'blank' }) as { id: string };
    store.writeFile(doc.id, { path: 'data/runs.json', content: '[1]' }, UI_USER);
    expect(rpc.readPageFile!({ doc: doc.id, path: './data/runs.json' })).toEqual({ kind: 'code', encoding: 'utf8', content: '[1]' });
    expect(rpc.readPageFile!({ doc: doc.id, path: 'zcc-kit/site.js' })).toEqual({ kind: 'code', encoding: 'utf8', content: 'go()' });
    expect(rpc.readPageFile!({ doc: doc.id, path: 'absent.json' })).toBeNull();
    expect(rpc.readPageFile!({ doc: doc.id, path: '../escape.json' })).toBeNull();
    expect(createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never }).readPageFile!({ doc: doc.id, path: 'zcc-kit/site.js' })).toBeNull();
    expect(() => rpc.readPageFile!({ doc: doc.id })).toThrow(/path/);
  });

  it('hands over the doc as a static site for download, the kit its pages load included', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const kit = vi.fn((path: string) => ({ path: `zcc-kit/${path}`, kind: 'code' as const, content: `/* ${path} */`, encoding: 'utf8' as const, revision: 0 }));
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, kit });
    const doc = await rpc.create!({ title: 'Pay Site', template: 'blank' }) as { id: string; slug: string };
    store.writeFile(doc.id, { path: 'index.html', content: '<script src="zcc-kit/site.js"></script>' }, UI_USER);
    store.writeFile(doc.id, { path: 'logo.png', content: 'iVBORw0K', encoding: 'base64' }, UI_USER);
    const site = rpc.siteFiles!({ doc: doc.slug }) as { slug: string; files: Array<{ path: string; encoding: string }> };
    expect(site.slug).toBe(doc.slug);
    expect(site.files.map((file) => file.path)).toEqual(['index.html', 'logo.png', 'README.md', 'zcc-kit/site.css', 'zcc-kit/site.js', '.nojekyll']);
    expect(site.files.find((file) => file.path === 'logo.png')!.encoding).toBe('base64');
    expect(() => rpc.siteFiles!({ doc: 'nope' })).toThrow(/not found/);
  });

  it('links to a page served standalone', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const pageUrl = vi.fn((docId: string, path: string) => `http://127.0.0.1:8780/page?doc=${docId}&path=${path}`);
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, pageUrl });
    const doc = await rpc.create!({ title: 'Site', template: 'blank' }) as { id: string; entryPath: string };
    expect(rpc.pageLink!({ doc: doc.id, path: './runs/a.html' })).toEqual({ url: `http://127.0.0.1:8780/page?doc=${doc.id}&path=runs/a.html` });
    expect(rpc.pageLink!({ doc: doc.id })).toEqual({ url: `http://127.0.0.1:8780/page?doc=${doc.id}&path=${doc.entryPath}` });
    expect(() => rpc.pageLink!({ doc: doc.id, path: '../x.html' })).toThrow(DesignDocError);
    expect(() => createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never }).pageLink!({ doc: doc.id })).toThrow(/not served here/);
  });

  it('keeps what the panel saw when it ran a page', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const reports = new RenderReports();
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, reports });
    const doc = store.create({ title: 'Site', files: [{ path: 'index.html', content: '<p>Hi</p>' }] }, UI_USER);
    const report = { doc: doc.id, path: 'index.html', revision: 1, deps: [], missing: [], problems: [{ kind: 'error', message: 'boom' }], unanchored: [] };
    expect(rpc.reportRender!(report)).toEqual({ ok: true });
    expect(reports.current(doc.id, store.get(doc.id).files)).toMatchObject([{ docId: doc.id, path: 'index.html', problems: [{ kind: 'error', message: 'boom' }] }]);
    expect(() => rpc.reportRender!({ ...report, revision: 0 })).toThrow(/saved revision/);
    expect(() => rpc.reportRender!({ ...report, doc: 'missing' })).toThrow(/not found/);
    // Without a report store the panel's reports are accepted and dropped.
    expect(createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never }).reportRender!(report)).toEqual({ ok: true });
  });

  it('manages comments and linked threads', async () => {
    const { call, store } = setup();
    const doc = await call('create', { title: 'Doc', template: 'blank' });
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
    const doc = await call('create', { title: 'Sync', projectId: 'p1', template: 'blank' });

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
    const global = await call('create', { title: 'Global', template: 'blank' });
    await expect(call('askAgent', { doc: global.id, action: 'dance' })).rejects.toThrow(/unknown agent action/);
    await expect(call('askAgent', { doc: global.id })).rejects.toThrow(/pick an action/);
    await expect(call('askAgent', { doc: global.id, prompt: 'x'.repeat(4001) })).rejects.toThrow(/at most 4000/);
    await expect(call('askAgent', { doc: global.id, action: 'plan' })).rejects.toThrow(/choose a project/);
    await expect(call('askAgent', { doc: global.id, action: 'plan', projectId: 'p-unknown' })).rejects.toThrow(/unknown project/);
    await expect(call('askAgent', { doc: global.id, action: 'plan', projectId: 'p1' })).resolves.toMatchObject({ projectId: 'p1' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('registers every handler as an rpc method', () => {
    const method = vi.fn();
    const { store } = setup();
    registerRpc({ rpc: { method } } as never, { store, changed: () => {}, sdk: {} as never });
    expect(method.mock.calls.map(([name]) => name)).toContain('askAgent');
    expect(method).toHaveBeenCalledTimes(27);
  });
});
