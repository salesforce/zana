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
import { validateScheduleFile } from './schedule-validation.js';
import { listAllSchedules, saveSchedule } from './scheduler-store.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project, ScheduleCreateInput, ScheduledTask } from '@zana-ai/zcc-domain/product';

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
type Internals = {
  arm: (id: string) => void;
  fire: (id: string, opts: Record<string, unknown>) => Promise<void>;
  queue: Array<{ taskId: string; trigger: string; slotAt?: number; attempt?: number }>;
  retryTimers: Map<string, unknown>;
  live: Map<string, { firing?: boolean; task: ScheduledTask; queuedThroughMs?: number; targetAt?: number }>;
  scheduleRetryIfDue: (id: string, runId: string) => Promise<boolean>;
};

const internals = (manager: SchedulerManager) => manager as unknown as Internals;
const T = (manager: SchedulerManager, id: string) => manager.list().find(task => task.id === id)!;
const autoFire = (manager: SchedulerManager, id: string) => internals(manager).fire(id, { manual: false });
/** Wait for queued serial work (exit handlers, drains) to finish. */
const settle = (manager: SchedulerManager) =>
  (manager as unknown as { serial: (work: () => Promise<unknown>) => Promise<unknown> }).serial(async () => undefined);
const HOUR = 3_600_000;
const MIN = 60_000;

async function makeFixture(
  inputs: Array<Partial<ScheduleCreateInput>> = [{}],
  config: Record<string, unknown> = {}
) {
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
  return { manager, ptys, tasks, project, config, inbox };
}

/** Mark tasks enabled without arming their timers (a fire only queues for enabled schedules). */
function enable(manager: SchedulerManager, tasks: ScheduledTask[]) {
  for (const task of tasks) internals(manager).live.get(task.id)!.task.enabled = true;
}

const classic = (n: number) => Array.from({ length: n }, () => ({ catchUp: null as null }));
const recovery = (n: number) => Array.from({ length: n }, () => ({}));

describe('configurable limit', () => {
  it.each([[1, 1], [3, 3], [20, 20], [0, 1], [99, 20], [7.6, 8]])('limit %s runs %s at once', async (configured, expected) => {
    const { manager, ptys, tasks } = await makeFixture(classic(22), { scheduledRunConcurrency: configured });
    for (const task of tasks) await autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(expected);
    const skipped = tasks.flatMap(task => T(manager, task.id).status.runs).filter(run => run.reasonCode === 'concurrency-cap');
    expect(skipped).toHaveLength(22 - expected);
    expect(skipped[0].message).toBe(`concurrency-cap: ${expected}/${expected} scheduled runs active`);
  });

  it('defaults to 5 when unset or not a number', async () => {
    const { manager, ptys, tasks } = await makeFixture(classic(7), { scheduledRunConcurrency: 'many' });
    for (const task of tasks) await autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(5);
  });

  it('reads the limit at each check', async () => {
    const { manager, ptys, tasks, config } = await makeFixture(classic(4), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    expect(ptys.createCalls).toHaveLength(1);
    config.scheduledRunConcurrency = 3;
    await autoFire(manager, tasks[2].id);
    expect(ptys.createCalls).toHaveLength(2);
  });
});

describe('overflow policy', () => {
  it('auto + Classic keeps today\'s skip record', async () => {
    const { manager, ptys, tasks } = await makeFixture(classic(2), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ result: 'skipped', reasonCode: 'concurrency-cap' });
    expect(internals(manager).queue).toHaveLength(0);
  });

  it('auto + Recovery queues: 3 fires at limit 1 give 1 running, 2 queued, no skip; exits launch the next', async () => {
    const { manager, ptys, tasks } = await makeFixture(recovery(3), { scheduledRunConcurrency: 1 });
    enable(manager, tasks);
    for (const task of tasks) await autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(internals(manager).queue.map(entry => entry.taskId)).toEqual([tasks[1].id, tasks[2].id]);
    for (const task of tasks) expect(T(manager, task.id).status.runs.some(run => run.result === 'skipped' && !run.launchState)).toBe(false);
    expect(T(manager, tasks[1].id).status.queuedAt).toBeTruthy();
    expect(T(manager, tasks[0].id).status.queuedAt).toBeUndefined();

    ptys.simulateExit(ptys.sessions[0].id, 0);
    await settle(manager);
    expect(ptys.createCalls).toHaveLength(2);
    expect(internals(manager).queue.map(entry => entry.taskId)).toEqual([tasks[2].id]);
    expect(T(manager, tasks[1].id).status.queuedAt).toBeUndefined();

    ptys.simulateExit(ptys.sessions[1].id, 0);
    await settle(manager);
    expect(ptys.createCalls).toHaveLength(3);
    expect(internals(manager).queue).toHaveLength(0);
  });

  it('explicit queue overrides a Classic schedule', async () => {
    const { manager, ptys, tasks } = await makeFixture(classic(2), { scheduledRunConcurrency: 1, scheduledRunOverflow: 'queue' });
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(internals(manager).queue).toHaveLength(1);
    expect(T(manager, tasks[1].id).status.runs).toHaveLength(0);
  });

  it('explicit skip overrides a Recovery schedule', async () => {
    const { manager, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1, scheduledRunOverflow: 'skip' });
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ result: 'skipped', reasonCode: 'concurrency-cap' });
    expect(internals(manager).queue).toHaveLength(0);
  });

  it('Run now ignores the limit and the queue', async () => {
    const { manager, ptys, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    await manager.runNow(tasks[1].id);
    expect(ptys.createCalls).toHaveLength(2);
  });
});

describe('queue behaviour', () => {
  it('coalesces a second fire of the same schedule into one entry with the newer slot', async () => {
    const { manager, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    const base = Date.now();
    Object.assign(internals(manager).live.get(tasks[1].id)!, { targetAt: base + 1_000 });
    await autoFire(manager, tasks[1].id);
    Object.assign(internals(manager).live.get(tasks[1].id)!, { targetAt: base + 5_000 });
    await autoFire(manager, tasks[1].id);
    const entries = internals(manager).queue.filter(entry => entry.taskId === tasks[1].id);
    expect(entries).toHaveLength(1);
    expect(entries[0].slotAt).toBe(base + 5_000);
    expect(internals(manager).live.get(tasks[1].id)!.queuedThroughMs).toBe(base + 5_000);
  });

  it('bounds the queue at 200 and records queue-full beyond it', async () => {
    const { manager, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    for (let i = 0; i < 200; i += 1) internals(manager).queue.push({ taskId: `ghost-${i}`, trigger: 'schedule', enqueuedAt: 0 } as never);
    await autoFire(manager, tasks[1].id);
    expect(internals(manager).queue).toHaveLength(200);
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ result: 'skipped', reasonCode: 'queue-full' });
  });

  it('an entry that cannot start does not block the ones behind it', async () => {
    const { manager, ptys, tasks } = await makeFixture(recovery(3), { scheduledRunConcurrency: 1 });
    enable(manager, tasks);
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    await autoFire(manager, tasks[2].id);
    internals(manager).live.get(tasks[1].id)!.firing = true; // mid-launch elsewhere: ineligible
    ptys.simulateExit(ptys.sessions[0].id, 0);
    await settle(manager);
    expect(ptys.createCalls).toHaveLength(2);
    expect(ptys.createCalls[1].title).toBe('Scheduled: t2');
    expect(internals(manager).queue.map(entry => entry.taskId)).toEqual([tasks[1].id]);
  });

  it('puts an entry back at the head when it loses a race for the last slot', async () => {
    const { manager, ptys, tasks } = await makeFixture(recovery(3), { scheduledRunConcurrency: 1 });
    enable(manager, tasks);
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    await autoFire(manager, tasks[2].id);
    const fire = vi.spyOn(internals(manager), 'fire');
    fire.mockResolvedValueOnce('raced' as never);
    ptys.simulateExit(ptys.sessions[0].id, 0);
    await settle(manager);
    expect(internals(manager).queue.map(entry => entry.taskId)).toEqual([tasks[1].id, tasks[2].id]);
    fire.mockRestore();
  });

  it('drops the entries of a disabled schedule', async () => {
    const { manager, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    internals(manager).live.get(tasks[1].id)!.task.enabled = true;
    await manager.setEnabled(tasks[1].id, false);
    expect(internals(manager).queue).toHaveLength(0);
    expect(internals(manager).live.get(tasks[1].id)!.queuedThroughMs).toBeUndefined();
    expect(T(manager, tasks[1].id).status.queuedAt).toBeUndefined();
  });

  it('drops the entries of a removed schedule', async () => {
    const { manager, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    await manager.remove(tasks[1].id);
    expect(internals(manager).queue).toHaveLength(0);
  });

  it('never writes the runtime-only queuedAt to disk', async () => {
    const { manager, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    const saved: ScheduledTask[] = [];
    vi.mocked(saveSchedule).mockImplementation((task) => { saved.push(structuredClone(task)); });
    enable(manager, tasks);
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    expect(T(manager, tasks[1].id).status.queuedAt).toBeTruthy();
    await manager.update(tasks[1].id, { description: 'x' });
    expect(saved.length).toBeGreaterThan(0);
    for (const task of saved) expect('queuedAt' in task.status).toBe(false);
    vi.mocked(saveSchedule).mockReset();
  });

  describe('timers', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-15T14:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });

    it('stopAll releases the queue, the arm timers and the retry timers', async () => {
      const { manager, tasks } = await makeFixture(
        [{ enabled: true, retry: { attempts: 2, delayMinutes: 10 } }, { enabled: true }],
        { scheduledRunConcurrency: 1 }
      );
      await autoFire(manager, tasks[0].id);
      await autoFire(manager, tasks[1].id);
      expect(internals(manager).queue).toHaveLength(1);
      manager.stopAll();
      expect(internals(manager).queue).toHaveLength(0);
      expect(internals(manager).retryTimers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('Recovery `all` with 5 missed slots and max 3: a marker for 2, then 3 sequential runs', async () => {
      const now = Date.parse('2026-07-15T14:00:00Z');
      const { manager, ptys, tasks } = await makeFixture([{ catchUp: { mode: 'all', max: 3 }, enabled: false }]);
      const id = tasks[0].id;
      const task = T(manager, id);
      task.status.lastRunAt = new Date(now - 5.5 * HOUR).toISOString();
      task.enabled = true;
      internals(manager).arm(id);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(ptys.createCalls).toHaveLength(1);
      const markers = T(manager, id).status.runs.filter(run => run.marker);
      expect(markers).toHaveLength(1);
      expect(markers[0].missed!.count).toBe(2);

      ptys.simulateExit(ptys.sessions[0].id, 0);
      await vi.advanceTimersByTimeAsync(10);
      expect(ptys.createCalls).toHaveLength(2);
      ptys.simulateExit(ptys.sessions[1].id, 0);
      await vi.advanceTimersByTimeAsync(10);
      expect(ptys.createCalls).toHaveLength(3);
      ptys.simulateExit(ptys.sessions[2].id, 0);
      await vi.advanceTimersByTimeAsync(10);
      expect(ptys.createCalls).toHaveLength(3);

      const fired = T(manager, id).status.runs.filter(run => !run.marker);
      expect(fired).toHaveLength(3);
      expect(fired.every(run => run.trigger === 'catch-up')).toBe(true);
      const slots = fired.map(run => Date.parse(run.slotAt!)).sort((a, b) => a - b);
      expect(slots).toEqual([now - 2.5 * HOUR, now - 1.5 * HOUR, now - 0.5 * HOUR]);
      // Queued catch-ups may never start, so the marker carries no early `resolvedBy`:
      // the first finished success closes it (D8).
      const marker = T(manager, id).status.runs.find(run => run.marker)!;
      expect(marker.resolvedBy).toBe(fired.find(run => Date.parse(run.slotAt!) === slots[0])!.id);
      manager.stopAll();
    });
  });
});

describe('auto-retry', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-15T14:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const policy = { attempts: 2, delayMinutes: 10 };
  const loud = (extra: Partial<ScheduleCreateInput> = {}) => ({ enabled: true, inboxLevel: 'loud' as const, retry: policy, ...extra });
  const lastSession = (ptys: FakePtys) => ptys.sessions[ptys.sessions.length - 1].id;

  it('retries with linear backoff (delay x1 then x2), then stops: one loud notice, root stays open', async () => {
    const { manager, ptys, tasks, inbox } = await makeFixture([loud()]);
    const id = tasks[0].id;
    await manager.runNow(id);
    const root = T(manager, id).status.runs[0];
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(inbox.append).not.toHaveBeenCalled();
    const first = T(manager, id).status.pendingRetry!;
    expect(first).toMatchObject({ rootRunId: root.id, attempt: 2 });
    expect(Date.parse(first.dueAt) - Date.now()).toBe(10 * MIN);

    await vi.advanceTimersByTimeAsync(10 * MIN - 1);
    expect(ptys.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(ptys.createCalls).toHaveLength(2);
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    expect(T(manager, id).status.runs[0]).toMatchObject({ trigger: 'retry', attempt: 2, retryOf: root.id });

    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(inbox.append).not.toHaveBeenCalled();
    const second = T(manager, id).status.pendingRetry!;
    expect(second.attempt).toBe(3);
    expect(Date.parse(second.dueAt) - Date.now()).toBe(20 * MIN);

    await vi.advanceTimersByTimeAsync(20 * MIN + 1);
    expect(ptys.createCalls).toHaveLength(3);
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    expect(inbox.append).toHaveBeenCalledTimes(1);
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ notify: 'loud' }));
    const runs = T(manager, id).status.runs;
    expect(runs.find(run => run.id === root.id)!.resolvedBy).toBeUndefined();
    expect(runs.filter(run => run.result === 'error')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(HOUR);
    manager.stopAll();
  });

  it('a success on retry 2 resolves the whole chain with one "after 2 attempts" notice', async () => {
    const { manager, ptys, tasks, inbox } = await makeFixture([loud()]);
    const id = tasks[0].id;
    await manager.runNow(id);
    const root = T(manager, id).status.runs[0];
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    await vi.advanceTimersByTimeAsync(10 * MIN + 1);
    expect(ptys.createCalls).toHaveLength(2);
    await manager.attachReport(lastSession(ptys), 'done');
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    const runs = T(manager, id).status.runs;
    expect(runs[0]).toMatchObject({ result: 'success', attempt: 2 });
    expect(runs.find(run => run.id === root.id)!.resolvedBy).toBe(runs[0].id);
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    expect(inbox.append).toHaveBeenCalledTimes(1);
    expect((inbox.append.mock.calls[0] as unknown as [{ comments: string }])[0].comments).toContain('after 2 attempts');
    manager.stopAll();
  });

  it('a plain first-attempt success has no attempts suffix', async () => {
    const { manager, ptys, tasks, inbox } = await makeFixture([loud()]);
    await manager.runNow(tasks[0].id);
    await manager.attachReport(lastSession(ptys), 'done');
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    expect((inbox.append.mock.calls[0] as unknown as [{ comments: string }])[0].comments).not.toContain('attempts');
    manager.stopAll();
  });

  it('a success cancels a pending retry and its timer', async () => {
    const { manager, ptys, tasks } = await makeFixture([loud()]);
    const id = tasks[0].id;
    await manager.runNow(id);
    ptys.simulateExit(lastSession(ptys), 1);
    await settle(manager);
    expect(internals(manager).retryTimers.size).toBe(1);
    await manager.runNow(id);
    await manager.attachReport(lastSession(ptys), 'done');
    ptys.simulateExit(lastSession(ptys), 0);
    await settle(manager);
    expect(T(manager, id).status.pendingRetry).toBeUndefined();
    expect(internals(manager).retryTimers.size).toBe(0);
    manager.stopAll();
  });

  it('disabling clears the pending retry; removing clears the timer', async () => {
    const { manager, ptys, tasks } = await makeFixture([loud(), loud()]);
    for (const task of tasks) {
      await manager.runNow(task.id);
      ptys.simulateExit(lastSession(ptys), 1);
      await settle(manager);
    }
    expect(internals(manager).retryTimers.size).toBe(2);
    await manager.setEnabled(tasks[0].id, false);
    expect(T(manager, tasks[0].id).status.pendingRetry).toBeUndefined();
    expect(internals(manager).retryTimers.size).toBe(1);
    await manager.remove(tasks[1].id);
    expect(internals(manager).retryTimers.size).toBe(0);
    manager.stopAll();
  });

  it('stopAll releases the retry timers', async () => {
    const { manager, ptys, tasks } = await makeFixture([loud({ enabled: false }), loud({ enabled: false })]);
    for (const task of tasks) {
      internals(manager).live.get(task.id)!.task.enabled = true;
      await manager.runNow(task.id);
      ptys.simulateExit(lastSession(ptys), 1);
      await settle(manager);
    }
    expect(internals(manager).retryTimers.size).toBe(2);
    manager.stopAll();
    expect(internals(manager).retryTimers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['project-missing', false],
    ['outcome-unknown', false],
    ['concurrency-cap', true],
    ['exit-nonzero', true],
    ['worker-not-started', true],
    ['missed-asleep', false]
  ] as const)('reason %s retries: %s', async (reasonCode, expected) => {
    const { manager, tasks } = await makeFixture([loud()]);
    const live = internals(manager).live.get(tasks[0].id)!;
    live.task.status.runs = [{ id: 'r', at: new Date().toISOString(), result: 'error', reasonCode }];
    expect(await internals(manager).scheduleRetryIfDue(tasks[0].id, 'r')).toBe(expected);
    manager.stopAll();
  });

  it('does nothing without a retry policy, with attempts 0, or once attempts are used up', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: true }, loud({ retry: { attempts: 0, delayMinutes: 5 } }), loud({ retry: { attempts: 1, delayMinutes: 5 } })]);
    for (const [index, task] of tasks.entries()) {
      internals(manager).live.get(task.id)!.task.status.runs = [{ id: 'r', at: new Date().toISOString(), result: 'error', reasonCode: 'exit-nonzero', attempt: index === 2 ? 2 : 1 }];
      expect(await internals(manager).scheduleRetryIfDue(task.id, 'r')).toBe(false);
    }
    manager.stopAll();
  });

  it('pendingRetry survives a reload and fires', async () => {
    const first = await makeFixture([loud()]);
    const id = first.tasks[0].id;
    await first.manager.runNow(id);
    first.ptys.simulateExit(lastSession(first.ptys), 1);
    await settle(first.manager);
    const saved = JSON.parse(JSON.stringify(vi.mocked(saveSchedule).mock.calls.at(-1)![0]));
    expect(saved.status.pendingRetry).toMatchObject({ attempt: 2 });
    first.manager.stopAll();

    const second = await makeFixture([]);
    const loaded = validateScheduleFile(saved);
    if ('error' in loaded) throw new Error(loaded.error);
    vi.mocked(listAllSchedules).mockReturnValueOnce([loaded]);
    await second.manager.loadAll([second.project]);
    expect(internals(second.manager).retryTimers.size).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * MIN + 1);
    expect(second.ptys.createCalls).toHaveLength(1);
    expect(T(second.manager, id).status.runs[0]).toMatchObject({ trigger: 'retry', attempt: 2 });
    second.manager.stopAll();
  });

  it('re-arms an overdue pendingRetry no sooner than 5 s after load', async () => {
    const { manager, ptys, project } = await makeFixture([]);
    const loaded = validateScheduleFile({
      id: 'late', name: 'late', enabled: true, projectId: 'proj-1', profile: 'claude', schedule: { every: '1h' }, inboxLevel: 'silent',
      catchUp: { mode: 'once' }, retry: policy,
      status: { runCount: 1, runs: [{ id: 'root', at: new Date(Date.now() - HOUR).toISOString(), result: 'error', reasonCode: 'exit-nonzero' }],
        pendingRetry: { rootRunId: 'root', attempt: 2, dueAt: new Date(Date.now() - HOUR).toISOString() } }
    });
    if ('error' in loaded) throw new Error(loaded.error);
    vi.mocked(listAllSchedules).mockReturnValueOnce([loaded]);
    await manager.loadAll([project]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(ptys.createCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });
});

describe('retryRuns through the queue', () => {
  const problem = { id: 'p1', at: new Date().toISOString(), result: 'error' as const, reasonCode: 'exit-nonzero' as const };

  it('returns started when a slot is free', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: false }]);
    internals(manager).live.get(tasks[0].id)!.task.status.runs = [problem];
    const [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'p1' }]);
    expect(result).toMatchObject({ ok: true, status: 'started' });
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ trigger: 'retry', retryOf: 'p1', attempt: 2 });
  });

  it('returns queued at the limit, then launches when a run exits, even with overflow skip', async () => {
    const { manager, ptys, tasks } = await makeFixture([{}, {}], { scheduledRunConcurrency: 1, scheduledRunOverflow: 'skip' });
    internals(manager).live.get(tasks[1].id)!.task.status.runs = [problem];
    await manager.runNow(tasks[0].id);
    const [result] = await manager.retryRuns([{ scheduleId: tasks[1].id, runId: 'p1' }]);
    expect(result).toMatchObject({ ok: true, status: 'queued' });
    expect(ptys.createCalls).toHaveLength(1);
    ptys.simulateExit(ptys.sessions[0].id, 0);
    await settle(manager);
    expect(ptys.createCalls).toHaveLength(2);
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ trigger: 'retry', attempt: 2 });
  });

  it('a newer retry for the same schedule coalesces with the queued one', async () => {
    const { manager, tasks } = await makeFixture([{}, {}], { scheduledRunConcurrency: 1 });
    internals(manager).live.get(tasks[1].id)!.task.status.runs = [problem, { ...problem, id: 'p2' }];
    await manager.runNow(tasks[0].id);
    const results = await manager.retryRuns([
      { scheduleId: tasks[1].id, runId: 'p1' },
      { scheduleId: tasks[1].id, runId: 'p2' }
    ]);
    // Coalesced, not failed: the schedule re-runs once and that run serves both refs.
    expect(results[0]).toMatchObject({ ok: true, status: 'queued' });
    expect(results[1]).toMatchObject({ ok: true, status: 'queued' });
    expect(internals(manager).queue).toHaveLength(1);
  });

  it('asks to enable a disabled schedule before catching up a missed marker', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: false }]);
    internals(manager).live.get(tasks[0].id)!.task.status.runs = [
      { id: 'm', at: new Date().toISOString(), result: 'skipped', marker: true, reasonCode: 'missed-asleep', missed: { count: 1, from: new Date().toISOString(), to: new Date().toISOString() } }
    ];
    const [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'm' }]);
    expect(result).toMatchObject({ ok: false, error: 'enable the schedule to catch up missed runs' });
  });

  it('reports queue-full when the queue has no room', async () => {
    const { manager, tasks } = await makeFixture([{}], { scheduledRunConcurrency: 1 });
    internals(manager).live.get(tasks[0].id)!.task.status.runs = [problem];
    for (let i = 0; i < 200; i += 1) internals(manager).queue.push({ taskId: `ghost-${i}`, trigger: 'schedule', enqueuedAt: 0 } as never);
    const [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'p1' }]);
    expect(result).toMatchObject({ ok: false, error: 'Queue full' });
  });
});

describe('review fixes', () => {
  const NOW = '2026-07-15T14:00:00Z';
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); vi.mocked(saveSchedule).mockReset(); });

  const armWith = (manager: SchedulerManager, id: string, lastRunAt: string) => {
    const task = internals(manager).live.get(id)!.task;
    task.status.lastRunAt = lastRunAt;
    task.enabled = true;
    internals(manager).arm(id);
  };

  it('a long-overdue Classic interval schedule writes nothing when it is armed, and one marker at its first fire', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    const lastRunAt = new Date(Date.parse(NOW) - 4 * HOUR).toISOString();
    vi.mocked(saveSchedule).mockClear();
    armWith(manager, id, lastRunAt);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saveSchedule).not.toHaveBeenCalled();
    expect(T(manager, id).status.runs).toHaveLength(0);

    // Re-arming (the 15 s poll / a file-watcher reload) still writes nothing.
    internals(manager).arm(id);
    internals(manager).arm(id);
    expect(saveSchedule).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR + 1_000);
    expect(ptys.createCalls).toHaveLength(1);
    const runs = T(manager, id).status.runs;
    const markers = runs.filter(run => run.marker);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ result: 'skipped' });
    expect(markers[0].missed!.count).toBeGreaterThanOrEqual(2);
    expect(runs.filter(run => !run.marker)).toHaveLength(1);
    expect(T(manager, id).status.runCount).toBe(1);
    manager.stopAll();
  });

  it('Recovery skip writes one marker per gap even while the poll reloads, and never moves lastRunAt', async () => {
    const { manager, ptys, project, tasks } = await makeFixture([{ catchUp: { mode: 'skip' } }]);
    const id = tasks[0].id;
    const lastRunAt = new Date(Date.parse(NOW) - 3.5 * HOUR).toISOString();
    armWith(manager, id, lastRunAt);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(0);
    expect(T(manager, id).status.runs.filter(run => run.marker)).toHaveLength(1);
    expect(T(manager, id).status.lastRunAt).toBe(lastRunAt);

    for (let i = 0; i < 3; i += 1) {
      vi.mocked(listAllSchedules).mockReturnValueOnce([structuredClone(T(manager, id))]);
      await manager.loadAll([project]);
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(T(manager, id).status.runs.filter(run => run.marker)).toHaveLength(1);
    expect(ptys.createCalls).toHaveLength(0);
    expect(T(manager, id).status.lastRunAt).toBe(lastRunAt);
    manager.stopAll();
  });

  it('a queued entry that loses a cap race leaves the schedule armed', async () => {
    const { manager, ptys, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    enable(manager, tasks);
    internals(manager).arm(tasks[1].id);
    await autoFire(manager, tasks[0].id);
    expect(ptys.createCalls).toHaveLength(1);
    const timers = vi.getTimerCount();
    const outcome = await internals(manager).fire(tasks[1].id, { manual: false, trigger: 'schedule', fromQueue: true });
    expect(outcome).toBe('raced');
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(timers);
    expect(internals(manager).live.get(tasks[1].id)!.timer).not.toBeNull();
    manager.stopAll();
  });

  it('a reload while an entry is queued neither refires nor loses the entry', async () => {
    const { manager, ptys, project, tasks } = await makeFixture(recovery(2), { scheduledRunConcurrency: 1 });
    enable(manager, tasks);
    await autoFire(manager, tasks[0].id);
    await autoFire(manager, tasks[1].id);
    expect(internals(manager).queue).toHaveLength(1);
    const edited = structuredClone(T(manager, tasks[1].id));
    edited.description = 'edited elsewhere';
    vi.mocked(listAllSchedules).mockReturnValueOnce([structuredClone(T(manager, tasks[0].id)), edited]);
    await manager.loadAll([project]);
    expect(internals(manager).queue).toHaveLength(1);
    expect(T(manager, tasks[1].id).status.queuedAt).toBeTruthy();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('disable and remove release the arm timer, retry timer and queue entries', async () => {
    const { manager, ptys, tasks } = await makeFixture(
      [{ enabled: true, retry: { attempts: 2, delayMinutes: 10 } }, { enabled: true }, { enabled: true }],
      { scheduledRunConcurrency: 1 }
    );
    await manager.runNow(tasks[0].id);
    ptys.simulateExit(ptys.sessions[0].id, 1);
    await settle(manager);
    await manager.runNow(tasks[2].id); // holds the only slot
    await autoFire(manager, tasks[1].id); // queued
    expect(internals(manager).queue).toHaveLength(1);
    expect(internals(manager).retryTimers.size).toBe(1);

    await manager.setEnabled(tasks[0].id, false);
    await manager.setEnabled(tasks[1].id, false);
    await manager.remove(tasks[0].id);
    await manager.remove(tasks[1].id);
    expect(internals(manager).queue).toHaveLength(0);
    expect(internals(manager).retryTimers.size).toBe(0);
    manager.stopAll();
    expect(vi.getTimerCount()).toBe(0);
  });
});
