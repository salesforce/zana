import { beforeEach, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeHostScheduleTool } from './host-schedule-tools.js';
const { control } = vi.hoisted(() => ({ control: vi.fn() }));
vi.mock('../../http/cli-agent-ops.js', async importOriginal => ({ ...await importOriginal<object>(), callControlAsProductServer: control }));
const task = { id: 'schedule-one', name: 'Hourly QA', enabled: true, projectId: 'p1', profile: 'codex', schedule: { every: '1h' }, status: { runs: [], runCount: 0 } };
const emit = vi.fn();
const ctx = { dataDir: '/instance', toProjects: () => [{ id: 'p1' }], hub: { emit, size: () => 5 } } as unknown as ProductHttpContext;
const invoke = (name: string, input: unknown = {}) => invokeHostScheduleTool(ctx, { name, input, projectId: 'p1', threadId: 't1' });
beforeEach(() => {
  emit.mockClear(); control.mockReset();
  control.mockImplementation(async (_dir, _op, call) => ({ ok: true, value: call.method === 'scheduler.list'
    ? [task, { ...task, id: 'foreign', projectId: 'p2' }]
    : { ok: true, value: { ...task, enabled: call.args[1] ?? true } } }));
});
it('executes exactly once at the owner with five clients, without a command broadcast', async () => {
  expect((await invoke('schedule_run_now', { id: 'Hourly QA' })).success).toBe(true);
  expect(control.mock.calls.map(call => call[2])).toEqual([
    { method: 'scheduler.list', args: [] }, { method: 'scheduler.runNow', args: ['schedule-one'] }
  ]);
  expect(emit).not.toHaveBeenCalled();
});
it('lists authoritative records and confines names and IDs to the owning project', async () => {
  const listed = await invoke('schedule_list');
  expect(JSON.parse(listed.contentItems[0]!.text!).schedules).toHaveLength(1);
  expect((await invoke('schedule_run_now', { id: 'foreign', projectId: 'p2' })).success).toBe(false);
  expect(control.mock.calls.every(call => call[2].method === 'scheduler.list')).toBe(true);
  expect((await invoke('schedule_run_now', { id: 'foreign', allProjects: true })).success).toBe(true);
});
it('updates through the owner and projects the acknowledged result', async () => {
  const result = await invoke('schedule_set_enabled', { id: task.id, enabled: false });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.contentItems[0]!.text!)).toMatchObject({ action: 'disable', schedule: { enabled: false } });
  expect(control).toHaveBeenLastCalledWith('/instance', 'product.invoke', { method: 'scheduler.setEnabled', args: [task.id, false] });
});
it.each([
  ['schedule_run_now', {}], ['schedule_set_enabled', { id: task.id }], ['unsupported', {}]
])('rejects invalid %s without any mutation', async (name, input) => {
  expect((await invoke(name, input)).success).toBe(false);
  expect(control.mock.calls.every(call => call[2].method === 'scheduler.list')).toBe(true);
});
it('rejects an unknown project before reading owner state', async () => {
  expect((await invokeHostScheduleTool(ctx, { name: 'schedule_list', projectId: 'unknown', threadId: 't1', input: null })).success).toBe(false);
  expect(control).not.toHaveBeenCalled();
});
it.each([
  { ok: false, message: 'owner offline' }, { ok: true, value: null }
])('does not fall back to client broadcasts when authority is unavailable', async response => {
  control.mockResolvedValue(response);
  expect((await invoke('schedule_run_now', { id: task.id })).success).toBe(false);
  expect(emit).not.toHaveBeenCalled();
});
it('preserves an owner mutation rejection and never retries', async () => {
  control.mockResolvedValueOnce({ ok: true, value: [task] }).mockResolvedValueOnce({ ok: true, value: { ok: false, message: 'already running' } });
  const result = await invoke('schedule_run_now', { id: task.id });
  expect(result.success).toBe(false); expect(result.contentItems[0]!.text).toContain('already running');
  expect(control).toHaveBeenCalledTimes(2);
});
it.each(['schedule_get', 'schedule_reload', 'schedule_update'])('routes %s to the owner exactly once after scope resolution', async name => {
  control.mockResolvedValueOnce({ ok: true, value: [task] }).mockResolvedValueOnce({ ok: true, value: { ok: true, value: name === 'schedule_reload' ? { reloaded: false, reason: 'run X is live', sessionIds: ['X'], schedule: task } : task } });
  const result = await invoke(name, { id: task.id, patch: { prompt: 'New', extraArgs: ['--effort', 'high'] } });
  expect(result.success).toBe(true);
  expect(control).toHaveBeenCalledTimes(2);
  expect(control.mock.calls[1][2]).toEqual({ method: `scheduler.${name.slice(9)}`, args: name === 'schedule_update' ? [task.id, { prompt: 'New', extraArgs: ['--effort', 'high'] }] : [task.id] });
  if (name === 'schedule_reload') expect(JSON.parse(result.contentItems[0]!.text!)).toMatchObject({ reloaded: false, reason: 'run X is live', sessionIds: ['X'] });
});
it.each(['schedule_get', 'schedule_reload', 'schedule_update'])('confines the %s definition surface', async name => {
  expect((await invoke(name, { id: 'foreign', patch: { prompt: 'New' } })).success).toBe(false);
  expect(control.mock.calls.every(call => call[2].method === 'scheduler.list')).toBe(true);
});
it('rejects forged fields and empty patches on modern schedule updates', async () => {
  for (const patch of [{}, { enabled: true }, { extraArgs: [1] }, { projectId: 'p2' }]) expect((await invoke('schedule_update', { id: task.id, patch })).success).toBe(false);
  expect(control.mock.calls.every(call => call[2].method === 'scheduler.list')).toBe(true);
});
