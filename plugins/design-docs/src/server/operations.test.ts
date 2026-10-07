import { describe, expect, it } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import {
  asInput,
  commentDoc,
  createDoc,
  docHistory,
  listDocs,
  optionalString,
  readDoc,
  requiredString,
  updateDoc,
  writeDoc,
  type ImageToolResult,
  type OperationContext
} from './operations.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const agent: DocActor = { kind: 'agent', label: 'Planner', threadId: 'thread-1' };
const PNG = 'iVBORw0KGgo=';

function setup(projectId: string | null = 'p1') {
  const store = new DesignDocStore(createTestDatabase());
  const changes: string[] = [];
  const ctx: OperationContext = { store, changed: (id) => changes.push(id), projectId };
  return { store, changes, ctx };
}

describe('input helpers', () => {
  it('normalise loosely-typed input', () => {
    expect(asInput(null)).toEqual({});
    expect(asInput([1])).toEqual({});
    expect(asInput({ a: 1 })).toEqual({ a: 1 });
    expect(() => requiredString({ doc: ' ' }, 'doc')).toThrow(/doc is required/);
    expect(optionalString({ a: null }, 'a')).toBeUndefined();
    expect(() => optionalString({ a: 1 }, 'a')).toThrow(/must be a string/);
  });
});

describe('agent operations', () => {
  it('creates docs in the calling project or globally', () => {
    const { ctx, changes, store } = setup();
    const text = createDoc(ctx, { title: 'Sync', tags: 'mobile, offline', status: 'review' }, agent);
    expect(text).toMatch(/^Created design doc dd_/);
    expect(text).toContain('::design-doc{id="dd_');
    const [doc] = store.list();
    expect(doc).toMatchObject({ projectId: 'p1', status: 'review', tags: ['mobile', 'offline'] });
    expect(changes).toEqual([doc!.id]);

    createDoc(ctx, { title: 'Global', global: 'true', files: [{ path: 'a.md', content: '# A' }, { path: 'i.png', content: PNG, encoding: 'base64' }] }, agent);
    expect(store.list({ projectId: null }).map((entry) => entry.title)).toEqual(['Global']);

    expect(() => createDoc(ctx, { title: 'x', template: 'nope' }, agent)).toThrow(/template must be one of/);
    expect(() => createDoc(ctx, { title: 'x', files: 'a' }, agent)).toThrow(/files must be an array/);
    expect(() => createDoc(ctx, { title: 'x', files: [{ path: 'a.md' }] }, agent)).toThrow(/files\[0\]/);
    expect(() => createDoc(ctx, { title: 'x', status: 'shipped' }, agent)).toThrow(/status must be one of/);
    expect(() => createDoc(ctx, { title: 'x', tags: [1] }, agent)).toThrow(/array of strings/);
  });

  it('lists the project scope by default and every project on request', () => {
    const { ctx, store } = setup();
    store.create({ title: 'Mine', projectId: 'p1', template: 'blank' }, agent);
    store.create({ title: 'Theirs', projectId: 'p2', template: 'blank' }, agent);
    expect(listDocs(ctx, {})).toMatch(/^Design docs for this project/);
    expect(listDocs(ctx, {})).not.toContain('Theirs');
    expect(listDocs(ctx, { scope: 'all', limit: '5' })).toContain('Theirs');
    expect(listDocs({ ...ctx, projectId: null }, {})).toMatch(/^Design docs across all projects/);
    expect(listDocs(ctx, { query: 'zzz' })).toContain('No design docs match.');
    expect(() => listDocs(ctx, { scope: 'mine' })).toThrow(/scope/);
    expect(() => listDocs(ctx, { status: 'nope' })).toThrow(/status must be/);
    expect(() => listDocs(ctx, { limit: 1.5 })).toThrow(/integer/);
  });

  it('reads the manifest, one file, an image, or the whole bundle', () => {
    const { ctx, store } = setup();
    const doc = store.create({ title: 'Doc', template: 'technical' }, agent);
    store.writeFile(doc.id, { path: 'img/shot.png', content: PNG }, agent);
    store.addComment(doc.id, { body: 'Clarify', path: 'README.md', quote: 'Context' }, agent);

    const manifest = readDoc(ctx, { doc: doc.slug }) as string;
    expect(manifest).toContain('## Files (3)');
    expect(manifest).toContain('README.md [entry]');
    expect(manifest).toContain('## Open comments (1)');
    expect(manifest).toContain('## Entry file');

    const file = readDoc(ctx, { doc: doc.id, path: 'diagrams/architecture.mmd' }) as string;
    expect(file).toContain('<file path="diagrams/architecture.mmd" revision="1" kind="mermaid">');
    expect(file).toContain('baseRevision=1');

    const image = readDoc(ctx, { doc: doc.id, path: 'img/shot.png' }) as ImageToolResult;
    expect(image.content[1]).toEqual({ type: 'image', data: PNG, mimeType: 'image/png' });

    const bundle = readDoc(ctx, { doc: doc.id, includeAll: true }) as string;
    expect(bundle.indexOf('path="README.md"')).toBeLessThan(bundle.indexOf('path="diagrams/architecture.mmd"'));
    expect(bundle).toContain('(binary image, not shown as text)');
  });

  it('writes content, applies edits, deletes and renames through one verb', () => {
    const { ctx, store, changes } = setup();
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'hello world' }] }, agent);

    expect(writeDoc(ctx, { doc: doc.id, path: 'notes.md', content: 'n', baseRevision: '0' }, agent)).toMatch(
      /^Created notes\.md .* revision 1/
    );
    expect(
      writeDoc(ctx, { doc: doc.id, path: 'README.md', edits: [{ oldText: 'world', newText: 'there' }], baseRevision: 1 }, agent)
    ).toMatch(/^Updated README\.md .* revision 2\. Use baseRevision=2/);
    expect(store.readFile(doc.id, 'README.md').content).toBe('hello there');
    expect(writeDoc(ctx, { doc: doc.id, path: 'i.png', content: PNG, encoding: 'base64' }, agent)).toMatch(/Created i\.png/);
    expect(writeDoc(ctx, { doc: doc.id, path: 'notes.md', renameTo: 'docs/notes.md' }, agent)).toBe(
      'Renamed notes.md to docs/notes.md (rev 1).'
    );
    expect(writeDoc(ctx, { doc: doc.id, path: 'docs/notes.md', delete: true }, agent)).toMatch(/^Deleted docs\/notes\.md/);
    expect(changes).toHaveLength(5);

    expect(() => writeDoc(ctx, { doc: doc.id, path: 'README.md' }, agent)).toThrow(/exactly one/);
    expect(() => writeDoc(ctx, { doc: doc.id, path: 'README.md', content: 'x', delete: true }, agent)).toThrow(/exactly one/);
    expect(() => writeDoc(ctx, { doc: doc.id, path: 'README.md', edits: 'x' }, agent)).toThrow(/edits must be an array/);
    expect(() => writeDoc(ctx, { doc: 'missing', path: 'README.md', content: 'x' }, agent)).toThrow(/not found/);
  });

  it('updates metadata', () => {
    const { ctx, store } = setup();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    expect(updateDoc(ctx, { doc: doc.id, status: 'approved', tags: ['api'] }, agent)).toBe(
      `Updated ${doc.id}: "Doc" · approved · tags: api · entry: README.md`
    );
    expect(updateDoc(ctx, { doc: doc.id, tags: [] }, agent)).toContain('tags: none');
  });

  it('comments, resolves with a reply, and reopens', () => {
    const { ctx, store } = setup();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    const added = commentDoc(ctx, { doc: doc.id, body: 'Needs numbers', path: 'README.md', quote: '# Doc' }, agent);
    expect(added).toMatch(/^Added comment c_/);
    expect(added).toContain('on README.md › "# Doc"');
    const id = store.get(doc.id).comments[0]!.id;

    expect(commentDoc(ctx, { doc: doc.id, resolve: id, body: 'Added a table' }, agent)).toBe(
      `Resolved comment ${id}. Added your reply as a new comment.`
    );
    const comments = store.get(doc.id).comments;
    expect(comments).toHaveLength(2);
    expect(comments.find((comment) => comment.id !== id)).toMatchObject({ body: 'Added a table', path: 'README.md' });
    expect(commentDoc(ctx, { doc: doc.id, reopen: id }, agent)).toBe(`Reopened comment ${id}.`);
    expect(() => commentDoc(ctx, { doc: doc.id }, agent)).toThrow(/body is required/);
  });

  it('prints history', () => {
    const { ctx, store } = setup();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    store.writeFile(doc.id, { path: 'README.md', content: 'v2', note: 'second' }, agent);
    const history = docHistory(ctx, { doc: doc.id, path: 'README.md', limit: '10' });
    expect(history.split('\n')).toHaveLength(2);
    expect(history).toMatch(/write README\.md → rev 2, .* agent "Planner" just now — second/);
  });
});
