import { describe, expect, it, vi } from 'vitest';
import { ContextPresets, registerContextPresets, type PresetScope } from '../lib/preview-context-presets.js';
import { sameContext, presetCompatibility, type ContextPreset } from '../lib/preview-context-preset-contract.js';
import { validateContextEntries, validatePreviewContext, parsePreviewContext } from '../lib/preview-context.js';

const scope: PresetScope = { projectId: 'p', key: 'agent-org', orgLabel: 'Sandbox' };
const values = [{ name: 'verified', type: 'Boolean' as const, value: false }, { name: 'count', type: 'Number' as const, value: 0 }, { name: 'empty', type: 'Text' as const, value: '' }, { name: 'nil', type: 'Text' as const, value: null }];
const payload = (name = 'Default test') => ({ name, values, fields: values.map(v => ({ name: v.name, label: v.name, type: v.type, declared: true })), expectedScope: scope.key });
function setup() {
  const data = new Map<string, unknown>();
  const kv = { get: vi.fn(async <T>(key: string) => structuredClone(data.get(key)) as T), set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }) };
  let id = 0;
  return { data, kv, store: new ContextPresets(kv, () => 123, () => `preset-${++id}`) };
}
describe('context presets storage', () => {
  it('persists detached typed overrides, isolates project/agent/org and updates explicit revisions', async () => {
    const { store, kv } = setup();
    expect(await store.list(scope)).toEqual([]);
    const a = await store.save(scope, payload());
    expect(a).toMatchObject({ id: 'preset-1', revision: 1, updatedAt: 123, values });
    a.values[0]!.value = true;
    expect((await new ContextPresets(kv).list(scope))[0]!.values[0]!.value).toBe(false);
    for (const changed of [{ ...scope, key: 'another-agent' }, { ...scope, key: 'another-org' }, { ...scope, projectId: 'q' }]) expect(await store.list(changed)).toEqual([]);
    const b = await store.save(scope, { ...payload('Renamed'), id: a.id, expectedRevision: 1 });
    expect(b).toMatchObject({ id: a.id, revision: 2, name: 'Renamed' });
    expect(await store.list(scope)).toHaveLength(1);
  });
  it('serializes competing updates, rejects stale revisions and continues after write failures', async () => {
    const { store, kv } = setup();
    const first = await store.save(scope, payload());
    const results = await Promise.allSettled([1, 2].map(() => store.save(scope, { ...payload(), id: first.id, expectedRevision: 1 })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'revision_mismatch' } });
    kv.set.mockRejectedValueOnce(Error('Disk full'));
    await expect(store.save(scope, payload('Fails'))).rejects.toThrow('Disk full');
    await expect(store.save(scope, payload('Recovers'))).resolves.toMatchObject({ name: 'Recovers' });
  });
  it('rejects malformed inputs and never overwrites another scope or duplicate name', async () => {
    const { store } = setup();
    const a = await store.save(scope, payload());
    await expect(store.save(scope, null)).rejects.toThrow();
    await expect(store.save(scope, {})).rejects.toThrow();
    for (const patch of [{ name: '' }, { name: '\n' }, { name: 'x'.repeat(61) }, { expectedScope: 'other' },
      { values: [{ name: 'count', type: 'Number', value: '0' }] }, { fields: [] }, { fields: null }, { fields: Array(101).fill({}) },
      { fields: [...payload().fields, payload().fields[0]] }, { fields: [{ ...payload().fields[0], declared: 'yes' }] },
      { fields: [{ ...payload().fields[0], label: 'x'.repeat(161) }] }, { id: 'missing' }, { id: a.id }, { name: 'DEFAULT TEST' }]) {
      await expect(store.save(scope, patch === null ? null : { ...payload('Next'), ...patch })).rejects.toThrow();
    }
    await expect(store.save({ ...scope, key: 'other' }, { ...payload(), expectedScope: 'other', id: a.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'not_found' });
    const b = await store.save(scope, { ...payload('Source'), fields: payload().fields.map(f => ({ ...f, source: 'x'.repeat(300) })) });
    expect(b.fields[0]!.source).toHaveLength(256);
  });
  it('bounds records and bytes without evicting data, and rejects broken storage', async () => {
    const { store, data } = setup();
    for (let i = 0; i < 20; i++) await store.save(scope, payload(`Preset ${i}`));
    await expect(store.save(scope, payload('Overflow'))).rejects.toMatchObject({ code: 'limit' });
    const rows = data.get('sf:project:p:context-presets') as ContextPreset[];
    expect(rows).toHaveLength(20);
    data.set('sf:project:p:context-presets', Array.from({ length: 100 }, (_, i) => ({ ...rows[0], id: `${i}`, scope: `other${i}` })));
    await expect(store.save(scope, payload('Overflow'))).rejects.toMatchObject({ code: 'limit' });
    data.set('sf:project:p:context-presets', Array.from({ length: 70 }, (_, i) => ({ ...rows[0], id: `${i}`, scope: `other${i}`, name: 'x'.repeat(60_000) })));
    await expect(store.save(scope, payload('Too large'))).rejects.toMatchObject({ code: 'limit' });
    for (const invalid of [{}, Array(101).fill(null)]) {
      data.set('sf:project:p:context-presets', invalid);
      await expect(store.list(scope)).rejects.toMatchObject({ code: 'storage_failed' });
    }
  });
  it('registers bounded RPC results and publishes only successful writes', async () => {
    const { store } = setup();
    const handlers = new Map<string, (a: unknown) => any>(); const changed = vi.fn();
    const resolveScope = vi.fn(async () => scope);
    registerContextPresets({ registerRpc: (n, h) => handlers.set(n, h), store, resolveScope, changed });
    expect(await handlers.get('agentPreview.presets.list')!({})).toMatchObject({ ok: true, presets: [], scopeKey: scope.key, orgLabel: 'Sandbox' });
    expect(await handlers.get('agentPreview.presets.save')!(payload())).toMatchObject({ ok: true, preset: { revision: 1 } });
    expect(changed).toHaveBeenCalledWith('p');
    expect(await handlers.get('agentPreview.presets.save')!({})).toMatchObject({ ok: false, code: 'invalid_input' });
    resolveScope.mockRejectedValueOnce(Error('Offline'));
    expect(await handlers.get('agentPreview.presets.list')!({})).toMatchObject({ ok: false, code: 'failed', error: 'Offline' });
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
describe('agent-authored presets', () => {
  const declared = [
    { name: 'verified', label: 'Verified', type: 'Boolean' as const },
    { name: '$Context.sessionId', label: 'Session', type: 'Text' as const, source: '@MessagingSession.Id' }
  ];
  it('types values from the declarations, keeps undeclared names manual and marks the author', async () => {
    const { store } = setup();
    const saved = await store.save(scope, { name: 'Gold', values: [{ name: 'verified', value: true }, { name: '$Context.sessionId', value: '0Mw1' }, { name: 'tier', type: 'Text', value: 'gold' }] }, { declared, agent: true });
    expect(saved).toMatchObject({ savedBy: 'agent', values: [{ name: 'verified', type: 'Boolean', value: true }, { name: '$Context.sessionId', type: 'Text', value: '0Mw1' }, { name: 'tier', type: 'Text', value: 'gold' }] });
    expect(saved.fields).toEqual([
      { name: 'verified', type: 'Boolean', label: 'Verified', declared: true },
      { name: '$Context.sessionId', type: 'Text', label: 'Session', declared: true, source: '@MessagingSession.Id' },
      { name: 'tier', type: 'Text', label: 'tier', declared: false }
    ]);
    // A wrong declared type, a stale scope or an untyped undeclared name are refused.
    await expect(store.save(scope, { name: 'Bad', values: [{ name: 'verified', type: 'Text', value: 'yes' }] }, { declared, agent: true })).rejects.toThrow('declared as Boolean');
    await expect(store.save(scope, { name: 'Bad', expectedScope: 'old', values: [] }, { declared, agent: true })).rejects.toMatchObject({ code: 'scope_changed' });
    await expect(store.save(scope, { name: 'Bad', values: [{ name: 'untyped', value: 1 }] }, { declared, agent: true })).rejects.toThrow();
    // The Studio still has to send its scope, and a person's update drops the agent mark.
    await expect(store.save(scope, { ...payload('No scope'), expectedScope: undefined })).rejects.toMatchObject({ code: 'scope_changed' });
    expect(await store.save(scope, { ...payload('Gold'), id: saved.id, expectedRevision: 1 })).not.toHaveProperty('savedBy');
  });
  it('removes a preset of its scope only, guarded by revision', async () => {
    const { store } = setup();
    const a = await store.save(scope, payload());
    await expect(store.remove(scope, {})).rejects.toThrow('Choose a preset id');
    await expect(store.remove({ ...scope, key: 'another-agent' }, { id: a.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.remove(scope, { id: a.id, expectedRevision: 2 })).rejects.toMatchObject({ code: 'revision_mismatch' });
    expect(await store.remove(scope, { id: a.id, expectedRevision: 1 })).toEqual({ id: a.id });
    expect(await store.list(scope)).toEqual([]);
  });
  it('registers remove, discovers fields for an agent save and looks presets up by id', async () => {
    const { store } = setup();
    const handlers = new Map<string, (args: unknown) => unknown>();
    const changed = vi.fn();
    const discover = vi.fn(async () => declared);
    const lookup = registerContextPresets({ registerRpc: (n, h) => handlers.set(n, h), store, resolveScope: async () => scope, discover, changed });
    const saved = await handlers.get('agentPreview.presets.save')!({ threadId: 't1', path: 'A.agent', name: 'Agent', values: [{ name: 'verified', value: true }] }) as { ok: boolean; preset: ContextPreset };
    expect(saved).toMatchObject({ ok: true, preset: { savedBy: 'agent', fields: [{ name: 'verified', declared: true }] } });
    expect(discover).toHaveBeenCalledTimes(1);
    // The Studio's own save sends fields, so nothing is discovered and no agent mark is set.
    expect(await handlers.get('agentPreview.presets.save')!(payload('Mine'))).toMatchObject({ ok: true, preset: { name: 'Mine' } });
    expect(discover).toHaveBeenCalledTimes(1);
    expect((await lookup.values({}, saved.preset.id)).name).toBe('Agent');
    await expect(lookup.values({}, 'missing')).rejects.toMatchObject({ code: 'not_found' });
    expect(await handlers.get('agentPreview.presets.remove')!({ id: saved.preset.id })).toEqual({ ok: true, id: saved.preset.id });
    expect(await handlers.get('agentPreview.presets.remove')!({ id: saved.preset.id })).toMatchObject({ ok: false, code: 'not_found' });
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
describe('context validation and preset compatibility', () => {
  it('collects errors per field and never returns a partial context payload', () => {
    const entries = { count: { type: 'Number' as const, text: '-' }, details: { type: 'Json' as const, text: '{' }, valid: { type: 'Text' as const, text: 'kept' } };
    const result = validateContextEntries(entries);
    expect(result.values).toEqual([]); expect(Object.keys(result.fieldErrors)).toEqual(['details', 'count']);
    expect(result.fieldErrors.count).toContain('Enter a number');
    expect(validateContextEntries({ b: { type: 'Boolean', text: 'wrong' } }).fieldErrors.b).toBeTruthy();
    expect(validateContextEntries({ b: { type: 'Boolean', text: 'false' }, n: { type: 'Number', text: '0' }, nil: { type: 'Json', text: 'bad', isNull: true } }).values.map(v => v.value)).toEqual([false, 0, null]);
    expect(validatePreviewContext([{ name: 'a', type: 'Number', value: 'bad' }, { name: 'b', type: 'List', value: {} }]).fieldErrors).toEqual({ a: expect.any(String), b: expect.any(String) });
    expect(validatePreviewContext([null]).errors).toHaveLength(1);
    expect(validatePreviewContext([{ name: 'a', type: 'Text', value: '' }, { name: 'a', type: 'Text', value: '' }]).fieldErrors.a).toContain('Duplicate');
    expect(validatePreviewContext(Array(101).fill({})).errors[0]).toContain('100');
    expect(() => parsePreviewContext([{ name: 'day', type: 'Date', value: '2026-02-30' }])).toThrow();
  });
  it('compares semantic JSON values and identifies removed or retyped declarations while allowing manual inputs', () => {
    const a = [{ name: 'a', type: 'Json' as const, value: { b: 1, a: 2 } }, { name: 'b', type: 'List' as const, value: [0, false] }];
    expect(sameContext(a, [{ ...a[1]! }, { ...a[0]!, value: { a: 2, b: 1 } }])).toBe(true);
    expect(sameContext(a, [{ ...a[0]! }, { ...a[1]!, value: [false, 0] }])).toBe(false);
    const saved = payload().fields;
    const current = saved.filter(f => f.name !== 'empty').map(f => f.name === 'count' ? { ...f, type: 'Text' as const } : f);
    expect(presetCompatibility(current, saved, values)).toEqual({ empty: expect.stringContaining('no longer declared'), count: expect.stringContaining('now Text') });
    expect(presetCompatibility([], saved.map(f => ({ ...f, declared: false })), values)).toEqual({});
  });
});
