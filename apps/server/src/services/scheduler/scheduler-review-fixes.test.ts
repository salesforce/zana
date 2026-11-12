import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));
vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn((task) => structuredClone(task)), saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(() => true),
  listAllSchedules: vi.fn(() => []),
  globalDir: () => '/tmp/cc-test-home/.zcc/schedules',
  projectDir: (project: { path: string }) => `${project.path}/.zcc/schedules`
}));
vi.mock('../claude.js', () => ({
  listClaudeSessions: vi.fn(() => [])
}));

import { EventEmitter } from 'node:events';
import { SchedulerManager } from './scheduler.js';
import { readSchedule, saveSchedule } from './scheduler-store.js';
import { isOpenProblem } from '@zana-ai/zcc-domain/schedule-health';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project, ScheduleCreateInput, ScheduledTask } from '@zana-ai/zcc-domain/product';

// Regression tests for the independent review of the self-healing engine:
// retry chains, catch-up arithmetic, lateness and the queue.

class FakePtys extends EventEmitter {
  constructor() { super(); this.setMaxListeners(0); }
  createCalls: Array<Record<string, unknown>> = [];
  sessions: Array<{ id: string; projectId: string; title: string; profile: string; cwd: string; status: 'running' | 'exited'; exitCode?: number; createdAt: number }> = [];
  list(projectId: string) { return this.sessions.filter(s => s.projectId === projectId); }
  getRememberedSession(id: string) { return this.sessions.find(s => s.id === id) ?? null; }
  reapDeadSessions() { return []; }
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
    const session = {
      id: opts.preallocatedSessionId as string, projectId: opts.projectId as string, title: 'x',
      profile: opts.profile as string, cwd: opts.cwd as string, status: 'running' as 'running' | 'exited', createdAt: Date.now()
    };
    this.sessions.push(session);
    return session;
  }
  write() { /* no-op */ }
  closeExpected() { return true; }
  simulateExit(id: string, code = 0) {
    const session = this.sessions.find(s => s.id === id);
    if (session) { session.status = 'exited'; session.exitCode = code; }
    this.emit('exit', id, code);
  }
}

type Deps = Parameters<SchedulerManager['setDeps']>[0];
type Entry = { taskId: string; trigger: string; retryOf?: string; attempt?: number; enqueuedAt: number; auto?: true; slotAt?: number };
type Internals = {
  arm: (id: string) => void;
  fire: (id: string, opts: Record<string, unknown>) => Promise<unknown>;
  queue: Entry[];
  retryTimers: Map<string, unknown>;
  live: Map<string, { task: ScheduledTask; targetAt?: number }>;
  serial: (work: () => Promise<unknown>) => Promise<unknown>;
};
const internals = (manager: SchedulerManager) => manager as unknown as Internals;
const T = (manager: SchedulerManager, id: string) => manager.list().find(task => task.id === id)!;
const settle = (manager: SchedulerManager) => internals(manager).serial(async () => undefined);
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-07-15T14:00:00Z');
const policy = { attempts: 1, delayMinutes: 10 };

async function makeFixture(inputs: Array<Partial<ScheduleCreateInput>> = [{}], config: Record<string, unknown> = {}) {
  const ptys = new FakePtys();
  const project: Project = { id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 };
  const inbox = { append: vi.fn(async () => undefined) };
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: { listProjects: () => [project], getConfig: () => config } as unknown as Deps['store'],
    inbox: inbox as unknown as Deps['inbox']
  });
  const tasks: ScheduledTask[] = [];
  for (const [index, input] of inputs.entries()) {
    tasks.push(await manager.create({
      name: `t${index}`, projectId: 'proj-1', profile: 'claude', every: '1h', enabled: false, prompt: 'work', inboxLevel: 'silent', ...input
    }));
  }
  return { manager, ptys, tasks, inbox };
}
const lastSession = (ptys: FakePtys) => ptys.sessions[ptys.sessions.length - 1].id;
/** Put a task in a late state: last run `agoMs` ago, enabled, timer armed. */
function lateTask(manager: SchedulerManager, id: string, agoMs: number, status: Partial<ScheduledTask['status']> = {}) {
  const task = internals(manager).live.get(id)!.task;
  task.status = { ...task.status, lastRunAt: new Date(Date.now() - agoMs).toISOString(), ...status };
  task.enabled = true;
  internals(manager).arm(id);
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); vi.mocked(saveSchedule).mockClear(); });

describe('retry chains end where they should', () => {
  it('a late report that promotes an incomplete run is a success: no stale reason, no pending retry', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, inboxLevel: 'loud', retry: policy }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    expect(T(manager, id).status.runs[0]).toMatchObject({ result: 'incomplete', reasonCode: 'no-report' });
    expect(T(manager, id).status.pendingRetry).toBeDefined();

    await manager.attachReport(ptys.sessions[0].id, 'done after all');
    const run = T(manager, id).status.runs[0];
    expect(run.result).toBe('success');
    expect(run.reasonCode).toBeUndefined();
    expect(run.message).toBeUndefined();
    expect(isOpenProblem(run, Date.now())).toBe(false);
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    expect(internals(manager).retryTimers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(11 * MIN);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('a later success drops a queued automatic retry', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, retry: policy, inboxLevel: 'silent' }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    internals(manager).queue.push({ taskId: id, trigger: 'retry', retryOf: 'older', attempt: 2, enqueuedAt: Date.now(), auto: true });
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    expect(internals(manager).queue).toHaveLength(0);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('a later success keeps a manual retry the user asked for', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, inboxLevel: 'silent' }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    internals(manager).queue.push({ taskId: id, trigger: 'retry', retryOf: 'older', attempt: 2, enqueuedAt: Date.now() });
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    expect(ptys.createCalls).toHaveLength(2);
    manager.stopAll();
  });

  it('disabling drops queued automatic retries; a manual one still runs', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, retry: policy }]);
    const id = tasks[0].id;
    internals(manager).queue.push(
      { taskId: id, trigger: 'retry', retryOf: 'a', attempt: 2, enqueuedAt: Date.now(), auto: true },
      { taskId: id, trigger: 'retry', retryOf: 'b', attempt: 2, enqueuedAt: Date.now() }
    );
    await manager.setEnabled(id, false);
    await settle(manager);
    // The automatic retry went with the schedule; the one the user asked for launched.
    expect(internals(manager).queue).toHaveLength(0);
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, id).status.runs[0]).toMatchObject({ trigger: 'retry', retryOf: 'b' });
    manager.stopAll();
  });

  it('turning Auto-retry off cancels the pending retry and its timer', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, retry: policy }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(internals(manager).retryTimers.size).toBe(1);
    await manager.update(id, { retry: null });
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    expect(internals(manager).retryTimers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(11 * MIN);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('keeps pendingRetry persisted until the retry starts', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, retry: policy }], { scheduledRunConcurrency: 1 });
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    // Hold the only slot so the due retry has to wait in the queue.
    ptys.sessions.push({ id: 'blocker', projectId: 'proj-1', title: 'x', profile: 'claude', cwd: '/', status: 'running', createdAt: Date.now() });
    internals(manager).live.get(id)!.task.status.runs.push({ id: 'blocker-run', at: new Date().toISOString(), result: 'success', sessionId: 'blocker', launchState: 'running' });
    await vi.advanceTimersByTimeAsync(10 * MIN + 1_000);
    expect(internals(manager).queue.some(entry => entry.trigger === 'retry' && entry.auto)).toBe(true);
    expect(T(manager, id).status.pendingRetry).toBeDefined();
    // On disk too: a quit while the retry waits in the in-memory queue re-arms it next launch.
    const saved = vi.mocked(saveSchedule).mock.calls.map(call => call[0] as ScheduledTask).filter(task => task.id === id).at(-1)!;
    expect(saved.status.pendingRetry).toMatchObject({ attempt: 2 });
    manager.stopAll();
  });

  it('a retry that cannot even start, with no retries left, still sends the chain one loud notice', async () => {
    const { manager, ptys, tasks, inbox } = await makeFixture([{ enabled: true, inboxLevel: 'quiet', retry: policy }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(inbox.append).not.toHaveBeenCalled();
    vi.spyOn(ptys, 'create').mockImplementationOnce(() => { throw new Error('binary missing'); });
    await vi.advanceTimersByTimeAsync(10 * MIN + 1_000);
    await settle(manager);
    expect(T(manager, id).status.runs[0]).toMatchObject({ reasonCode: 'launch-failed', attempt: 2 });
    expect(inbox.append).toHaveBeenCalledTimes(1);
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ notify: 'loud' }));
    manager.stopAll();
  });

  it('retryRuns refuses a second retry of a chain that is already queued', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: true }]);
    const id = tasks[0].id;
    internals(manager).live.get(id)!.task.status.runs = [{ id: 'p1', at: new Date().toISOString(), result: 'error', reasonCode: 'exit-nonzero' }];
    internals(manager).queue.push({ taskId: id, trigger: 'retry', retryOf: 'p1', attempt: 2, enqueuedAt: Date.now() });
    expect(await manager.retryRuns([{ scheduleId: id, runId: 'p1' }])).toEqual([{ scheduleId: id, runId: 'p1', ok: false, error: 'already retrying' }]);
    manager.stopAll();
  });
});

describe('catch-up arithmetic', () => {
  it('a gap of more than 1000 slots writes one marker and re-arms in the future', async () => {
    const { manager, tasks } = await makeFixture([{ every: '1m', catchUp: { mode: 'skip' } }]);
    const id = tasks[0].id;
    lateTask(manager, id, 2 * 24 * HOUR);
    await vi.advanceTimersByTimeAsync(5_100);
    await vi.advanceTimersByTimeAsync(30_000);
    const markers = T(manager, id).status.runs.filter(run => run.marker);
    expect(markers).toHaveLength(1);
    expect(Date.parse(markers[0].missed!.to)).toBeGreaterThan(Date.now() - 2 * MIN);
    expect(Date.parse(T(manager, id).status.nextRunAt!)).toBeGreaterThan(Date.now());
    manager.stopAll();
  });

  it('interval marker ranges sit on the schedule grid', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ every: '1h' }]);
    const id = tasks[0].id;
    const last = Date.now() - 5.5 * HOUR;
    lateTask(manager, id, 5.5 * HOUR);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    const marker = T(manager, id).status.runs.find(run => run.marker)!;
    expect(marker.missed).toEqual({ count: 4, from: new Date(last + HOUR).toISOString(), to: new Date(last + 4 * HOUR).toISOString() });
    expect(T(manager, id).status.runs.find(run => !run.marker)!.slotAt).toBe(new Date(last + 5 * HOUR).toISOString());
    manager.stopAll();
  });

  it('measures lateness when the timer fired, not after waiting in the serial queue', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ every: '1h' }]);
    const id = tasks[0].id;
    const task = internals(manager).live.get(id)!.task;
    task.status = { ...task.status, lastRunAt: new Date(Date.now() - HOUR - 5 * MIN).toISOString() };
    task.enabled = true;
    internals(manager).arm(id);
    const targetAt = internals(manager).live.get(id)!.targetAt!;
    await internals(manager).serial(() => internals(manager).fire(id, { manual: false, firedAt: targetAt + 10_000 }));
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, id).status.runs[0].lateByMs).toBeUndefined();
    expect(T(manager, id).status.runs.some(run => run.marker)).toBe(false);
    manager.stopAll();
  });

  it('Recovery catch-ups queue at the limit even when overflow is "skip"', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true }, { catchUp: { mode: 'once' } }], { scheduledRunConcurrency: 1, scheduledRunOverflow: 'skip' });
    await manager.runNow(tasks[0].id);
    lateTask(manager, tasks[1].id, 3.5 * HOUR);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    expect(internals(manager).queue.some(entry => entry.taskId === tasks[1].id && entry.trigger === 'catch-up')).toBe(true);
    expect(T(manager, tasks[1].id).status.runs.some(run => run.reasonCode === 'concurrency-cap')).toBe(false);
    manager.stopAll();
  });

  it('Recovery skip while the previous run is alive writes no marker and does not refire', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ every: '1h', catchUp: { mode: 'skip' } }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    lateTask(manager, id, 3.5 * HOUR);
    await vi.advanceTimersByTimeAsync(5_100);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(T(manager, id).status.runs.some(run => run.marker)).toBe(false);
    expect(ptys.createCalls).toHaveLength(1);
    expect(Date.parse(T(manager, id).status.nextRunAt!)).toBeGreaterThan(Date.now());
    manager.stopAll();
  });

  it('ignores a slot cursor in the future (clock skew) instead of stopping the schedule', async () => {
    const { manager, tasks } = await makeFixture([{ every: '1h' }]);
    const id = tasks[0].id;
    lateTask(manager, id, 30 * MIN, { slotCursorAt: new Date(Date.now() + 2 * 24 * HOUR).toISOString() });
    expect(Date.parse(T(manager, id).status.nextRunAt!)).toBeLessThanOrEqual(Date.now() + HOUR);
    manager.stopAll();
  });
});

describe('reload', () => {
  it('does not rewrite a disabled schedule whose cadence changed on disk', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: false }]);
    const id = tasks[0].id;
    vi.mocked(saveSchedule).mockClear();
    vi.mocked(readSchedule).mockImplementationOnce((task: ScheduledTask) => ({ ...structuredClone(task), schedule: { every: '2h' } }));
    await manager.reload(id);
    expect(T(manager, id).schedule).toEqual({ every: '2h' });
    expect(saveSchedule).not.toHaveBeenCalled();
    manager.stopAll();
  });
});

describe('re-review of the fix round', () => {
  const problem = (id: string) => ({ id, at: new Date(Date.now() - 2 * HOUR).toISOString(), result: 'error' as const, reasonCode: 'exit-nonzero' as const, durationMs: 1_000 });

  it('any retry that starts consumes the pending retry (one run serves every chain)', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, retry: policy }]);
    const id = tasks[0].id;
    const live = internals(manager).live.get(id)!;
    live.task.status.runs = [problem('B'), problem('A')];
    live.task.status.pendingRetry = { rootRunId: 'A', attempt: 2, dueAt: new Date(Date.now() + 10 * MIN).toISOString() };
    const [result] = await manager.retryRuns([{ scheduleId: id, runId: 'B' }]);
    expect(result).toMatchObject({ ok: true, status: 'started' });
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    manager.stopAll();
  });

  it('a due automatic retry never replaces a manual retry already queued for the schedule', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: true, retry: policy }], { scheduledRunConcurrency: 1 });
    const id = tasks[0].id;
    const live = internals(manager).live.get(id)!;
    live.task.status.runs = [problem('A')];
    live.task.status.pendingRetry = { rootRunId: 'A', attempt: 2, dueAt: new Date(Date.now() - MIN).toISOString() };
    internals(manager).queue.push({ taskId: id, trigger: 'retry', retryOf: 'B', attempt: 2, enqueuedAt: Date.now() });
    await internals(manager).serial(() => (manager as unknown as { retryDue: (id: string) => Promise<void> }).retryDue(id));
    expect(internals(manager).queue).toEqual([expect.objectContaining({ retryOf: 'B' })]);
    expect(internals(manager).queue[0].auto).toBeUndefined();
    manager.stopAll();
  });

  it('skip while a run is alive changes no stored status (no deferred-reload spin)', async () => {
    const { manager, tasks } = await makeFixture([{ every: '1h', catchUp: { mode: 'skip' } }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    lateTask(manager, id, 3.5 * HOUR);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(T(manager, id).status.slotCursorAt).toBeUndefined();
    expect((internals(manager).live.get(id) as unknown as { handledThroughMs?: number }).handledThroughMs).toBeGreaterThan(0);
    manager.stopAll();
  });

  it('a failed marker write does not refire every 5 s', async () => {
    const { manager, tasks } = await makeFixture([{ every: '1h', catchUp: { mode: 'skip' } }]);
    const id = tasks[0].id;
    lateTask(manager, id, 3.5 * HOUR);
    vi.mocked(saveSchedule).mockClear();
    vi.mocked(saveSchedule).mockImplementation(() => { throw new Error('disk full'); });
    await vi.advanceTimersByTimeAsync(5_100);
    const attempts = vi.mocked(saveSchedule).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(saveSchedule).mock.calls.length).toBe(attempts);
    expect(Date.parse(T(manager, id).status.nextRunAt!)).toBeGreaterThan(Date.now());
    vi.mocked(saveSchedule).mockReset();
    manager.stopAll();
  });

  it('a manual retry that cannot start sends no chain notice (only automatic chains do)', async () => {
    const { manager, ptys, tasks, inbox } = await makeFixture([{ enabled: true, inboxLevel: 'quiet' }]);
    const id = tasks[0].id;
    internals(manager).live.get(id)!.task.status.runs = [problem('A')];
    vi.spyOn(ptys, 'create').mockImplementationOnce(() => { throw new Error('binary missing'); });
    const [result] = await manager.retryRuns([{ scheduleId: id, runId: 'A' }]);
    expect(result.ok).toBe(false);
    expect(inbox.append).not.toHaveBeenCalled();
    manager.stopAll();
  });

  it('a report that promotes an incomplete run whose notice was held back sends that one notice', async () => {
    const { manager, ptys, tasks, inbox } = await makeFixture([{ enabled: true, inboxLevel: 'loud', retry: policy }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    expect(inbox.append).not.toHaveBeenCalled();
    await manager.attachReport(ptys.sessions[0].id, 'done after all');
    await settle(manager);
    expect(inbox.append).toHaveBeenCalledTimes(1);
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ comments: expect.stringContaining('success') }));
    manager.stopAll();
  });

  it('a failed update leaves the retry chain as it was', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true, retry: policy }]);
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(internals(manager).retryTimers.size).toBe(1);
    vi.mocked(saveSchedule).mockImplementationOnce(() => { throw new Error('read-only'); });
    await expect(manager.update(id, { retry: null })).rejects.toThrow('read-only');
    expect(internals(manager).retryTimers.size).toBe(1);
    expect(T(manager, id).status.pendingRetry).toBeDefined();
    manager.stopAll();
  });
});
