import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn(task => structuredClone(task)), saveSchedule: vi.fn(),
  globalDir: () => '/tmp/scheduler-launch-options', projectDir: () => '/tmp/scheduler-launch-options'
}));

import { SchedulerManager } from './scheduler.js';
import { saveSchedule } from './scheduler-store.js';
import { validateScheduleFile } from './schedule-validation.js';
import { scheduleDefinitionPatchSchema, projectScheduleDefinition, registerScheduleManageTools } from './schedule-manage-mcp-tools.js';

const base = { name: 'Review', projectId: 'p', profile: 'claude' as const, every: '1h', enabled: false, kind: 'team' as const, teamId: 't' };
const options = { worktree: false, push: false, checks: [], onComplete: 'leave' as const, failurePolicyDefault: 'fail-run' as const };
const managers: SchedulerManager[] = [];
function manager() {
  const value = new SchedulerManager();
  value.setDeps({ ptys: { list: () => [] }, store: { listProjects: () => [] } } as never);
  managers.push(value);
  return value;
}
afterEach(() => { managers.splice(0).forEach(value => value.stopAll()); vi.clearAllMocks(); });

describe('schedule launch options', () => {
  it('persists explicit false and empty lists on create, update, reload and definition replies', async () => {
    const m = manager();
    const task = await m.create({ ...base, launchOptions: options } as never);
    expect(task).toHaveProperty('launchOptions', options);
    expect(saveSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ launchOptions: options }), [], expect.objectContaining({ launchOptions: options }));
    expect(validateScheduleFile(task)).toHaveProperty('launchOptions', options);
    expect(projectScheduleDefinition(task)).toHaveProperty('launchOptions', options);
    const updated = await m.update(task.id, { launchOptions: { push: true } } as never);
    expect(updated).toHaveProperty('launchOptions', { push: true });
    expect((await m.update(task.id, { name: 'Renamed' })).launchOptions).toEqual({ push: true });
    expect((await m.update(task.id, { launchOptions: null } as never)).launchOptions).toBeUndefined();
  });

  it.each([
    { push: 'false' }, { checks: ['shell command'] }, { unknown: true },
    { target: { kind: 'project-root' }, worktree: true },
    { target: { kind: 'project-root' }, onComplete: 'merge' }
  ])('rejects invalid options without saving: %j', async launchOptions => {
    const m = manager();
    await expect(m.create({ ...base, launchOptions } as never)).rejects.toThrow();
    const task = await m.create(base);
    vi.mocked(saveSchedule).mockClear();
    await expect(m.update(task.id, { launchOptions } as never)).rejects.toThrow();
    expect(saveSchedule).not.toHaveBeenCalled();
    expect(validateScheduleFile({ ...task, launchOptions })).toHaveProperty('error');
  });

  it('rejects options for agent or omitted kind and clears them when switching away from team', async () => {
    const m = manager();
    for (const kind of [undefined, 'agent'] as const) {
      await expect(m.create({ ...base, kind, launchOptions: {} } as never)).rejects.toThrow('team');
    }
    const agent = await m.create({ ...base, kind: 'agent' });
    await expect(m.update(agent.id, { launchOptions: {} } as never)).rejects.toThrow('team');
    expect(validateScheduleFile({ ...agent, launchOptions: options })).toHaveProperty('error');
    const task = await m.create({ ...base, launchOptions: options } as never);
    const switched = await m.update(task.id, { kind: 'agent' });
    expect(switched.launchOptions).toBeUndefined();
    expect(saveSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ launchOptions: undefined, teamId: undefined, planSource: undefined }), [], expect.objectContaining({ launchOptions: undefined, teamId: undefined, planSource: undefined }));
  });

  it('exposes shared strict options schema but refuses agent writes to operator-owned options', async () => {
    expect(scheduleDefinitionPatchSchema.safeParse({ launchOptions: options }).success).toBe(true);
    expect(scheduleDefinitionPatchSchema.safeParse({ launchOptions: { unknown: true } }).success).toBe(false);
    const task = await manager().create(base);
    const update = vi.fn();
    const tools = new Map<string, (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    registerScheduleManageTools({ registerTool: (name: string, _schema: unknown, handler: never) => tools.set(name, handler) } as never, {
      projectId: 'p', scheduleAgentApi: { list: () => [task], update, runNow: () => task, setEnabled: () => task }
    });
    const result = await tools.get('schedule_update')!({ id: task.id, patch: { launchOptions: options } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('operator');
    expect(update).not.toHaveBeenCalled();
  });
});
