import { describe, expect, it, vi } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import { MAX_FILES_PER_DOC } from '../shared/limits.js';
import { addFromTemplate, readTemplate, type OperationContext } from './operations.js';
import { createRpcHandlers } from './rpc.js';
import { runCli, type CliDeps } from './cli.js';
import { registerDesignDocTools } from './tools.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const agent: DocActor = { kind: 'agent', label: 'Planner', threadId: 'thread-1' };
const COMMENT = '<!-- AI Instructions: keep   this\n  exact -->';
const PNG = 'iVBORw0KGgo=';

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const changes: string[] = [];
  const ctx: OperationContext = { store, changed: (id) => changes.push(id) };
  const tpl = store.templateNew({
    label: 'Kit', entryPath: 'notes/a.md',
    files: [
      { path: 'notes/a.md', content: `${COMMENT}\n# {{title}}\n{{summary}} {{other}}\n` },
      { path: 'notes/page.html', content: `${COMMENT}<h1>{{title}}</h1><p>{{summary}}</p>` },
      { path: 'img/p.png', content: PNG, encoding: 'base64' }
    ]
  }, agent);
  const key = store.listTemplateRecords().find((t) => t.docId === tpl.id)!.id;
  const doc = store.create({ title: 'Base Doc', summary: 'Base summary', template: 'blank' }, agent);
  return { store, ctx, changes, key, doc };
}

describe('readTemplate', () => {
  it('returns full file contents, untouched, with base64 marked', () => {
    const { ctx, key } = setup();
    const result = readTemplate(ctx, { key });
    expect(result.key).toBe(key);
    const a = result.files.find((f) => f.path === 'notes/a.md')!;
    expect(a).toMatchObject({ encoding: 'utf8' });
    expect(a.content).toContain(COMMENT);
    expect(a.content).toContain('{{title}}');
    expect(result.files.find((f) => f.path === 'img/p.png')).toMatchObject({ encoding: 'base64', content: PNG });
  });

  it('fails for unknown or missing key', () => {
    const { ctx } = setup();
    expect(() => readTemplate(ctx, { key: 'nope' })).toThrow(/unknown template/);
    expect(() => readTemplate(ctx, {})).toThrow(/key is required/);
  });
});

describe('addFromTemplate', () => {
  it('adds files with substitution, preserving comments and base64', () => {
    const { ctx, store, changes, key, doc } = setup();
    const result = addFromTemplate(ctx, { docId: doc.id, templateKey: key, title: 'T & <Co>', summary: 'S "q"' }, agent);
    expect(result.added.sort()).toEqual(['img/p.png', 'notes/a.md', 'notes/page.html']);
    expect(changes).toEqual([doc.id]);
    const md = store.readFile(doc.id, 'notes/a.md').content;
    expect(md).toBe(`${COMMENT}\n# T & <Co>\nS "q" {{other}}\n`);
    const html = store.readFile(doc.id, 'notes/page.html').content;
    expect(html).toBe(`${COMMENT}<h1>T &#38; &#60;Co&#62;</h1><p>S &#34;q&#34;</p>`);
    expect(store.readFile(doc.id, 'img/p.png')).toMatchObject({ encoding: 'base64', content: PNG });
    expect(store.history(doc.id, { path: 'notes/a.md' }).length).toBeGreaterThan(0);
  });

  it('defaults title and summary to the doc', () => {
    const { ctx, store, key, doc } = setup();
    addFromTemplate(ctx, { docId: doc.id, templateKey: key }, agent);
    expect(store.readFile(doc.id, 'notes/a.md').content).toContain('# Base Doc\nBase summary');
  });

  it('fails on unknown template, unknown doc and missing args without changes', () => {
    const { ctx, changes, key, doc } = setup();
    expect(() => addFromTemplate(ctx, { docId: doc.id, templateKey: 'nope' }, agent)).toThrow(/unknown template/);
    expect(() => addFromTemplate(ctx, { docId: 'dd_missing', templateKey: key }, agent)).toThrow(/not found/);
    expect(() => addFromTemplate(ctx, { templateKey: key }, agent)).toThrow(/docId is required/);
    expect(() => addFromTemplate(ctx, { docId: doc.id }, agent)).toThrow(/templateKey is required/);
    expect(changes).toEqual([]);
  });

  it('refuses a path collision, including by letter case, and writes nothing', () => {
    const { ctx, store, changes, key, doc } = setup();
    store.writeFile(doc.id, { path: 'NOTES/A.md', content: 'mine' }, agent);
    expect(() => addFromTemplate(ctx, { docId: doc.id, templateKey: key }, agent)).toThrow(/already exists/);
    expect(store.get(doc.id).files.map((f) => f.path).sort()).toEqual(['NOTES/A.md', 'README.md']);
    expect(store.readFile(doc.id, 'NOTES/A.md').content).toBe('mine');
    expect(changes).toEqual([]);
  });

  it('refuses an exact collision with README.md', () => {
    const { ctx, store, doc } = setup();
    expect(() => addFromTemplate(ctx, { docId: doc.id, templateKey: 'blank' }, agent)).toThrow(/already exists/);
    expect(store.readFile(doc.id, 'README.md').content).toContain('Base Doc');
  });

  it('with skipExisting keeps clashing files and adds the rest', () => {
    const { ctx, store, key, doc } = setup();
    store.writeFile(doc.id, { path: 'NOTES/A.md', content: 'mine' }, agent);
    const result = addFromTemplate(ctx, { docId: doc.id, templateKey: key, skipExisting: true }, agent);
    expect(result.added.sort()).toEqual(['img/p.png', 'notes/page.html']);
    expect(result.skipped).toEqual(['notes/a.md']);
    expect(store.readFile(doc.id, 'NOTES/A.md').content).toBe('mine');
  });

  it('with skipExisting still fails when nothing would be added', () => {
    const { ctx, changes, doc } = setup();
    expect(() => addFromTemplate(ctx, { docId: doc.id, templateKey: 'blank', skipExisting: true }, agent)).toThrow(/nothing to add/);
    expect(changes).toEqual([]);
  });

  it('enforces the file-count limit atomically', () => {
    const { ctx, store, key, doc } = setup();
    const files = Array.from({ length: MAX_FILES_PER_DOC - 2 }, (_, i) => ({ path: `f/${i}.md`, content: 'x' }));
    store.importFiles(doc.id, files, agent);
    expect(store.get(doc.id).files).toHaveLength(MAX_FILES_PER_DOC - 1);
    expect(() => addFromTemplate(ctx, { docId: doc.id, templateKey: key }, agent)).toThrow(/at most 500 files/);
    expect(store.get(doc.id).files).toHaveLength(MAX_FILES_PER_DOC - 1);
  });

  it('enforces the per-doc byte limit', () => {
    const { ctx, store } = setup();
    const big = store.templateNew({ label: 'Big', entryPath: 'a.md', files: [{ path: 'a.md', content: 'a'.repeat(1.5 * 1024 * 1024) }, { path: 'b.md', content: 'b'.repeat(1.5 * 1024 * 1024) }] }, agent);
    const key = store.listTemplateRecords().find((t) => t.docId === big.id)!.id;
    const doc = store.create({ title: 'Full', template: 'blank' }, agent);
    store.importFiles(doc.id, Array.from({ length: 11 }, (_, i) => ({ path: `fill/${i}.txt`, content: 'z'.repeat(2 * 1024 * 1024 - 10) })), agent);
    store.importFiles(doc.id, [{ path: 'fill/x.txt', content: 'z'.repeat(1.9 * 1024 * 1024) }], agent);
    expect(() => addFromTemplate(ctx, { docId: doc.id, templateKey: key }, agent)).toThrow(/at most/);
    expect(store.get(doc.id).files.map((f) => f.path)).not.toContain('a.md');
  });
});

describe('surfaces', () => {
  it('RPC, tools and CLI expose both verbs', async () => {
    const { store, key, doc: target } = setup();
    const changed = vi.fn();
    const rpc = createRpcHandlers({ store, changed, sdk: {} as never }) as Record<string, (a: unknown) => any>;
    expect(rpc.templateRead!({ key }).files).toHaveLength(3);
    expect(rpc.addFromTemplate!({ docId: target.id, templateKey: key }).added).toHaveLength(3);
    expect(changed).toHaveBeenCalledWith(target.id);
    expect(() => rpc.addFromTemplate!({ docId: target.id, templateKey: key })).toThrow(/already exists/);

    const tools: any[] = [];
    registerDesignDocTools({ agents: { registerTool: (t: unknown) => tools.push(t) } } as never, { store, changed, actorFor: async () => agent });
    const read = tools.find((t) => t.name === 'design_doc_template_read');
    const add = tools.find((t) => t.name === 'design_doc_add_from_template');
    expect((await read.execute({ key }, {})).files).toHaveLength(3);
    const doc2 = store.create({ title: 'Other', template: 'blank' }, agent);
    expect((await add.execute({ docId: doc2.id, templateKey: key }, {})).added).toHaveLength(3);

    const deps: CliDeps = { store, changed, caller: async () => ({ actor: agent, projectId: null, files: null }), readLocalFile: vi.fn() as never };
    const ctx = { pluginId: 'design-docs', argv: [], projectId: null } as never;
    const doc3 = store.create({ title: 'Third', template: 'blank' }, agent);
    expect(JSON.parse((await runCli(deps, ['template-read', key], ctx)).stdout).key).toBe(key);
    expect((await runCli(deps, ['add-from-template', doc3.id, key, '--title', 'X'], ctx)).stdout).toMatch(/Added 3 file/);
    expect(await runCli(deps, ['add-from-template', doc3.id, key], ctx)).toMatchObject({ exitCode: 1 });
    expect(await runCli(deps, ['template-read'], ctx)).toMatchObject({ exitCode: 2 });
  });
});
