import { describe, beforeEach, expect, it, vi } from 'vitest';
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
  for (const patch of [{}, { enabled: true }, { extraArgs: [1] }, { projectId: 'p2' }, { launchOptions: { push: false, checks: [] } }, { launchOptions: null }]) expect((await invoke('schedule_update', { id: task.id, patch })).success).toBe(false);
  expect(control.mock.calls.every(call => call[2].method === 'scheduler.list')).toBe(true);
});
describe('schedule run tools', () => {
  const rows = [
    { scheduleId: 'schedule-one', run: { id: 'r1' }, manualRetry: true },
    { scheduleId: 'schedule-one', run: { id: 'r2' }, manualRetry: false },
    { scheduleId: 'schedule-one', run: {}, manualRetry: true }
  ];
  const owner = (extra: Record<string, unknown> = {}) => control.mockImplementation(async (_dir, _op, call) => {
    if (call.method === 'scheduler.list') return { ok: true, value: [task, { ...task, id: 'foreign', projectId: 'p2' }] };
    if (call.method === 'scheduler.queryRuns') return { ok: true, value: { ok: true, value: { rows, total: 3, truncated: false } } };
    if (call.method === 'scheduler.retryRuns') return { ok: true, value: { ok: true, value: call.args[0].map((ref: object) => ({ ...ref, ok: true, status: 'queued' })) } };
    if (call.method === 'scheduler.dismissRuns') return { ok: true, value: { ok: true, value: call.args[0].length } };
    return { ok: true, value: { ok: true, value: extra } };
  });
  const body = (r: { contentItems: Array<{ text?: string }> }) => JSON.parse(r.contentItems[0]!.text!);
  const owned = () => control.mock.calls.map(call => call[2]).filter(call => call.method !== 'scheduler.list');

  it('schedule_runs queries the owner with the route project, ignoring a supplied one', async () => {
    owner();
    const result = await invoke('schedule_runs', { state: 'problems', limit: 3 });
    expect(result.success).toBe(true);
    expect(owned()).toEqual([{ method: 'scheduler.queryRuns', args: [{ state: 'problems', limit: 3, projectId: 'p1' }] }]);
    expect(body(result)).toMatchObject({ scope: 'project:p1', total: 3 });
    // Compact rows only: the full run record never crosses the 256 KB reply cap.
    expect(body(result).rows[0]).toMatchObject({ scheduleId: 'schedule-one', runId: 'r1' });
    expect(body(result).rows[0]).not.toHaveProperty('run');
    expect((await invoke('schedule_runs', { projectId: 'p2' })).success).toBe(false);
    control.mockClear(); owner();
    await invoke('schedule_runs', { allProjects: true });
    expect(owned()).toEqual([{ method: 'scheduler.queryRuns', args: [{ limit: 50 }] }]);
    control.mockClear(); owner();
    await invoke('schedule_runs', { limit: 500 });
    expect(owned()).toEqual([{ method: 'scheduler.queryRuns', args: [{ limit: 100, projectId: 'p1' }] }]);
  });

  it('schedule_retry sends in-scope refs and rejects the rest', async () => {
    owner();
    const result = await invoke('schedule_retry', { refs: [{ scheduleId: 'schedule-one', runId: 'r1' }, { scheduleId: 'foreign', runId: 'r9' }] });
    expect(owned()).toEqual([{ method: 'scheduler.retryRuns', args: [[{ scheduleId: 'schedule-one', runId: 'r1' }]] }]);
    // Partial success is a working call: `ok` true, `allOk` false.
    expect(result.success).toBe(true);
    expect(body(result)).toMatchObject({ ok: true, allOk: false, count: 2 });
    expect(body(result).results[1]).toMatchObject({ ok: false, error: 'schedule not found' });
  });

  it('schedule_retry open:true retries only retryable open rows; needs exactly one mode', async () => {
    owner();
    const result = await invoke('schedule_retry', { open: true });
    expect(owned()).toEqual([
      { method: 'scheduler.queryRuns', args: [{ state: 'open', limit: 200, projectId: 'p1' }] },
      { method: 'scheduler.retryRuns', args: [[{ scheduleId: 'schedule-one', runId: 'r1' }]] }
    ]);
    expect(body(result).count).toBe(1);
    control.mockClear(); owner();
    expect((await invoke('schedule_retry', {})).success).toBe(false);
    expect((await invoke('schedule_retry', { open: true, refs: [{ scheduleId: 'a', runId: 'b' }] })).success).toBe(false);
    expect(owned()).toEqual([]);
  });

  it('schedule_dismiss counts in-scope refs and skips the owner when none are', async () => {
    owner();
    expect(body(await invoke('schedule_dismiss', { refs: [{ scheduleId: 'schedule-one', runId: 'r1' }] }))).toEqual({ ok: true, allOk: true, dismissed: 1, rejected: [] });
    control.mockClear(); owner();
    expect(body(await invoke('schedule_dismiss', { refs: [{ scheduleId: 'foreign', runId: 'r1' }] }))).toMatchObject({ ok: false, dismissed: 0 });
    expect(owned()).toEqual([]);
    expect((await invoke('schedule_dismiss', { refs: [] })).success).toBe(false);
  });

  it('surfaces an owner failure Result', async () => {
    control.mockImplementation(async (_dir, _op, call) => call.method === 'scheduler.list'
      ? { ok: true, value: [task] } : { ok: true, value: { ok: false, message: 'QUERY_FAILED' } });
    const result = await invoke('schedule_runs');
    expect(result.success).toBe(false);
    expect(result.contentItems[0]!.text).toContain('QUERY_FAILED');
  });

  it('declares the three tools with closed input schemas', async () => {
    const { HOST_SCHEDULE_TOOLS } = await import('./host-schedule-tools.js');
    for (const name of ['schedule_runs', 'schedule_retry', 'schedule_dismiss']) {
      const tool = HOST_SCHEDULE_TOOLS.find(candidate => candidate.name === name)!;
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toContain('allProjects');
    }
  });
});

describe('schedule run tools: scope edge cases', () => {
  it('never targets Claude /loop rows, even when they carry the route project', async () => {
    control.mockImplementation(async (_dir, _op, call) => {
      if (call.method === 'scheduler.list') return { ok: true, value: [task, { ...task, id: 'claude-loop:abc', external: { kind: 'claude-loop', cron: '* * * * *' } }] };
      if (call.method === 'scheduler.retryRuns') return { ok: true, value: { ok: true, value: call.args[0].map((ref: object) => ({ ...ref, ok: true, status: 'queued' })) } };
      return { ok: true, value: { ok: true, value: 0 } };
    });
    const result = await invoke('schedule_retry', { refs: [{ scheduleId: task.id, runId: 'r1' }, { scheduleId: 'claude-loop:abc', runId: 'r2' }] });
    const sent = control.mock.calls.map(call => call[2]).filter(call => call.method === 'scheduler.retryRuns');
    expect(sent).toEqual([{ method: 'scheduler.retryRuns', args: [[{ scheduleId: task.id, runId: 'r1' }]] }]);
    expect(JSON.parse(result.contentItems[0]!.text!).results[1]).toMatchObject({ scheduleId: 'claude-loop:abc', ok: false, error: 'schedule not found' });
  });
});
