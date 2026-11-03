// Shared fake ptys and helpers for the overlap history tests. Each test file keeps its own vi.mock calls.
import { EventEmitter } from 'node:events';
import { SchedulerManager } from './scheduler.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project, ScheduleCreateInput, ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';

export class FakePtys extends EventEmitter {
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

export type Deps = Parameters<SchedulerManager['setDeps']>[0];

export async function makeFixture(inputs: Array<Partial<ScheduleCreateInput>> = [{}], extra: Partial<Deps> = {}) {
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

export const T = (manager: SchedulerManager, id: string) => manager.list().find(task => task.id === id)!;
export const internals = (manager: SchedulerManager) => manager as unknown as {
  fire: (id: string, opts: Record<string, unknown>) => Promise<void>;
  recordRun: (id: string, run: ScheduleRun, options?: Record<string, unknown>) => Promise<void>;
  live: Map<string, { targetAt?: number; task: ScheduledTask }>;
};
export const autoFire = (manager: SchedulerManager, id: string) => internals(manager).fire(id, { manual: false });
export const runs = (manager: SchedulerManager, id: string) => T(manager, id).status.runs;
export const liveRow = (manager: SchedulerManager, id: string, sessionId: string) => runs(manager, id).find(run => run.sessionId === sessionId);
export const skipRows = (manager: SchedulerManager, id: string) => runs(manager, id).filter(run => run.reasonCode === 'overlap');
