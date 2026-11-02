import { describe, it, expect, vi } from 'vitest';

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
import { lastRunSkipped } from '@zana-ai/zcc-domain/schedule-skipped';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project, ScheduleCreateInput, ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';

class FakePtys extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  sessions: Array<{ id: string; projectId: string; title: string; profile: string; cwd: string; status: 'running' | 'exited'; exitCode?: number; createdAt: number }> = [];
  closeExpectedCalls: string[] = [];
  list(projectId: string) { return this.sessions.filter(s => s.projectId === projectId); }
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
  fire: (id: string, opts: Record<string, unknown>) => Promise<void>;
  recordRun: (id: string, run: ScheduleRun, options?: Record<string, unknown>) => Promise<void>;
  live: Map<string, { targetAt?: number; task: ScheduledTask }>;
};
const autoFire = (manager: SchedulerManager, id: string) => internals(manager).fire(id, { manual: false });
const runs = (manager: SchedulerManager, id: string) => T(manager, id).status.runs;
const liveRow = (manager: SchedulerManager, id: string, sessionId: string) => runs(manager, id).find(run => run.sessionId === sessionId);
const skipRows = (manager: SchedulerManager, id: string) => runs(manager, id).filter(run => run.reasonCode === 'overlap');

// Acceptance tests for #586: an overlap skip is its own history row and never overwrites the live run's row.
describe('overlap skip row (#586)', () => {
  it('REQ-5: records the skip as its own row, counts it, and keeps the live row id, at and sessionId', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const before = { ...liveRow(manager, id, sessionId)! };
    expect(T(manager, id).status.runCount).toBe(1);

    await autoFire(manager, id);

    expect(ptys.createCalls).toHaveLength(1);
    expect(T(manager, id).status.runCount).toBe(2);
    expect(runs(manager, id)).toHaveLength(2);
    const live = liveRow(manager, id, sessionId)!;
    expect(live).toMatchObject({ id: before.id, at: before.at, sessionId });
    expect(live.result).not.toBe('skipped');
    const [skip] = skipRows(manager, id);
    expect(skip).toMatchObject({ result: 'skipped', message: 'previous run still active' });
    expect(skip.id).not.toBe(before.id);
    expect(skip.sessionId).toBeUndefined();
  });

  it('REQ-6: finalises the live row when its session exits and keeps the skip row', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const liveId = liveRow(manager, id, sessionId)!.id;
    await autoFire(manager, id);

    ptys.simulateExit(sessionId, 0);
    await manager.attachReport('drain', 'x');

    const live = liveRow(manager, id, sessionId)!;
    expect(live.id).toBe(liveId);
    expect(live.result).not.toBe('skipped');
    expect(live.durationMs).toBeTypeOf('number');
    expect(skipRows(manager, id)).toHaveLength(1);
    expect(T(manager, id).status.runCount).toBe(2);
  });

  it('REQ-7: recordRun never merges a record that has an id into a row with a different id', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const before = { ...liveRow(manager, id, sessionId)! };

    await internals(manager).recordRun(id, {
      id: 'foreign-run-id', at: new Date().toISOString(), result: 'skipped', sessionId, reasonCode: 'overlap', trigger: 'schedule', message: 'previous run still active'
    });

    const live = runs(manager, id).find(run => run.id === before.id)!;
    expect(live).toMatchObject({ at: before.at, sessionId, result: before.result });
    expect(live.reasonCode).toBeUndefined();
    expect(runs(manager, id).find(run => run.id === 'foreign-run-id')).toBeDefined();
    expect(runs(manager, id)).toHaveLength(2);
  });

  it('REQ-7: a record without an id still finds its row by sessionId', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    await internals(manager).recordRun(id, { at: new Date().toISOString(), result: 'success', sessionId, durationMs: 5 });
    expect(runs(manager, id)).toHaveLength(1);
    expect(runs(manager, id)[0]).toMatchObject({ sessionId, durationMs: 5 });
  });

  it('REQ-9: the live row keeps its sessionId and stays open while the skip row has none', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    await autoFire(manager, id);

    const live = liveRow(manager, id, sessionId)!;
    expect(live).toBeDefined();
    expect(live.finishedAt).toBeUndefined();
    expect(live.durationMs).toBeUndefined();
    const [skip] = skipRows(manager, id);
    expect(skip.sessionId).toBeUndefined();
    expect(skip.finishedAt).toBeUndefined();
  });

  it('REQ-15: the skip row uses only keys an overlap skip already had (no new ScheduleRun field; regression guard)', async () => {
    const { manager, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    await autoFire(manager, id);
    const allowed = new Set(['id', 'at', 'result', 'sessionId', 'launchKind', 'reasonCode', 'trigger', 'attempt', 'slotAt', 'message']);
    const [skip] = skipRows(manager, id);
    expect(Object.keys(skip).filter(key => !allowed.has(key))).toEqual([]);
  });

  it('REQ-16: with history.retain 1, two overlap skips leave the live row and a third fire is still an overlap', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 1 }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const liveId = liveRow(manager, id, sessionId)!.id;

    await autoFire(manager, id);
    await autoFire(manager, id);

    expect(liveRow(manager, id, sessionId)?.id).toBe(liveId);
    expect(ptys.createCalls).toHaveLength(1);
    expect(skipRows(manager, id).length).toBeGreaterThanOrEqual(1);
    expect(T(manager, id).status.runCount).toBe(3);
    // The live run's exit is still recorded on its own row rather than dropped.
    ptys.simulateExit(sessionId, 0);
    await manager.attachReport('drain', 'x');
    expect(liveRow(manager, id, sessionId)?.durationMs).toBeTypeOf('number');
  });
});

// Acceptance tests for #586 / #575: the Skipped last run pill must keep working for new and legacy overlap rows.
describe('Skipped last run pill for overlap rows (#586)', () => {
  const enabled = (task: ScheduledTask, runsOverride?: ScheduleRun[]): ScheduledTask => ({
    ...task, enabled: true, status: { ...task.status, ...(runsOverride ? { runs: runsOverride } : {}) }
  });

  it('REQ-8: a new overlap row shows the due time from its slotAt', async () => {
    const { manager, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    const due = Date.now() - 10 * 60_000;
    internals(manager).live.get(id)!.targetAt = due;
    await autoFire(manager, id);
    await autoFire(manager, id);

    const [skip] = skipRows(manager, id);
    expect(skip.slotAt).toBe(new Date(due).toISOString());
    expect(skip.sessionId).toBeUndefined();
    expect(lastRunSkipped(enabled(T(manager, id)), Date.now())).toEqual({ slotAt: new Date(due).toISOString(), reason: 'overlap' });
  });

  it('REQ-8: a row merged by an older version (skip fields on the live run\'s sessionId) still shows its due time', () => {
    const liveStart = Date.now() - 2 * 3_600_000;
    const skipAt = Date.now() - 5 * 60_000;
    const legacy: ScheduleRun = {
      id: 'live-run', at: new Date(skipAt).toISOString(), result: 'skipped', sessionId: 'sess-live', reasonCode: 'overlap',
      trigger: 'schedule', slotAt: new Date(liveStart).toISOString(), message: 'previous run still active'
    };
    const task = { id: 't', name: 't', projectId: 'p', enabled: true, schedule: { every: '1h' }, status: { runs: [legacy], runCount: 1 } } as unknown as ScheduledTask;
    expect(lastRunSkipped(task, Date.now())).toEqual({ slotAt: new Date(skipAt).toISOString(), reason: 'overlap' });
  });
});
