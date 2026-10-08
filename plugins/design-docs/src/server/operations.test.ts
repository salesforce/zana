import { describe, expect, it } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import {
  asInput,
  commentDoc,
  createDoc,
  docHistory,
  docRef,
  listDocs,
  optionalString,
  readDoc,
  requiredString,
  updateDoc,
  writeDoc,
  type ImageToolResult,
  type OperationContext
} from './operations.js';
import { RenderReports } from './render-reports.js';
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
    const site = [{ path: 'README.md', content: '# Repo' }, { path: 'index.html', content: '<p>home</p>' }];
    createDoc(ctx, { title: 'Site', files: site, entryPath: 'index.html' }, agent);
    expect(store.summary('site').entryPath).toBe('index.html');

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

  it('comments, resolves with a reply in the thread, and reopens', () => {
    const { ctx, store, changes } = setup();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    const added = commentDoc(ctx, { doc: doc.id, body: 'Needs numbers', path: 'README.md', quote: '# Doc' }, agent);
    expect(added).toMatch(/^Added comment c_/);
    expect(added).toContain('on README.md › "# Doc"');
    expect(added).not.toContain('Note:');
    const id = store.get(doc.id).comments[0]!.id;

    const resolved = commentDoc(ctx, { doc: doc.id, resolve: id, body: 'Added a table' }, agent);
    expect(resolved).toMatch(new RegExp(`^Resolved comment ${id} and added your reply\\.`));
    expect(resolved).toContain('↳ reply agent "Planner", just now: Added a table');
    const [comment, ...others] = store.get(doc.id).comments;
    expect(others).toEqual([]);
    expect(comment).toMatchObject({ status: 'resolved', replies: [{ body: 'Added a table' }] });
    expect(store.get(doc.id).openComments).toBe(0);

    expect(commentDoc(ctx, { doc: doc.id, reopen: id }, agent)).toMatch(new RegExp(`^Reopened comment ${id}\\.\\n`));
    expect(store.get(doc.id).comments[0]!.status).toBe('open');
    expect(changes).toHaveLength(3);
    expect(() => commentDoc(ctx, { doc: doc.id }, agent)).toThrow(/body is required/);
  });

  it('replies without changing status, and rejects mixed or misdirected targets', () => {
    const { ctx, store } = setup();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    const id = store.addComment(doc.id, { body: 'Why?', path: 'README.md' }, agent).id;

    const replied = commentDoc(ctx, { doc: doc.id, replyTo: id, body: 'Because latency.' }, agent);
    expect(replied).toMatch(new RegExp(`^Replied to comment ${id}\\.`));
    expect(store.get(doc.id).comments[0]).toMatchObject({ status: 'open', replies: [{ body: 'Because latency.' }] });
    const replyId = store.get(doc.id).comments[0]!.replies[0]!.id;

    expect(() => commentDoc(ctx, { doc: doc.id, replyTo: id }, agent)).toThrow(/body is required/);
    expect(() => commentDoc(ctx, { doc: doc.id, resolve: id, reopen: id }, agent)).toThrow(/only one of .* \(got resolve and reopen\)/);
    expect(() => commentDoc(ctx, { doc: doc.id, replyTo: id, resolve: id, body: 'x' }, agent)).toThrow(/only one of/);
    expect(() => commentDoc(ctx, { doc: doc.id, resolve: id, path: 'README.md' }, agent)).toThrow(/path and quote anchor a new comment/);
    expect(() => commentDoc(ctx, { doc: doc.id, resolve: replyId }, agent)).toThrow(new RegExp(`is a reply; use its comment ${id}`));
    expect(() => commentDoc(ctx, { doc: doc.id, replyTo: 'c_missing', body: 'x' }, agent)).toThrow(/not found/);
    // An empty target is ignored, so the call is an ordinary new comment.
    expect(commentDoc(ctx, { doc: doc.id, resolve: '', body: 'Fresh' }, agent)).toMatch(/^Added comment/);
  });

  it('warns when the panel will not be able to highlight a quote', () => {
    const { ctx, store } = setup();
    const doc = store.create(
      { title: 'Doc', files: [{ path: 'README.md', content: 'Tokens **expire\nhourly** via [the job](job.md).' }, { path: 'i.png', content: PNG, encoding: 'base64' }] },
      agent
    );
    const comment = (input: Record<string, unknown>) => commentDoc(ctx, { doc: doc.id, body: 'Why?', ...input }, agent);
    // Markdown syntax and line breaks do not count against the match.
    expect(comment({ path: 'README.md', quote: 'expire hourly via the job' })).not.toContain('Note:');
    expect(comment({ path: 'README.md', quote: 'expires daily' })).toContain(
      'Note: the quote does not appear in README.md, so the panel cannot highlight it.'
    );
    expect(comment({ quote: 'hourly' })).toContain('Note: the quote has no path');
    expect(comment({ path: 'i.png', quote: 'anything' })).not.toContain('Note:');
    expect(comment({ path: 'README.md' })).not.toContain('Note:');
  });

  it('names the project in manifests when its name is known', () => {
    const { ctx, store } = setup();
    const doc = store.create({ title: 'Doc', projectId: 'p1', template: 'blank' }, agent);
    expect(readDoc(ctx, { doc: doc.id }) as string).toContain('project: p1 ·');
    const named = { ...ctx, projectName: (id: string | null) => (id === 'p1' ? 'Mobile app' : null) };
    expect(readDoc(named, { doc: doc.id }) as string).toContain('project: Mobile app ·');
    expect(readDoc(named, { doc: doc.id, includeAll: true }) as string).toContain('project: Mobile app ·');
    expect(createDoc(named, { title: 'Second' }, agent)).toContain('project: Mobile app ·');
  });

  it('reaches another project\'s doc by id only', () => {
    const { ctx, store } = setup();
    const own = store.create({ title: 'Plan', projectId: 'p1', template: 'blank' }, agent);
    const other = store.create({ title: 'Roadmap', projectId: 'p2', template: 'blank' }, agent);
    const shared = store.create({ title: 'Glossary', template: 'blank' }, agent);
    expect(docRef(ctx, 'plan')).toBe(own.id);
    expect(docRef(ctx, ' glossary ')).toBe(shared.id);
    expect(docRef(ctx, other.id)).toBe(other.id);
    expect(docRef(ctx, 'missing')).toBe('missing');
    const named = { ...ctx, projectName: (id: string | null) => (id === 'p2' ? 'Website' : null) };
    expect(() => docRef(named, 'roadmap')).toThrow(`"roadmap" is a design doc in project Website (${other.id}), not this one`);
    expect(() => readDoc(ctx, { doc: 'roadmap' })).toThrow(/in project p2/);
    expect(() => commentDoc(ctx, { doc: 'roadmap', body: 'x' }, agent)).toThrow(/in project p2/);
    // Without a calling project, nothing to guess against.
    expect(docRef({ ...ctx, projectId: null }, 'roadmap')).toBe(other.id);
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

describe('HTML pages', () => {
  const PAGE = '<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body><h1>Pass <em>rate</em> &amp; cost</h1><img src="logo.png"></body></html>';

  function pageSetup(files: Array<{ path: string; content: string }> = [{ path: 'index.html', content: PAGE }]) {
    const { ctx, store } = setup();
    const reports = new RenderReports();
    const doc = store.create({ title: 'Site', entryPath: 'index.html', files: [...files, { path: 'site.css', content: 'h1 { color: red }' }] }, agent);
    const report = (path: string, patch: Partial<Parameters<RenderReports['record']>[1]> = {}) => {
      const files = store.get(doc.id).files;
      const revision = (target: string) => files.find((file) => file.path === target)!.revision;
      reports.record(doc.id, { path, revision: revision(path), deps: [], missing: [], problems: [], unanchored: [], ...patch });
    };
    return { ctx: { ...ctx, reports }, store, doc, report };
  }

  it('reads a page with what rendering it found and what the panel saw', () => {
    const { ctx, store, doc, report } = pageSetup();
    const comment = store.addComment(doc.id, { body: 'Source?', path: 'index.html', quote: 'Pass rate' }, agent);
    expect(readDoc(ctx, { doc: doc.id, path: 'index.html' })).toContain(
      'Page check for index.html:\n- Missing: the page uses logo.png, which is not a file in this doc.'
    );
    expect(readDoc(ctx, { doc: doc.id, path: 'index.html' })).not.toContain('The Design Docs panel ran');

    report('index.html', { problems: [{ kind: 'error', message: 'chart is not defined', source: 'index.html', line: 9 }], unanchored: ['Pass rate'] });
    const read = readDoc(ctx, { doc: doc.id, path: 'index.html' }) as string;
    expect(read).toContain('The Design Docs panel ran index.html (rev 1) just now:\n- Error: chart is not defined (index.html:9)');
    expect(read).toContain(`- Comment ${comment.id} quotes "Pass rate", which the page does not show.`);

    // A report about an older revision no longer describes the page.
    writeDoc(ctx, { doc: doc.id, path: 'index.html', content: PAGE.replace('logo.png', 'site.css') }, agent);
    const fresh = readDoc(ctx, { doc: doc.id, path: 'index.html' }) as string;
    expect(fresh).not.toContain('Page check');
    expect(fresh).not.toContain('The Design Docs panel ran');
    // Other files carry no page notes.
    expect(readDoc(ctx, { doc: doc.id, path: 'site.css' })).not.toContain('Page check');
  });

  it('reads a page without a report store, and survives a page that cannot render', () => {
    const { ctx, doc } = pageSetup();
    const bare = { ...ctx, reports: undefined };
    expect(readDoc(bare, { doc: doc.id, path: 'index.html' })).toContain('Page check for index.html:');
    const broken = { ...ctx, kit: { read: () => { throw new Error('kit is gone'); } } } as unknown as typeof ctx;
    expect(() => readDoc(broken, { doc: doc.id, path: 'index.html' })).not.toThrow();
  });

  it('lists the problems of other pages in the manifest', () => {
    const pages = Array.from({ length: 7 }, (_, index) => ({ path: `p${index}.html`, content: '<p>Hi</p>' }));
    const { ctx, doc, report } = pageSetup([{ path: 'index.html', content: PAGE }, ...pages]);
    expect(readDoc(ctx, { doc: doc.id }) as string).not.toContain('## Page problems');

    report('index.html', { problems: [{ kind: 'blocked', message: 'The page tried to open a popup.' }] });
    report('p0.html');
    for (const page of pages.slice(1)) report(page.path, { problems: [{ kind: 'error', message: `${page.path} broke` }] });
    const manifest = readDoc(ctx, { doc: doc.id }) as string;
    // The entry page's notes follow it; the section lists only other pages that had problems.
    expect(manifest).toMatch(/## Entry file[\s\S]*Page check for index\.html[\s\S]*The Design Docs panel ran index\.html[\s\S]*## Page problems/);
    const section = manifest.slice(manifest.indexOf('## Page problems'));
    expect(section).not.toContain('index.html');
    expect(section).not.toContain('p0.html');
    expect(section).toContain('- Error: p1.html broke');
    expect(section).toContain('- Error: p5.html broke');
    expect(section).not.toContain('p6.html broke');
    expect(section).toContain('(1 more page(s) had problems; read them by path.)');
  });

  it('checks a page as it is written', () => {
    const { ctx, doc } = pageSetup();
    const written = writeDoc(ctx, { doc: doc.id, path: 'about.html', content: '<script src="https://cdn.example/chart.js"></script><script src="app.js"></script>' }, agent);
    expect(written).toMatch(/^Created about\.html/);
    expect(written).toContain('Page check for about.html:\n- Missing: the page uses app.js');
    expect(written).toContain('- Blocked: External script https://cdn.example/chart.js is blocked in previews');
    expect(written).toContain('Its scripts run when the page is open in the Design Docs panel');
    expect(writeDoc(ctx, { doc: doc.id, path: 'plain.html', content: '<p>Plain</p>' }, agent)).not.toContain('\n\n');
    expect(writeDoc(ctx, { doc: doc.id, path: 'notes.md', content: '<script src="app.js"></script>' }, agent)).not.toContain('Page check');
    expect(writeDoc(ctx, { doc: doc.id, path: 'plain.html', delete: true }, agent)).not.toContain('Page check');
  });

  it('matches a quote on a page against the text it shows', () => {
    const { ctx, store, doc } = pageSetup([
      { path: 'index.html', content: PAGE },
      { path: 'live.html', content: '<div id="out"></div><script>out.textContent = "Built later"</script>' }
    ]);
    const comment = (path: string, quote: string) => commentDoc(ctx, { doc: doc.id, body: 'Why?', path, quote }, agent);
    // Tags and entities do not count against the match.
    expect(comment('index.html', 'Pass rate & cost')).not.toContain('Note:');
    expect(comment('index.html', '<em>rate</em>')).toContain(
      'Note: the quote does not appear on index.html, so the panel cannot highlight it. Quote the text as the page shows it, not its HTML.'
    );
    expect(comment('live.html', 'Built later')).toContain(
      "Note: the quote is not in the HTML of live.html. The panel highlights it if the page's scripts show that text"
    );
    expect(store.get(doc.id).comments).toHaveLength(3);
  });
});
