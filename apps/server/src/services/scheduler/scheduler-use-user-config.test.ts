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
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
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

describe('scheduled run useUserConfig opt-out', () => {
  it('defaults to isolated: flag absent from launch options', async () => {
    const { manager, ptys, task } = await fixture({});
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]).not.toHaveProperty('useUserConfig');
    expect(ptys.createCalls[0]!.scheduled).toBe(true);
  });

  it('per-schedule opt-out sets the flag', async () => {
    const { manager, ptys, task } = await fixture({}, { useUserConfig: true });
    expect(task.useUserConfig).toBe(true);
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]!.useUserConfig).toBe(true);
  });

  it('global opt-out sets the flag', async () => {
    const { manager, ptys, task } = await fixture({ automatedUseUserConfig: true });
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]!.useUserConfig).toBe(true);
  });

  it('per-schedule false overrides global opt-out', async () => {
    const { manager, ptys, task } = await fixture({ automatedUseUserConfig: true }, { useUserConfig: false });
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]).not.toHaveProperty('useUserConfig');
  });

  it('non-boolean global value is ignored (isolated)', async () => {
    const { manager, ptys, task } = await fixture({ automatedUseUserConfig: 'yes' });
    await manager.runNow(task.id);
    expect(ptys.createCalls[0]).not.toHaveProperty('useUserConfig');
  });

  it('survives a throwing config read (isolated)', async () => {
    const ptys = new FakePtys();
    const manager = new SchedulerManager();
    let throwing = false;
    manager.setDeps({
      ptys: ptys as unknown as PtyManager,
      launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
      store: {
        listProjects: () => [{ id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 }],
        getConfig: () => { if (throwing) throw new Error('boom'); return {}; }
      } as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
    });
    const task = await manager.create({ name: 't', projectId: 'proj-1', profile: 'claude', every: '5m', enabled: false } as never);
    throwing = true;
    await manager.runNow(task.id).catch(() => undefined);
    for (const c of ptys.createCalls) expect(c).not.toHaveProperty('useUserConfig');
  });

  it('rejects non-boolean create/update values', async () => {
    await expect(fixture({}, { useUserConfig: 'true' })).rejects.toThrow('useUserConfig must be a boolean');
    const { manager, task } = await fixture({});
    await expect(manager.update(task.id, { useUserConfig: 1 } as never)).rejects.toThrow('useUserConfig must be a boolean');
    const updated = await manager.update(task.id, { useUserConfig: true });
    expect(updated?.useUserConfig).toBe(true);
    const cleared = await manager.update(task.id, { useUserConfig: null });
    expect(cleared?.useUserConfig).toBeUndefined();
  });

  it('validateScheduleFile keeps booleans and drops invalid values', () => {
    const base = {
      id: 'sched-1', name: 'n', enabled: true, projectId: 'p', profile: 'claude', schedule: { every: '5m' },
      overlap: 'skip', history: { retain: 10 }, status: { runCount: 0, runs: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const ok = validateScheduleFile({ ...base, useUserConfig: true }) as { useUserConfig?: boolean };
    expect(ok.useUserConfig).toBe(true);
    for (const bad of ['true', 1, null, {}]) {
      const v = validateScheduleFile({ ...base, useUserConfig: bad }) as { useUserConfig?: boolean; error?: string };
      expect(v.error).toBeUndefined();
      expect(v.useUserConfig).toBeUndefined();
    }
  });
});
