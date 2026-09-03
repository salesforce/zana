import { describe, it, expect, vi } from 'vitest';
import {
  registerScheduleManageTools,
  resolveSchedule,
  scopeSchedules,
  projectSchedule,
  formatResolveError,
  type ScheduleAgentApi
} from './schedule-manage-mcp-tools.js';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  };
  return { server, tools };
}

function text(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function payload(res: { content: Array<{ type: string; text?: string }> }) {
  return JSON.parse(text(res));
}

function makeTask(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'qa-hourly',
    name: 'Hourly QA sweep',
    enabled: true,
    projectId: 'proj-1',
    profile: 'claude',
    prompt: 'Run the suite. Do not leak this.',
    extraArgs: ['--secret-token'],
    schedule: { every: '1h' },
    overlap: 'skip',
    history: { retain: 10 },
    status: {
      runCount: 3,
      lastRunAt: '2026-09-01T10:00:00.000Z',
      nextRunAt: '2026-09-01T11:00:00.000Z',
      lastRunResult: 'success',
      runs: [
        {
          id: 'run-1',
          at: '2026-09-01T10:00:00.000Z',
          result: 'success'
        }
      ]
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...over
  };
}

function makeApi(tasks: ScheduledTask[], over: Partial<ScheduleAgentApi> = {}): ScheduleAgentApi {
  return {
    list: vi.fn(() => tasks),
    runNow: vi.fn((id: string) => {
      const t = tasks.find((s) => s.id === id);
      if (!t) throw new Error(`schedule not found: ${id}`);
      return t;
    }),
    setEnabled: vi.fn((id: string, enabled: boolean) => {
      const t = tasks.find((s) => s.id === id);
      if (!t) return null;
      return { ...t, enabled };
    }),
    ...over
  };
}

describe('scopeSchedules', () => {
  const a = makeTask({ id: 'a', projectId: 'proj-1' });
  const b = makeTask({ id: 'b', projectId: 'proj-2' });

  it('confines to the route project by default', () => {
    expect(scopeSchedules([a, b], 'proj-1', false).map((t) => t.id)).toEqual(['a']);
  });

  it('returns the full list when allProjects is true', () => {
    expect(scopeSchedules([a, b], 'proj-1', true).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('resolveSchedule', () => {
  const hourly = makeTask({ id: 'qa-hourly', name: 'Hourly QA sweep' });
  const nightly = makeTask({ id: 'qa-nightly', name: 'Nightly QA sweep' });
  const twinA = makeTask({ id: 'watch-1', name: 'Watchdog' });
  const twinB = makeTask({ id: 'watch-2', name: 'Watchdog' });

  it('matches exact id first', () => {
    const r = resolveSchedule([hourly, nightly], 'qa-hourly');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.id).toBe('qa-hourly');
  });

  it('matches a unique case-insensitive name', () => {
    const r = resolveSchedule([hourly, nightly], 'hourly qa sweep');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.id).toBe('qa-hourly');
  });

  it('matches a unique id prefix', () => {
    const r = resolveSchedule([hourly, nightly], 'qa-n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.id).toBe('qa-nightly');
  });

  it('reports ambiguous names with candidates', () => {
    const r = resolveSchedule([twinA, twinB], 'watchdog');
    expect(r).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates: [
        { id: 'watch-1', name: 'Watchdog' },
        { id: 'watch-2', name: 'Watchdog' }
      ]
    });
  });

  it('reports an ambiguous id prefix with candidates', () => {
    const r = resolveSchedule([hourly, nightly], 'qa-');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ambiguous');
  });

  it('returns not_found for an unknown query', () => {
    expect(resolveSchedule([hourly], 'nope')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found for a blank query', () => {
    expect(resolveSchedule([hourly], '   ')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('prefers exact id over a colliding name', () => {
    const namedLikeId = makeTask({ id: 'other', name: 'qa-hourly' });
    const r = resolveSchedule([hourly, namedLikeId], 'qa-hourly');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.id).toBe('qa-hourly');
  });
});

describe('projectSchedule', () => {
  it('projects cadence + status and omits prompt, extraArgs, and run history', () => {
    const hit = projectSchedule(makeTask());
    expect(hit).toEqual({
      id: 'qa-hourly',
      name: 'Hourly QA sweep',
      enabled: true,
      projectId: 'proj-1',
      schedule: { every: '1h' },
      lastRunAt: '2026-09-01T10:00:00.000Z',
      nextRunAt: '2026-09-01T11:00:00.000Z',
      lastRunResult: 'success',
      runCount: 3
    });
    expect(hit).not.toHaveProperty('prompt');
    expect(hit).not.toHaveProperty('extraArgs');
    expect(hit).not.toHaveProperty('status');
  });

  it('includes cron + tz when present', () => {
    const hit = projectSchedule(
      makeTask({ schedule: { cron: '0 9 * * 1-5', tz: 'Europe/Paris' } })
    );
    expect(hit.schedule).toEqual({ cron: '0 9 * * 1-5', tz: 'Europe/Paris' });
  });
});

describe('formatResolveError', () => {
  it('does not list candidates on not_found', () => {
    expect(formatResolveError({ ok: false, reason: 'not_found' }, 'secret')).toBe(
      'schedule not found: secret'
    );
  });
});

describe('registerScheduleManageTools', () => {
  const local = makeTask();
  const other = makeTask({
    id: 'gift-qa',
    name: 'Gift-card QA',
    projectId: 'proj-2',
    prompt: 'other secret'
  });

  it('registers exactly the three schedule_* tools', () => {
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, {
      projectId: 'proj-1',
      scheduleAgentApi: makeApi([local])
    });
    expect([...tools.keys()].sort()).toEqual([
      'schedule_list',
      'schedule_run_now',
      'schedule_set_enabled'
    ]);
  });

  it('schedule_list defaults to THIS project and omits internals', async () => {
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, {
      projectId: 'proj-1',
      scheduleAgentApi: makeApi([local, other])
    });
    const out = payload(await tools.get('schedule_list')!({}));
    expect(out.scope).toBe('project:proj-1');
    expect(out.count).toBe(1);
    expect(out.schedules[0].id).toBe('qa-hourly');
    expect(out.schedules[0]).not.toHaveProperty('prompt');
    expect(out.schedules.some((s: { projectId: string }) => s.projectId === 'proj-2')).toBe(false);
  });

  it('schedule_list allProjects lists every schedule', async () => {
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, {
      projectId: 'proj-1',
      scheduleAgentApi: makeApi([local, other])
    });
    const out = payload(await tools.get('schedule_list')!({ allProjects: true }));
    expect(out.scope).toBe('all-projects');
    expect(out.schedules.map((s: { id: string }) => s.id).sort()).toEqual(['gift-qa', 'qa-hourly']);
  });

  it('schedule_run_now fires by name within this project', async () => {
    const api = makeApi([local, other]);
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_run_now')!({ id: 'Hourly QA sweep' });
    expect(res.isError).toBeFalsy();
    expect(api.runNow).toHaveBeenCalledWith('qa-hourly');
    expect(payload(res).schedule.id).toBe('qa-hourly');
  });

  it('schedule_run_now hides a cross-project id without allProjects', async () => {
    const api = makeApi([local, other]);
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_run_now')!({ id: 'gift-qa' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('schedule not found: gift-qa');
    expect(api.runNow).not.toHaveBeenCalled();
  });

  it('schedule_run_now with allProjects can fire another project\'s schedule', async () => {
    const api = makeApi([local, other]);
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_run_now')!({ id: 'gift-qa', allProjects: true });
    expect(res.isError).toBeFalsy();
    expect(api.runNow).toHaveBeenCalledWith('gift-qa');
  });

  it('schedule_run_now reports ambiguous names without firing', async () => {
    const api = makeApi([
      makeTask({ id: 'watch-1', name: 'Watchdog' }),
      makeTask({ id: 'watch-2', name: 'Watchdog' })
    ]);
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_run_now')!({ id: 'Watchdog' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('ambiguous');
    expect(text(res)).toContain('watch-1');
    expect(api.runNow).not.toHaveBeenCalled();
  });

  it('schedule_set_enabled toggles by unique id prefix', async () => {
    const api = makeApi([local]);
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_set_enabled')!({ id: 'qa-h', enabled: false });
    expect(res.isError).toBeFalsy();
    expect(api.setEnabled).toHaveBeenCalledWith('qa-hourly', false);
    expect(payload(res).action).toBe('disable');
    expect(payload(res).schedule.enabled).toBe(false);
  });

  it('schedule_set_enabled reports a vanished id as an error', async () => {
    const api = makeApi([local], { setEnabled: vi.fn(() => null) });
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_set_enabled')!({ id: 'qa-hourly', enabled: true });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('schedule not found');
  });

  it('a throwing manager surfaces as isError, not an exception', async () => {
    const api = makeApi([local], {
      runNow: vi.fn(() => {
        throw new Error('overlap skip');
      })
    });
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const res = await tools.get('schedule_run_now')!({ id: 'qa-hourly' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('schedule_run_now failed: overlap skip');
  });

  it('ignores a smuggled projectId — the route id is the authority', async () => {
    const api = makeApi([local, other]);
    const { server, tools } = fakeServer();
    registerScheduleManageTools(server as never, { projectId: 'proj-1', scheduleAgentApi: api });
    const out = payload(
      await tools.get('schedule_list')!({ allProjects: false, projectId: 'proj-2' })
    );
    expect(out.scope).toBe('project:proj-1');
    expect(out.schedules.map((s: { id: string }) => s.id)).toEqual(['qa-hourly']);
  });
});
