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

import { lastRunSkipped } from '@zana-ai/zcc-domain/schedule-skipped';
import type { ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';
import { makeFixture, T, internals, autoFire, runs, liveRow, skipRows } from './overlap-fixture.test-support.js';

describe('overlap skip history row', () => {
  it('fake PTY remembered-session lookup returns its session or null', async () => {
    const { ptys, tasks } = await makeFixture();
    const session = ptys.create({
      preallocatedSessionId: 'remembered', projectId: tasks[0].projectId, profile: 'claude', cwd: '/tmp/proj'
    });

    expect(ptys.getRememberedSession(session.id)).toBe(session);
    expect(ptys.getRememberedSession('missing')).toBeNull();
  });

  it('records the skip as its own row, counts it, and keeps the live row id, at and sessionId', async () => {
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

  it('finalises the live row when its session exits and keeps the skip row', async () => {
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

  it('recordRun never merges a record that has an id into a row with a different id', async () => {
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

  it('a record without an id still finds its row by sessionId', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    await internals(manager).recordRun(id, { at: new Date().toISOString(), result: 'success', sessionId, durationMs: 5 });
    expect(runs(manager, id)).toHaveLength(1);
    expect(runs(manager, id)[0]).toMatchObject({ sessionId, durationMs: 5 });
  });

  it('the live row keeps its sessionId and stays open while the skip row has none', async () => {
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

  it('the skip row uses only keys an overlap skip already had (no new ScheduleRun field)', async () => {
    const { manager, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    await autoFire(manager, id);
    const allowed = new Set(['id', 'at', 'result', 'sessionId', 'launchKind', 'reasonCode', 'trigger', 'attempt', 'slotAt', 'message']);
    const [skip] = skipRows(manager, id);
    expect(Object.keys(skip).filter(key => !allowed.has(key))).toEqual([]);
  });

  it('with history.retain 1, two overlap skips leave the live row and a third fire is still an overlap', async () => {
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

describe('Skipped last run pill for overlap rows', () => {
  const enabled = (task: ScheduledTask, runsOverride?: ScheduleRun[]): ScheduledTask => ({
    ...task, enabled: true, status: { ...task.status, ...(runsOverride ? { runs: runsOverride } : {}) }
  });

  it('a new overlap row shows the due time from its slotAt', async () => {
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

  it('a row merged by an older version (skip fields on the live run\'s sessionId) still shows its due time', () => {
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

describe('overlap rows and history retention', () => {
  it('a finished-but-open session stays in history, so a third fire is still an overlap skip', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 1, autoCloseOnFinish: false }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    await manager.onAgentFinished(sessionId); // Stop hook: finishedAt and durationMs set, tab stays open
    expect(liveRow(manager, id, sessionId)?.finishedAt).toBeTruthy();
    await autoFire(manager, id);
    await autoFire(manager, id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(liveRow(manager, id, sessionId)).toBeDefined();
  });

  it('Stop hook then exit with retain 1 and an overlap skip keeps the run\'s finished row', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 1 }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const liveId = liveRow(manager, id, sessionId)!.id;
    await autoFire(manager, id);
    await manager.onAgentFinished(sessionId);
    ptys.simulateExit(sessionId, 0);
    await manager.attachReport('drain', 'x');
    const row = runs(manager, id).find(run => run.id === liveId);
    expect(row).toBeDefined();
    expect(row?.durationMs).toBeTypeOf('number');
  });

  it('overlap skip rows do not push the last real run out of history after it ends', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 2 }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const liveId = liveRow(manager, id, sessionId)!.id;
    for (let i = 0; i < 4; i++) await autoFire(manager, id);
    ptys.simulateExit(sessionId, 0);
    await manager.attachReport('drain', 'x');
    // The next write (another skip) must not trim the finished run either.
    await internals(manager).recordRun(id, { id: 'later-skip', at: new Date().toISOString(), result: 'skipped', reasonCode: 'overlap', trigger: 'schedule', attempt: 1 });
    expect(runs(manager, id).some(run => run.id === liveId && run.result !== 'skipped')).toBe(true);
  });

  it('an overlap skip leaves lastRunSessionId on the live run, and a later non-overlap run still replaces it', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    expect(T(manager, id).status.lastRunSessionId).toBe(sessionId);
    await autoFire(manager, id);
    expect(runs(manager, id).filter(run => run.reasonCode === 'overlap')).toHaveLength(1);
    expect(T(manager, id).status.lastRunSessionId).toBe(sessionId);
    expect(T(manager, id).status.lastRunResult).toBe('skipped');
    // Another kind of record still sets the field as before.
    await internals(manager).recordRun(id, { id: 'other', at: new Date().toISOString(), result: 'success', sessionId: 'other-session', trigger: 'schedule', attempt: 1 });
    expect(T(manager, id).status.lastRunSessionId).toBe('other-session');
  });

  it('a row merged by an older version (skipped, overlap, live session) is kept, so no duplicate is launched', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 1 }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    // Rewrite the live row the way an older Zana left it: the overlap skip spread over it.
    const live = internals(manager).live.get(id)!;
    live.task.status.runs[0] = { ...live.task.status.runs[0], result: 'skipped', reasonCode: 'overlap', message: 'previous run still active' };
    await autoFire(manager, id);
    await autoFire(manager, id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(runs(manager, id).some(run => run.sessionId === sessionId)).toBe(true);
  });

  it('the row a write closes survives that write while a newer real run is the newest', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 1 }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const sessionId = ptys.sessions[0].id;
    const liveId = runs(manager, id).find(run => run.sessionId === sessionId)!.id;
    // A newer real run (a second, already-finished session) sits ahead of the live row, which is still open.
    const live = internals(manager).live.get(id)!;
    live.task.status.runs = [
      { id: 'newer', at: new Date(Date.now() + 1000).toISOString(), result: 'success', durationMs: 1, sessionId: 'gone', trigger: 'schedule', attempt: 1 },
      ...live.task.status.runs
    ];
    // The live session exits: its row is the one this write closes, so it must survive although retain is 1.
    ptys.simulateExit(sessionId, 0);
    await manager.attachReport('drain', 'x');
    expect(runs(manager, id).find(run => run.id === liveId)?.durationMs).toBeTypeOf('number');
  });

  it('an overlap skip points lastRunSessionId at the session that holds the slot, not at an exited manual run', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null }]);
    const id = tasks[0].id;
    await autoFire(manager, id);
    const scheduled = ptys.sessions[0].id;
    await internals(manager).fire(id, { manual: true });
    const manual = ptys.sessions[1].id;
    ptys.simulateExit(manual, 0);
    await manager.attachReport('drain', 'x');
    await autoFire(manager, id);
    expect(T(manager, id).status.lastRunSessionId).toBe(scheduled);
  });

  it('keeps every row with a live session, so an older manual run still records its exit at retain 1', async () => {
    const { manager, ptys, tasks } = await makeFixture([{ catchUp: null, retain: 1 }]);
    const id = tasks[0].id;
    await internals(manager).fire(id, { manual: true });
    const manual = ptys.sessions[0].id;
    const manualId = liveRow(manager, id, manual)!.id;
    // A scheduled run is open beside the manual one (two live sessions); the newer row must not evict the older.
    ptys.sessions.push({ id: 'scheduled-session', projectId: 'proj-1', title: 'x', profile: 'claude', cwd: '/tmp/proj', status: 'running', createdAt: Date.now() });
    await internals(manager).recordRun(id, { id: 'scheduled-row', at: new Date(Date.now() + 1000).toISOString(), result: 'success', sessionId: 'scheduled-session', trigger: 'schedule', attempt: 1 });
    expect(runs(manager, id).some(run => run.id === manualId)).toBe(true);

    ptys.simulateExit(manual, 0);
    await manager.attachReport('drain', 'x');

    expect(runs(manager, id).find(run => run.id === manualId)?.durationMs).toBeTypeOf('number');
  });
});
