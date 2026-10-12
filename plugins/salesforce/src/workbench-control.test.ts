import { describe, expect, it } from 'vitest';
import { WorkbenchControl } from '../lib/workbench-control.js';
import { WorkbenchResults } from '../lib/workbench-results.js';
import { actionCatalog, actionInput, isWorkbenchAction } from '../lib/workbench-actions.js';

describe('scoped workbench controls', () => {
  it('lists, delivers once and acknowledges the actual resulting view state', () => {
    const service = new WorkbenchControl();
    const { viewId } = service.register('p', { surface: 'agentforce', commands: ['state', 'file.open'], threadId: 'thread' });
    expect(service.list('other')).toEqual([]);
    expect(service.list('p')[0]).toMatchObject({ id: viewId, threadId: 'thread' });
    const { commandId } = service.request('p', { viewId, command: 'file.open', input: { path: 'Help.agent' } });
    expect(service.result('p', commandId)).toEqual({ state: 'pending' });
    expect(() => service.acknowledge('p', { viewId, commandId, ok: true, state: {} })).toThrow('stale');
    expect(service.poll('p', { viewId, state: { path: 'old.agent' } }).commands).toHaveLength(1);
    expect(service.poll('p', { viewId, state: {} }).commands).toHaveLength(0);
    service.acknowledge('p', { viewId, commandId, ok: true, state: { path: 'Help.agent' } });
    expect(service.result('p', commandId)).toEqual({ state: 'completed', ok: true, viewState: { path: 'Help.agent' } });
    expect(() => service.acknowledge('p', { viewId, commandId })).toThrow('stale');
    service.close('p', viewId); expect(service.list('p')).toEqual([]);
  });
  it('rejects unsupported, cross-project, stale and missing views/commands', () => {
    let now = 0; const service = new WorkbenchControl(() => now);
    const { viewId } = service.register('p', { surface: 'workbench', commands: ['state'] });
    const other = service.register('p', { surface: 'workbench', commands: [] });
    expect(() => service.request('other', { viewId, command: 'state' })).toThrow('unavailable');
    expect(() => service.request('p', { viewId, command: 'delete' })).toThrow('support');
    const { commandId } = service.request('p', { viewId, command: 'state' });
    expect(() => service.result('other', commandId)).toThrow('project');
    service.poll('p', { viewId, state: {} });
    expect(() => service.acknowledge('p', { viewId: other.viewId, commandId })).toThrow('stale');
    now = 20_001;
    expect(service.result('p', commandId)).toMatchObject({ ok: false, state: 'failed' });
    expect(service.list('p')).toEqual([]);
    now = 300_001; expect(() => service.result('p', commandId)).toThrow('not found');
    service.dispose();
  });
  it('lists the focused window first and records each view window from untrusted input', () => {
    let now = 1000; const service = new WorkbenchControl(() => now);
    const main = service.register('p', { surface: 'agentforce', commands: ['state'], window: 'main' }).viewId;
    const studio = service.register('p', { surface: 'workbench', commands: ['view.open'], window: 'plugin-view' }).viewId;
    const odd = service.register('p', { surface: 'data', commands: [], window: 'elsewhere' }).viewId;
    expect(service.list('p').find(view => view.id === odd)).not.toHaveProperty('window');
    expect(service.list('p')[0]).toMatchObject({ visible: true, focused: false });
    now = 1100; service.poll('p', { viewId: main, state: {}, presence: { visible: true, focused: true } });
    now = 1200; service.poll('p', { viewId: odd, state: {}, presence: { visible: false, focused: false } });
    expect(service.list('p').map(view => view.id)).toEqual([main, studio, odd]);
    // Focus moves to the Studio window; the main window stays visible behind it.
    now = 1300; service.poll('p', { viewId: main, state: {}, presence: { visible: true, focused: false } });
    now = 1400; service.poll('p', { viewId: studio, state: {}, presence: { visible: true, focused: true } });
    const listed = service.list('p');
    expect(listed.map(view => view.id)).toEqual([studio, main, odd]);
    expect(listed[0]).toMatchObject({ window: 'plugin-view', visible: true, focused: true });
    expect(listed[0]).not.toHaveProperty('focusedAt');
    // A malformed presence keeps the last report; the more recently focused view wins a tie.
    now = 1500; service.poll('p', { viewId: studio, state: {}, presence: 'focused' });
    service.poll('p', { viewId: studio, state: {}, presence: { visible: false, focused: false } });
    expect(service.list('p').map(view => view.id)).toEqual([main, studio, odd]);
  });
  it('marks commands from the person\'s own UI, never ones a thread sent', () => {
    const service = new WorkbenchControl();
    const { viewId } = service.register('p', { surface: 'agentforce', commands: ['file.open'] });
    service.request('p', { viewId, command: 'file.open', input: { path: 'a.agent' } }, undefined, true);
    service.request('p', { viewId, command: 'file.open', input: { path: 'b.agent' } }, { threadId: 't' }, true);
    service.request('p', { viewId, command: 'file.open', input: { path: 'c.agent' } });
    const [own, thread, agent] = service.poll('p', { viewId, state: {} }).commands;
    expect(own).toMatchObject({ user: true });
    expect(thread).not.toHaveProperty('user');
    expect(thread!.from).toEqual({ threadId: 't' });
    expect(agent).not.toHaveProperty('user');
  });
  it('bounds views, commands and payloads and reports renderer errors', () => {
    const service = new WorkbenchControl();
    expect(() => service.register('p', [])).toThrow('payload');
    expect(() => service.register('p', { surface: 'bogus', commands: [] })).toThrow('surface');
    expect(() => service.register('p', { surface: 'data', commands: ['x'] })).toThrow('command');
    const { viewId } = service.register('p', { surface: 'data', commands: ['state'] });
    expect(() => service.poll('p', { viewId, state: { source: 'a'.repeat(200_000) } })).toThrow('payload');
    const { commandId } = service.request('p', { viewId, command: 'state' });
    service.poll('p', { viewId, state: {} });
    service.acknowledge('p', { viewId, commandId, ok: false, error: 'Unsaved draft' });
    expect(service.result('p', commandId)).toMatchObject({ ok: false, error: 'Unsaved draft' });
    const fallback = service.request('p', { viewId, command: 'state' });
    service.poll('p', { viewId, state: {} }); service.acknowledge('p', { viewId, commandId: fallback.commandId });
    expect(service.result('p', fallback.commandId)).toMatchObject({ ok: false, error: expect.stringContaining('could not') });
    for (let i = 0; i < 8; i++) service.request('p', { viewId, command: 'state' });
    expect(() => service.request('p', { viewId, command: 'state' })).toThrow('busy');
    for (let i = 1; i < 40; i++) service.register('p', { surface: 'data', commands: [] });
    expect(() => service.register('p', { surface: 'data', commands: [] })).toThrow('Too many');
  });
});

it('keeps bounded server-owned query results scoped to the original org and project', () => {
  let now = 0; const results = new WorkbenchResults(() => now);
  const id = results.put('p', 'org', { records: [{ Id: 'record' }] });
  expect(results.get('p', 'org', id)).toMatchObject({ records: [{ Id: 'record' }] });
  expect(() => results.get('other', 'org', id)).toThrow('another project');
  expect(() => results.get('p', 'other', id)).toThrow('another project');
  expect(() => results.put('p', 'org', 'a'.repeat(300_000))).toThrow('too large');
  for (let i = 0; i < 20; i++) results.put('p', 'org', {});
  expect(() => results.get('p', 'org', id)).toThrow();
  const last = results.put('p', 'org', {}); now = 600_001; expect(() => results.get('p', 'org', last)).toThrow('expired');
  results.dispose(); expect(() => results.get('p', 'org', last)).toThrow();
});
it('offers a closed semantic action catalogue and strips caller authority fields', () => {
  expect(actionCatalog()).toContainEqual(expect.objectContaining({ action: 'draft.create' }));
  expect(isWorkbenchAction('draft.create')).toBe(true); expect(isWorkbenchAction('arbitrary.rpc')).toBe(false);
  expect(actionInput(undefined)).toEqual({});
  expect(actionInput({ projectId: 'forged', threadId: 'forged', orgAlias: 'other', path: 'here' })).toEqual({ path: 'here' });
  for (const value of [null, [], 'bad', { source: 'x'.repeat(200_001) }]) expect(() => actionInput(value)).toThrow('object');
});
