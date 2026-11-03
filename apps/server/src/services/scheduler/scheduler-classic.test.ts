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
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project, ScheduleCreateInput } from '@zana-ai/zcc-domain/product';

/**
 * Classic characterization (design 6.0 / 9.1). These pin the arm/fire timing of
 * schedules WITHOUT `catchUp`, captured against the code before self-healing.
 * Never change an existing expected time here; only add assertions.
 */

class FakePtys extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  sessions: Array<{ id: string; projectId: string; title: string; profile: string; cwd: string; status: 'running' | 'exited'; createdAt: number }> = [];
  list(projectId: string) { return this.sessions.filter(s => s.projectId === projectId); }
  reapDeadSessions() { return []; }
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
    const session = {
      id: opts.preallocatedSessionId as string,
      projectId: opts.projectId as string,
      title: 'x',
      profile: opts.profile as string,
      cwd: opts.cwd as string,
      status: 'running' as const,
      createdAt: Date.now()
    };
    this.sessions.push(session);
    return session;
  }
  write() { /* no-op */ }
  closeExpected() { return true; }
}

async function makeManager(inputs: Array<Partial<ScheduleCreateInput>> = [{}]) {
  const ptys = new FakePtys();
  const project: Project = { id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 };
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: { listProjects: () => [project], getConfig: () => ({}) } as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
  });
  const tasks = [];
  for (const [index, input] of inputs.entries()) {
    tasks.push(await manager.create({
      name: `t${index}`, projectId: 'proj-1', profile: 'claude', every: '1h', enabled: false, prompt: 'work', catchUp: null, ...input
    }));
  }
  return { manager, ptys, tasks };
}

const T = (manager: SchedulerManager, id: string) => manager.list().find(task => task.id === id)!;
const arm = (manager: SchedulerManager, id: string) => (manager as unknown as { arm: (id: string) => void }).arm(id);
const HOUR = 3_600_000;
const NOW = '2026-07-15T14:00:00Z';
const CRON = { every: undefined, cron: '0 9 * * 1-5', tz: 'UTC' } as const;

/** Mark the stored task enabled with a persisted lastRunAt, then arm it (as loadAll does). */
function armWith(manager: SchedulerManager, id: string, lastRunAt: string | undefined) {
  const task = T(manager, id);
  task.status.lastRunAt = lastRunAt;
  task.enabled = true;
  arm(manager, id);
}

describe('Classic timing characterization', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('1. cron never run: first slot after now, fires exactly then', async () => {
    vi.setSystemTime(new Date('2026-07-15T08:00:00Z'));
    const { manager, ptys, tasks } = await makeManager([{ ...CRON, enabled: true }]);
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T09:00:00.000Z');
    await vi.advanceTimersByTimeAsync(HOUR - 1_000);
    expect(ptys.createCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-16T09:00:00.000Z');
    manager.stopAll();
  });

  it('2. cron, last run yesterday: one catch-up 5 s after arm, then the next slot', async () => {
    const { manager, ptys, tasks } = await makeManager([CRON]);
    armWith(manager, tasks[0].id, '2026-07-14T09:00:00.000Z');
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T14:00:05.000Z');
    await vi.advanceTimersByTimeAsync(4_900);
    expect(ptys.createCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, tasks[0].id).status.runs).toHaveLength(1);
    expect(T(manager, tasks[0].id).status.runCount).toBe(1);
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-16T09:00:00.000Z');
    manager.stopAll();
  });

  it('3. interval 0.5 intervals overdue: fires after the 5 s grace floor', async () => {
    const { manager, ptys, tasks } = await makeManager();
    armWith(manager, tasks[0].id, new Date(Date.parse(NOW) - 1.5 * HOUR).toISOString());
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T14:00:05.000Z');
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('4. interval 1.5 intervals overdue (2.5 since last run): re-armed fresh at now + interval', async () => {
    const { manager, ptys, tasks } = await makeManager();
    armWith(manager, tasks[0].id, new Date(Date.parse(NOW) - 2.5 * HOUR).toISOString());
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T15:00:00.000Z');
    await vi.advanceTimersByTimeAsync(HOUR - 1_000);
    expect(ptys.createCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('4b. interval just under 2 intervals since last run is not stale', async () => {
    const { manager, ptys, tasks } = await makeManager();
    armWith(manager, tasks[0].id, new Date(Date.parse(NOW) - 1.9 * HOUR).toISOString());
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T14:00:05.000Z');
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });

  it('5. interval 3 intervals overdue: no run now, next = now + interval', async () => {
    const { manager, ptys, tasks } = await makeManager();
    armWith(manager, tasks[0].id, new Date(Date.parse(NOW) - 4 * HOUR).toISOString());
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T15:00:00.000Z');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ptys.createCalls).toHaveLength(0);
    // The gap is now recorded as a marker, which is not a fire.
    expect(T(manager, tasks[0].id).status.runs.filter(run => !run.marker)).toHaveLength(0);
    expect(T(manager, tasks[0].id).status.runCount).toBe(0);
    expect(T(manager, tasks[0].id).status.lastRunAt).toBe(new Date(Date.parse(NOW) - 4 * HOUR).toISOString());
    manager.stopAll();
  });

  it('6. cron re-enabled after a pause spanning a slot: fires after 5 s', async () => {
    const { manager, ptys, tasks } = await makeManager([CRON]);
    T(manager, tasks[0].id).status.lastRunAt = '2026-07-14T09:00:00.000Z';
    await manager.setEnabled(tasks[0].id, true);
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T14:00:05.000Z');
    await vi.advanceTimersByTimeAsync(5_100);
    expect(ptys.createCalls).toHaveLength(1);
    // The paused slot is simply run: no missed marker, no late chip.
    expect(T(manager, tasks[0].id).status.runs.filter(run => run.marker || run.lateCause)).toHaveLength(0);
    manager.stopAll();
  });

  it('7. cadence edit re-times from lastRunAt', async () => {
    const { manager, tasks } = await makeManager([{ enabled: true }]);
    T(manager, tasks[0].id).status.lastRunAt = new Date(Date.parse(NOW) - 0.5 * HOUR).toISOString();
    await manager.update(tasks[0].id, { every: '2h' });
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T15:30:00.000Z');
    await manager.update(tasks[0].id, { every: undefined, cron: '0 18 * * *', tz: 'UTC' });
    expect(T(manager, tasks[0].id).status.nextRunAt).toBe('2026-07-15T18:00:00.000Z');
    manager.stopAll();
  });

  it('8. six coincident fires at the default limit: five run, one skipped concurrency-cap', async () => {
    const { manager, ptys, tasks } = await makeManager(Array.from({ length: 6 }, () => ({ every: '5m', enabled: true })));
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 500);
    expect(ptys.createCalls).toHaveLength(5);
    const skipped = tasks.flatMap(task => T(manager, task.id).status.runs).filter(run => run.result === 'skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].message).toMatch(/^concurrency-cap: 5\/5/);
    manager.stopAll();
  });

  it('9. history.retain is respected in Recent runs', async () => {
    const { manager, ptys, tasks } = await makeManager([{ retain: 2 }]);
    for (let i = 0; i < 4; i += 1) {
      await manager.runNow(tasks[0].id);
      // A run whose tab is still open keeps its row beyond retain, so close each one.
      for (const session of ptys.sessions) session.status = 'exited';
    }
    expect(T(manager, tasks[0].id).status.runs).toHaveLength(2);
    expect(T(manager, tasks[0].id).status.runCount).toBe(4);
  });
});
