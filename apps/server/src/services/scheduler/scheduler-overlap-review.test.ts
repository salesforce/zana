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

// Review round 1 fixes for #586: the overlap guard's live session and a run's outcome must survive newer overlap rows.
describe('overlap rows and history retention (#586 review)', () => {
  it('F1/A1: a finished-but-open session stays in history, so a third fire is still an overlap skip', async () => {
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

  it('A2: Stop hook then exit with retain 1 and an overlap skip keeps the run\'s finished row', async () => {
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

  it('A3: overlap skip rows do not push the last real run out of history after it ends', async () => {
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
});
