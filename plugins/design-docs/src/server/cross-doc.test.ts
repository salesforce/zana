import { describe, expect, it } from 'vitest';
import { resolveCrossDocTarget } from './cross-doc.js';
import { createRpcHandlers, UI_USER } from './rpc.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const make = (title: string, projectId: string | null, files = [{ path: 'README.md', content: title }, { path: 'api/auth.md', content: 'auth' }]) =>
    store.create({ title, projectId, files }, UI_USER);
  const a1 = make('Alpha One', 'p1');
  const a2 = make('Alpha Two', 'p1');
  const b1 = make('Beta One', 'p2');
  const g1 = make('Global One', null);
  const g2 = make('Global Two', null);
  return { store, a1, a2, b1, g1, g2 };
}

describe('resolveCrossDocTarget', () => {
  it('resolves by slug and by id, with a path or the entry file', () => {
    const { store, a1, a2 } = setup();
    expect(resolveCrossDocTarget(store, a2.slug, 'api/auth.md', { docId: a1.id })).toEqual({ docId: a2.id, path: 'api/auth.md' });
    expect(resolveCrossDocTarget(store, a2.id, null, { docId: a1.id })).toEqual({ docId: a2.id, path: a2.entryPath });
    expect(resolveCrossDocTarget(store, a2.slug.toUpperCase(), null, { docId: a1.id })).toEqual({ docId: a2.id, path: a2.entryPath });
  });
  it('reports a missing doc or file and a template as a missing doc', () => {
    const { store, a1, a2 } = setup();
    expect(resolveCrossDocTarget(store, 'nope', null, { docId: a1.id })).toEqual({ error: 'missing-doc' });
    expect(resolveCrossDocTarget(store, a2.id, 'gone.md', { docId: a1.id })).toEqual({ error: 'missing-file' });
    const template = store.listTemplateRecords()[0]!;
    expect(resolveCrossDocTarget(store, template.docId, null, { docId: a1.id })).toEqual({ error: 'missing-doc' });
  });
  it('rejects traversal and malformed paths without touching other files', () => {
    const { store, a1, a2 } = setup();
    for (const path of ['../README.md', '/etc/passwd', 'a//b.md', '']) {
      expect(resolveCrossDocTarget(store, a2.id, path, { docId: a1.id }), path).toEqual({ error: 'missing-file' });
    }
  });
  it('lets a doc read same-project and global docs but not another project, and global callers see only global docs', () => {
    const { store, a1, a2, b1, g1, g2 } = setup();
    expect(resolveCrossDocTarget(store, b1.id, null, { docId: a1.id })).toEqual({ error: 'forbidden' });
    expect(resolveCrossDocTarget(store, g1.id, null, { docId: a1.id })).toMatchObject({ docId: g1.id });
    expect(resolveCrossDocTarget(store, a2.id, null, { docId: g1.id })).toEqual({ error: 'forbidden' });
    expect(resolveCrossDocTarget(store, g2.id, null, { docId: g1.id })).toMatchObject({ docId: g2.id });
    expect(resolveCrossDocTarget(store, g1.id, 'README.md', { docId: g1.id })).toMatchObject({ docId: g1.id });
  });
  it('does not depend on a capped fuzzy list: >200 docs sharing a slug substring still resolve', () => {
    const { store, a1 } = setup();
    for (let i = 0; i < 205; i += 1) store.create({ title: `Shared ${i}`, projectId: 'p1', files: [{ path: 'README.md', content: 'x' }] }, UI_USER);
    const last = store.create({ title: 'Shared', projectId: 'p1', files: [{ path: 'README.md', content: 'x' }] }, UI_USER);
    const other = store.create({ title: 'Shared elsewhere', projectId: 'p2', files: [{ path: 'README.md', content: 'x' }] }, UI_USER);
    expect(resolveCrossDocTarget(store, last.id, null, { docId: a1.id })).toMatchObject({ docId: last.id });
    expect(resolveCrossDocTarget(store, a1.id, null, { docId: last.id })).toMatchObject({ docId: a1.id });
    expect(resolveCrossDocTarget(store, other.id, null, { docId: last.id })).toEqual({ error: 'forbidden' });
  });
  it('treats unassigned received docs as reachable only from themselves and honours mappings', () => {
    const { store, a1, g1 } = setup();
    const received = (title: string, foreign: string) => {
      const doc = store.create({ title, template: 'blank' }, UI_USER);
      store.db.prepare('INSERT OR REPLACE INTO sync_doc_references (doc_id, project_json, threads_json) VALUES (?, ?, ?)').run(doc.id, JSON.stringify(foreign), '[]');
      return doc;
    };
    const u = received('Peer', 'f1');
    expect(resolveCrossDocTarget(store, u.id, null, { docId: u.id })).toMatchObject({ docId: u.id });
    expect(resolveCrossDocTarget(store, u.id, null, { docId: a1.id })).toEqual({ error: 'forbidden' });
    expect(resolveCrossDocTarget(store, g1.id, null, { docId: u.id })).toEqual({ error: 'forbidden' });
    store.db.prepare('INSERT INTO dd_project_aliases (foreign_project_id, local_project_id, updated_at) VALUES (?, ?, ?)').run('f1', 'p1', 1);
    expect(resolveCrossDocTarget(store, u.id, null, { docId: a1.id })).toMatchObject({ docId: u.id });
    expect(resolveCrossDocTarget(store, a1.id, null, { docId: u.id })).toMatchObject({ docId: a1.id });
    expect(resolveCrossDocTarget(store, g1.id, null, { docId: u.id })).toMatchObject({ docId: g1.id });
  });
  it('forbids an unknown caller doc', () => {
    const { store, a2 } = setup();
    expect(resolveCrossDocTarget(store, a2.id, null, { docId: 'dd_missing' })).toEqual({ error: 'forbidden' });
  });
});

describe('resolveCrossDocLink RPC', () => {
  it('re-parses the href in main and authorizes the caller', () => {
    const { store, a1, a2, b1 } = setup();
    const rpc = createRpcHandlers({ store, changed: () => {}, sdk: {} as never });
    const call = (args: unknown) => rpc.resolveCrossDocLink!(args);
    expect(call({ fromDoc: a1.id, href: `doc://${a2.slug}/api/auth.md#x` })).toEqual({ docId: a2.id, path: 'api/auth.md' });
    expect(call({ fromDoc: a1.id, href: `doc:${a2.id}` })).toEqual({ docId: a2.id, path: a2.entryPath });
    expect(call({ fromDoc: a1.id, href: `doc://${b1.slug}` })).toEqual({ error: 'forbidden' });
    expect(call({ fromDoc: a1.id, href: 'doc://x/../y' })).toEqual({ error: 'missing-doc' });
    expect(() => call({ fromDoc: a1.id })).toThrow(/href/);
    expect(() => call({ href: 'doc://x' })).toThrow(/fromDoc/);
    expect(() => call({ fromDoc: a1.id, href: 'doc://x', projectId: 'p2' })).toThrow(/accepts only/);
  });
});
