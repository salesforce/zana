import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ScheduledTask, Project } from '@zana-ai/zcc-domain/product';
import { ScheduleConflictError, SchedulerManager } from './scheduler.js';
import { LaunchSpawnError } from '../launch/coordinator.js';
import { validateScheduleFile } from './schedule-validation.js';

const fs = vi.hoisted(() => ({ watch: vi.fn(), existsSync: vi.fn(() => true), mkdirSync: vi.fn() }));
vi.mock('node:fs', () => fs);
vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn((task) => structuredClone(task)), saveSchedule: vi.fn(), deleteSchedule: vi.fn(() => true), listAllSchedules: vi.fn(() => []),
  globalDir: () => '/global/schedules', projectDir: (project: Project) => `${project.path}/.zcc/schedules`
}));
const project: Project = { id: 'p1', name: 'Original owner', path: '/owner/project', createdAt: 0, lastActiveAt: 0 };
const managers: SchedulerManager[] = [];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture() {
  const records = new Map<string, ScheduledTask>();
  const persistence = {
    read: undefined as undefined | ReturnType<typeof vi.fn>,
    load: vi.fn(async () => structuredClone([...records.values()])),
    save: vi.fn(async (value: ScheduledTask) => { records.set(value.id, structuredClone(value)); }),
    remove: vi.fn(async (value: ScheduledTask) => { records.delete(value.id); }),
    localProjects: vi.fn(() => [] as Project[])
  };
  const sessions: any[] = [];
  const ptys = Object.assign(new EventEmitter(), {
    list: vi.fn((id: string) => sessions.filter(session => session.projectId === id)),
    reapDeadSessions: vi.fn(), closeExpected: vi.fn()
  });
  const deps = {
    persistence,
    ptys: ptys as any,
    launchTerminal: vi.fn(async (opts: any) => {
      const session = { id: opts.preallocatedSessionId, projectId: opts.projectId, status: 'running', profile: opts.profile, cwd: opts.cwd };
      sessions.push(session); return session as any;
    }),
    store: { listProjects: () => [project], getConfig: () => ({}) } as any,
    logger: vi.fn(), inbox: { append: vi.fn(async () => undefined) } as any
  };
  const manager = new SchedulerManager(); manager.setDeps(deps); managers.push(manager);
  const input = { name: 'Scheduled work', projectId: project.id, scope: { projectId: project.id }, profile: 'claude' as const, every: '5m', enabled: false };
  return { manager, records, persistence, deps, sessions, ptys, input };
}
beforeEach(() => {
  vi.clearAllMocks(); fs.existsSync.mockReturnValue(true);
  fs.watch.mockImplementation(() => ({ close: vi.fn(), on: vi.fn() }));
});
afterEach(() => { for (const manager of managers.splice(0)) { manager.stopWatching(); manager.stopAll(); } vi.useRealTimers(); });

describe('original-owner scheduler persistence', () => {
  it.each(['not-started', 'exited'] as const)('resolves a missing worker with durable %s evidence without enabling or launching', async evidence => {
    const { manager, deps, input, persistence } = fixture();
    const inspect = vi.fn(async () => evidence); manager.setDeps({ ...deps, inspectWorkerLaunch: inspect });
    const task = await manager.create(input);
    deps.launchTerminal.mockRejectedValue(new LaunchSpawnError('LAUNCH_UNCONFIRMED', 'lost'));
    await expect(manager.runNow(task.id)).rejects.toThrow('lost');
    const sessionId = manager.list()[0].status.runs[0].sessionId;
    persistence.save.mockRejectedValueOnce(new Error('offline'));
    await expect(manager.reconcile(task.id)).rejects.toThrow('offline');
    expect(manager.list()[0].status.runs[0].launchState).toBe('pending');
    expect(await manager.reconcile(task.id)).toBe(true);
    expect(inspect).toHaveBeenCalledWith(project.id, sessionId, { kind: 'schedule', id: `schedule:${task.id}` });
    expect(manager.list()[0]).toMatchObject({ enabled: false, status: { runs: [expect.objectContaining({ sessionId, launchState: 'failed', result: evidence === 'exited' ? 'error' : 'skipped' })] } });
    expect(await manager.reconcile(task.id)).toBe(true); expect(deps.launchTerminal).toHaveBeenCalledOnce();
  });
  it('checks the reserved worker without enabling a timer or starting replacement work', async () => {
    const { manager, input, deps, sessions, persistence } = fixture();
    const task = await manager.create(input);
    expect(await manager.reconcile(task.id)).toBe(true);
    deps.launchTerminal.mockRejectedValue(new LaunchSpawnError('LAUNCH_UNCONFIRMED', 'ready reply lost'));
    await expect(manager.runNow(task.id)).rejects.toThrow('ready reply lost');
    const reserved = manager.list()[0].status.runs[0].sessionId;
    expect(await manager.reconcile(task.id)).toBe(false);
    sessions.push({ id: reserved, projectId: 'other', profile: 'claude', status: 'running' });
    expect(await manager.reconcile(task.id)).toBe(false); sessions[0].projectId = project.id;
    persistence.save.mockRejectedValueOnce(new Error('owner offline'));
    await expect(manager.reconcile(task.id)).rejects.toThrow('owner offline');
    expect(manager.list()[0].status.runs[0].launchState).toBe('pending');
    expect(await manager.reconcile(task.id)).toBe(true);
    expect(manager.list()[0]).toMatchObject({ enabled: false, status: { runCount: 1 } });
    expect(await manager.reconcile(task.id)).toBe(true);
    expect(deps.launchTerminal).toHaveBeenCalledOnce();
    await expect(manager.reconcile('missing')).rejects.toThrow('not found');
  });
  it('does not publish a new task before its owner acknowledges the write', async () => {
    const { manager, persistence, input } = fixture(); const saving = deferred<void>();
    persistence.save.mockReturnValue(saving.promise); const changed = vi.fn(); manager.on('changed', changed);
    const creating = manager.create(input); await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledOnce());
    expect(manager.list()).toEqual([]); expect(changed).not.toHaveBeenCalled();
    saving.resolve(); const task = await creating;
    expect(manager.list()).toEqual([task]); expect(changed).toHaveBeenCalledOnce();
  });
  it('serializes edits and retains the last acknowledged snapshot after a failed write or delete', async () => {
    const { manager, persistence, input, records } = fixture(); const task = await manager.create(input);
    await Promise.all([manager.update(task.id, { name: 'New name' }), manager.update(task.id, { prompt: 'New prompt' })]);
    expect(records.get(task.id)).toMatchObject({ name: 'New name', prompt: 'New prompt' });
    const before = structuredClone(manager.list()); persistence.save.mockRejectedValue(new Error('revision conflict'));
    await expect(manager.update(task.id, { enabled: true })).rejects.toThrow('conflict'); expect(manager.list()).toEqual(before);
    persistence.remove.mockRejectedValue(new Error('owner offline'));
    await expect(manager.remove(task.id)).rejects.toThrow('offline'); expect(manager.list()).toEqual(before);
    persistence.remove.mockResolvedValue(); await manager.remove(task.id); expect(manager.list()).toEqual([]);
  });
  it('reserves a disabled record and stable worker identity before launch', async () => {
    const { manager, input, records, deps } = fixture(); const task = await manager.create({ ...input, enabled: true });
    const launch = deps.launchTerminal.getMockImplementation()!;
    deps.launchTerminal.mockImplementation(async opts => {
      expect(records.get(task.id)).toMatchObject({ enabled: false, status: { runs: [expect.objectContaining({ launchState: 'pending', sessionId: opts.preallocatedSessionId })] } });
      return launch(opts);
    });
    await manager.runNow(task.id);
    expect(records.get(task.id)).toMatchObject({ enabled: true, status: { runCount: 1, runs: [expect.objectContaining({ launchState: 'running' })] } });
  });
  it('never launches when the reservation cannot be persisted', async () => {
    const { manager, input, persistence, deps } = fixture(); const task = await manager.create(input);
    persistence.save.mockRejectedValue(new Error('offline'));
    await expect(manager.runNow(task.id)).rejects.toThrow('offline'); expect(deps.launchTerminal).not.toHaveBeenCalled();
    expect(manager.list()[0].status.runCount).toBe(0);
  });
  it('reserves and launches a team schedule through durable squad deps, never a PTY', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, launchSquad });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad', prompt: 'Ship release' });
    await manager.runNow(task.id);
    expect(launchSquad).toHaveBeenCalledWith(expect.objectContaining({ schedule: expect.objectContaining({ kind: 'team', teamId: 'release-squad' }) }));
    expect(deps.launchTerminal).not.toHaveBeenCalled();
    expect(manager.list()[0].status.runs[0]).toMatchObject({ executionId: 'execution-1', launchState: 'running' });
  });
  it('passes provided plan source to the scheduled Squad trigger', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, launchSquad });
    const task = await manager.create({
      ...input,
      kind: 'team',
      teamId: 'release-squad',
      planSource: 'provided',
      prompt: '### supplied plan'
    });

    await manager.runNow(task.id);

    expect(launchSquad).toHaveBeenCalledWith(expect.objectContaining({
      schedule: expect.objectContaining({ planSource: 'provided' })
    }));
  });
  it('falls back to description when an edited Squad prompt is blank', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, launchSquad });
    const task = await manager.create({
      ...input,
      kind: 'team',
      teamId: 'release-squad',
      description: '  Check release readiness  ',
      prompt: 'Initial objective'
    });

    await manager.update(task.id, { prompt: '   ' });
    await manager.runNow(task.id);

    expect(launchSquad).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Check release readiness'
    }));
  });
  it('uses the first nonblank trimmed Squad objective candidate', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, launchSquad });
    const task = await manager.create({
      ...input,
      kind: 'team',
      teamId: 'release-squad',
      name: '  Release fallback  ',
      description: '  Description fallback  ',
      prompt: '  Initial objective  '
    });

    await manager.runNow(task.id);
    expect(launchSquad).toHaveBeenLastCalledWith(expect.objectContaining({
      objective: 'Initial objective'
    }));

    await manager.update(task.id, { prompt: ' ' });
    await manager.runNow(task.id);
    expect(launchSquad).toHaveBeenLastCalledWith(expect.objectContaining({
      objective: 'Description fallback'
    }));

    await manager.update(task.id, { description: ' ' });
    await manager.runNow(task.id);
    expect(launchSquad).toHaveBeenLastCalledWith(expect.objectContaining({
      objective: 'Release fallback'
    }));
  });
  it('does not overlap live squad executions across ticks', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    const getSquadExecution = vi.fn(async () => ({ state: 'RUNNING' }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad' });

    await manager.runNow(task.id);
    await (manager as any).fire(task.id, { manual: false });

    expect(launchSquad).toHaveBeenCalledOnce();
    expect(getSquadExecution).toHaveBeenCalledWith(project.id, 'execution-1');
    expect(manager.get(task.id).status.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ executionId: 'execution-1', launchState: 'running' }),
      expect.objectContaining({ result: 'skipped', message: 'previous squad run still active' })
    ]));
  });
  it('rejects a Squad-to-Agent mode change while its active execution is unresolved', async () => {
    const { manager, input, deps, records } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution: vi.fn(async () => ({ state: 'RUNNING' })) });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad' });

    await manager.runNow(task.id);

    await expect(manager.update(task.id, { kind: 'agent' })).rejects.toThrow('Cannot change schedule mode');
    expect(manager.get(task.id)).toMatchObject({ kind: 'team', teamId: 'release-squad', status: {
      runs: [expect.objectContaining({ executionId: 'execution-1', launchState: 'running' })]
    } });
    expect(records.get(task.id)).toMatchObject({ kind: 'team', teamId: 'release-squad' });
  });
  it('defers an external Squad-to-Agent edit until the recorded Squad run resolves', async () => {
    const { manager, input, deps, records } = fixture();
    let state = 'RUNNING';
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    const getSquadExecution = vi.fn(async () => ({ state }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad' });

    await manager.runNow(task.id);
    Object.assign(records.get(task.id)!, { kind: 'agent', teamId: undefined, planSource: undefined });
    await manager.loadAll([project]);

    expect(manager.get(task.id)).toMatchObject({ kind: 'team', status: { runs: [expect.objectContaining({ launchKind: 'team', executionId: 'execution-1' })] } });
    expect(await manager.reload(task.id)).toMatchObject({ reloaded: false, reason: 'run is unresolved' });

    state = 'COMPLETED';
    await (manager as any).observeSquadExecutions();
    // Completion persistence owns status, so repeat editor's intended definition
    // after it races the terminal lifecycle write.
    Object.assign(records.get(task.id)!, { kind: 'agent', teamId: undefined, planSource: undefined });
    await manager.loadAll([project]);
    expect(manager.get(task.id).kind).toBe('agent');
    await manager.runNow(task.id);
    expect(deps.launchTerminal).toHaveBeenCalledOnce();
  });
  it('retains an active squad run beyond retain=1 so repeated ticks keep skipping it', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    const getSquadExecution = vi.fn(async () => ({ state: 'RUNNING' }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad', retain: 1 });

    await manager.runNow(task.id);
    await (manager as any).fire(task.id, { manual: false });
    await (manager as any).fire(task.id, { manual: false });

    expect(launchSquad).toHaveBeenCalledOnce();
    expect(manager.get(task.id).status.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ executionId: 'execution-1', launchState: 'running' })
    ]));
    expect(manager.get(task.id).status.runs.filter(run => run.result === 'skipped')).toHaveLength(1);
  });
  it('counts live squad executions toward global concurrency before dispatch', async () => {
    const { manager, input, deps } = fixture();
    let sequence = 0;
    const launchSquad = vi.fn(async () => ({ executionId: `execution-${++sequence}` }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution: vi.fn(async () => ({ state: 'RUNNING' })) });
    const tasks = await Promise.all(Array.from({ length: 6 }, (_, index) => manager.create({
      ...input, name: `squad-${index}`, kind: 'team', teamId: `team-${index}`
    })));

    for (const task of tasks.slice(0, 5)) await manager.runNow(task.id);
    await (manager as any).fire(tasks[5].id, { manual: false });

    expect(launchSquad).toHaveBeenCalledTimes(5);
    expect(manager.get(tasks[5].id).status.runs[0]).toMatchObject({
      result: 'skipped',
      message: 'concurrency-cap: 5/5 scheduled runs active'
    });
  });
  it('finalizes terminal squad execution before next dispatch and notifies', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn()
      .mockResolvedValueOnce({ executionId: 'execution-1' })
      .mockResolvedValueOnce({ executionId: 'execution-2' });
    const getSquadExecution = vi.fn(async (_projectId: string, executionId: string) => ({
      state: executionId === 'execution-1' ? 'COMPLETED' : 'RUNNING',
      finalSummary: executionId === 'execution-1' ? 'release shipped' : undefined
    }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad', inboxLevel: 'quiet' });

    await manager.runNow(task.id);
    await (manager as any).fire(task.id, { manual: false });

    const finished = manager.get(task.id).status.runs.find(run => run.executionId === 'execution-1');
    expect(finished).toMatchObject({ result: 'success', launchState: 'running', message: 'release shipped' });
    expect(finished?.finishedAt).toEqual(expect.any(String));
    expect(finished?.durationMs).toEqual(expect.any(Number));
    expect(launchSquad).toHaveBeenCalledTimes(2);
    expect(deps.inbox.append).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Scheduled work',
      comments: expect.stringContaining('success'),
      notify: 'quiet'
    }));
  });
  it('finalizes a disabled Squad Run now without waiting for a cadence tick', async () => {
    vi.useFakeTimers();
    try {
      const { manager, input, deps } = fixture();
      let completed = false;
      const getSquadExecution = vi.fn(async () => ({
        state: completed ? 'COMPLETED' : 'RUNNING',
        finalSummary: completed ? 'release shipped' : undefined
      }));
      manager.setDeps({
        ...deps,
        launchSquad: vi.fn(async () => ({ executionId: 'execution-1' })),
        getSquadExecution
      });
      const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad', inboxLevel: 'quiet' });

      await manager.runNow(task.id);
      expect(manager.get(task.id).enabled).toBe(false);
      completed = true;
      await vi.advanceTimersByTimeAsync(5_000);

      const finished = manager.get(task.id).status.runs.find(run => run.executionId === 'execution-1');
      expect(finished).toMatchObject({ result: 'success', launchState: 'running', message: 'release shipped' });
      expect(finished?.finishedAt).toEqual(expect.any(String));
      expect(deps.inbox.append).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'Scheduled work',
        comments: expect.stringContaining('success')
      }));

      getSquadExecution.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getSquadExecution).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('restores the disabled Squad completion observer after restart', async () => {
    vi.useFakeTimers();
    try {
      const { manager, input, deps } = fixture();
      let completed = false;
      const getSquadExecution = vi.fn(async () => ({
        state: completed ? 'COMPLETED' : 'RUNNING',
        finalSummary: completed ? 'release shipped after restart' : undefined
      }));
      manager.setDeps({
        ...deps,
        launchSquad: vi.fn(async () => ({ executionId: 'execution-1' })),
        getSquadExecution
      });
      const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad', inboxLevel: 'quiet' });

      await manager.runNow(task.id);
      manager.stopAll();
      await manager.loadAll([project]);
      expect(manager.get(task.id)).toMatchObject({ enabled: false, status: {
        runs: [expect.objectContaining({ executionId: 'execution-1', launchState: 'running' })]
      } });

      completed = true;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(getSquadExecution).toHaveBeenCalledOnce();
      expect(manager.get(task.id).status.runs[0]).toMatchObject({
        executionId: 'execution-1', result: 'success', finishedAt: expect.any(String), message: 'release shipped after restart'
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('retains an active Squad run after terminal history truncation across restart and skips overlap', async () => {
    const { manager, input, deps, records } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-2' }));
    const getSquadExecution = vi.fn(async () => ({ state: 'RUNNING' }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad' });
    const terminalRuns = Array.from({ length: 101 }, (_, index) => ({
      id: `terminal-${index}`, at: '2026-01-01T00:00:00.000Z', result: 'success' as const
    }));
    const persisted = validateScheduleFile({
      ...task,
      status: {
        ...task.status,
        runs: [...terminalRuns, {
          id: 'active-squad', at: '2026-01-02T00:00:00.000Z', result: 'success',
          launchKind: 'team', launchState: 'running', executionId: 'execution-1'
        }]
      }
    });
    if ('error' in persisted) throw new Error(persisted.error);
    records.set(task.id, persisted);

    manager.stopAll();
    await manager.loadAll([project]);
    await (manager as any).fire(task.id, { manual: false });

    expect(manager.get(task.id).status.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ executionId: 'execution-1', launchState: 'running' })
    ]));
    expect(launchSquad).not.toHaveBeenCalled();
    expect(getSquadExecution).toHaveBeenCalledWith(project.id, 'execution-1');
  });
  it('cleans the Squad completion observer when its schedule is removed', async () => {
    vi.useFakeTimers();
    try {
      const { manager, input, deps } = fixture();
      const getSquadExecution = vi.fn(async () => ({ state: 'RUNNING' }));
      manager.setDeps({
        ...deps,
        launchSquad: vi.fn(async () => ({ executionId: 'execution-1' })),
        getSquadExecution
      });
      const task = await manager.create({ ...input, kind: 'team', teamId: 'release-squad' });

      await manager.runNow(task.id);
      await manager.remove(task.id);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(getSquadExecution).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('rearms an automatic fire after transient squad observation persistence failure', async () => {
    vi.useFakeTimers();
    try {
      const { manager, input, deps, persistence } = fixture();
      const launchSquad = vi.fn()
        .mockResolvedValueOnce({ executionId: 'execution-1' })
        .mockResolvedValueOnce({ executionId: 'execution-2' });
      manager.setDeps({
        ...deps,
        launchSquad,
        getSquadExecution: vi.fn(async () => ({ state: 'COMPLETED' }))
      });
      const task = await manager.create({ ...input, enabled: true, kind: 'team', teamId: 'release-squad' });

      await manager.runNow(task.id);
      persistence.save.mockRejectedValueOnce(new Error('owner temporarily offline'));

      // One run's failed finalization is logged, never rethrown: the tick still
      // completes (here: skips the still-live run) and re-arms its cadence.
      await expect((manager as any).fire(task.id, { manual: false })).resolves.toBeUndefined();
      expect(deps.logger).toHaveBeenCalledWith(expect.stringContaining(task.id), expect.objectContaining({ message: 'owner temporarily offline' }));
      expect(manager.get(task.id).status.runs[0]).toMatchObject({ result: 'skipped', message: 'previous squad run still active' });
      // Cadence retry plus independent Squad completion observer remain armed.
      expect(vi.getTimerCount()).toBe(2);

      // The failed observation must not strand this schedule: its next tick can
      // observe the completed execution and dispatch a replacement.
      await (manager as any).fire(task.id, { manual: false });
      expect(launchSquad).toHaveBeenCalledTimes(2);
      expect(manager.get(task.id).enabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps an ambiguous launch disabled and cannot replay it after restart', async () => {
    const { manager, input, records, persistence, deps } = fixture(); const task = await manager.create(input);
    deps.launchTerminal.mockRejectedValue(new LaunchSpawnError('LAUNCH_UNCONFIRMED', 'ready response lost'));
    await expect(manager.runNow(task.id)).rejects.toThrow('ready response lost');
    expect(records.get(task.id)).toMatchObject({ enabled: false, status: { runs: [expect.objectContaining({ launchState: 'pending' })] } });
    manager.stopAll(); await manager.loadAll([project]);
    await expect(manager.runNow(task.id)).rejects.toThrow('Unconfirmed');
    await expect(manager.setEnabled(task.id, true)).rejects.toThrow('Unconfirmed');
    expect(deps.launchTerminal).toHaveBeenCalledOnce(); expect(persistence.save).toHaveBeenCalledTimes(2);
  });
  it('recovers a known worker after a lost persistence acknowledgement without launching twice', async () => {
    const { manager, input, records, persistence, deps, sessions } = fixture(); const task = await manager.create(input);
    persistence.save.mockImplementation(async record => {
      if (record.status.runs[0]?.launchState === 'running') throw new Error('ack lost');
      records.set(record.id, structuredClone(record));
    });
    await expect(manager.runNow(task.id)).rejects.toThrow('ack lost');
    const reserved = records.get(task.id)!.status.runs[0].sessionId;
    expect(reserved).toBe(sessions[0].id);
    persistence.save.mockImplementation(async record => { records.set(record.id, structuredClone(record)); });
    await manager.runNow(task.id); expect(deps.launchTerminal).toHaveBeenCalledOnce();
    expect(manager.list()[0]).toMatchObject({ enabled: false, status: { runCount: 1, runs: [expect.objectContaining({ launchState: 'running' })] } });
  });
  it('does not recover a reserved session belonging to another project', async () => {
    const { manager, input, records, deps, sessions } = fixture(); const task = await manager.create(input);
    const pending = structuredClone(task); pending.status.runs = [{ at: new Date().toISOString(), result: 'skipped', sessionId: 'other', launchState: 'pending' }];
    records.set(task.id, pending); sessions.push({ id: 'other', projectId: 'another', status: 'running' });
    await manager.loadAll([project]); await expect(manager.runNow(task.id)).rejects.toThrow('Unconfirmed'); expect(deps.launchTerminal).not.toHaveBeenCalled();
  });
  it('restores completion listeners for a surviving worker after reload without resetting its deadline', async () => {
    vi.useFakeTimers(); const { manager, input, sessions, ptys, deps } = fixture();
    const task = await manager.create({ ...input, profile: 'cursor', maxDurationMinutes: 1 }); await manager.runNow(task.id);
    await vi.advanceTimersByTimeAsync(30_000); manager.stopAll(); await manager.loadAll([project]);
    expect(ptys.listenerCount('exit')).toBe(1); expect(deps.launchTerminal).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000); expect(ptys.closeExpected).toHaveBeenCalledWith(sessions[0].id);
    sessions[0].status = 'exited'; ptys.emit('exit', sessions[0].id, 0); await manager.attachReport('absent', 'drain');
    expect(manager.list()[0].status).toMatchObject({ runCount: 1, runs: [expect.objectContaining({ result: 'error', durationMs: 60_000 })] });
  });
  it('restores pending worker ownership from inventory and continues recording its completion', async () => {
    const { manager, input, persistence, records, sessions, ptys, deps } = fixture(); const task = await manager.create(input);
    persistence.save.mockImplementation(async record => {
      if (record.status.runs[0]?.launchState === 'running') throw new Error('lost ack');
      records.set(record.id, structuredClone(record));
    });
    await expect(manager.runNow(task.id)).rejects.toThrow('lost ack'); manager.stopAll();
    persistence.save.mockImplementation(async record => { records.set(record.id, structuredClone(record)); });
    await manager.loadAll([project]); expect(deps.launchTerminal).toHaveBeenCalledOnce(); expect(manager.list()[0].enabled).toBe(false);
    await manager.attachReport(sessions[0].id, 'Recovered run complete', 'success');
    sessions[0].status = 'exited'; ptys.emit('exit', sessions[0].id, 0); await manager.attachReport('absent', 'drain');
    expect(manager.list()[0].status).toMatchObject({ runCount: 1, runs: [expect.objectContaining({ result: 'success', report: 'Recovered run complete', durationMs: expect.any(Number) })] });
  });
  it('records proven pre-spawn failures without losing cadence or incrementing twice', async () => {
    const { manager, input, deps } = fixture(); const task = await manager.create({ ...input, enabled: true });
    deps.launchTerminal.mockRejectedValue(new LaunchSpawnError('HOST_UNSUPPORTED', 'secondary machines'));
    await manager.runNow(task.id);
    expect(manager.list()[0]).toMatchObject({ enabled: true, status: { runCount: 1, runs: [expect.objectContaining({ launchState: 'failed', result: 'error' })] } });
  });
  it('preserves completed reports and Stop state across serialized callbacks', async () => {
    const { manager, input, sessions, ptys } = fixture(); const task = await manager.create(input); await manager.runNow(task.id);
    const id = sessions[0].id;
    await Promise.all([manager.attachReport(id, 'Finished work', 'success'), manager.onAgentFinished(id)]);
    expect(ptys.closeExpected).toHaveBeenCalledWith(id);
    sessions[0].status = 'exited'; ptys.emit('exit', id, 0); await manager.attachReport('absent', 'drain');
    expect(manager.list()[0].status.runs[0]).toMatchObject({ result: 'success', report: 'Finished work', finishedAt: expect.any(String), durationMs: expect.any(Number) });
  });
  it('never closes a worker or publishes a report when the owner rejects the update', async () => {
    const { manager, input, sessions, persistence, ptys } = fixture(); const task = await manager.create(input); await manager.runNow(task.id);
    const before = structuredClone(manager.list()); persistence.save.mockRejectedValue(new Error('conflict'));
    await expect(manager.attachReport(sessions[0].id, 'lost')).rejects.toThrow('conflict');
    await expect(manager.onAgentFinished(sessions[0].id)).rejects.toThrow('conflict');
    expect(manager.list()).toEqual(before); expect(ptys.closeExpected).not.toHaveBeenCalled();
  });
  it('captures a worker which exits before the launch acknowledgement', async () => {
    const { manager, input, deps, sessions, ptys } = fixture(); const task = await manager.create({ ...input, inboxLevel: 'silent' });
    deps.launchTerminal.mockImplementation(async opts => {
      const session = { id: opts.preallocatedSessionId, projectId: opts.projectId, status: 'exited', exitCode: 0 }; sessions.push(session); return session as any;
    });
    await manager.runNow(task.id); await manager.attachReport('absent', 'drain');
    expect(manager.list()[0].status.runs[0]).toMatchObject({ result: 'success', durationMs: expect.any(Number) });
    expect(ptys.listenerCount('exit')).toBe(0);
  });
  it('bounds outstanding mutations and cancels queued work on teardown', async () => {
    const { manager, input, persistence } = fixture(); const blocked = deferred<void>(); persistence.save.mockReturnValue(blocked.promise);
    const operations = Array.from({ length: 100 }, () => manager.create(input).catch(error => error));
    await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledOnce());
    await expect(manager.create(input)).rejects.toThrow('Too many'); manager.stopAll(); blocked.resolve();
    const results = await Promise.all(operations); expect(results.every(result => result instanceof Error)).toBe(true); expect(manager.list()).toEqual([]);
  });
  it('preserves live state on failed load and ignores a late response after teardown', async () => {
    const { manager, input, persistence } = fixture(); await manager.create(input);
    persistence.load.mockRejectedValueOnce(new Error('offline')); await expect(manager.loadAll([project])).rejects.toThrow('offline'); expect(manager.list()).toHaveLength(1);
    const blocked = deferred<ScheduledTask[]>(); persistence.load.mockReturnValue(blocked.promise);
    const loading = manager.loadAll([project]); await vi.waitFor(() => expect(persistence.load).toHaveBeenCalledTimes(2));
    manager.stopAll(); blocked.resolve([]); await expect(loading).rejects.toThrow('stopped'); expect(manager.list()).toEqual([]);
  });
  it('releases session listeners and watchdogs when records are removed or the manager stops', async () => {
    vi.useFakeTimers(); const { manager, input, ptys } = fixture();
    const task = await manager.create({ ...input, profile: 'cursor', maxDurationMinutes: 1 }); await manager.runNow(task.id);
    expect(ptys.listenerCount('exit')).toBe(1); expect(vi.getTimerCount()).toBe(2);
    await manager.remove(task.id); expect(ptys.listenerCount('exit')).toBe(0); expect(vi.getTimerCount()).toBe(0);
    const next = await manager.create({ ...input, profile: 'cursor' }); await manager.runNow(next.id); manager.stopAll();
    expect(ptys.listenerCount('exit')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects metadata owner moves, handles unknown IDs, and drops a removed project without deleting its records', async () => {
    const { manager, input, records } = fixture(); const task = await manager.create(input);
    await expect(manager.update(task.id, { projectId: 'different' })).rejects.toThrow('metadata owner');
    await expect(manager.update('absent', {})).rejects.toThrow('not found'); await expect(manager.runNow('absent')).rejects.toThrow('not found');
    expect(await manager.setEnabled('absent', false)).toBeNull(); await manager.remove('absent');
    await manager.onProjectRemoved(project.id); expect(manager.list()).toEqual([]); expect(records.has(task.id)).toBe(true);
  });
  it('refreshes foreign records periodically while preserving a live worker and cleans up the poll', async () => {
    vi.useFakeTimers(); const { manager, input, persistence, sessions } = fixture(); manager.startWatching();
    const task = await manager.create(input); await vi.advanceTimersByTimeAsync(15_000); expect(persistence.load).toHaveBeenCalledOnce();
    await manager.runNow(task.id); await vi.advanceTimersByTimeAsync(15_000); expect(persistence.load).toHaveBeenCalledTimes(2);
    sessions[0].status = 'exited'; persistence.load.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(15_000); expect(persistence.load).toHaveBeenCalledTimes(3);
    manager.stopWatching(); manager.stopAll(); expect(vi.getTimerCount()).toBe(0);
  });
  it('watches only local directories and handles external changes and watcher failures', async () => {
    vi.useFakeTimers(); const { manager, persistence, deps } = fixture(); persistence.localProjects.mockReturnValue([project]);
    const callbacks: (() => void)[] = [], watchers: any[] = [];
    fs.watch.mockImplementation((_dir, _options, callback) => { callbacks.push(callback); const watcher = { close: vi.fn(), on: vi.fn() }; watchers.push(watcher); return watcher; });
    manager.startWatching(); expect(fs.watch.mock.calls.map(call => call[0])).toEqual(['/global/schedules', '/owner/project/.zcc/schedules']);
    callbacks[0](); await vi.advanceTimersByTimeAsync(250); expect(persistence.load).toHaveBeenCalledOnce();
    const watcher = watchers[1]; watcher.on.mock.calls[0][1](new Error('watch failed')); expect(watcher.close).toHaveBeenCalledOnce(); expect(deps.logger).toHaveBeenCalled();
    manager.rebindWatchers(); expect(watchers[0].close).toHaveBeenCalledOnce(); callbacks.at(-1)!(); manager.stopWatching();
    await vi.advanceTimersByTimeAsync(60_000); expect(persistence.load).toHaveBeenCalledOnce();
  });
  it('only creates the global watch directory and tolerates unavailable filesystem watchers', () => {
    const { manager, persistence } = fixture(); persistence.localProjects.mockReturnValue([project]); fs.existsSync.mockReturnValue(false);
    fs.watch.mockImplementation(() => { throw new Error('unsupported'); }); manager.startWatching();
    expect(fs.mkdirSync).toHaveBeenCalledWith('/global/schedules', { recursive: true }); expect(fs.watch).toHaveBeenCalledOnce();
  });
  it('updates cadence and presentation fields atomically and validates invalid edits before saving', async () => {
    const { manager, input, persistence, records } = fixture();
    const task = await manager.create({ ...input, scope: 'global', description: ' desc ', group: ' jobs ' });
    await manager.update(task.id, { description: 'new', profile: 'cursor', prompt: 'work', extraArgs: ['--flag'], cron: '0 9 * * *', tz: 'Europe/Zurich', retain: 3, inboxLevel: 'loud', autoCloseOnFinish: false, maxDurationMinutes: 30, group: 'nightly', projectId: 'p2' });
    expect(records.get(task.id)).toMatchObject({ description: 'new', profile: 'cursor', prompt: 'work', extraArgs: ['--flag'], schedule: { cron: '0 9 * * *', tz: 'Europe/Zurich' }, history: { retain: 3 }, inboxLevel: 'loud', autoCloseOnFinish: false, maxDurationMinutes: 30, group: 'nightly', projectId: 'p2' });
    await manager.update(task.id, { tz: null, description: '', maxDurationMinutes: 0, group: null });
    expect(manager.list()[0].schedule).toEqual({ cron: '0 9 * * *' }); expect(manager.list()[0].group).toBeUndefined();
    await manager.update(task.id, { tz: 'UTC' });
    await manager.update(task.id, { cron: '0 12 * * *', tz: null });
    await manager.update(task.id, { every: '1h' }); expect(manager.list()[0].schedule).toEqual({ every: '1h' });
    const saves = persistence.save.mock.calls.length;
    await expect(manager.update(task.id, { cron: 'invalid' })).rejects.toThrow(); expect(persistence.save).toHaveBeenCalledTimes(saves);
    await expect(manager.create({ ...input, name: '' })).rejects.toThrow('name');
    await expect(manager.create({ ...input, projectId: '' })).rejects.toThrow('projectId');
    await manager.create({ ...input, scope: 'global', group: '', cron: '0 0 * * *', every: undefined, tz: 'UTC', retain: NaN });
  });
  it('preserves timers on failed enable and loads legacy records without duplicating live workers', async () => {
    vi.useFakeTimers(); const { manager, input, persistence, deps } = fixture();
    const task = await manager.create({ ...input, enabled: true }); manager.stopAll();
    await manager.loadAll([project]); expect(vi.getTimerCount()).toBe(1);
    await manager.runNow(task.id); const calls = persistence.load.mock.calls.length;
    await manager.loadAll([project]); expect(persistence.load).toHaveBeenCalledTimes(calls + 1); expect(deps.launchTerminal).toHaveBeenCalledOnce();
    await manager.setEnabled(task.id, false); expect(manager.list()[0].enabled).toBe(false);
  });
  it('retains a watcher event inside write suppression and reloads other schedules during a live run', async () => {
    vi.useFakeTimers(); const { manager, input, persistence, records, ptys } = fixture();
    let changed!: () => void; fs.watch.mockImplementation((_dir, _options, callback) => { changed = callback; return { close: vi.fn(), on: vi.fn() }; });
    manager.startWatching(); const active = await manager.create(input); const idle = await manager.create(input);
    await manager.runNow(active.id);
    records.get(idle.id)!.prompt = 'External edit'; changed();
    await vi.advanceTimersByTimeAsync(250); expect(persistence.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    expect(manager.get(idle.id).prompt).toBe('External edit');
    expect(ptys.listenerCount('exit')).toBe(1);
    expect(manager.get(active.id).status.runCount).toBe(1);
  });
  it('preserves disk prompt/effort without updatedAt changes on report, completion and toggles', async () => {
    const { manager, input, persistence, records, sessions, ptys } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create({ ...input, prompt: 'Old', extraArgs: ['--effort', 'max'] });
    await manager.runNow(task.id);
    Object.assign(records.get(task.id)!, { prompt: 'External', extraArgs: ['--effort', 'high'] });
    const stamp = records.get(task.id)!.updatedAt;
    await manager.attachReport(sessions[0].id, 'Done');
    expect(records.get(task.id)).toMatchObject({ prompt: 'External', extraArgs: ['--effort', 'high'], updatedAt: stamp });
    await manager.onAgentFinished(sessions[0].id);
    await manager.setEnabled(task.id, true);
    sessions[0].status = 'exited'; ptys.emit('exit', sessions[0].id, 0);
    await manager.attachReport('absent', 'drain');
    expect(manager.get(task.id)).toMatchObject({ prompt: 'External', extraArgs: ['--effort', 'high'], enabled: true, status: { runCount: 1, runs: [expect.objectContaining({ report: 'Done', finishedAt: expect.any(String) })] } });
  });
  it('patches the latest disk definition and refuses unreadable or deleted definitions', async () => {
    const { manager, input, persistence, records } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create(input);
    records.get(task.id)!.prompt = 'External';
    await manager.update(task.id, { every: '1h', extraArgs: ['--effort', 'medium'] });
    expect(records.get(task.id)).toMatchObject({ prompt: 'External', schedule: { every: '1h' } });
    persistence.read.mockRejectedValue(new Error('unreadable JSON'));
    const writes = persistence.save.mock.calls.length;
    await expect(manager.setEnabled(task.id, false)).rejects.toThrow('unreadable');
    await expect(manager.reload(task.id)).rejects.toThrow('unreadable');
    await expect(manager.runNow(task.id)).rejects.toThrow('unreadable');
    expect(persistence.save).toHaveBeenCalledTimes(writes);
  });
  it('reports a same-schedule reload deferral, retries across writes, and preserves exit listeners', async () => {
    vi.useFakeTimers(); const { manager, input, records, sessions, ptys } = fixture();
    const task = await manager.create(input); await manager.runNow(task.id);
    records.get(task.id)!.prompt = 'Reloaded';
    expect(await manager.reload(task.id)).toMatchObject({ reloaded: false, reason: expect.stringContaining(sessions[0].id), sessionIds: [sessions[0].id] });
    await vi.advanceTimersByTimeAsync(750); expect(manager.get(task.id).prompt).toBeUndefined();
    // Another schedule's persistence extends suppression across the deferred callback.
    await manager.create(input); sessions[0].status = 'exited';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.get(task.id).prompt).toBe('Reloaded'); expect(ptys.listenerCount('exit')).toBe(1);
    ptys.emit('exit', sessions[0].id, 0); await manager.attachReport('absent', 'drain');
    expect(manager.get(task.id).status.runs[0].durationMs).toBeGreaterThanOrEqual(0);
  });
  it('gets a detached live snapshot and reloads one record without a launch', async () => {
    const { manager, input, persistence, records, deps } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create(input); const copy = manager.get(task.id); copy.prompt = 'Mutated';
    expect(manager.get(task.id).prompt).toBeUndefined(); records.get(task.id)!.prompt = 'Disk';
    expect(await manager.reload(task.id)).toMatchObject({ reloaded: true, schedule: { prompt: 'Disk' } });
    expect(deps.launchTerminal).not.toHaveBeenCalled();
    expect(() => manager.get('missing')).toThrow('not found'); await expect(manager.reload('missing')).rejects.toThrow('not found');
  });
  it('refreshes the definition at fire time and reaps dead sessions before reload guards', async () => {
    const { manager, input, persistence, records, deps, sessions, ptys } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create(input); Object.assign(records.get(task.id)!, { prompt: 'Latest prompt', extraArgs: ['--effort', 'high'] });
    await manager.runNow(task.id);
    expect(deps.launchTerminal).toHaveBeenCalledWith(expect.objectContaining({ extraArgs: expect.arrayContaining(['--effort', 'high', 'Latest prompt']) }), expect.any(Object));
    ptys.reapDeadSessions.mockImplementation(() => { sessions[0].status = 'exited'; });
    expect(await manager.reload(task.id)).toMatchObject({ reloaded: true });
  });
  it('keeps an unchanged timer deadline across watcher and periodic reloads', async () => {
    vi.useFakeTimers(); const { manager, input, records } = fixture();
    const task = await manager.create({ ...input, enabled: true });
    const deadline = manager.get(task.id).status.nextRunAt;
    await vi.advanceTimersByTimeAsync(15_000);
    // Simulate validator-added optional undefined keys and a different JSON key order.
    const saved = records.get(task.id)!;
    records.set(task.id, { prompt: undefined, extraArgs: undefined, ...saved, status: { ...saved.status, nextRunAt: undefined } });
    await manager.loadAll([project]);
    expect(manager.get(task.id).status.nextRunAt).toBe(deadline);
  });
  it('retimes a disk cadence edit rather than firing it at the previous deadline', async () => {
    vi.useFakeTimers(); const { manager, input, persistence, records, deps } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create({ ...input, enabled: true });
    records.get(task.id)!.schedule = { every: '1h' };
    await (manager as any).fire(task.id, { manual: false });
    expect(deps.launchTerminal).not.toHaveBeenCalled();
    expect(manager.get(task.id).status.nextRunAt).toBe(new Date(Date.now() + 3_600_000).toISOString());
    records.get(task.id)!.enabled = false;
    await (manager as any).fire(task.id, { manual: false });
    expect(deps.launchTerminal).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('retimes a disk cadence adopted during report persistence without releasing the worker', async () => {
    vi.useFakeTimers(); const { manager, input, persistence, records, sessions, ptys } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create({ ...input, enabled: true }); await manager.runNow(task.id);
    records.get(task.id)!.schedule = { every: '1h' };
    await manager.attachReport(sessions[0].id, 'Done');
    expect(manager.get(task.id).status.nextRunAt).toBe(new Date(Date.now() + 3_600_000).toISOString());
    expect(ptys.listenerCount('exit')).toBe(1);
  });
  it('retries a deferred reload after an owner refresh failure and rejects late reads after shutdown', async () => {
    vi.useFakeTimers(); const { manager, input, persistence, records, sessions } = fixture();
    const task = await manager.create(input); await manager.runNow(task.id);
    await manager.reload(task.id); records.get(task.id)!.prompt = 'Deferred'; sessions[0].status = 'exited';
    persistence.load.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(1_250); expect(manager.get(task.id).prompt).toBe('Deferred');
    const blocked = deferred<ScheduledTask>(); persistence.read = vi.fn(() => blocked.promise);
    const updating = manager.update(task.id, { prompt: 'Late' }); await vi.advanceTimersByTimeAsync(0);
    manager.stopAll(); blocked.resolve(records.get(task.id)!); await expect(updating).rejects.toThrow('stopped');
    expect(records.get(task.id)!.prompt).toBe('Deferred');
  });
  it('handles a removed execution project and releases owned resources on project removal', async () => {
    const { manager, input, deps, ptys } = fixture(); const task = await manager.create(input);
    deps.store.listProjects = () => []; await manager.runNow(task.id); expect(manager.list()[0].status.runs[0]).toMatchObject({ result: 'error', message: expect.stringContaining('not found') });
    deps.store.listProjects = () => [project]; await manager.runNow(task.id); expect(ptys.listenerCount('exit')).toBe(1);
    await manager.onProjectRemoved(project.id); expect(ptys.listenerCount('exit')).toBe(0); expect(manager.list()).toEqual([]);
  });
});

describe('scheduled Squad observation isolation (SC1)', () => {
  async function twoSquadSchedules() {
    const f = fixture();
    let sequence = 0;
    const launchSquad = vi.fn(async () => ({ executionId: `execution-${++sequence}` }));
    const getSquadExecution = vi.fn(async (_projectId: string, executionId: string) => {
      if (executionId === 'execution-1') throw new Error('poisoned execution record');
      return { state: 'COMPLETED', finalSummary: `${executionId} done` };
    });
    f.manager.setDeps({ ...f.deps, launchSquad, getSquadExecution });
    const poisoned = await f.manager.create({ ...f.input, name: 'poisoned', kind: 'team', teamId: 'squad-a' });
    const healthy = await f.manager.create({ ...f.input, name: 'healthy', kind: 'team', teamId: 'squad-b' });
    await f.manager.runNow(poisoned.id);
    await f.manager.runNow(healthy.id);
    return { ...f, launchSquad, getSquadExecution, poisoned, healthy };
  }

  it('finalizes other runs when one execution lookup throws', async () => {
    const { manager, deps, poisoned, healthy } = await twoSquadSchedules();

    await expect((manager as any).observeSquadExecutions()).resolves.toBeUndefined();

    expect(manager.get(healthy.id).status.runs[0]).toMatchObject({
      executionId: 'execution-2', result: 'success', finishedAt: expect.any(String), message: 'execution-2 done'
    });
    expect(manager.get(poisoned.id).status.runs[0]).toMatchObject({ executionId: 'execution-1', launchState: 'running' });
    expect(manager.get(poisoned.id).status.runs[0].finishedAt).toBeUndefined();
    expect(deps.logger).toHaveBeenCalledWith(expect.stringContaining(poisoned.id), expect.objectContaining({ message: 'poisoned execution record' }));
  });

  it('still fires an automatic tick for another schedule while one run is poisoned', async () => {
    const { manager, input, launchSquad, deps } = await twoSquadSchedules();
    const other = await manager.create({ ...input, name: 'other', kind: 'team', teamId: 'squad-c' });

    await expect((manager as any).fire(other.id, { manual: false })).resolves.toBeUndefined();

    expect(launchSquad).toHaveBeenCalledTimes(3);
    expect(manager.get(other.id).status.runs[0]).toMatchObject({ executionId: 'execution-3', launchState: 'running' });
    expect(deps.logger).toHaveBeenCalled();
  });

  it('logs instead of rejecting when observation itself fails', async () => {
    const { manager, input, deps } = fixture();
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, launchSquad, getSquadExecution: vi.fn(async () => ({ state: 'RUNNING' })) });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad' });
    vi.spyOn(manager as any, 'observeSquadExecutions').mockRejectedValueOnce(new Error('observer crashed'));

    await expect((manager as any).fire(task.id, { manual: false })).resolves.toBeUndefined();

    expect(deps.logger).toHaveBeenCalledWith(`observe squads ${task.id}`, expect.objectContaining({ message: 'observer crashed' }));
    expect(launchSquad).toHaveBeenCalledOnce();
  });
});

describe('deferred reload cadence (SC2)', () => {
  it('fires on cadence while a mode change is deferred instead of re-arming forever', async () => {
    vi.useFakeTimers();
    const { manager, input, deps, persistence, records } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    manager.setDeps({ ...deps, persistence, launchSquad, getSquadExecution: vi.fn(async () => ({ state: 'RUNNING' })) });
    const task = await manager.create({ ...input, enabled: true, kind: 'team', teamId: 'squad' });
    await manager.runNow(task.id);
    // External edit changes both mode and cadence while the Squad run is live.
    Object.assign(records.get(task.id)!, { kind: 'agent', teamId: undefined, schedule: { every: '1h' } });

    await (manager as any).fire(task.id, { manual: false });

    expect(manager.get(task.id)).toMatchObject({ kind: 'team', schedule: { every: '5m' } });
    expect(manager.get(task.id).status.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'skipped', message: 'previous squad run still active' })
    ]));
    expect(manager.get(task.id).status.nextRunAt).toBe(new Date(Date.now() + 5 * 60_000).toISOString());
  });
});

describe('schedule prompt compare-and-swap (PC1)', () => {
  it('writes when the disk prompt still matches the expected prompt and never persists the guard', async () => {
    const { manager, input, persistence, records } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad', prompt: '  launched objective\n' });

    await manager.update(task.id, { prompt: 'corrected plan', expectedPrompt: 'launched objective' });

    expect(records.get(task.id)!.prompt).toBe('corrected plan');
    expect(records.get(task.id)).not.toHaveProperty('expectedPrompt');
    expect(manager.get(task.id)).not.toHaveProperty('expectedPrompt');
  });

  it('rejects with ScheduleConflictError and keeps an unreloaded disk edit', async () => {
    const { manager, input, persistence, records } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad', prompt: 'launched objective' });
    records.get(task.id)!.prompt = 'hand edit';
    const saves = persistence.save.mock.calls.length;

    const error = await manager.update(task.id, { prompt: 'corrected plan', expectedPrompt: 'launched objective' }).catch(e => e);

    expect(error).toBeInstanceOf(ScheduleConflictError);
    expect(error).toMatchObject({ code: 'DEFINITION_CONFLICT', scheduleId: task.id });
    expect(records.get(task.id)!.prompt).toBe('hand edit');
    expect(persistence.save).toHaveBeenCalledTimes(saves);
    expect(manager.get(task.id).prompt).toBe('launched objective');
  });

  it('rejects an edit that lands between the update read and the write-boundary read', async () => {
    const { manager, input, persistence, records } = fixture();
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad', prompt: 'launched objective' });
    let reads = 0;
    persistence.read = vi.fn(async value => {
      reads += 1;
      if (reads === 2) records.get(value.id)!.prompt = 'late hand edit';
      return structuredClone(records.get(value.id)!);
    });
    const saves = persistence.save.mock.calls.length;

    await expect(manager.update(task.id, { prompt: 'corrected plan', expectedPrompt: 'launched objective' }))
      .rejects.toBeInstanceOf(ScheduleConflictError);

    expect(records.get(task.id)!.prompt).toBe('late hand edit');
    expect(persistence.save).toHaveBeenCalledTimes(saves);
  });

  it('treats a missing disk prompt as a conflict', async () => {
    const { manager, input } = fixture();
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad' });
    await expect(manager.update(task.id, { prompt: 'corrected', expectedPrompt: 'launched' })).rejects.toThrow(ScheduleConflictError);
  });
});

describe('schedule reservation validation', () => {
  it.each([null, { at: 'invalid', result: 'success' }, { at: '2026-01-01', result: 'unknown' }, { at: '2026-01-01', result: 'success', sessionId: 1 }, { at: '2026-01-01', result: 'success', launchState: 'unknown' }, { at: '2026-01-01', result: 'skipped', launchState: 'pending' }])('rejects malformed history without dropping a launch fence: %j', async run => {
    const { manager, input } = fixture(); const task = await manager.create(input);
    expect(validateScheduleFile({ ...task, status: { ...task.status, runs: [run] } })).toHaveProperty('error');
  });
  it('bounds terminal history but retains unresolved reservations and active Squad runs', async () => {
    const { manager, input } = fixture(); const task = await manager.create(input);
    const runs = Array.from({ length: 101 }, () => ({ at: '2026-01-01', result: 'success' }));
    const parsed = validateScheduleFile({ ...task, history: { retain: 10000 }, status: { runs } });
    expect(parsed).toMatchObject({ history: { retain: 100 }, status: { runs: expect.any(Array) } }); if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.status.runs).toHaveLength(100);
    runs.push(
      { at: '2026-01-02', result: 'skipped', launchState: 'pending' },
      { at: '2026-01-03', result: 'success', launchKind: 'team', launchState: 'running', executionId: 'execution-1' }
    );
    const retained = validateScheduleFile({ ...task, kind: 'team', teamId: 'release-squad', status: { runs } });
    if ('error' in retained) throw new Error(retained.error);
    expect(retained.status.runs).toHaveLength(102);
    expect(retained.status.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ launchState: 'pending' }),
      expect.objectContaining({ executionId: 'execution-1', launchState: 'running' })
    ]));
    expect(validateScheduleFile({ ...task, status: { runs: {} } })).toHaveProperty('error');
    expect(validateScheduleFile({ ...task, extraArgs: ['valid', 42], history: { retain: NaN } })).toMatchObject({ extraArgs: ['valid'], history: { retain: 10 } });
  });
  it('rejects a file with an unbounded number of unresolved runs (P3)', async () => {
    const { manager, input } = fixture(); const task = await manager.create(input);
    const squad = { ...task, kind: 'team', teamId: 'release-squad' };
    const active = (index: number) => ({ id: `active-${index}`, at: '2026-01-03', result: 'success', launchKind: 'team', launchState: 'running', executionId: `execution-${index}` });
    const atCap = validateScheduleFile({ ...squad, status: { runs: Array.from({ length: 100 }, (_, index) => active(index)) } });
    if ('error' in atCap) throw new Error(atCap.error);
    expect(atCap.status.runs).toHaveLength(100);
    const runs = [...Array.from({ length: 100 }, (_, index) => active(index)), { at: '2026-01-02', result: 'skipped', launchState: 'pending' }];
    expect(validateScheduleFile({ ...squad, status: { runs } })).toEqual({ error: 'too many unresolved runs' });
  });
});

describe('scheduled Squad pending-launch recovery', () => {
  async function pendingSquad(runs: ScheduledTask['status']['runs'], extra: Record<string, unknown> = {}) {
    const env = fixture();
    const task = await env.manager.create({ ...env.input, kind: 'team', teamId: 'squad' });
    env.records.set(task.id, { ...structuredClone(env.records.get(task.id)!), status: { runCount: runs.length, runs } });
    env.manager.setDeps({ ...env.deps, ...extra });
    await env.manager.loadAll([project]);
    return { ...env, task };
  }
  const pendingRun = (over: Partial<ScheduledTask['status']['runs'][number]> = {}) => ({
    id: 'run-1', at: new Date().toISOString(), result: 'skipped' as const, launchKind: 'team' as const, launchState: 'pending' as const,
    launchRequestId: 'schedule:x:run-1', ...over
  });

  it('cannot confirm a pending Squad launch without an execution lookup', async () => {
    const { manager, task } = await pendingSquad([pendingRun()]);
    await expect(manager.reconcile(task.id)).resolves.toBe(false);
    await expect(manager.runNow(task.id)).rejects.toThrow('Unconfirmed squad launch');
  });

  it('cannot confirm a pending Squad launch whose execution is unknown', async () => {
    const getSquadExecution = vi.fn(async () => undefined);
    const { manager, task } = await pendingSquad([pendingRun({ executionId: 'execution-1' })], { getSquadExecution });
    await expect(manager.reconcile(task.id)).resolves.toBe(false);
    await expect(manager.runNow(task.id)).rejects.toThrow('Unconfirmed squad launch');
    expect(manager.get(task.id).status.runs[0].launchState).toBe('pending');
  });

  it('confirms pending Squad launches by execution id or launch request id and maps their state', async () => {
    const getSquadExecution = vi.fn(async (_p: string, id: string) => id === 'execution-1'
      ? { state: 'FAILED', finalSummary: 'broke' } : { state: 'RUNNING' });
    const findSquadExecution = vi.fn(async () => ({ executionId: 'execution-2', state: 'COMPLETED' }));
    const { manager, task } = await pendingSquad([
      pendingRun({ id: 'run-1', executionId: 'execution-1' }),
      pendingRun({ id: 'run-2', launchRequestId: 'schedule:x:run-2' }),
      pendingRun({ id: 'run-3', executionId: 'execution-3' })
    ], { getSquadExecution, findSquadExecution });
    await expect(manager.reconcile(task.id)).resolves.toBe(true);
    const runs = manager.get(task.id).status.runs;
    expect(runs.find(run => run.id === 'run-1')).toMatchObject({ launchState: 'running', result: 'error', message: 'broke' });
    expect(runs.find(run => run.id === 'run-2')).toMatchObject({ launchState: 'running', result: 'success', executionId: 'execution-2' });
    expect(runs.find(run => run.id === 'run-3')).toMatchObject({ launchState: 'running', result: 'skipped' });
    expect(findSquadExecution).toHaveBeenCalledWith(project.id, 'schedule:x:run-2');
  });
});

describe('scheduled Squad definition edits', () => {
  it('rejects an edit while a disk mode change waits on an unresolved Squad run', async () => {
    const { manager, input, deps, records, persistence } = fixture();
    persistence.read = vi.fn(async task => structuredClone(records.get(task.id)!));
    manager.setDeps({ ...deps, persistence, launchSquad: vi.fn(async () => ({ executionId: 'execution-1' })), getSquadExecution: vi.fn(async () => ({ state: 'RUNNING' })) });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad' });
    await manager.runNow(task.id);
    records.get(task.id)!.kind = 'agent';
    await expect(manager.update(task.id, { name: 'Renamed' })).rejects.toThrow('Cannot change schedule mode');
  });

  it('switches mode, trims teamId and clears Squad-only fields for agent schedules', async () => {
    const { manager, input } = fixture();
    const task = await manager.create(input);
    await expect(manager.update(task.id, { kind: 'team', teamId: '  squad  ', planSource: 'provided' }))
      .resolves.toMatchObject({ kind: 'team', teamId: 'squad', planSource: 'provided' });
    await expect(manager.update(task.id, { kind: 'team', teamId: '  ' })).rejects.toThrow('teamId is required');
    const agent = await manager.update(task.id, { kind: 'agent' });
    expect(agent).toMatchObject({ kind: 'agent', teamId: undefined, planSource: undefined });
  });
});

describe('scheduled Squad launch failures', () => {
  it('refuses to fire a Squad schedule without a launch service', async () => {
    const { manager, input } = fixture();
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad' });
    await expect(manager.runNow(task.id)).rejects.toThrow('Squad execution service unavailable');
  });

  it('records a failed Squad launch instead of leaving a pending reservation', async () => {
    const { manager, input, deps } = fixture();
    manager.setDeps({ ...deps, launchSquad: vi.fn(async () => { throw new Error('no capacity'); }) });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad' });
    await manager.runNow(task.id).catch(() => undefined);
    const run = manager.get(task.id).status.runs[0];
    expect(run.launchState).not.toBe('pending');
    expect(run).toMatchObject({ result: 'error' });
  });

  it('keeps the observation loop alive when one timed observation pass fails', async () => {
    vi.useFakeTimers();
    const { manager, input, deps } = fixture();
    const getSquadExecution = vi.fn(async () => ({ state: 'RUNNING' }));
    manager.setDeps({ ...deps, launchSquad: vi.fn(async () => ({ executionId: 'execution-1' })), getSquadExecution });
    const task = await manager.create({ ...input, kind: 'team', teamId: 'squad' });
    await manager.runNow(task.id);
    const observe = vi.spyOn(manager as any, 'observeSquadExecutions').mockRejectedValueOnce(new Error('store offline'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.logger).toHaveBeenCalledWith('observe squads', expect.objectContaining({ message: 'store offline' }));
    observe.mockRestore();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getSquadExecution).toHaveBeenCalled();
  });
});
