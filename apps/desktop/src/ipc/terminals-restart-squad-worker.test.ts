import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, { handler: (...args: any[]) => any; fallback?: () => any }>();
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, app: { getPath: () => '/tmp' } }));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, { handler }); },
  safeProductHandle: (channel: string, handler: (...args: any[]) => any, fallback?: () => any) => { handlers.set(channel, { handler, fallback }); }
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [], getConfig: () => ({}) } }));
vi.mock('@zana-ai/zcc-host-daemon/tmux', () => ({ listLocalTmuxSessionIds: vi.fn(), verifyTmux: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/remembered-sessions', () => ({ listRememberedTombstones: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/cli-plan-watch', () => ({ CliPlanWatcher: class { onSessionExit() {} } }));

import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { registerTerminalsIpc } from './terminals.js';

const cohort = { cohortId: 'c1', teamId: 't', teamName: 'T', role: 'worker', slotId: 'slot1', executionId: 'e1' };
const sessions: Record<string, any> = {
  w1: { id: 'w1', projectId: 'p1', status: 'running', cohort },
  plain: { id: 'plain', projectId: 'p1', status: 'running' }
};
const restarter = { restart: vi.fn() };
const lifecycle = { list: vi.fn(), launchIsClosing: vi.fn() };
const executionStore = { getInProject: vi.fn() };
const call = (id: unknown) => handlers.get(IPC.terminals.restartSquadWorker)!.handler(id);

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  restarter.restart.mockResolvedValue({ ok: true });
  lifecycle.list.mockResolvedValue([{ id: 'r1', state: 'active', callerPrincipalId: 'u', launchRequestId: 'l1', workers: [{ sessionId: 'w1', slotId: 'slot1', cohortId: 'c1', projectId: 'p1', process: 'running' }] }]);
  lifecycle.launchIsClosing.mockResolvedValue(false);
  executionStore.getInProject.mockResolvedValue({ state: 'RUNNING', callerPrincipalId: 'u', teamLaunchRequestId: 'l1' });
  bindIpcCtx({
    ptys: { on: vi.fn(), getSession: (id: string) => sessions[id] ?? null },
    safeSend: vi.fn(), squadWorkerRestarter: restarter, teamLifecycle: lifecycle, executionStore
  } as never);
  registerTerminalsIpc();
});

describe('terminals.restartSquadWorker', () => {
  it('restarts a live Squad worker through the restarter', async () => {
    await expect(call('w1')).resolves.toEqual({ ok: true });
    expect(restarter.restart).toHaveBeenCalledWith('w1', { maySpawn: expect.any(Function) });
    expect(executionStore.getInProject).toHaveBeenCalledWith('p1', 'e1');
  });
  it('refuses a foreign session id', async () => {
    await expect(call('nope')).resolves.toMatchObject({ ok: false, reason: 'not-found' });
    expect(restarter.restart).not.toHaveBeenCalled();
  });
  it('reports non-Squad sessions so the renderer keeps its path', async () => {
    await expect(call('plain')).resolves.toMatchObject({ reason: 'not-squad-worker' });
    expect(restarter.restart).not.toHaveBeenCalled();
  });
  it('refuses a closing run and a terminal run', async () => {
    lifecycle.launchIsClosing.mockResolvedValue(true);
    await expect(call('w1')).resolves.toMatchObject({ reason: 'run-closing' });
    lifecycle.launchIsClosing.mockResolvedValue(false);
    executionStore.getInProject.mockResolvedValue({ state: 'FAILED', callerPrincipalId: 'u', teamLaunchRequestId: 'l1' });
    await expect(call('w1')).resolves.toMatchObject({ reason: 'run-finished' });
    expect(restarter.restart).not.toHaveBeenCalled();
  });
  it('falls back to a tagged failure when the handler throws', () => {
    expect(handlers.get(IPC.terminals.restartSquadWorker)!.fallback!()).toEqual({ ok: false, reason: 'restart-failed' });
  });
});
