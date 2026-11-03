import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ScheduledTask, Project, ScheduleRun } from '@zana-ai/zcc-domain/product';
import { isOpenProblem } from '@zana-ai/zcc-domain/schedule-health';
import { SchedulerManager } from './scheduler.js';

// Self-healing on upstream's scheduled Squads (#328): reasons, problem
// resolution, overlap and the run queue all treat a live Squad run like a live
// PTY session.

const fs = vi.hoisted(() => ({ watch: vi.fn(), existsSync: vi.fn(() => true), mkdirSync: vi.fn() }));
vi.mock('node:fs', () => fs);
vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn((task) => structuredClone(task)), saveSchedule: vi.fn(), deleteSchedule: vi.fn(() => true), listAllSchedules: vi.fn(() => []),
  globalDir: () => '/global/schedules', projectDir: (project: Project) => `${project.path}/.zcc/schedules`
}));
const project: Project = { id: 'p1', name: 'Owner', path: '/owner/project', createdAt: 0, lastActiveAt: 0 };
const managers: SchedulerManager[] = [];

function fixture(config: Record<string, unknown> = {}) {
  const records = new Map<string, ScheduledTask>();
  const persistence = {
    load: vi.fn(async () => structuredClone([...records.values()])),
    save: vi.fn(async (value: ScheduledTask) => { records.set(value.id, structuredClone(value)); }),
    remove: vi.fn(async (value: ScheduledTask) => { records.delete(value.id); }),
    localProjects: vi.fn(() => [] as Project[])
  };
  const ptys = Object.assign(new EventEmitter(), {
    list: vi.fn(() => []), reapDeadSessions: vi.fn(), closeExpected: vi.fn()
  });
  const states = new Map<string, string>();
  let sequence = 0;
  const deps = {
    persistence,
    ptys: ptys as any,
    launchTerminal: vi.fn(),
    launchSquad: vi.fn(async () => {
      const executionId = `execution-${++sequence}`;
      states.set(executionId, 'RUNNING');
      return { executionId };
    }),
    getSquadExecution: vi.fn(async (_projectId: string, executionId: string) => ({ state: states.get(executionId) ?? 'RUNNING' })),
    findSquadExecution: vi.fn(),
    store: { listProjects: () => [project], getConfig: () => config } as any,
    logger: vi.fn(), inbox: { append: vi.fn(async () => undefined) } as any
  };
  const manager = new SchedulerManager(); manager.setDeps(deps); managers.push(manager);
  const input = { name: 'Release squad', projectId: project.id, scope: { projectId: project.id }, profile: 'claude' as const, every: '5m', enabled: false, kind: 'team' as const, teamId: 'release' };
  return { manager, deps, states, input };
}

const runs = (manager: SchedulerManager, id: string): ScheduleRun[] => manager.get(id).status.runs;
const observe = (manager: SchedulerManager) => (manager as any).serial(() => (manager as any).observeSquadExecutions());

beforeEach(() => {
  vi.clearAllMocks(); fs.existsSync.mockReturnValue(true);
  fs.watch.mockImplementation(() => ({ close: vi.fn(), on: vi.fn() }));
});
afterEach(() => { for (const manager of managers.splice(0)) { manager.stopWatching(); manager.stopAll(); } vi.useRealTimers(); });

describe('scheduled Squads and self-healing', () => {
  it('stamps run metadata on the Squad reservation and running record', async () => {
    const { manager, input } = fixture();
    const task = await manager.create(input);
    await manager.runNow(task.id);
    expect(runs(manager, task.id)[0]).toMatchObject({ launchKind: 'team', launchState: 'running', trigger: 'manual', attempt: 1 });
  });

  it('records a failed Squad as an open "squad-failed" problem and notifies loudly', async () => {
    const { manager, deps, states, input } = fixture();
    const task = await manager.create({ ...input, inboxLevel: 'quiet' });
    await manager.runNow(task.id);
    states.set('execution-1', 'FAILED');
    await observe(manager);
    const final = runs(manager, task.id)[0];
    expect(final).toMatchObject({ result: 'error', reasonCode: 'squad-failed' });
    expect(isOpenProblem(final, Date.now())).toBe(true);
    expect(deps.inbox.append).toHaveBeenCalledWith(expect.objectContaining({ notify: 'loud' }));
  });

  it('records a stopped Squad as "squad-stopped": not a problem, but notified loudly as #328 does', async () => {
    const { manager, deps, states, input } = fixture();
    const task = await manager.create({ ...input, inboxLevel: 'quiet' });
    await manager.runNow(task.id);
    states.set('execution-1', 'STOPPED');
    await observe(manager);
    const final = runs(manager, task.id)[0];
    expect(final).toMatchObject({ result: 'error', reasonCode: 'squad-stopped' });
    expect(isOpenProblem(final, Date.now())).toBe(false);
    // Notification behaviour is unchanged from #328: any error is loud.
    expect(deps.inbox.append).toHaveBeenCalledWith(expect.objectContaining({ notify: 'loud' }));
  });

  it('closes earlier open problems when a later Squad run completes', async () => {
    const { manager, states, input } = fixture();
    const task = await manager.create(input);
    await manager.runNow(task.id);
    states.set('execution-1', 'FAILED');
    await observe(manager);
    await manager.runNow(task.id);
    states.set('execution-2', 'COMPLETED');
    await observe(manager);
    const [done, failed] = runs(manager, task.id);
    expect(done).toMatchObject({ result: 'success', executionId: 'execution-2' });
    expect(failed).toMatchObject({ reasonCode: 'squad-failed', resolvedBy: done.id });
    expect(isOpenProblem(failed, Date.now())).toBe(false);
  });

  it('records an overlap reason when a timer fires while its Squad run is live', async () => {
    const { manager, input } = fixture();
    const task = await manager.create(input);
    await manager.runNow(task.id);
    const before = manager.get(task.id).status.lastRunSessionId;
    const due = Date.now() - 60_000;
    (manager as any).live.get(task.id).targetAt = due;
    await (manager as any).fire(task.id, { manual: false });
    const skip = runs(manager, task.id)[0];
    expect(skip).toMatchObject({ result: 'skipped', reasonCode: 'overlap', message: 'previous squad run still active' });
    expect(skip.sessionId).toBeUndefined();
    expect(skip.slotAt).toBe(new Date(due).toISOString());
    expect(manager.get(task.id).status.lastRunSessionId).toBe(before);
  });

  it('marks a recovered failed Squad launch as "squad-failed"', async () => {
    const { manager, deps, input } = fixture();
    const task = await manager.create(input);
    const live = (manager as any).live.get(task.id);
    live.task.status.runs = [{ id: 'r1', at: new Date().toISOString(), result: 'skipped', launchKind: 'team', launchState: 'pending', launchRequestId: `schedule:${task.id}:r1` }];
    deps.findSquadExecution.mockResolvedValue({ executionId: 'execution-x', state: 'FAILED' });
    await manager.runNow(task.id);
    expect(runs(manager, task.id).find(run => run.id === 'r1')).toMatchObject({ result: 'error', reasonCode: 'squad-failed', executionId: 'execution-x' });
  });

  it('keeps a queued Squad waiting while a run holds the limit, then drains it when that run finishes', async () => {
    vi.useFakeTimers();
    const { manager, deps, states, input } = fixture({ scheduledRunConcurrency: 1 });
    const first = await manager.create({ ...input, name: 'First' });
    // Enabled: a timer fire (and so a queued entry) only exists for an enabled schedule.
    const second = await manager.create({ ...input, name: 'Second', teamId: 'other', enabled: true });
    await manager.runNow(first.id);
    await (manager as any).serial(() => (manager as any).fire(second.id, { manual: false }));
    expect(deps.launchSquad).toHaveBeenCalledTimes(1);
    expect(manager.get(second.id).status.queuedAt).toEqual(expect.any(String));

    states.set('execution-1', 'COMPLETED');
    await vi.advanceTimersByTimeAsync(5_100);
    expect(deps.launchSquad).toHaveBeenCalledTimes(2);
    expect(manager.get(second.id).status.queuedAt).toBeUndefined();
  });

  it('does not drain a queued entry for a schedule whose own Squad run is still live', async () => {
    const { manager, deps, input } = fixture({ scheduledRunConcurrency: 5 });
    const task = await manager.create(input);
    await manager.runNow(task.id);
    const live = (manager as any).live.get(task.id);
    expect((manager as any).isEligible({ taskId: task.id, trigger: 'retry', enqueuedAt: Date.now() })).toBe(false);
    live.task.status.runs[0].finishedAt = new Date().toISOString();
    expect((manager as any).isEligible({ taskId: task.id, trigger: 'retry', enqueuedAt: Date.now() })).toBe(true);
    expect(deps.launchSquad).toHaveBeenCalledTimes(1);
  });
});
