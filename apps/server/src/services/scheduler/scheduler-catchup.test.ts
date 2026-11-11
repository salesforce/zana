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
import { SchedulerManager, trimRuns } from './scheduler.js';
import { LaunchSpawnError } from '../launch/coordinator.js';
import { listAllSchedules, saveSchedule } from './scheduler-store.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project, ScheduleCreateInput, ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';

class FakePtys extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  sessions: Array<{ id: string; projectId: string; title: string; profile: string; cwd: string; status: 'running' | 'exited'; exitCode?: number; createdAt: number }> = [];
  closeExpectedCalls: string[] = [];
  list(projectId: string) { return this.sessions.filter(s => s.projectId === projectId && s.status === 'running'); }
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
  closeExpected(id: string) { this.closeExpectedCalls.push(id); return true; }
  simulateExit(id: string, code = 0) {
    const session = this.sessions.find(s => s.id === id);
    if (session) { session.status = 'exited'; session.exitCode = code; }
    this.emit('exit', id, code);
  }
}

type Deps = Parameters<SchedulerManager['setDeps']>[0];

async function makeFixture(inputs: Array<Partial<ScheduleCreateInput>> = [{}], extra: Partial<Deps> = {}) {
  const ptys = new FakePtys();
  const project: Project = { id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 };
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: { listProjects: () => [project], getConfig: () => ({}) } as unknown as Deps['store'],
    ...extra
  });
  const tasks = [];
  for (const [index, input] of inputs.entries()) {
    tasks.push(await manager.create({
      name: `t${index}`, projectId: 'proj-1', profile: 'claude', every: '1h', enabled: false, prompt: 'work', inboxLevel: 'silent', ...input
    }));
  }
  return { manager, ptys, tasks, project };
}

const T = (manager: SchedulerManager, id: string) => manager.list().find(task => task.id === id)!;
const internals = (manager: SchedulerManager) => manager as unknown as {
  arm: (id: string) => void;
  fire: (id: string, opts: Record<string, unknown>) => Promise<void>;
  live: Map<string, { firing?: boolean; targetAt?: number; task: ScheduledTask }>;
  deps: Deps;
};
const autoFire = (manager: SchedulerManager, id: string) => internals(manager).fire(id, { manual: false });
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('reason stamping', () => {
  it('stamps in-flight, overlap, concurrency-cap and trigger/attempt', async () => {
    const { manager, ptys, tasks } = await makeFixture(Array.from({ length: 6 }, () => ({ catchUp: null })));
    internals(manager).live.get(tasks[0].id)!.firing = true;
    await autoFire(manager, tasks[0].id);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ result: 'skipped', reasonCode: 'in-flight', trigger: 'schedule', attempt: 1 });
    internals(manager).live.get(tasks[0].id)!.firing = false;

    await autoFire(manager, tasks[1].id);
    await autoFire(manager, tasks[1].id);
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ reasonCode: 'overlap', message: 'previous run still active' });

    for (const task of tasks.slice(2, 6)) await autoFire(manager, task.id);
    await autoFire(manager, tasks[0].id);
    expect(ptys.createCalls).toHaveLength(5);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ reasonCode: 'concurrency-cap' });
  });

  it('stamps trigger manual on Run now', async () => {
    const { manager, tasks } = await makeFixture();
    await manager.runNow(tasks[0].id);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ trigger: 'manual', attempt: 1 });
  });

  it('stamps project-missing', async () => {
    const { manager, tasks } = await makeFixture([{ projectId: 'ghost' }]);
    await autoFire(manager, tasks[0].id);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ result: 'error', reasonCode: 'project-missing' });
  });

  it('stamps launch-failed and truncates the message to 500 characters', async () => {
    const { manager, tasks } = await makeFixture([{}], { launchTerminal: (() => Promise.reject(new Error('x'.repeat(900)))) as Deps['launchTerminal'] });
    await autoFire(manager, tasks[0].id);
    const run = T(manager, tasks[0].id).status.runs[0];
    expect(run).toMatchObject({ result: 'error', launchState: 'failed', reasonCode: 'launch-failed' });
    expect(run.message).toHaveLength(500);
  });

  it('stamps exit-nonzero, no-report and leaves success unstamped', async () => {
    const { manager, ptys, tasks } = await makeFixture([{}, { inboxLevel: 'quiet' }, {}]);
    await manager.runNow(tasks[0].id);
    ptys.simulateExit(ptys.sessions[0].id, 3);
    await manager.attachReport('drain', 'x');
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ result: 'error', reasonCode: 'exit-nonzero', message: 'exit 3' });

    await manager.runNow(tasks[1].id);
    ptys.simulateExit(ptys.sessions[1].id, 0);
    await manager.attachReport('drain', 'x');
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ result: 'incomplete', reasonCode: 'no-report' });

    await manager.runNow(tasks[2].id);
    ptys.simulateExit(ptys.sessions[2].id, 0);
    await manager.attachReport('drain', 'x');
    const ok = T(manager, tasks[2].id).status.runs[0];
    expect(ok.result).toBe('success');
    expect(ok.reasonCode).toBeUndefined();
  });

  it('finishes a command that exits before its scheduler listener is attached', async () => {
    const { manager, ptys, tasks } = await makeFixture([{}], {
      launchTerminal: ((opts) => {
        const session = ptys.create(opts as unknown as Record<string, unknown>);
        ptys.simulateExit(session.id, 0);
        return session;
      }) as Deps['launchTerminal']
    });

    await manager.runNow(tasks[0].id);
    // The exit callback serializes behind the runNow launch operation.
    await manager.attachReport('drain', 'x');

    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({
      result: 'success',
      launchState: 'running',
      durationMs: expect.any(Number)
    });
  });

  it('stamps timeout and subagent-timeout', async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, tasks } = await makeFixture([{ maxDurationMinutes: 5 }, { autoCloseOnFinish: true }], { getPendingSubagentCount: () => 1 });
      await autoFire(manager, tasks[0].id);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      ptys.simulateExit(ptys.sessions[0].id, 0);
      await manager.attachReport('drain', 'x');
      expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ result: 'error', reasonCode: 'timeout' });

      await autoFire(manager, tasks[1].id);
      const sid = ptys.sessions[1].id;
      await manager.onAgentFinished(sid);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ result: 'error', reasonCode: 'subagent-timeout' });
      ptys.simulateExit(sid, 0);
      await manager.attachReport('drain', 'x');
      expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ reasonCode: 'subagent-timeout' });
    } finally { vi.useRealTimers(); }
  });

  it('stamps worker-not-started and outcome-unknown when recovering a pending launch', async () => {
    const evidence = { value: 'not-started' as 'not-started' | 'exited' };
    const { manager, tasks } = await makeFixture([{}, {}], { inspectWorkerLaunch: (async () => evidence.value) as Deps['inspectWorkerLaunch'] });
    for (const [index, task] of tasks.entries()) {
      T(manager, task.id).status.runs = [{ id: `r${index}`, at: iso(Date.now()), result: 'skipped', sessionId: `s${index}`, launchState: 'pending' }];
    }
    expect(await manager.reconcile(tasks[0].id)).toBe(true);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ result: 'skipped', reasonCode: 'worker-not-started' });
    evidence.value = 'exited';
    await manager.reconcile(tasks[1].id);
    expect(T(manager, tasks[1].id).status.runs[0]).toMatchObject({ result: 'error', reasonCode: 'outcome-unknown' });
  });
});

describe('missed-run handling', () => {
  const NOW = Date.parse('2026-07-15T14:30:00Z');
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  const HOURLY = { every: undefined, cron: '0 * * * *', tz: 'UTC' } as const;

  it('Recovery cron: one marker for the older slots, one catch-up run, lastRunAt moved only by the run', async () => {
    const { manager, ptys, tasks } = await makeFixture([HOURLY]);
    const lastRunAt = iso(NOW - 5 * HOUR);
    T(manager, tasks[0].id).status.lastRunAt = lastRunAt;
    T(manager, tasks[0].id).enabled = true;
    internals(manager).arm(tasks[0].id);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    const { runs, runCount } = T(manager, tasks[0].id).status;
    const run = runs.find(candidate => !candidate.marker)!;
    const marker = runs.find(candidate => candidate.marker)!;
    expect(marker).toMatchObject({
      result: 'skipped', reasonCode: 'missed-app-closed', missed: { count: 4, from: '2026-07-15T10:00:00.000Z', to: '2026-07-15T13:00:00.000Z' },
      resolvedBy: run.id
    });
    expect(run).toMatchObject({ trigger: 'catch-up', slotAt: '2026-07-15T14:00:00.000Z', attempt: 1 });
    expect(run.lateByMs).toBeGreaterThan(30 * 60_000);
    expect(run.lateCause).toBe('app-closed');
    expect(runCount).toBe(1);
    expect(T(manager, tasks[0].id).status.lastRunAt).toBe(run.at);
    expect(T(manager, tasks[0].id).status.slotCursorAt).toBe('2026-07-15T13:00:00.000Z');
    manager.stopAll();
  });

  it('Recovery skip: marker for every missed slot, no run, no refire loop', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ ...HOURLY, catchUp: { mode: 'skip' } }]);
    const lastRunAt = iso(NOW - 5 * HOUR);
    T(manager, tasks[0].id).status.lastRunAt = lastRunAt;
    T(manager, tasks[0].id).enabled = true;
    internals(manager).arm(tasks[0].id);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(0);
    const status = T(manager, tasks[0].id).status;
    expect(status.runs).toHaveLength(1);
    expect(status.runs[0]).toMatchObject({ marker: true, missed: { count: 5, to: '2026-07-15T14:00:00.000Z' } });
    expect(status.runCount).toBe(0);
    expect(status.lastRunAt).toBe(lastRunAt);
    expect(status.nextRunAt).toBe('2026-07-15T15:00:00.000Z');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(T(manager, tasks[0].id).status.runs).toHaveLength(1);
    manager.stopAll();
  });

  it('a single late slot runs once with lateByMs / lateCause asleep and no marker', async () => {
    vi.setSystemTime(new Date('2026-07-15T08:30:00Z'));
    const { manager, ptys, tasks } = await makeFixture([{ every: undefined, cron: '0 9 * * *', tz: 'UTC', enabled: true }]);
    vi.setSystemTime(new Date('2026-07-15T11:00:00Z')); // the machine slept across 09:00
    await autoFire(manager, tasks[0].id);
    expect(ptys.createCalls).toHaveLength(1);
    const runs = T(manager, tasks[0].id).status.runs;
    expect(runs.some(run => run.marker)).toBe(false);
    expect(runs[0]).toMatchObject({ lateCause: 'asleep', lateByMs: 2 * HOUR, slotAt: '2026-07-15T09:00:00.000Z', trigger: 'schedule' });
    manager.stopAll();
  });

  it('a timer fire hours late while running records missed-asleep', async () => {
    const { manager, tasks } = await makeFixture([{ ...HOURLY, enabled: true }]);
    vi.setSystemTime(new Date('2026-07-15T17:00:30Z'));
    await autoFire(manager, tasks[0].id);
    const marker = T(manager, tasks[0].id).status.runs.find(run => run.marker)!;
    expect(marker).toMatchObject({ reasonCode: 'missed-asleep', missed: { count: 2, from: '2026-07-15T15:00:00.000Z', to: '2026-07-15T16:00:00.000Z' } });
    manager.stopAll();
  });

  it('Classic interval 3 intervals overdue: nothing at load, then an open marker and the run at now + interval', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const lastRunAt = iso(NOW - 4 * HOUR);
    T(manager, tasks[0].id).status.lastRunAt = lastRunAt;
    T(manager, tasks[0].id).enabled = true;
    vi.mocked(saveSchedule).mockClear();
    internals(manager).arm(tasks[0].id);
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe(iso(NOW + HOUR));
    await vi.advanceTimersByTimeAsync(10_000);
    // Loading never persists (C2): the gap is only recorded when the timer fires.
    expect(ptys.createCalls).toHaveLength(0);
    expect(saveSchedule).not.toHaveBeenCalled();
    expect(T(manager, tasks[0].id).status.runs).toHaveLength(0);
    // Re-arming does not write anything either.
    internals(manager).arm(tasks[0].id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saveSchedule).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(ptys.createCalls).toHaveLength(1);
    const status = T(manager, tasks[0].id).status;
    const markers = status.runs.filter(run => run.marker);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ reasonCode: 'missed-app-closed', result: 'skipped', missed: { count: 4 } });
    expect(markers[0].resolvedBy).toBeUndefined();
    expect(status.runCount).toBe(1);
    const rows = (await manager.queryRuns({})).rows.filter(row => row.outcome === 'missed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ open: true, manualRetry: true });
    manager.stopAll();
  });

  it('Classic cron: several missed slots give a marker for the older ones and one run', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ ...HOURLY, catchUp: null }]);
    T(manager, tasks[0].id).status.lastRunAt = iso(NOW - 3 * HOUR);
    T(manager, tasks[0].id).enabled = true;
    internals(manager).arm(tasks[0].id);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    const runs = T(manager, tasks[0].id).status.runs;
    expect(runs.find(run => run.marker)).toMatchObject({ missed: { count: 2 } });
    expect(runs.find(run => !run.marker)).toMatchObject({ trigger: 'catch-up' });
    manager.stopAll();
  });

  describe('re-enabling after a pause', () => {
    const PAUSED = { every: undefined, cron: '0 9 * * 1-5', tz: 'UTC' } as const;

    it('Classic still fires the paused slot once, with no marker', async () => {
      const { manager, ptys, tasks } = await makeFixture([{ ...PAUSED, catchUp: null }]);
      T(manager, tasks[0].id).status.lastRunAt = '2026-07-14T09:00:00.000Z';
      await manager.setEnabled(tasks[0].id, true);
      expect(T(manager, tasks[0].id).status.missedFloorAt).toBeDefined();
      expect(T(manager, tasks[0].id).status.slotCursorAt).toBeUndefined();
      await vi.advanceTimersByTimeAsync(5_100);
      expect(ptys.createCalls).toHaveLength(1);
      const runs = T(manager, tasks[0].id).status.runs;
      expect(runs.some(run => run.marker)).toBe(false);
      expect(runs[0].lateByMs).toBeUndefined();
      manager.stopAll();
    });

    it('Recovery does not fire the paused slot and moves the anchor', async () => {
      const { manager, ptys, tasks } = await makeFixture([PAUSED]);
      T(manager, tasks[0].id).status.lastRunAt = '2026-07-14T09:00:00.000Z';
      await manager.setEnabled(tasks[0].id, true);
      expect(T(manager, tasks[0].id).status.slotCursorAt).toBe(iso(NOW));
      expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-16T09:00:00.000Z');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ptys.createCalls).toHaveLength(0);
      expect(T(manager, tasks[0].id).status.runs).toHaveLength(0);
      manager.stopAll();
    });
  });

  it('a cadence edit records no marker and stamps the floor', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: true }]);
    T(manager, tasks[0].id).status.lastRunAt = iso(NOW - 30 * 60_000);
    await manager.update(tasks[0].id, { every: '2h' });
    const status = T(manager, tasks[0].id).status;
    expect(status.missedFloorAt).toBe(iso(NOW));
    expect(status.slotCursorAt).toBe(iso(NOW));
    expect(status.nextRunAt).toBe(iso(NOW + 2 * HOUR));
    expect(status.runs).toHaveLength(0);
    manager.stopAll();
  });

  it('an external cadence change seen at reload stamps the floor and persists it', async () => {
    const { manager, tasks } = await makeFixture([{ enabled: true }]);
    const live = internals(manager).live.get(tasks[0].id)!;
    vi.mocked(saveSchedule).mockClear();
    const edited = structuredClone(live.task);
    edited.schedule = { every: '3h' };
    await (manager as unknown as { replaceDefinition: (l: unknown, t: ScheduledTask) => Promise<void> }).replaceDefinition(live, edited);
    expect(T(manager, tasks[0].id).status.missedFloorAt).toBe(iso(NOW));
    expect(saveSchedule).toHaveBeenCalled();
    manager.stopAll();
  });

  it('the cadence-changed early return in fire stamps the floor without a marker', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ enabled: true }]);
    const { readSchedule } = await import('./scheduler-store.js');
    vi.mocked(readSchedule).mockImplementationOnce((task) => ({ ...structuredClone(task), schedule: { every: '2h' } }));
    await autoFire(manager, tasks[0].id);
    expect(ptys.createCalls).toHaveLength(0);
    expect(T(manager, tasks[0].id).status.missedFloorAt).toBeDefined();
    expect(T(manager, tasks[0].id).status.runs).toHaveLength(0);
    manager.stopAll();
  });
});

describe('create and update', () => {
  it('defaults new schedules to Recovery once; null keeps Classic', async () => {
    const { manager, tasks } = await makeFixture([{}, { catchUp: null }, { catchUp: { mode: 'all', max: 99 } }, { retry: { attempts: 9, delayMinutes: 0 } }]);
    expect(tasks[0].catchUp).toEqual({ mode: 'once' });
    expect(tasks[1].catchUp).toBeUndefined();
    expect(tasks[2].catchUp).toEqual({ mode: 'all', max: 10 });
    expect(tasks[3].retry).toEqual({ attempts: 5, delayMinutes: 1 });
    expect(T(manager, tasks[0].id).retry).toBeUndefined();
  });

  it('update sets and clears catchUp and retry', async () => {
    const { manager, tasks } = await makeFixture();
    let next = await manager.update(tasks[0].id, { catchUp: { mode: 'skip' }, retry: { attempts: 2, delayMinutes: 10 } });
    expect(next.catchUp).toEqual({ mode: 'skip' });
    expect(next.retry).toEqual({ attempts: 2, delayMinutes: 10 });
    next = await manager.update(tasks[0].id, { catchUp: null, retry: null });
    expect(next.catchUp).toBeUndefined();
    expect(next.retry).toBeUndefined();
    next = await manager.update(tasks[0].id, { catchUp: { mode: 'bogus' } as never });
    expect(next.catchUp).toBeUndefined();
  });
});

describe('resolution (D8)', () => {
  it('a finished success closes earlier open problems of the same schedule', async () => {
    const { manager, ptys, tasks } = await makeFixture();
    await manager.runNow(tasks[0].id);
    ptys.simulateExit(ptys.sessions[0].id, 1);
    await manager.attachReport('drain', 'x');
    expect((await manager.queryRuns({})).rows).toHaveLength(1);
    await manager.runNow(tasks[0].id);
    ptys.simulateExit(ptys.sessions[1].id, 0);
    await manager.attachReport('drain', 'x');
    const runs = T(manager, tasks[0].id).status.runs;
    const success = runs.find(run => run.result === 'success')!;
    expect(runs.find(run => run.result === 'error')!.resolvedBy).toBe(success.id);
    expect((await manager.queryRuns({})).rows).toHaveLength(0);
  });
});

describe('trimRuns', () => {
  const run = (id: string, extra: Partial<ScheduleRun> = {}): ScheduleRun => ({ id, at: iso(Date.now()), result: 'success', ...extra });
  const bad = (id: string, extra: Partial<ScheduleRun> = {}) => run(id, { result: 'error', reasonCode: 'exit-nonzero', ...extra });

  it('keeps the newest retain entries and up to 20 older open problems', () => {
    const runs = [run('a'), run('b'), run('c'), ...Array.from({ length: 25 }, (_, i) => bad(`e${i}`)), run('ok')];
    const kept = trimRuns(runs, 2, Date.now());
    expect(kept.map(r => r.id)).toEqual(['a', 'b', ...Array.from({ length: 20 }, (_, i) => `e${i}`)]);
  });

  it('drops resolved, dismissed and aged problems; never evicts pending', () => {
    const old = bad('old', { at: iso(Date.now() - 8 * 24 * HOUR) });
    const runs = [run('a'), bad('resolved', { resolvedBy: 'x' }), bad('dismissed', { dismissedAt: iso(Date.now()) }), old,
      run('pending', { result: 'skipped', launchState: 'pending' })];
    expect(trimRuns(runs, 1, Date.now()).map(r => r.id)).toEqual(['a', 'pending']);
  });

  it('hard-caps finished records at 100 and never evicts pending reservations', () => {
    const runs = [...Array.from({ length: 120 }, (_, i) => run(`r${i}`)), run('p', { result: 'skipped', launchState: 'pending' })];
    const kept = trimRuns(runs, 120, Date.now());
    // Unresolved records sit outside the history cap; the loader bounds them.
    expect(kept.filter(r => r.launchState !== 'pending')).toHaveLength(100);
    expect(kept.some(r => r.id === 'p')).toBe(true);
  });

  it('keeps every record the caller marks unresolved (a live Squad run)', () => {
    const live = run('squad', { result: 'success', launchState: 'running' });
    const runs = [...Array.from({ length: 5 }, (_, i) => run(`r${i}`)), live];
    const kept = trimRuns(runs, 2, Date.now(), r => r.id === 'squad');
    expect(kept.map(r => r.id)).toEqual(['r0', 'r1', 'squad']);
  });

  it('is applied by recordRun so retained problems survive newer runs', async () => {
    const { manager, tasks } = await makeFixture([{ retain: 1 }]);
    const live = internals(manager).live.get(tasks[0].id)!;
    live.task.status.runs = [bad('keep')];
    await manager.runNow(tasks[0].id);
    expect(T(manager, tasks[0].id).status.runs.map(r => r.id)).toContain('keep');
    expect(T(manager, tasks[0].id).status.runs).toHaveLength(2);
  });
});

describe('queryRuns / dismissRuns / retryRuns', () => {
  async function failedRun() {
    const fixture = await makeFixture([{}, {}]);
    const { manager, ptys, tasks } = fixture;
    await manager.runNow(tasks[0].id);
    ptys.simulateExit(ptys.sessions[0].id, 2);
    await manager.attachReport('drain', 'x');
    const run = T(manager, tasks[0].id).status.runs[0];
    return { ...fixture, run };
  }

  it('queries open problems and dismisses them', async () => {
    const { manager, tasks, run } = await failedRun();
    const open = await manager.queryRuns({ state: 'open' });
    expect(open.rows.map(row => [row.scheduleId, row.run.id, row.reason])).toEqual([[tasks[0].id, run.id, 'exit-nonzero']]);
    expect((await manager.queryRuns(undefined)).total).toBe(1);
    expect(await manager.dismissRuns([{ scheduleId: tasks[0].id, runId: run.id! }, { scheduleId: 'nope', runId: 'x' }, { scheduleId: tasks[0].id, runId: 'nope' }])).toBe(1);
    expect(await manager.dismissRuns([{ scheduleId: tasks[0].id, runId: run.id! }])).toBe(0);
    expect((await manager.queryRuns({})).rows).toHaveLength(0);
    expect((await manager.queryRuns({ state: 'all' })).rows[0].run.dismissedAt).toBeDefined();
  });

  it('dismissRuns refuses more than 200 refs and skips malformed ones and external schedules', async () => {
    const { manager, tasks, run } = await failedRun();
    await expect(manager.dismissRuns(Array.from({ length: 201 }, () => ({ scheduleId: 'a', runId: 'b' })))).rejects.toThrow(/at most 200/);
    internals(manager).live.get(tasks[0].id)!.task.external = { kind: 'claude-loop', cron: '* * * * *' };
    expect(await manager.dismissRuns([null as never, { scheduleId: tasks[0].id, runId: run.id! }])).toBe(0);
  });

  it('retries a failed run as the next attempt of its chain', async () => {
    const { manager, ptys, tasks, run } = await failedRun();
    const [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: run.id! }]);
    expect(result).toMatchObject({ ok: true, status: 'started' });
    expect(ptys.createCalls).toHaveLength(2);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ trigger: 'retry', attempt: 2, retryOf: run.id });
    // A retry of the retry stays in the same chain.
    ptys.simulateExit(ptys.sessions[1].id, 2);
    await manager.attachReport('drain', 'x');
    const second = T(manager, tasks[0].id).status.runs[0];
    await manager.retryRuns([{ scheduleId: tasks[0].id, runId: second.id! }]);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ attempt: 3, retryOf: run.id });
  });

  it('retries a missed marker as a catch-up with its slot', async () => {
    const { manager, tasks } = await makeFixture([{ catchUp: { mode: 'skip' }, enabled: true }]);
    const marker: ScheduleRun = { id: 'm1', at: iso(Date.now()), result: 'skipped', marker: true, reasonCode: 'missed-asleep',
      missed: { count: 2, from: '2026-07-15T08:00:00.000Z', to: '2026-07-15T09:00:00.000Z' } };
    T(manager, tasks[0].id).status.runs = [marker];
    const [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'm1' }]);
    expect(result.ok).toBe(true);
    expect(T(manager, tasks[0].id).status.runs[0]).toMatchObject({ trigger: 'catch-up', retryOf: 'm1', attempt: 2, slotAt: '2026-07-15T09:00:00.000Z' });
    manager.stopAll();
  });

  it('rejects unknown, external, pending, non-problem and non-retryable refs', async () => {
    const { manager, tasks } = await makeFixture([{}, {}]);
    const live = internals(manager).live;
    live.get(tasks[0].id)!.task.status.runs = [
      { id: 'ok', at: iso(Date.now()), result: 'success' },
      { id: 'pend', at: iso(Date.now()), result: 'skipped', launchState: 'pending' },
      { id: 'gone', at: iso(Date.now()), result: 'error', reasonCode: 'project-missing' },
      { id: 'cap', at: iso(Date.now()), result: 'skipped', reasonCode: 'concurrency-cap' }
    ];
    live.get(tasks[1].id)!.task.external = { kind: 'claude-loop', cron: '* * * * *' };
    const results = await manager.retryRuns([
      { scheduleId: 'nope', runId: 'ok' },
      { scheduleId: tasks[1].id, runId: 'x' },
      { scheduleId: tasks[0].id, runId: 'missing' },
      { scheduleId: tasks[0].id, runId: 'pend' },
      { scheduleId: tasks[0].id, runId: 'ok' },
      { scheduleId: tasks[0].id, runId: 'gone' }
    ]);
    expect(results.map(r => [r.ok, r.error])).toEqual([
      [false, 'schedule not found'],
      [false, 'external schedules cannot be retried here'],
      [false, 'run not found'],
      [false, 'run is still launching'],
      [false, 'run cannot be retried'],
      [false, 'run cannot be retried']
    ]);
    await expect(manager.retryRuns([])).rejects.toThrow(/1-50/);
    await expect(manager.retryRuns(Array.from({ length: 51 }, () => ({ scheduleId: 'a', runId: 'b' })))).rejects.toThrow(/1-50/);
  });

  it('queues a retry while the schedule still has a live run', async () => {
    const { manager, tasks } = await makeFixture();
    T(manager, tasks[0].id).status.runs = [{ id: 'cap', at: iso(Date.now()), result: 'skipped', reasonCode: 'concurrency-cap' }];
    await manager.runNow(tasks[0].id); // a live run makes the retry overlap
    T(manager, tasks[0].id).status.runs.push({ id: 'cap2', at: iso(Date.now()), result: 'skipped', reasonCode: 'concurrency-cap' });
    const [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'cap2' }]);
    expect(result).toMatchObject({ ok: true, status: 'queued' });
  });

  it('turns a thrown launch error into a per-ref failure', async () => {
    const { manager, tasks } = await makeFixture();
    T(manager, tasks[0].id).status.runs = [{ id: 'e', at: iso(Date.now()), result: 'error', reasonCode: 'exit-nonzero' }];
    internals(manager).deps.launchTerminal = (() => { throw new Error('spawn failed'); }) as Deps['launchTerminal'];
    let [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'e' }]);
    expect(result).toMatchObject({ ok: false, error: "Couldn't start" });
    internals(manager).deps.launchTerminal = (() => { throw new LaunchSpawnError('LAUNCH_UNCONFIRMED', 'unconfirmed'); }) as Deps['launchTerminal'];
    [result] = await manager.retryRuns([{ scheduleId: tasks[0].id, runId: 'e' }]);
    expect(result).toMatchObject({ ok: false, error: 'unconfirmed' });
  });
});

describe('loading never writes (design 9.3)', () => {
  it('loading a directory of Classic files persists nothing', async () => {
    const { manager, project } = await makeFixture([]);
    const now = Date.now();
    const classic = (id: string, extra: Partial<ScheduledTask>): ScheduledTask => ({
      id, name: id, enabled: true, projectId: 'proj-1', profile: 'claude', prompt: 'p', schedule: { every: '1h' }, overlap: 'skip',
      history: { retain: 10 }, status: { runCount: 1, runs: [{ id: `${id}-r`, at: iso(now - 10 * 60_000), result: 'success' }], lastRunAt: iso(now - 10 * 60_000), lastRunResult: 'success' },
      createdAt: iso(now), updatedAt: iso(now), source: 'global', ...extra
    } as ScheduledTask);
    vi.mocked(listAllSchedules).mockReturnValueOnce([
      classic('a', {}),
      classic('b', { enabled: false }),
      classic('c', { schedule: { cron: '0 9 * * *', tz: 'UTC' } })
    ]);
    vi.mocked(saveSchedule).mockClear();
    await manager.loadAll([project]);
    expect(manager.list()).toHaveLength(3);
    expect(saveSchedule).not.toHaveBeenCalled();
    manager.stopAll();
  });
});
