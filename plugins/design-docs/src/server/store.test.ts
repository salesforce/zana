import { describe, expect, it } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import {
  MAX_COMMENTS_PER_DOC,
  MAX_FILES_PER_DOC,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_REVISIONS_PER_FILE,
  MAX_THREAD_LINKS_PER_DOC
} from '../shared/limits.js';
import { formatBytes } from '../shared/display.js';
import { DesignDocError, DesignDocStore, applyEdits, slugify } from './store.js';
import { createTestDatabase } from './test-db.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };
const agent: DocActor = { kind: 'agent', label: 'Planner', threadId: 'thread-1' };

function makeStore() {
  let clock = 1_000;
  let counter = 0;
  const store = new DesignDocStore(createTestDatabase(), {
    now: () => (clock += 10),
    randomId: (prefix) => `${prefix}${(counter += 1).toString().padStart(4, '0')}`
  });
  return store;
}

function expectError(fn: () => unknown, code: string, message?: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DesignDocError);
    expect((error as DesignDocError).code).toBe(code);
    if (message) expect((error as Error).message).toMatch(message);
    return;
  }
  throw new Error('expected an error');
}

describe('DesignDocStore — docs', () => {
  it('creates a doc from the default template with an entry file and history', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Offline Sync', summary: 'Sync while offline', projectId: 'p1' }, agent);
    expect(doc.slug).toBe('offline-sync');
    expect(doc.entryPath).toBe('README.md');
    expect(doc.files.map((file) => file.path)).toEqual(['README.md', 'diagrams/architecture.mmd']);
    expect(doc.files[1]!.kind).toBe('mermaid');
    expect(doc.createdBy).toEqual(agent);
    expect(doc.threads).toEqual([
      expect.objectContaining({ threadId: 'thread-1', title: 'Planner', role: 'author' })
    ]);
    expect(store.readFile(doc.id, 'README.md').content).toContain('# Offline Sync');
    expect(store.readFile(doc.id, 'README.md').content).toContain('> Sync while offline');
    expect(store.history(doc.id)).toHaveLength(2);
  });

  it('creates from explicit files, picks a markdown entry, and rejects bad input', () => {
    const store = makeStore();
    const doc = store.create(
      { title: 'Files', files: [{ path: 'notes.txt', content: 'n' }, { path: 'spec.md', content: '# Spec' }] },
      user
    );
    expect(doc.entryPath).toBe('spec.md');
    expect(doc.threads).toEqual([]);
    expectError(() => store.create({ title: '  ' }, user), 'invalid', /title is required/);
    expectError(() => store.create({ title: 'x'.repeat(200) }, user), 'invalid', /at most/);
    expectError(() => store.create({ title: 'T', template: 'nope' }, user), 'invalid', /unknown template/);
    expectError(() => store.create({ title: 'T', status: 'weird' as never }, user), 'invalid', /unknown status/);
    expectError(
      () => store.create({ title: 'T', files: [{ path: 'a.md', content: '' }, { path: 'A.md', content: '' }] }, user),
      'invalid',
      /duplicate/
    );
    expectError(
      () => store.create({ title: 'T', files: [{ path: 'a.md', content: '' }], entryPath: 'b.md' }, user),
      'invalid',
      /entryPath/
    );
    expectError(
      () => store.create({ title: 'T', files: [{ path: '../evil.md', content: '' }] }, user),
      'invalid',
      /"\."/
    );
    expectError(
      () =>
        store.create(
          { title: 'T', files: Array.from({ length: MAX_FILES_PER_DOC + 1 }, (_, i) => ({ path: `f${i}.md`, content: '' })) },
          user
        ),
      'limit'
    );
    expectError(() => store.create({ title: 'T', tags: ['x'.repeat(40)] }, user), 'invalid', /longer/);
    expectError(() => store.create({ title: 'T', tags: 'a' as never }, user), 'invalid', /array/);
    expectError(() => store.create({ title: 'T', tags: [1 as never] }, user), 'invalid', /array/);
    expectError(() => store.create({ title: 'T', tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, user), 'invalid');
    expectError(() => store.create({ title: 'T', summary: 's'.repeat(700) }, user), 'invalid', /summary/);
  });

  it('makes slugs unique and resolves docs by id or slug', () => {
    const store = makeStore();
    const a = store.create({ title: 'Café API!', template: 'blank' }, user);
    const b = store.create({ title: 'Cafe API', template: 'blank' }, user);
    const c = store.create({ title: '!!!', template: 'blank' }, user);
    expect([a.slug, b.slug, c.slug]).toEqual(['cafe-api', 'cafe-api-2', 'design-doc']);
    expect(store.find('CAFE-API-2')?.id).toBe(b.id);
    expect(store.find(a.id)?.slug).toBe('cafe-api');
    expect(store.find('missing')).toBeNull();
    expect(store.find(42)).toBeNull();
    expectError(() => store.get('missing'), 'not_found', /list docs/);
  });

  it('lists with project scope, status and full-text filters', () => {
    const store = makeStore();
    const p1 = store.create({ title: 'Alpha', projectId: 'p1', tags: ['Mobile App'], template: 'blank' }, user);
    const global = store.create({ title: 'Beta', template: 'blank' }, user);
    store.create({ title: 'Gamma', projectId: 'p2', template: 'blank' }, user);
    store.writeFile(global.id, { path: 'README.md', content: 'mentions 100%_done' }, user);
    store.update(p1.id, { status: 'archived' }, user);

    expect(store.list().map((doc) => doc.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(store.list({ projectId: 'p1' }).map((doc) => doc.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(store.list({ projectId: null }).map((doc) => doc.title)).toEqual(['Beta']);
    expect(store.list({ status: 'active' }).map((doc) => doc.title)).toEqual(['Beta', 'Gamma']);
    expect(store.list({ status: 'archived' }).map((doc) => doc.title)).toEqual(['Alpha']);
    expect(store.list({ query: 'mobile-app' }).map((doc) => doc.title)).toEqual(['Alpha']);
    expect(store.list({ query: '100%_' }).map((doc) => doc.title)).toEqual(['Beta']);
    expect(store.list({ query: '%' }).map((doc) => doc.title)).toEqual(['Beta']);
    expect(store.list({ query: 'zzz' })).toEqual([]);
    expect(store.list({ limit: 1 })).toHaveLength(1);
    expect(store.list({ limit: -3 })).toHaveLength(3);
    expectError(() => store.list({ status: 'nope' as never }), 'invalid');
    const [first] = store.list({ projectId: 'p1', status: 'archived' });
    expect(first).toMatchObject({ fileCount: 1, openComments: 0, tags: ['mobile-app'] });
  });

  it('updates metadata and bumps the doc revision', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'technical' }, user);
    const updated = store.update(
      doc.id,
      { title: ' New   title ', summary: 'S', status: 'review', tags: ['A', 'a', ' '], entryPath: 'diagrams/architecture.mmd', projectId: 'p9' },
      agent
    );
    expect(updated).toMatchObject({
      title: 'New title',
      summary: 'S',
      status: 'review',
      tags: ['a'],
      entryPath: 'diagrams/architecture.mmd',
      projectId: 'p9',
      revision: doc.revision + 1,
      updatedBy: agent
    });
    expect(store.update(doc.id, {}, user).revision).toBe(updated.revision);
    expectError(() => store.update(doc.id, { entryPath: 'nope.md' }, user), 'invalid', /entryPath/);
    expectError(() => store.update(doc.id, { status: 'nope' as never }, user), 'invalid');
  });

  it('removes a doc and everything that belongs to it', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    store.addComment(doc.id, { body: 'hi' }, user);
    store.remove(doc.id);
    expect(store.find(doc.id)).toBeNull();
    expect(store.list()).toEqual([]);
  });
});

describe('DesignDocStore — files', () => {
  it('writes, skips no-op writes, and enforces baseRevision', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const first = store.writeFile(doc.id, { path: 'README.md', content: 'v2', baseRevision: 1, note: '  tidy  ' }, agent);
    expect(first).toMatchObject({ revision: 2, created: false, updatedBy: agent });
    expect(store.history(doc.id, { path: 'README.md' })[0]).toMatchObject({ op: 'write', note: 'tidy', revision: 2 });
    const same = store.writeFile(doc.id, { path: 'README.md', content: 'v2' }, user);
    expect(same.revision).toBe(2);
    expectError(
      () => store.writeFile(doc.id, { path: 'README.md', content: 'v3', baseRevision: 1 }, user),
      'conflict',
      /changed since revision 1 \(now 2, last edited by agent|Planner/
    );
    expectError(() => store.writeFile(doc.id, { path: 'new.md', content: 'x', baseRevision: 3 }, user), 'conflict', /does not exist/);
    expectError(() => store.writeFile(doc.id, { path: 'README.md', content: 'x', baseRevision: -1 }, user), 'invalid');
    const created = store.writeFile(doc.id, { path: 'docs/new.md', content: 'x', baseRevision: 0 }, user);
    expect(created).toMatchObject({ created: true, revision: 1 });
    expect(store.get(doc.id).threads).toEqual([expect.objectContaining({ role: 'editor' })]);
  });

  it('validates content type, size, case clashes and file count', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    expectError(() => store.writeFile(doc.id, { path: 'x.md', content: 5 as never }, user), 'invalid', /string/);
    expectError(() => store.writeFile(doc.id, { path: 'readme.md', content: 'x' }, user), 'conflict', /letter case/);
    expectError(
      () => store.writeFile(doc.id, { path: 'big.md', content: 'x'.repeat(MAX_TEXT_FILE_BYTES + 1) }, user),
      'limit',
      /split/
    );
    expectError(() => store.writeFile(doc.id, { path: 'a.png', content: 'abc', encoding: 'utf8' }, user), 'invalid', /base64/);
    expectError(() => store.writeFile(doc.id, { path: 'a.md', content: 'abc', encoding: 'base64' }, user), 'invalid', /UTF-8/);
    expectError(() => store.writeFile(doc.id, { path: 'a.png', content: 'not base64!' }, user), 'invalid', /valid base64/);
    const png = store.writeFile(doc.id, { path: 'img/a.png', content: 'iVBO\nRw0K' }, user);
    expect(png).toMatchObject({ kind: 'image', size: 6 });
    expect(store.readFile(doc.id, 'img/a.png')).toMatchObject({ encoding: 'base64', content: 'iVBORw0K' });
    for (let index = store.get(doc.id).files.length; index < MAX_FILES_PER_DOC; index += 1) {
      store.writeFile(doc.id, { path: `f/${index}.md`, content: '' }, user);
    }
    expectError(() => store.writeFile(doc.id, { path: 'overflow.md', content: '' }, user), 'limit', /files/);
    expectError(() => store.readFile(doc.id, 'nope.md'), 'not_found', /files: /);
  });

  it('applies exact-match edits like an agent Edit tool', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'a b a c' }] }, user);
    const result = store.editFile(doc.id, { path: 'README.md', edits: [{ oldText: 'b', newText: 'B' }], baseRevision: 1 }, agent);
    expect(result.revision).toBe(2);
    expect(store.readFile(doc.id, 'README.md').content).toBe('a B a c');
    store.editFile(doc.id, { path: 'README.md', edits: [{ oldText: 'a', newText: '$&x', replaceAll: true }] }, agent);
    expect(store.readFile(doc.id, 'README.md').content).toBe('$&x B $&x c');
    expectError(() => store.editFile(doc.id, { path: 'README.md', edits: [] }, agent), 'invalid', /non-empty/);
    expectError(() => store.editFile(doc.id, { path: 'gone.md', edits: [{ oldText: 'a', newText: 'b' }] }, agent), 'not_found');
    expectError(
      () => store.editFile(doc.id, { path: 'README.md', edits: Array.from({ length: 51 }, () => ({ oldText: 'a', newText: 'b' })) }, agent),
      'limit'
    );
    expectError(
      () => store.editFile(doc.id, { path: 'README.md', edits: [{ oldText: 'B', newText: 'C' }], baseRevision: 1 }, agent),
      'conflict'
    );
    store.writeFile(doc.id, { path: 'a.png', content: 'iVBORw0K' }, user);
    expectError(() => store.editFile(doc.id, { path: 'a.png', edits: [{ oldText: 'i', newText: 'j' }] }, agent), 'invalid', /binary/);
  });

  it('deletes and renames files, keeping history and the entry path valid', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'technical' }, user);
    store.renameFile(doc.id, 'README.md', 'overview.md', agent);
    expect(store.get(doc.id).entryPath).toBe('overview.md');
    expect(store.history(doc.id, { path: 'overview.md' })[0]).toMatchObject({ op: 'rename', renamedFrom: 'README.md' });
    expect(store.history(doc.id, { path: 'README.md' })[0]).toMatchObject({ op: 'delete', note: 'Renamed to overview.md' });
    expectError(() => store.renameFile(doc.id, 'overview.md', 'overview.md', user), 'invalid', /differ/);
    expectError(() => store.renameFile(doc.id, 'overview.md', 'DIAGRAMS/architecture.mmd', user), 'conflict', /already exists/);
    expectError(() => store.renameFile(doc.id, 'overview.md', 'overview.png', user), 'invalid', /encoding/);
    expectError(() => store.renameFile(doc.id, 'missing.md', 'x.md', user), 'not_found');
    store.renameFile(doc.id, 'overview.md', 'Overview.md', user);

    store.deleteFile(doc.id, 'Overview.md', user, { note: 'gone' });
    const after = store.get(doc.id);
    expect(after.files.map((file) => file.path)).toEqual(['diagrams/architecture.mmd']);
    expect(after.entryPath).toBe('diagrams/architecture.mmd');
    expectError(() => store.deleteFile(doc.id, 'diagrams/architecture.mmd', user), 'invalid', /at least one/);
    expectError(() => store.deleteFile(doc.id, 'Overview.md', user), 'not_found');

    // Recreating a deleted path continues its revision numbering.
    const recreated = store.writeFile(doc.id, { path: 'README.md', content: 'back' }, user);
    expect(recreated.revision).toBeGreaterThan(1);
    store.deleteFile(doc.id, 'README.md', agent);
    expect(store.get(doc.id).threads[0]).toMatchObject({ role: 'editor' });
  });

  it('restores past revisions, including deleted files', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'one' }, { path: 'x.md', content: 'x' }] }, user);
    store.writeFile(doc.id, { path: 'README.md', content: 'two' }, user);
    const firstRevision = store.history(doc.id, { path: 'README.md' }).at(-1)!;
    expect(store.revisionContent(doc.id, firstRevision.id)).toMatchObject({ content: 'one', encoding: 'utf8' });
    const restored = store.restoreRevision(doc.id, firstRevision.id, user);
    expect(restored.revision).toBe(3);
    expect(store.readFile(doc.id, 'README.md').content).toBe('one');
    expect(store.history(doc.id, { path: 'README.md' })[0]!.note).toBe('Restored revision 1');

    store.deleteFile(doc.id, 'x.md', user);
    const deletion = store.history(doc.id, { path: 'x.md' })[0]!;
    store.restoreRevision(doc.id, deletion.id, user);
    expect(store.readFile(doc.id, 'x.md').content).toBe('x');
    expectError(() => store.revisionContent(doc.id, 'abc'), 'not_found');
    expectError(() => store.restoreRevision(doc.id, 99999, user), 'not_found');
  });

  it('prunes per-file history to the retention cap', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    for (let index = 0; index < MAX_TEXT_REVISIONS_PER_FILE + 5; index += 1) {
      store.writeFile(doc.id, { path: 'README.md', content: `v${index}` }, user);
    }
    const history = store.history(doc.id, { path: 'README.md', limit: 100 });
    expect(history).toHaveLength(MAX_TEXT_REVISIONS_PER_FILE);
    expect(store.history(doc.id, { limit: 3 })).toHaveLength(3);
  });

  it('returns every file in tree order', () => {
    const store = makeStore();
    const doc = store.create(
      { title: 'Doc', files: [{ path: 'b/z.md', content: '' }, { path: 'README.md', content: '' }, { path: 'a.md', content: '' }] },
      user
    );
    expect(store.readAllFiles(doc.id).map((file) => file.path)).toEqual(['a.md', 'README.md', 'b/z.md']);
  });
});

describe('DesignDocStore — comments and threads', () => {
  it('adds, resolves, reopens and deletes comments', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const comment = store.addComment(doc.id, { body: ' Why? ', path: 'README.md', quote: '  # Doc ' }, agent);
    expect(comment).toMatchObject({ body: 'Why?', path: 'README.md', quote: '# Doc', status: 'open', author: agent });
    expect(store.summary(doc.id).openComments).toBe(1);
    expect(store.get(doc.id).threads[0]).toMatchObject({ role: 'reviewer' });
    const resolved = store.setCommentStatus(doc.id, comment.id, 'resolved', user);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(store.setCommentStatus(doc.id, comment.id, 'open', user).resolvedAt).toBeNull();
    store.deleteComment(doc.id, comment.id, user);
    expect(store.get(doc.id).comments).toEqual([]);
    expectError(() => store.addComment(doc.id, { body: ' ' }, user), 'invalid');
    expectError(() => store.addComment(doc.id, { body: 'x'.repeat(9000) }, user), 'limit');
    expectError(() => store.addComment(doc.id, { body: 'x', path: 'nope.md' }, user), 'not_found');
    expectError(() => store.setCommentStatus(doc.id, 'c_nope', 'resolved', user), 'not_found');
    expectError(() => store.setCommentStatus(doc.id, comment.id, 'weird' as never, user), 'invalid');
    expectError(() => store.deleteComment(doc.id, 'c_nope', user), 'not_found');
  });

  it('caps comments per doc', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    for (let index = 0; index < MAX_COMMENTS_PER_DOC; index += 1) store.addComment(doc.id, { body: `c${index}` }, user);
    expectError(() => store.addComment(doc.id, { body: 'one more' }, user), 'limit', /resolved/);
  });

  it('keeps the strongest thread role, tracks activity and forgets deleted threads', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    store.addComment(doc.id, { body: 'x' }, agent);
    expect(store.get(doc.id).threads[0]!.role).toBe('author');
    store.linkThread(doc.id, 'thread-2', 'Reviewer', 'assistant');
    store.linkThread(doc.id, 'thread-2', '', 'reviewer');
    expect(store.get(doc.id).threads[0]).toMatchObject({ threadId: 'thread-2', title: 'Reviewer', role: 'reviewer' });
    expect(store.touchThread('thread-2', 'Renamed')).toEqual([doc.id]);
    expect(store.get(doc.id).threads.find((thread) => thread.threadId === 'thread-2')!.title).toBe('Renamed');
    expect(store.touchThread('unknown', 'x')).toEqual([]);
    store.unlinkThread(doc.id, 'thread-2');
    expect(store.get(doc.id).threads.map((thread) => thread.threadId)).toEqual(['thread-1']);
    expect(store.forgetThread('thread-1')).toEqual([doc.id]);
    expect(store.forgetThread('thread-1')).toEqual([]);
    for (let index = 0; index < MAX_THREAD_LINKS_PER_DOC + 3; index += 1) {
      store.linkThread(doc.id, `t-${index}`, `T${index}`, 'assistant');
    }
    expect(store.get(doc.id).threads).toHaveLength(MAX_THREAD_LINKS_PER_DOC);
  });
});

describe('pure helpers', () => {
  it('slugifies titles', () => {
    expect(slugify('Hello, World — 2026!')).toBe('hello-world-2026');
    expect(slugify('x'.repeat(80))).toHaveLength(48);
  });

  it('reports precise edit failures', () => {
    expect(() => applyEdits('aa', [{ oldText: 'a', newText: 'b' }], 'f.md')).toThrow(/matches 2 places/);
    expect(() => applyEdits('aa', [{ oldText: 'z', newText: 'b' }, { oldText: 'a', newText: 'c' }], 'f.md')).toThrow(/edit 1/);
    expect(() => applyEdits('aa', [{ oldText: '', newText: 'b' }], 'f.md')).toThrow(/empty/);
    expect(() => applyEdits('aa', [{ oldText: 'a', newText: 'a' }], 'f.md')).toThrow(/identical/);
    expect(() => applyEdits('aa', [{ oldText: 1 } as never], 'f.md')).toThrow(/string/);
  });

  it('formats byte sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MiB');
  });
});
