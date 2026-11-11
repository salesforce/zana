import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cc-test-home' } }));
vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn((task) => structuredClone(task)), saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(() => true),
  listAllSchedules: vi.fn(() => []),
  globalDir: () => '/tmp/cc-test-home/.zcc/schedules',
  projectDir: (project: { path: string }) => `${project.path}/.zcc/schedules`
}));
vi.mock('../claude.js', () => ({ listClaudeSessions: vi.fn(() => []) }));

import { EventEmitter } from 'node:events';
import { SchedulerManager } from './scheduler.js';
import { validateScheduleFile } from './schedule-validation.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';

class FakePtys extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  sessions: Array<{ id: string; projectId: string; profile: string; cwd: string; status: string; createdAt: number; title: string }> = [];
  list(projectId: string) { return this.sessions.filter((s) => s.projectId === projectId); }
  getRememberedSession(id: string) { return this.sessions.find(s => s.id === id) ?? null; }
  reapDeadSessions(): string[] { return []; }
  failWith: Error | null = null;
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
    if (this.failWith) throw this.failWith;
    const s = { id: (opts.preallocatedSessionId as string) ?? `s${this.sessions.length}`, projectId: opts.projectId as string, title: 'x', profile: opts.profile as string, cwd: opts.cwd as string, status: 'running', createdAt: Date.now() };
    this.sessions.push(s);
    return s;
  }
  write() {}
  closeExpected() { return true; }
}

async function fixture(config: Record<string, unknown>, fields: Record<string, unknown> = {}) {
  const ptys = new FakePtys();
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: {
      listProjects: () => [{ id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 }],
      getConfig: () => config
    } as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
  });
  const task = await manager.create({ name: 't', projectId: 'proj-1', profile: 'claude', every: '5m', enabled: false, ...fields } as never);
  return { manager, ptys, task };
}

const MISSING = 'Required MCP server not available in the isolated config: slack. Enable "Use my Claude config" for this schedule.';

describe('scheduled run requiredMcps', () => {
  it('undeclared: the flag is absent from launch options', async () => {
    const { manager, ptys, task } = await fixture({});
    expect(task).not.toHaveProperty('requiredMcps');
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]).not.toHaveProperty('requiredMcps');
  });

  it('passes a trimmed, de-duplicated list to an isolated launch', async () => {
    const { manager, ptys, task } = await fixture({}, { requiredMcps: [' slack ', 'slack', 'github'] });
    expect(task.requiredMcps).toEqual(['slack', 'github']);
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]!.requiredMcps).toEqual(['slack', 'github']);
  });

  it('is not sent for an opted-out run (schedule or global)', async () => {
    const a = await fixture({}, { requiredMcps: ['slack'], useUserConfig: true });
    await a.manager.runNow(a.task.id);
    expect(a.ptys.createCalls[0]).not.toHaveProperty('requiredMcps');
    expect(a.ptys.createCalls[0]!.useUserConfig).toBe(true);
    const b = await fixture({ automatedUseUserConfig: true }, { requiredMcps: ['slack'] });
    await b.manager.runNow(b.task.id);
    expect(b.ptys.createCalls[0]).not.toHaveProperty('requiredMcps');
  });

  it('records a non-success launch-failed run naming the missing server when admission refuses', async () => {
    const { manager, ptys, task } = await fixture({}, { requiredMcps: ['slack'] });
    ptys.failWith = Object.assign(new Error(MISSING), { preSpawn: true });
    await manager.runNow(task.id).catch(() => undefined);
    expect(ptys.sessions).toHaveLength(0);
    const run = manager.get(task.id)!.status.runs[0]!;
    expect(run.result).toBe('error');
    expect(run.launchState).toBe('failed');
    expect(run.reasonCode).toBe('launch-failed');
    expect(run.message).toContain('slack');
    expect(run.message).toContain('Use my Claude config');
  });

  it('create/update validate, bound, de-duplicate and clear', async () => {
    await expect(fixture({}, { requiredMcps: 'slack' })).rejects.toThrow('requiredMcps must be an array');
    await expect(fixture({}, { requiredMcps: [''] })).rejects.toThrow('non-empty strings');
    await expect(fixture({}, { requiredMcps: [1] })).rejects.toThrow('non-empty strings');
    await expect(fixture({}, { requiredMcps: ['x'.repeat(129)] })).rejects.toThrow('at most 128');
    await expect(fixture({}, { requiredMcps: Array.from({ length: 33 }, (_, i) => `s${i}`) })).rejects.toThrow('at most 32');
    const ok = await fixture({}, { requiredMcps: Array.from({ length: 32 }, (_, i) => `s${i}`).concat('s0') });
    expect(ok.task.requiredMcps).toHaveLength(32);
    const { manager, task } = await fixture({});
    await expect(manager.update(task.id, { requiredMcps: 'slack' } as never)).rejects.toThrow('must be an array');
    expect((await manager.update(task.id, { requiredMcps: ['a', 'a', 'b'] }))?.requiredMcps).toEqual(['a', 'b']);
    expect((await manager.update(task.id, { requiredMcps: [] }))?.requiredMcps).toBeUndefined();
    await manager.update(task.id, { requiredMcps: ['a'] });
    expect((await manager.update(task.id, { requiredMcps: null }))?.requiredMcps).toBeUndefined();
    expect((await manager.update(task.id, { name: 'renamed' }))?.requiredMcps).toBeUndefined();
  });

  it('validateScheduleFile keeps valid names and drops invalid values', () => {
    const base = {
      id: 'sched-1', name: 'n', enabled: true, projectId: 'p', profile: 'claude', schedule: { every: '5m' },
      overlap: 'skip', history: { retain: 10 }, status: { runCount: 0, runs: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const get = (value: unknown) => (validateScheduleFile({ ...base, requiredMcps: value }) as { requiredMcps?: string[] }).requiredMcps;
    expect(get([' slack', 'slack', 'gh', '', 3, 'y'.repeat(200)])).toEqual(['slack', 'gh']);
    expect(get(Array.from({ length: 200 }, (_, i) => `s${i}`))).toHaveLength(32);
    for (const bad of ['slack', 1, null, {}, [], [1]]) expect(get(bad)).toBeUndefined();
  });
});
