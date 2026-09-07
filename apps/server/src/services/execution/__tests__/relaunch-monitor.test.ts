import { describe, expect, it, vi } from 'vitest';
import { relaunchExecutionMonitor, type RelaunchMonitorDeps } from '../relaunch-monitor.js';
import type { ExecutionRecord } from '../store.js';

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1',
    jobTitle: 'Recover job', summary: 'Ship it', requestDigest: 'digest', launchRequestId: 'req',
    teamLaunchRequestId: 'team-req', attempt: 1, state: 'RUNNING', stateVersion: 5, recoveryGeneration: 2,
    resolvedModels: [], createdAt: 1, updatedAt: 2,
    request: { version: 1, slots: [], resolvedModels: [], goal: 'Deliver', sourceBundle: { contentRef: 'ref', sources: [] } },
    ...overrides
  } as ExecutionRecord;
}

function baseDeps(overrides: Partial<RelaunchMonitorDeps> = {}): RelaunchMonitorDeps {
  return {
    findProject: () => ({ id: 'project-1', path: '/tmp/project-1' }),
    getExecution: async () => record(),
    confirm: async () => true,
    rotateRecovery: async () => ({ ok: true, value: { token: 'tok', generation: 3 } }),
    readSource: async () => ({ content: '', totalBytes: 0 }),
    getWorkerRoster: async () => [{ slotId: 'w1', sessionId: 's1', status: 'live' }],
    findOrchestratorPersona: () => ({ id: 'persona-1' }),
    createMonitor: () => ({ ok: true, value: { id: 'monitor-session-1' } }),
    bindMonitor: async () => ({ ok: true, value: {} }),
    closeMonitor: vi.fn(),
    clearToken: vi.fn(),
    revokeBinding: vi.fn(async () => undefined),
    waitBeforeBindRetry: async () => undefined,
    logError: vi.fn(),
    ...overrides
  };
}

describe('relaunchExecutionMonitor', () => {
  it('binds a fresh monitor on the happy path and clears the local token', async () => {
    const clearToken = vi.fn();
    const result = await relaunchExecutionMonitor(baseDeps({ clearToken }), 'project-1', 'execution-1');
    expect(result).toEqual({ ok: true, value: { sessionId: 'monitor-session-1' } });
    expect(clearToken).toHaveBeenCalledWith('project-1', 'execution-1');
  });

  it('rejects when the execution is already terminal (preflight failure)', async () => {
    const closeMonitor = vi.fn();
    const result = await relaunchExecutionMonitor(
      baseDeps({ getExecution: async () => record({ state: 'COMPLETED' }), closeMonitor }),
      'project-1', 'execution-1'
    );
    expect(result).toMatchObject({ ok: false, code: 'TERMINAL' });
    expect(closeMonitor).not.toHaveBeenCalled();
  });

  it('retries a transient binding failure and succeeds', async () => {
    const bindMonitor = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'BINDING_TRANSIENT', message: 'try again' })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const result = await relaunchExecutionMonitor(baseDeps({ bindMonitor }), 'project-1', 'execution-1');
    expect(result).toMatchObject({ ok: true });
    expect(bindMonitor).toHaveBeenCalledTimes(2);
  });

  it('closes the monitor and revokes the binding on a permanent transient failure', async () => {
    const closeMonitor = vi.fn();
    const revokeBinding = vi.fn(async () => undefined);
    const clearToken = vi.fn();
    const result = await relaunchExecutionMonitor(
      baseDeps({
        closeMonitor, revokeBinding, clearToken,
        bindMonitor: async () => ({ ok: false, code: 'BINDING_TRANSIENT', message: 'stuck' })
      }),
      'project-1', 'execution-1'
    );
    expect(result).toMatchObject({ ok: false, code: 'BINDING_TRANSIENT' });
    expect(closeMonitor).toHaveBeenCalledWith('monitor-session-1');
    expect(revokeBinding).toHaveBeenCalledWith('monitor-session-1', 'project-1', 'execution-1');
    expect(clearToken).toHaveBeenCalledWith('project-1', 'execution-1');
  });

  it('cleans up the monitor and binding even when the retry delay rejects', async () => {
    const closeMonitor = vi.fn();
    const revokeBinding = vi.fn(async () => undefined);
    const clearToken = vi.fn();
    const result = await relaunchExecutionMonitor(
      baseDeps({
        closeMonitor, revokeBinding, clearToken,
        bindMonitor: async () => ({ ok: false, code: 'BINDING_TRANSIENT', message: 'try again' }),
        waitBeforeBindRetry: async () => { throw new Error('timer blew up'); }
      }),
      'project-1', 'execution-1'
    );
    expect(result).toMatchObject({ ok: false, code: 'SPAWN_FAILED' });
    expect(closeMonitor).toHaveBeenCalledWith('monitor-session-1');
    expect(revokeBinding).toHaveBeenCalledWith('monitor-session-1', 'project-1', 'execution-1');
    expect(clearToken).toHaveBeenCalledWith('project-1', 'execution-1');
  });

  it('logs (does not throw) when best-effort cleanup rejects', async () => {
    const logError = vi.fn();
    const result = await relaunchExecutionMonitor(
      baseDeps({
        logError,
        bindMonitor: async () => ({ ok: false, code: 'BINDING_TRANSIENT', message: 'stuck' }),
        revokeBinding: async () => { throw new Error('revoke failed'); },
        clearToken: () => { throw new Error('clear failed'); }
      }),
      'project-1', 'execution-1'
    );
    expect(result).toMatchObject({ ok: false, code: 'BINDING_TRANSIENT' });
    expect(logError).toHaveBeenCalledTimes(2); // revoke + clearToken
  });

  it('rejects a concurrent relaunch for the same execution', async () => {
    let releaseBind!: () => void;
    const bindGate = new Promise<void>((resolve) => { releaseBind = resolve; });
    const deps = baseDeps({ bindMonitor: async () => { await bindGate; return { ok: true, value: {} }; } });
    const first = relaunchExecutionMonitor(deps, 'project-1', 'execution-1');
    const second = await relaunchExecutionMonitor(deps, 'project-1', 'execution-1');
    expect(second).toMatchObject({ ok: false, code: 'CONFLICT' });
    releaseBind();
    expect(await first).toMatchObject({ ok: true });
  });
});
