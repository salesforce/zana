import { describe, expect, it, vi } from 'vitest';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { ScenarioLibrary, registerScenarioLibrary, scenarioLibraryStorage } from '../lib/scenario-library.js';
import { scenarioSnapshot, starterScenarios } from '../lib/scenario-library-contract.js';
import { parseLabScenario } from '../lib/agentforce-lab-contract.js';

const scope = { projectId: 'p', agentPath: 'Bot.agent' };
const definition = (name = 'Customer') => ({ ...starterScenarios()[0], id: undefined, name, contextVariables: [{ name: 'verified', type: 'Boolean' as const, value: false }] });
function setup(initial?: unknown) {
  const data = new Map<string, unknown>(initial === undefined ? [] : [['p', initial]]);
  let id = 0;
  const kv = { get: vi.fn(async <T,>(key: string) => data.get(key) as T), set: vi.fn(async (key: string, value: unknown) => { data.set(key, value); }) };
  return { kv, data, store: new ScenarioLibrary(kv, () => 123, () => `scenario-${++id}`) };
}
describe('shared scenario definitions', () => {
  it('seeds once per agent, isolates projects and returns detached definitions and snapshots', async () => {
    const { store } = setup();
    const starters = await store.list(scope); expect(starters).toHaveLength(3);
    starters[0].persona = 'mutation'; expect((await store.list(scope))[0].persona).not.toBe('mutation');
    const saved = await store.save(scope, definition()); expect(saved).toMatchObject({ id: 'scenario-1', revision: 1, updatedAt: 123 });
    const snapshot = scenarioSnapshot(saved); saved.contextVariables[0].value = true;
    expect(snapshot.contextVariables?.[0].value).toBe(false); expect(parseLabScenario(snapshot).origin).toEqual({ id: saved.id, name: 'Customer', revision: 1 });
    expect((await store.list({ ...scope, projectId: 'q' }))).toHaveLength(3);
    expect((await store.list({ ...scope, agentPath: 'Other.agent' }))).toHaveLength(3);
    expect((await store.list(scope))).toHaveLength(4);
  });
  it('uses revision checks, keeps order, requires unique names and never changes a previous snapshot', async () => {
    const { store } = setup(); const first = (await store.list(scope))[0]; const snapshot = scenarioSnapshot(first);
    const next = await store.save(scope, { ...first, name: 'Renamed', expectedRevision: 1, origin: snapshot.origin });
    expect(next.revision).toBe(2); expect(next.origin).toBeUndefined(); expect((await store.list(scope))[0].name).toBe('Renamed');
    expect(snapshot.name).toBe(first.name); expect(snapshot.origin?.revision).toBe(1);
    await expect(store.save(scope, { ...next, expectedRevision: 1 })).rejects.toMatchObject({ code: 'revision_mismatch' });
    await expect(store.save(scope, { ...next })).rejects.toMatchObject({ code: 'revision_mismatch' });
    await expect(store.save(scope, definition('RENAMED'))).rejects.toThrow('already exists');
    await expect(store.save(scope, { ...definition(), id: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.save(scope, { ...definition(), goal: '' })).rejects.toThrow();
    await expect(store.save(scope, { ...definition(), contextVariables: [{ name: 'verified', type: 'Boolean', value: 'false' }] })).rejects.toThrow();
  });
  it('serializes concurrent updates, recovers after write errors and retains an explicitly empty catalogue', async () => {
    const { store, kv } = setup(); const row = (await store.list(scope))[0];
    const results = await Promise.allSettled([store.save(scope, { ...row, name: 'A', expectedRevision: 1 }), store.save(scope, { ...row, name: 'B', expectedRevision: 1 })]);
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected']);
    kv.set.mockRejectedValueOnce(Error('disk full')); await expect(store.save(scope, definition())).rejects.toThrow('disk full');
    expect((await store.list(scope))).toHaveLength(3); await store.save(scope, definition());
    await expect(store.remove(scope, { id: 'missing', expectedRevision: 1 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.remove(scope, { id: row.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'revision_mismatch' });
    for (const item of await store.list(scope)) await store.remove(scope, { id: item.id, expectedRevision: item.revision });
    expect(await store.list(scope)).toEqual([]);
  });
  it('bounds agent, project and payload growth without corrupting previous data', async () => {
    const { store } = setup(); for (let i = 0; i < 27; i++) await store.save(scope, definition(`Name ${i}`));
    await expect(store.save(scope, definition('Extra'))).rejects.toMatchObject({ code: 'limit' }); expect(await store.list(scope)).toHaveLength(30);
    const all = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Agent${i}`, []]));
    const agents = setup(all); await expect(agents.store.save(scope, definition())).rejects.toMatchObject({ code: 'limit' });
    const full = setup(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`Agent${i}`, Array.from({ length: 30 }, (_, n) => ({ ...starterScenarios()[0], id: `s-${n}`, name: `Row ${n}` }))])));
    await expect(full.store.save(scope, definition())).rejects.toMatchObject({ code: 'limit' });
    const collections: Record<string, any[]> = {};
    for (let i = 0; i < 62; i++) (collections[`Agent${Math.floor(i / 30)}`] ??= []).push({ ...definition(`Large ${i}`), id: `s-${i}`, contextVariables: [{ name: 'text', type: 'Text', value: 'x'.repeat(63_000) }] });
    const padding = 3_970_000 - JSON.stringify(collections).length;
    collections.Agent2[0].persona += 'x'.repeat(Math.min(1000, Math.max(0, padding)));
    const large = setup(collections);
    await expect(large.store.save(scope, { ...definition(), contextVariables: [{ name: 'text', type: 'Text', value: 'x'.repeat(63_000) }] })).rejects.toMatchObject({ code: 'limit' });
    expect(await large.store.list({ ...scope, agentPath: 'Agent0' })).toHaveLength(30);
  });
  it.each([[], { a: null }, { a: [{}] }, { a: [{ ...starterScenarios()[0], revision: 0 }] }, { a: [starterScenarios()[0], starterScenarios()[0]] }, { a: [{ ...starterScenarios()[0], id: 'bad/id' }] }])('fails closed on damaged storage %#', async data => {
    await expect(setup(data).store.list(scope)).rejects.toThrow();
  });
  it('registers bounded read/write RPCs, publishes only successful mutations and rejects unresolved scopes', async () => {
    const handlers = new Map<string, (args: unknown) => any>(); const { store } = setup(); const changed = vi.fn(); const resolveScope = vi.fn(async () => scope);
    registerScenarioLibrary({ store, changed, resolveScope, registerRpc: (name, handler) => { handlers.set(name, handler); } });
    expect(await handlers.get('studio.scenarios.list')!({})).toMatchObject({ ok: true, scenarios: expect.any(Array) });
    const reply = await handlers.get('studio.scenarios.save')!(definition()); expect(reply.ok).toBe(true); expect(changed).toHaveBeenCalledTimes(1);
    expect(await handlers.get('studio.scenarios.remove')!({ id: reply.scenario.id, expectedRevision: 1 })).toEqual({ ok: true });
    expect(await handlers.get('studio.scenarios.remove')!({ id: 'missing' })).toMatchObject({ ok: false, code: 'not_found' }); expect(changed).toHaveBeenCalledTimes(2);
    resolveScope.mockRejectedValueOnce(Error('Outside registered project')); expect(await handlers.get('studio.scenarios.list')!({})).toMatchObject({ ok: false, error: 'Outside registered project' });
  });
  it('persists definitions through database adapter recreation', async () => {
    const db = createSqliteDatabase(':memory:'); const factory = () => ({ runScript: (sql: string) => { db.exec(sql); }, prepare: (sql: string) => db.prepare(sql) });
    try { await new ScenarioLibrary(scenarioLibraryStorage(factory)).save(scope, definition()); expect(await new ScenarioLibrary(scenarioLibraryStorage(factory)).list(scope)).toHaveLength(4); } finally { db.close(); }
  });
  it.each([{ id: undefined, name: 'Name', revision: 1 }, { id: 'bad/id', name: 'Name', revision: 1 }, { id: 'ok', name: '', revision: 1 }, { id: 'ok', name: 'Name', revision: 0 }])('validates source revision %#', origin => {
    expect(() => parseLabScenario({ ...definition(), origin })).toThrow();
  });
});
