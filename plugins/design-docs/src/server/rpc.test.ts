import { describe, expect, it, vi } from 'vitest';
import { RenderReports } from './render-reports.js';
import { createRpcHandlers, registerRpc, titleFromMarkdown, UI_USER } from './rpc.js';
import { DesignDocError, DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const changed = vi.fn();
  const spawn = vi.fn(async () => ({ id: 'thread-42' }));
  const get = vi.fn(async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: 'p1', title: 'Planner' }));
  const sdk = {
    threads: { spawn, get },
    projects: { list: async () => [{ id: 'p1', name: 'App', path: '/secret/path' }, { id: 'q', name: 'Default Project', quickAgent: true }] }
  };
  const rpc = createRpcHandlers({ store, changed, sdk: sdk as never });
  const call = (name: string, args?: unknown) => rpc[name]!(args) as any;
  return { store, changed, spawn, get, call };
}

describe('Design Docs RPC', () => {
  it('bounds peer review to retained heads and attributes resolution to user without trusting renderer origin', () => {
    const { store } = setup();
    const doc = store.create({ title: 'Review', template: 'blank' }, UI_USER);
    const peerSync = { conflicts: vi.fn(() => ({ remoteHeads: ['remote'], nextCursor: null })),
      conflictReview: vi.fn(() => ({ localHead: 'local' })), conflictFile: vi.fn(() => ({ localHead: 'local' })),
      resolveConflict: vi.fn(() => 'resolved') };
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, peerSync: peerSync as unknown as DesignDocPeerService });
    expect(rpc.peerConflicts!({ doc: doc.slug, cursor: 'prior' })).toEqual({ remoteHeads: ['remote'], nextCursor: null });
    expect(peerSync.conflicts).toHaveBeenCalledWith(doc.id, 'prior');
    rpc.peerConflictReview!({ doc: doc.id, remoteHead: 'remote' });
    expect(peerSync.conflictReview).toHaveBeenCalledWith(doc.id, 'remote');
    rpc.peerConflictFile!({ doc: doc.id, remoteHead: 'remote', path: 'README.md' });
    expect(peerSync.conflictFile).toHaveBeenCalledWith(doc.id, 'remote', 'README.md');
    expect(() => rpc.resolvePeerConflict!({ doc: doc.id, remoteHead: 'remote', choice: 'merge' })).toThrow(/expectedHead/);
    expect(() => rpc.resolvePeerConflict!({ doc: doc.id, expectedHead: 'local', remoteHead: 'remote', choice: 'force' })).toThrow(/choice/);
    expect(rpc.resolvePeerConflict!({ doc: doc.id, expectedHead: 'local', remoteHead: 'remote', choice: 'remote', origin: 'local-authoring' })).toEqual({ head: 'resolved' });
    expect(peerSync.resolveConflict).toHaveBeenCalledExactlyOnceWith({ docId: doc.id, expectedHead: 'local', remoteHead: 'remote', choice: 'remote' }, UI_USER);
    const unavailable = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never });
    expect(unavailable.peerConflicts!({ doc: doc.id })).toEqual({ remoteHeads: [], nextCursor: null });
    for (const method of ['peerConflictReview', 'peerConflictFile', 'resolvePeerConflict']) {
      expect(() => unavailable[method]!({ doc: doc.id })).toThrow(/unavailable/);
    }
  });
  it('passes file identity CAS through write, edit, delete, rename and restore RPCs', () => {
    const { store, call, changed } = setup();
    const doc = store.create({ title: 'Identity', files: [{ path: 'README.md', content: 'one' }, { path: 'other.md', content: 'two' }] }, UI_USER);
    const file = call('readFile', { doc: doc.id, path: 'other.md' });
    const revision = store.history(doc.id).find((row) => row.path === file.path)!;
    const options = { doc: doc.id, baseRevision: file.revision, baseFileId: 'stale-id' };
    for (const [method, args] of [
      ['writeFile', { path: file.path, content: 'stale' }],
      ['editFile', { path: file.path, edits: [{ oldText: 'two', newText: 'stale' }] }],
      ['deleteFile', { path: file.path }],
      ['renameFile', { from: file.path, to: 'moved.md' }],
      ['restore', { id: revision.id }]
    ] as const) expect(() => call(method, { ...options, ...args })).toThrow(/identity changed/);
    expect(changed).not.toHaveBeenCalled();
    expect(call('writeFile', { ...options, baseFileId: file.fileId, path: file.path, content: 'fresh' }).fileId).toBe(file.fileId);
    expect(call('writeFile', { doc: doc.id, path: 'new.md', content: 'new', baseRevision: 0, baseFileId: null }).fileId).toBeTruthy();
  });

  it.each([{ status: 'approved' }, { title: 'Stale' }, { tags: ['stale'] }, { entryPath: 'other.md' }])(
    'passes expectedHead and rejects stale metadata %j without notifications or intents', async (patch) => {
      const db = createTestDatabase();
      let sync!: DesignDocSyncStore;
      const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
      sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
      sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, joinedAt: 1, sponsorReplicaId: null })));
      const changed = vi.fn();
      const handlers = createRpcHandlers({ store, changed, sdk: { projects: { list: async () => [] } } as never });
      const doc = store.create({ title: 'Reviewed', files: [{ path: 'README.md', content: 'reviewed' }, { path: 'other.md', content: '' }] }, UI_USER);
      const expectedHead = (handlers.get!({ doc: doc.id }) as typeof doc).head;
      expect(expectedHead).toBe(sync.head('repo', doc.id));
      store.writeFile(doc.id, { path: 'README.md', content: 'replacement' }, UI_USER);
      const before = store.get(doc.id), operations = sync.operations('repo');
      await expect(handlers.update!({ doc: doc.id, ...patch, expectedHead })).rejects.toThrow(/head changed/);
      await expect(handlers.update!({ doc: doc.id, ...patch })).rejects.toThrow(/expectedHead/);
      await expect(handlers.update!({ doc: doc.id, ...patch, expectedHead: 42 })).rejects.toThrow(/string/);
      expect(store.get(doc.id)).toEqual(before);
      expect(sync.operations('repo')).toEqual(operations);
      expect(sync.readyIntents('repo')).toEqual([]);
      expect(changed).not.toHaveBeenCalled();
      await handlers.update!({ doc: doc.id, ...patch, expectedHead: before.head });
      expect(changed).toHaveBeenCalledExactlyOnceWith(doc.id);
    }
  );

  it('group control accepts peer identity only, never renderer roster or arbitrary scope', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const pairing = { status: vi.fn(async () => ({ configured: false })), enable: vi.fn(async () => ({ configured: true })),
      retry: vi.fn(async () => {}), revoke: vi.fn(async () => ({ configured: true })),
      remove: vi.fn(async () => { throw new Error('SDK peers.revoke unavailable'); }) };
    const handlers = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, pairing: pairing as never });
    expect(() => handlers.enablePeer!({ peerId: 'app', members: [] })).toThrow(/only peerId/);
    expect(() => handlers.enablePeer!({ peerId: 'app', scope: 'other' })).toThrow(/only peerId/);
    expect(() => handlers.enablePeer!({})).toThrow(/peerId/);
    await expect(handlers.enablePeer!({ peerId: 'app' })).resolves.toEqual({ configured: true });
    expect(pairing.enable).toHaveBeenCalledExactlyOnceWith('app');
    await expect(handlers.groupStatus!(undefined)).resolves.toEqual({ configured: false });
    await handlers.retryIntroductions!(undefined); expect(pairing.retry).toHaveBeenCalledOnce();
    await expect(handlers.removePeer!({ replicaId: 'replica' })).rejects.toThrow(/revoke unavailable/);
    expect(() => handlers.removePeer!({ replicaId: 'replica', scope: 'other' })).toThrow(/only replicaId/);
    expect(handlers.revokePeer).toBeUndefined();
    const unavailable = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never });
    expect(() => unavailable.groupStatus!(undefined)).toThrow(/unavailable/);
    expect(() => unavailable.enablePeer!({ peerId: 'app' })).toThrow(/unavailable/);
    expect(() => unavailable.removePeer!({ replicaId: 'replica' })).toThrow(/unavailable/);
    await expect(unavailable.retryIntroductions!(undefined)).rejects.toThrow(/unavailable/);
  });
  it('peerStatus marks this computer and linked members connected, and degrades without pairing or on a failed lookup', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const members = [{ replicaId: 'r-a', machineId: 'app-a' }, { replicaId: 'r-b', machineId: 'app-b' }, { replicaId: 'r-c', machineId: 'app-c' }];
    const peerSync = { status: () => ({ configured: true, replicaId: 'r-a', members }) };
    const connectedMembers = vi.fn(async () => ['app-b']);
    const withPairing = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, peerSync: peerSync as never, pairing: { connectedMembers } as never });
    await expect(withPairing.peerStatus!(undefined)).resolves.toMatchObject({ configured: true, members: [
      { machineId: 'app-a', connected: true }, { machineId: 'app-b', connected: true }, { machineId: 'app-c', connected: false }] });
    const failing = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, peerSync: peerSync as never,
      pairing: { connectedMembers: async () => { throw new Error('host down'); } } as never });
    await expect(failing.peerStatus!(undefined)).resolves.toMatchObject({ members: [{ connected: true }, { connected: false }, { connected: false }] });
    const bare = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, peerSync: peerSync as never });
    await expect(bare.peerStatus!(undefined)).resolves.toMatchObject({ members: [{ connected: true }, { connected: false }, { connected: false }] });
    const unconfigured = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, peerSync: { status: () => ({ configured: false, members: [] }) } as never });
    await expect(unconfigured.peerStatus!(undefined)).resolves.toEqual({ configured: false, members: [] });
    await expect(createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never }).peerStatus!(undefined)).resolves.toEqual({ configured: false, members: [] });
  });

  it('captures message import plus association as one trusted import, not milestone', async () => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, joinedAt: 1, sponsorReplicaId: null })));
    const sdk = { threads: { get: async () => ({ id: 'thread', title: 'Source', projectId: 'p1' }) }, projects: { list: async () => [] } };
    const handlers = createRpcHandlers({ store, sdk: sdk as never, changed: vi.fn() });
    await handlers.createFromMessage!({ threadId: 'thread', text: '# Message', origin: 'local-authoring', status: 'approved' });
    expect(sync.operations('repo').map((op) => op.origin)).toEqual(['import']);
    expect(sync.readyIntents('repo')).toEqual([]);
    expect(store.get(store.list()[0]!.id).threads).toHaveLength(1);
    await handlers.create!({ title: 'Ordinary', status: 'approved', origin: 'import' });
    expect(sync.operations('repo').at(-1)!.origin).toBe('local-authoring');
    expect(sync.readyIntents('repo')).toHaveLength(1);
  });
  it('serves templates and projects without leaking paths', async () => {
    const { call } = setup();
    expect(call('templates').map((template: { id: string }) => template.id)).toEqual(['technical', 'product', 'adr', 'api', 'report', 'html-design', 'blank']);
    expect(call('templates')[0].files).toContain('README.md');
    await expect(call('projects')).resolves.toEqual([{ id: 'p1', name: 'App' }, { id: 'q', name: 'Default Project', quickAgent: true }]);
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

  it('pins docs and links alternatives', async () => {
    const { call, changed } = setup();
    const original = await call('create', { title: 'Trace API', template: 'blank' });
    const doc = await call('create', { title: 'Unlocked package', template: 'blank' });

    const pinned = call('pin', { doc: doc.id, pinned: true });
    expect(pinned.pinnedAt).toEqual(expect.any(Number));
    expect(changed).toHaveBeenLastCalledWith(doc.id);
    expect(call('pin', { doc: doc.id, pinned: false }).pinnedAt).toBeNull();
    expect(() => call('pin', { doc: doc.id, pinned: 'yes' })).toThrow(/boolean/);

    expect((await call('update', { doc: doc.id, alternativeTo: original.id })).alternativeTo).toBe(original.id);
    expect((await call('update', { doc: doc.id, alternativeTo: '' })).alternativeTo).toBeNull();
    expect((await call('update', { doc: doc.id, alternativeTo: original.id })).alternativeTo).toBe(original.id);
    expect((await call('update', { doc: doc.id, alternativeTo: null })).alternativeTo).toBeNull();
    await expect(call('update', { doc: doc.id, alternativeTo: 7 })).rejects.toThrow(/string or null/);
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

    // A renderer-supplied provider is ignored: agents always run on the project AI harness.
    await expect(call('askAgent', { doc: doc.id, action: 'review', path: 'README.md', providerId: 'codex' })).resolves.toEqual({
      threadId: 'thread-42',
      projectId: 'p1'
    });
    const request = (spawn.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(request).toMatchObject({
      projectId: 'p1',
      title: 'Review · Sync',
      harness: 'project-default',
      visibility: 'hidden',
      pluginMetadata: { designDocId: doc.id, action: 'review', panelAgent: { panel: 'design-docs', view: doc.id } }
    });
    expect(request).not.toHaveProperty('providerId');
    expect(request.prompt).toContain('Focus on README.md.');
    expect(request.prompt).toContain(`::design-doc{id="${doc.id}"}`);
    expect(store.get(doc.id).threads[0]).toMatchObject({ threadId: 'thread-42', role: 'reviewer' });

    await call('askAgent', { doc: doc.id, prompt: '  Add a rollout section  ' });
    const custom = (spawn.mock.calls[1] as unknown[])[0] as Record<string, any>;
    expect(custom).toMatchObject({ title: 'Design doc · Sync', pluginMetadata: { designDocId: doc.id } });
    expect(custom).not.toHaveProperty('providerId');
    expect(custom.harness).toBe('project-default');
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

  it('publishes a doc through a linked agent thread', async () => {
    const { call, spawn, store, changed } = setup();
    const doc = await call('create', { title: 'Collab', projectId: 'p1', template: 'html-design' });
    await expect(call('publish', { doc: doc.id, repo: 'https://github.com/o/site', branch: 'main', folder: 'docs' })).resolves.toEqual({
      threadId: 'thread-42',
      projectId: 'p1'
    });
    const request = (spawn.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(request).toMatchObject({
      projectId: 'p1',
      title: 'Publish · Collab',
      harness: 'project-default',
      visibility: 'hidden',
      pluginMetadata: { designDocId: doc.id, action: 'publish', panelAgent: { panel: 'design-docs', view: doc.id } }
    });
    expect(request.prompt).toContain('https://github.com/o/site, branch main, folder /docs');
    expect(store.get(doc.id).threads[0]).toMatchObject({ threadId: 'thread-42', role: 'assistant', title: 'Publish · Collab' });
    expect(changed).toHaveBeenLastCalledWith(doc.id);
  });

  it('validates publish requests', async () => {
    const { call, spawn } = setup();
    const site = await call('create', { title: 'Site', template: 'html-design' });
    const notes = await call('create', { title: 'Notes', projectId: 'p1', template: 'blank' });
    await expect(call('publish', { doc: site.id, branch: 'a b' })).rejects.toThrow(/valid git branch/);
    await expect(call('publish', { doc: site.id, repo: 'file:///x', branch: 'main' })).rejects.toThrow(/clone URL/);
    await expect(call('publish', { doc: notes.id, branch: 'main' })).rejects.toThrow(/no HTML pages/);
    await expect(call('publish', { doc: site.id, branch: 'main' })).rejects.toThrow(/choose a project/);
    await expect(call('publish', { doc: site.id, branch: 'main', projectId: 'p-unknown' })).rejects.toThrow(/unknown project/);
    expect(spawn).not.toHaveBeenCalled();
    await expect(call('publish', { doc: site.id, branch: 'main', projectId: 'p1' })).resolves.toMatchObject({ projectId: 'p1' });
    expect((spawn.mock.calls[0] as unknown[])[0]).toMatchObject({ projectId: 'p1' });
    expect(((spawn.mock.calls[0] as unknown[])[0] as { prompt: string }).prompt).toContain("this project's repository");
  });

  it('ignores a legacy stored Agent harness setting and spawns every agent on the project harness', async () => {
    // Earlier builds stored `agent-harness` in plugin kv ("Always use"). It is
    // never read now, so such a value behaves as "follow the project".
    const store = new DesignDocStore(createTestDatabase());
    const spawn = vi.fn(async () => ({ id: 'thread-7' }));
    const kvStore = new Map<string, unknown>([['agent-harness', {
      mode: 'provider',
      providerId: 'codex',
      harnessRouting: { schemaVersion: 1, byAdapter: { codex: { compatibility: { codexSandbox: 'danger-full-access' } } } }
    }]]);
    const kv = { get: vi.fn(async (key: string) => kvStore.get(key)), set: vi.fn() };
    const deps = {
      store,
      changed: vi.fn(),
      sdk: { threads: { spawn, get: vi.fn() }, projects: { list: async () => [{ id: 'p1', name: 'App' }] } },
      kv
    };
    const rpc = createRpcHandlers(deps as never);
    const doc = store.create({ title: 'Site', template: 'html-design', projectId: 'p1' }, UI_USER);
    await rpc.askAgent!({ doc: doc.id, action: 'review' });
    await rpc.publish!({ doc: doc.id, branch: 'main' });
    expect(spawn).toHaveBeenCalledTimes(2);
    for (const [request] of spawn.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(request.harness).toBe('project-default');
      expect(request).not.toHaveProperty('providerId');
      expect(request).not.toHaveProperty('harnessRouting');
    }
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.set).not.toHaveBeenCalled();
  });

  it('passes a host harness error through unchanged', async () => {
    const { call, spawn } = setup();
    const doc = await call('create', { title: 'Sync', projectId: 'p1', template: 'blank' });
    const message = 'No usable AI harness: Default harness unavailable. Choose an installed, enabled harness in Settings → AI Harness.';
    spawn.mockRejectedValueOnce(new Error(message));
    await expect(call('askAgent', { doc: doc.id, action: 'review' })).rejects.toThrow(message);
  });

  it('registers every handler as an rpc method', () => {
    const method = vi.fn();
    const { store } = setup();
    registerRpc({ rpc: { method } } as never, { store, changed: () => {}, sdk: {} as never });
    expect(method.mock.calls.map(([name]) => name)).toContain('askAgent');
    expect(method.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      'publish', 'pin', 'peerStatus', 'groupStatus', 'enablePeer', 'retryIntroductions', 'removePeer', 'connections', 'useConnection', 'stopUsingConnection',
      'syncNow', 'peerConflicts', 'peerConflictReview', 'peerConflictFile', 'resolvePeerConflict', 'backupDatabase', 'backups'
    ]));
    expect(method.mock.calls.map(([name]) => name)).not.toContain('agentSettings');
    expect(method.mock.calls.map(([name]) => name)).not.toContain('setAgentSettings');
    expect(method.mock.calls.map(([name]) => name)).not.toContain('agentHarnesses');
    expect(method).toHaveBeenCalledTimes(47);
  });
});

describe('Design Docs connection RPC handlers', () => {
  function invite() {
    const store = new DesignDocStore(createTestDatabase());
    const pairing = {
      connections: vi.fn(async () => [{ computerId: 'app-b', hostname: 'B', state: 'connected', usedByThisPlugin: true, use: 'approved', syncing: false, retiring: false }]),
      useConnection: vi.fn(async () => ({ status: 'pending' })),
      stopUsingConnection: vi.fn(async () => ({ configured: false })),
      repair: vi.fn(async () => ({ outcome: 'sync-enabled', detail: null, reason: null })),
      resetPeer: vi.fn(async () => ({ discarded: 2, status: { configured: false } })),
      outOfSync: vi.fn(async () => true),
      notifyStateChanged: vi.fn(async () => undefined)
    };
    const handlers = createRpcHandlers({ store, changed: vi.fn(), sdk: {} as never, pairing: pairing as never });
    return { handlers, pairing };
  }
  const message = (run: () => unknown): string => { try { run(); } catch (error) { return (error as Error).message; } return ''; };
  const reject = async (run: () => unknown): Promise<string> => { try { await run(); } catch (error) { return (error as Error).message; } return ''; };

  it('every handler fails with a clear message when pairing is unavailable', async () => {
    const handlers = createRpcHandlers({ store: new DesignDocStore(createTestDatabase()), changed: vi.fn(), sdk: {} as never });
    const calls: Array<[string, unknown]> = [['connections', undefined], ['useConnection', { computerId: 'c' }], ['stopUsingConnection', { computerId: 'c' }],
      ['repairPeer', { peerId: 'p' }], ['resetPeerSync', { peerId: 'p' }], ['peersOutOfSync', undefined]];
    for (const [name, args] of calls) expect(await reject(() => handlers[name]!(args)), name).toBe('database group setup is unavailable');
  });

  it('connections and peersOutOfSync delegate; only a boolean reaches the UI', async () => {
    const { handlers, pairing } = invite();
    await expect(handlers.connections!(undefined)).resolves.toEqual([expect.objectContaining({ computerId: 'app-b', syncing: false })]);
    await expect(handlers.peersOutOfSync!(undefined)).resolves.toEqual({ outOfSync: true });
    pairing.outOfSync.mockResolvedValueOnce(false);
    await expect(handlers.peersOutOfSync!({ extra: 1 })).resolves.toEqual({ outOfSync: false });
    expect(pairing.connections).toHaveBeenCalledOnce();
  });

  it('useConnection and stopUsingConnection take only a computerId', async () => {
    const { handlers, pairing } = invite();
    await expect(handlers.useConnection!({ computerId: 'app-b' })).resolves.toEqual({ status: 'pending' });
    await expect(handlers.stopUsingConnection!({ computerId: 'app-b' })).resolves.toEqual({ configured: false });
    expect(pairing.useConnection).toHaveBeenCalledExactlyOnceWith('app-b');
    expect(pairing.stopUsingConnection).toHaveBeenCalledExactlyOnceWith('app-b');
    for (const name of ['useConnection', 'stopUsingConnection'] as const) {
      expect(await reject(() => handlers[name]!({}))).toBe('computerId is required');
      expect(await reject(() => handlers[name]!({ computerId: ' ' }))).toBe('computerId is required');
      expect(await reject(() => handlers[name]!({ computerId: 'x', scope: 'other' }))).toBe('accepts only computerId');
    }
  });

  it('repairPeer and resetPeerSync take a single peer id', async () => {
    const { handlers, pairing } = invite();
    await expect(handlers.repairPeer!({ peerId: 'app-b' })).resolves.toMatchObject({ outcome: 'sync-enabled' });
    expect(pairing.repair).toHaveBeenCalledExactlyOnceWith('app-b');
    await expect(handlers.resetPeerSync!({ peerId: 'app-b' })).resolves.toEqual({ discarded: 2, status: { configured: false } });
    expect(pairing.resetPeer).toHaveBeenCalledExactlyOnceWith('app-b');
    for (const name of ['repairPeer', 'resetPeerSync'] as const) {
      expect(await reject(() => handlers[name]!({}))).toBe('peerId is required');
      expect(await reject(() => handlers[name]!({ peerId: 'x', token: 'y' }))).toBe('accepts only peerId');
    }
  });

  it('propagates core failures (error codes) unchanged', async () => {
    const { handlers, pairing } = invite();
    const denied = Object.assign(new Error('unknown_connection'), { code: 'unknown_connection' });
    pairing.useConnection.mockRejectedValueOnce(denied);
    pairing.stopUsingConnection.mockRejectedValueOnce(new Error('fenced'));
    pairing.outOfSync.mockRejectedValueOnce(new Error('peer down'));
    await expect(handlers.useConnection!({ computerId: 'c' })).rejects.toBe(denied);
    expect(await reject(() => handlers.stopUsingConnection!({ computerId: 'c' }))).toBe('fenced');
    expect(await reject(() => handlers.peersOutOfSync!(undefined))).toBe('peer down');
  });

  it('syncNow tells peers to re-check afterwards without failing or awaiting the sync', async () => {
    const { pairing } = invite();
    const peerSync = { syncNow: vi.fn(async () => ({ attempted: 1, synced: 1, blocked: 0 })) };
    const store = new DesignDocStore(createTestDatabase());
    const handlers = createRpcHandlers({ store, changed: vi.fn(), sdk: { peers: {} } as never, pairing: pairing as never, peerSync: peerSync as never });
    await expect(handlers.syncNow!(undefined)).resolves.toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(pairing.notifyStateChanged).toHaveBeenCalledOnce();
    pairing.notifyStateChanged.mockRejectedValueOnce(new Error('peer down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(handlers.syncNow!(undefined)).resolves.toMatchObject({ synced: 1 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('notification failed'), 'peer down'));
    warn.mockRestore();
    const bare = createRpcHandlers({ store, changed: vi.fn(), sdk: { peers: {} } as never, peerSync: peerSync as never });
    await expect(bare.syncNow!(undefined)).resolves.toMatchObject({ synced: 1 });
  });
});
