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
