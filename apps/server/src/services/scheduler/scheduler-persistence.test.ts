import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ScheduledTask, Project } from '@zana-ai/zcc-domain/product';
import { SchedulerManager } from './scheduler.js';
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

describe('schedule reservation validation', () => {
  it.each([null, { at: 'invalid', result: 'success' }, { at: '2026-01-01', result: 'unknown' }, { at: '2026-01-01', result: 'success', sessionId: 1 }, { at: '2026-01-01', result: 'success', launchState: 'unknown' }, { at: '2026-01-01', result: 'skipped', launchState: 'pending' }])('rejects malformed history without dropping a launch fence: %j', async run => {
    const { manager, input } = fixture(); const task = await manager.create(input);
    expect(validateScheduleFile({ ...task, status: { ...task.status, runs: [run] } })).toHaveProperty('error');
  });
  it('bounds history but never silently drops an unresolved reservation', async () => {
    const { manager, input } = fixture(); const task = await manager.create(input);
    const runs = Array.from({ length: 101 }, () => ({ at: '2026-01-01', result: 'success' }));
    const parsed = validateScheduleFile({ ...task, history: { retain: 10000 }, status: { runs } });
    expect(parsed).toMatchObject({ history: { retain: 100 }, status: { runs: expect.any(Array) } }); if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.status.runs).toHaveLength(100);
    Object.assign(runs[100], { sessionId: 'reserved', launchState: 'pending' });
    expect(validateScheduleFile({ ...task, status: { runs } })).toHaveProperty('error');
    expect(validateScheduleFile({ ...task, status: { runs: {} } })).toHaveProperty('error');
    expect(validateScheduleFile({ ...task, extraArgs: ['valid', 42], history: { retain: NaN } })).toMatchObject({ extraArgs: ['valid'], history: { retain: 10 } });
  });
});
