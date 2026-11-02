import { describe, expect, it, vi } from 'vitest';
import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';
import { createProjectNames } from './project-names.js';
import { DesignDocProjectRefs } from './project-refs.js';
import { createRpcHandlers, UI_USER } from './rpc.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';

const PROJECTS = [{ id: 'p1', name: 'App', tag: 'app' }, { id: 'p2', name: 'Site', tag: 'site' }];
const list = async () => PROJECTS;

function setup(db: PluginDatabase = createTestDatabase()) {
  const store = new DesignDocStore(db);
  /** A doc as a peer delivers it: no local project, the foreign id held in sync_doc_references. */
  const received = (title: string, foreign: string | null) => {
    const doc = store.create({ title, template: 'blank' }, UI_USER);
    db.prepare('INSERT OR REPLACE INTO sync_doc_references (doc_id, project_json, threads_json) VALUES (?, ?, ?)')
      .run(doc.id, JSON.stringify(foreign), '[]');
    return doc;
  };
  const ids = (filter: Parameters<DesignDocStore['list']>[0]) => store.list(filter).map((doc) => doc.title).sort();
  return { db, store, received, ids, refs: store.projectRefs };
}

describe('lazy tables', () => {
  it('survives table creation failure and falls back to Unknown project', async () => {
    const real = createTestDatabase();
    const failing: PluginDatabase = { ...real, runScript: (sql) => { if (sql.includes('dd_project_refs')) throw new Error('readonly'); real.runScript(sql); } };
    const { store, received, ids, refs } = setup(failing);
    expect(refs.available).toBe(false);
    received('Foreign', 'f1');
    store.create({ title: 'Own', projectId: 'p1', template: 'blank' }, UI_USER);
    expect(ids({ projectId: 'p1' })).toEqual(['Own']);
    expect(ids({ unassigned: true })).toEqual(['Foreign']);
    refs.observe(PROJECTS);
    expect(refs.removedLabel('p1')).toBeNull();
    expect(refs.removedProjects(['p1'])).toEqual([]);
    expect(await refs.listUnassignedForeignProjects(list)).toEqual([]);
    await expect(refs.mapForeignProject(list, 'f1', 'p1')).rejects.toThrow(/unavailable/);
    expect(() => refs.unmapForeignProject('f1')).toThrow(/unavailable/);
  });

  it('recreates the tables after a restore that lacks them', () => {
    const { db, refs, received, ids } = setup();
    refs.observe(PROJECTS);
    db.runScript('DROP TABLE dd_project_refs; DROP TABLE dd_project_aliases;');
    const reopened = new DesignDocProjectRefs(db);
    received('Foreign', 'f1');
    expect(reopened.available).toBe(true);
    reopened.observe(PROJECTS);
    expect(reopened.removedLabel('p1')).toBe('App (project removed)');
    expect(ids({ projectId: 'p1' })).toEqual([]);
  });

  it('re-probes when a failed observe cleared availability', () => {
    const { db, refs } = setup();
    db.runScript('DROP TABLE dd_project_refs;');
    refs.observe(PROJECTS); // table missing: swallowed
    expect(refs.available).toBe(true); // lazily recreated
    refs.observe(PROJECTS);
    expect(refs.removedLabel('zzz')).toBeNull();
  });
});

describe('deleted project display', () => {
  it('shows "<name> (project removed)" and follows renames', async () => {
    const { refs, store } = setup();
    store.create({ title: 'Kept', projectId: 'p1', template: 'blank' }, UI_USER);
    let projects = [{ id: 'p1', name: 'App' }];
    const names = createProjectNames(async () => projects, {
      ttlMs: 0, onRefresh: (p) => refs.observe(p), removedLabel: (id) => refs.removedLabel(id)
    });
    expect(names.name('p1')).toBeNull(); // nothing loaded yet: never mislabel as removed
    await names.refresh();
    expect(names.name('p1')).toBe('App');
    projects = [{ id: 'p1', name: 'App v2' }];
    await names.refresh();
    expect(refs.removedLabel('p1')).toBe('App v2 (project removed)');
    projects = [{ id: 'p2', name: 'Other' }];
    await names.refresh();
    expect(names.name('p1')).toBe('App v2 (project removed)');
    expect(names.name('nope')).toBeNull();
    expect(refs.removedProjects(['p2'])).toEqual([{ id: 'p1', label: 'App v2 (project removed)' }]);
  });

  it('keeps names working when bookkeeping throws', async () => {
    const names = createProjectNames(async () => [{ id: 'p1', name: 'App' }], {
      onRefresh: () => { throw new Error('boom'); }, removedLabel: () => { throw new Error('boom'); }
    });
    await names.refresh();
    expect(names.name('p1')).toBe('App');
    expect(names.name('gone')).toBeNull();
  });

  it('forgets removed projects that no doc references', () => {
    const { store, refs, db } = setup();
    refs.observe([{ id: 'p1', name: 'App' }, { id: 'p2', name: 'Site' }, { id: 'p3', name: 'Third' }]);
    store.create({ title: 'Uses p1', projectId: 'p1', template: 'blank' }, UI_USER);
    db.prepare('INSERT INTO sync_doc_references (doc_id, project_json, threads_json) VALUES (?, ?, ?)').run('x', JSON.stringify('p2'), '[]');
    refs.observe([{ id: 'p3', name: 'Third' }]);
    expect(refs.removedLabel('p1')).toBe('App (project removed)');
    expect(refs.removedLabel('p2')).toBe('Site (project removed)');
    db.prepare('DELETE FROM sync_doc_references').run();
    refs.observe([{ id: 'p3', name: 'Third' }]);
    expect(refs.removedLabel('p2')).toBeNull();
  });
});

describe('mapping and scoping', () => {
  it('scopes own, global, mapped and unmapped received docs', async () => {
    const { store, received, ids, refs } = setup();
    store.create({ title: 'Own', projectId: 'p1', template: 'blank' }, UI_USER);
    store.create({ title: 'Global', template: 'blank' }, UI_USER);
    received('Mapped', 'f1');
    received('Unmapped', 'f2');
    received('Received global', null);
    expect(ids({ projectId: 'p1' })).toEqual(['Global', 'Own', 'Received global']);
    expect(ids({ projectId: 'p2' })).toEqual(['Global', 'Received global']);
    expect(ids({ projectId: null })).toEqual(['Global', 'Received global']);
    expect(ids({ unassigned: true })).toEqual(['Mapped', 'Unmapped']);
    expect(ids({})).toHaveLength(5);

    await expect(refs.mapForeignProject(list, 'f1', 'p1')).resolves.toEqual({ foreignProjectId: 'f1', localProjectId: 'p1' });
    expect(ids({ projectId: 'p1' })).toEqual(['Global', 'Mapped', 'Own', 'Received global']);
    expect(ids({ projectId: 'p2' })).toEqual(['Global', 'Received global']);
    expect(ids({ unassigned: true })).toEqual(['Unmapped']);
    expect(store.list({ projectId: 'p1' }).find((doc) => doc.title === 'Mapped')?.projectId).toBe('p1');
    expect(store.list({ unassigned: true })[0]?.projectId).toBeNull();

    expect(refs.unmapForeignProject('f1')).toEqual({ removed: true });
    expect(refs.unmapForeignProject('f1')).toEqual({ removed: false });
    expect(ids({ unassigned: true })).toEqual(['Mapped', 'Unmapped']);
    expect(ids({ projectId: 'p1' })).toEqual(['Global', 'Own', 'Received global']);
  });

  it('maps two foreign ids to one local project and remaps', async () => {
    const { received, ids, refs } = setup();
    received('A', 'f1'); received('B', 'f2');
    await refs.mapForeignProject(list, 'f1', 'p1');
    await refs.mapForeignProject(list, 'f2', 'p1');
    expect(ids({ projectId: 'p1' })).toEqual(['A', 'B']);
    await refs.mapForeignProject(list, 'f2', 'p2');
    expect(ids({ projectId: 'p1' })).toEqual(['A']);
    expect(ids({ projectId: 'p2' })).toEqual(['B']);
  });

  it('rejects bad input, unknown local projects and unreferenced foreign ids', async () => {
    const { received, refs, db } = setup();
    received('A', 'f1');
    await expect(refs.mapForeignProject(list, 'f1', 'nope')).rejects.toThrow(/unknown project/);
    await expect(refs.mapForeignProject(async () => { throw new Error('down'); }, 'f1', 'p1')).rejects.toThrow(/unavailable/);
    await expect(refs.mapForeignProject(undefined, 'f1', 'p1')).rejects.toThrow(/unknown project/);
    await expect(refs.mapForeignProject(list, 'ghost', 'p1')).rejects.toThrow(/no doc references/);
    await expect(refs.mapForeignProject(list, '', 'p1')).rejects.toThrow(/foreignProjectId/);
    await expect(refs.mapForeignProject(list, 'f1', 5)).rejects.toThrow(/localProjectId/);
    await expect(refs.mapForeignProject(list, 'x'.repeat(600), 'p1')).rejects.toThrow(/foreignProjectId/);
    expect(() => refs.unmapForeignProject(null)).toThrow(/foreignProjectId/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM dd_project_aliases').get() as { n: number }).n).toBe(0);
  });

  it('accepts a foreign id referenced only through docs.project_id', async () => {
    const { store, refs } = setup();
    store.create({ title: 'Own', projectId: 'old', template: 'blank' }, UI_USER);
    await expect(refs.mapForeignProject(list, 'old', 'p1')).resolves.toBeDefined();
  });

  it('a peer moving a doc to a new foreign id makes it unmapped', async () => {
    const { db, received, ids, refs } = setup();
    const doc = received('Moved', 'f1');
    await refs.mapForeignProject(list, 'f1', 'p1');
    expect(ids({ projectId: 'p1' })).toContain('Moved');
    db.prepare('UPDATE sync_doc_references SET project_json = ? WHERE doc_id = ?').run(JSON.stringify('f9'), doc.id);
    expect(ids({ projectId: 'p1' })).not.toContain('Moved');
    expect(ids({ unassigned: true })).toEqual(['Moved']);
  });

  it('prunes aliases to projects that are no longer registered', async () => {
    const { received, ids, refs, db } = setup();
    received('A', 'f1'); received('B', 'f2');
    await refs.mapForeignProject(list, 'f1', 'p1');
    await refs.mapForeignProject(list, 'f2', 'p2');
    refs.observe([PROJECTS[0]!]);
    expect(db.prepare('SELECT foreign_project_id AS f FROM dd_project_aliases').all()).toEqual([{ f: 'f1' }]);
    expect(ids({ unassigned: true })).toEqual(['B']);
  });

  it('does not change docs rows or the captured sync payload', async () => {
    const { db, store, received, refs } = setup();
    const sync = new DesignDocSyncStore(db);
    sync.initializeLocal();
    const doc = received('Hash', 'f1');
    const capture = () => (sync as unknown as { capture(id: string): unknown }).capture(doc.id);
    const snapshot = () => JSON.stringify([db.prepare('SELECT * FROM docs ORDER BY id').all(), db.prepare('SELECT * FROM sync_doc_references').all()]);
    const before = [snapshot(), JSON.stringify(capture())];
    await refs.mapForeignProject(list, 'f1', 'p1');
    expect([snapshot(), JSON.stringify(capture())]).toEqual(before);
    refs.unmapForeignProject('f1');
    expect([snapshot(), JSON.stringify(capture())]).toEqual(before);
    expect(store.get(doc.id).projectId).toBeNull();
  });
});

describe('listUnassignedForeignProjects', () => {
  it('counts docs, samples up to three titles and suggests by tag then name, never ambiguous', async () => {
    const { received, refs } = setup();
    for (const title of ['a', 'b', 'c', 'd']) received(title, 'f1');
    received('solo', 'f2');
    received('named', 'f3');
    received('ambiguous', 'f4');
    received('plain', 'f5');
    received('mapped', 'f6');
    received('global', null);
    refs.observe([{ id: 'f1', name: 'Whatever', tag: 'APP' }, { id: 'f2', name: 'site' }, { id: 'f3', name: 'Zed' },
      { id: 'f4', name: 'X', tag: 'dup' }, { id: 'f5', name: 'Ghost' }]);
    await refs.mapForeignProject(list, 'f6', 'p1');
    const registered = [...PROJECTS, { id: 'p3', name: 'Dup 1', tag: 'dup' }, { id: 'p4', name: 'Dup 2', tag: 'dup' }];
    const out = await refs.listUnassignedForeignProjects(async () => registered);
    expect(out.map((item) => item.foreignProjectId)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
    const by = Object.fromEntries(out.map((item) => [item.foreignProjectId, item]));
    expect(by.f1).toMatchObject({ docCount: 4, suggestion: { projectId: 'p1', basis: 'tag' } });
    expect(by.f1!.sampleTitles).toHaveLength(3);
    expect(by.f2!.suggestion).toMatchObject({ projectId: 'p2', basis: 'name' });
    expect(by.f3!.suggestion).toBeNull();
    expect(by.f4!.suggestion).toBeNull();
    expect(by.f5!.suggestion).toBeNull();
    expect(await refs.listUnassignedForeignProjects(async () => { throw new Error('down'); })).toHaveLength(5);
    expect((await refs.listUnassignedForeignProjects())[0]!.suggestion).toBeNull();
  });
});

describe('RPC', () => {
  it('validates in main and exposes map, unmap, list and unassigned scope', async () => {
    const { store, received } = setup();
    const changed = vi.fn();
    const sdk = { projects: { list } };
    const rpc = createRpcHandlers({ store, changed, sdk: sdk as never });
    received('Foreign', 'f1');
    store.create({ title: 'P1', projectId: 'p1', template: 'blank' }, UI_USER);
    store.create({ title: 'P2', projectId: 'p2', template: 'blank' }, UI_USER);
    expect(await rpc.listUnassignedProjects!(undefined)).toMatchObject([{ foreignProjectId: 'f1', docCount: 1 }]);
    expect((rpc.list!({ unassigned: true }) as unknown[])).toHaveLength(1);
    await expect(rpc.mapForeignProject!({ foreignProjectId: 'f1', localProjectId: 'nope' })).rejects.toThrow(/unknown project/);
    await expect(rpc.mapForeignProject!({ foreignProjectId: 'f1', localProjectId: 'p1', extra: 1 })).rejects.toThrow(/accepts only/);
    await expect(rpc.mapForeignProject!({ foreignProjectId: 'f1', localProjectId: 'p1' })).resolves.toEqual({ foreignProjectId: 'f1', localProjectId: 'p1' });
    expect(changed).toHaveBeenCalled();
    expect((rpc.list!({ unassigned: true }) as unknown[])).toHaveLength(0);
    expect(rpc.unmapForeignProject!({ foreignProjectId: 'f1' })).toEqual({ removed: true });
    expect(() => rpc.unmapForeignProject!({ foreignProjectId: 'f1', x: 1 })).toThrow(/accepts only/);
    await rpc.projects!(undefined);
    const gone = createRpcHandlers({ store, changed, sdk: { projects: { list: async () => [] } } as never });
    expect(await gone.removedProjects!(undefined)).toEqual([{ id: 'p1', label: 'App (project removed)' }, { id: 'p2', label: 'Site (project removed)' }]);
  });
});

describe('listProjectMappings', () => {
  it('is empty without mappings, lists counts and samples, flags dead local projects, degrades when unavailable', async () => {
    const { received, refs, db } = setup();
    expect(refs.listProjectMappings(PROJECTS)).toEqual([]);
    received('A', 'f1'); received('B', 'f1'); received('C', 'f2');
    await refs.mapForeignProject(list, 'f1', 'p1');
    await refs.mapForeignProject(list, 'f2', 'p2');
    const live = refs.listProjectMappings(PROJECTS);
    expect(live).toHaveLength(2);
    expect(live.find((m) => m.foreignProjectId === 'f1')).toMatchObject({ localProjectId: 'p1', docCount: 2, localRegistered: true });
    expect(live.find((m) => m.foreignProjectId === 'f1')!.sampleTitles.sort()).toEqual(['A', 'B']);
    const dead = refs.listProjectMappings([PROJECTS[0]!]);
    expect(dead.find((m) => m.foreignProjectId === 'f2')?.localRegistered).toBe(false);
    refs.unmapForeignProject('f1');
    expect(refs.listProjectMappings(PROJECTS).map((m) => m.foreignProjectId)).toEqual(['f2']);
    db.runScript('DROP TABLE dd_project_aliases');
    expect(refs.listProjectMappings(PROJECTS)).toEqual([]);
  });

  it('RPC handler lists mappings', async () => {
    const { store, received } = setup();
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk: { projects: { list } } as never });
    received('A', 'f1');
    await rpc.mapForeignProject!({ foreignProjectId: 'f1', localProjectId: 'p1' });
    expect(await rpc.listProjectMappings!(undefined)).toMatchObject([{ foreignProjectId: 'f1', localProjectId: 'p1', docCount: 1, localRegistered: true }]);
  });
});
