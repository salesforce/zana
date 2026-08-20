import { describe, expect, it, vi } from 'vitest';
import { relaunchExecutionMonitor, type RelaunchMonitorDeps } from '../execution/relaunch-monitor.js';
import type { ExecutionRecord } from '../execution/store.js';

const record: ExecutionRecord = {
  id: 'execution-1', callerPrincipalId: 'owner-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship',
  requestDigest: 'digest', launchRequestId: 'request-1', teamLaunchRequestId: 'request-1',
  request: { version: 1, slots: [], resolvedModels: [] }, attempt: 1, state: 'RUNNING', stateVersion: 1,
  resolvedModels: [], createdAt: 1, updatedAt: 1
};

function deps(overrides: Partial<RelaunchMonitorDeps> = {}): RelaunchMonitorDeps {
  return {
    findProject: vi.fn(() => ({ id: 'project-1', path: '/project' })),
    getExecution: vi.fn(async () => record),
    confirm: vi.fn(async () => true),
    readToken: vi.fn(() => 'resume-token'),
    findOrchestratorPersona: vi.fn(() => ({ id: 'builtin:orchestrator' })),
    createMonitor: vi.fn(() => ({ ok: true as const, value: { id: 'monitor-1' } })),
    bindMonitor: vi.fn(async () => ({ ok: true as const, value: {} })),
    closeMonitor: vi.fn(),
    clearToken: vi.fn(),
    ...overrides
  };
}

describe('relaunchExecutionMonitor', () => {
  it('returns NOT_FOUND before confirmation, token access, or spawn for an invalid project or execution', async () => {
    const invalidProject = deps({ findProject: vi.fn(() => undefined) });
    await expect(relaunchExecutionMonitor(invalidProject, 'missing-project', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(invalidProject.getExecution).not.toHaveBeenCalled();
    expect(invalidProject.confirm).not.toHaveBeenCalled();
    expect(invalidProject.readToken).not.toHaveBeenCalled();
    expect(invalidProject.createMonitor).not.toHaveBeenCalled();

    const invalidExecution = deps({ getExecution: vi.fn(async () => undefined) });
    await expect(relaunchExecutionMonitor(invalidExecution, 'project-1', 'missing-execution')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(invalidExecution.confirm).not.toHaveBeenCalled();
    expect(invalidExecution.readToken).not.toHaveBeenCalled();
    expect(invalidExecution.createMonitor).not.toHaveBeenCalled();
  });

  it('uses native confirmation as a gate before token access or monitor creation', async () => {
    const input = deps({ confirm: vi.fn(async () => false) });
    await expect(relaunchExecutionMonitor(input, 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'CANCELED' });
    expect(input.readToken).not.toHaveBeenCalled();
    expect(input.findOrchestratorPersona).not.toHaveBeenCalled();
    expect(input.createMonitor).not.toHaveBeenCalled();
  });

  it('launches using the built-in orchestrator persona and clears token after successful binding', async () => {
    const input = deps();
    await expect(relaunchExecutionMonitor(input, 'project-1', 'execution-1')).resolves.toEqual({ ok: true, value: { sessionId: 'monitor-1' } });
    expect(input.createMonitor).toHaveBeenCalledWith(expect.objectContaining({ personaId: 'builtin:orchestrator', projectId: 'project-1', cwd: '/project' }));
    expect(input.bindMonitor).toHaveBeenCalledWith('monitor-1', 'project-1', 'execution-1', 'resume-token');
    expect(input.clearToken).toHaveBeenCalledWith('project-1', 'execution-1');
  });

  it('closes monitor and clears rejected tokens while preserving tokens after transport failures', async () => {
    const rejected = deps({ bindMonitor: vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND', message: 'grant expired' })) });
    await expect(relaunchExecutionMonitor(rejected, 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(rejected.closeMonitor).toHaveBeenCalledWith('monitor-1');
    expect(rejected.clearToken).toHaveBeenCalledWith('project-1', 'execution-1');

    const thrown = deps({ bindMonitor: vi.fn(async () => { throw new Error('binding transport failed'); }) });
    await expect(relaunchExecutionMonitor(thrown, 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'SPAWN_FAILED' });
    expect(thrown.closeMonitor).toHaveBeenCalledWith('monitor-1');
    expect(thrown.clearToken).not.toHaveBeenCalled();
  });

  it('closes monitor but retains token after a transient binding failure for retry', async () => {
    const input = deps({ bindMonitor: vi.fn(async () => ({ ok: false as const, code: 'BINDING_TRANSIENT', message: 'retry' })) });
    await expect(relaunchExecutionMonitor(input, 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'BINDING_TRANSIENT' });
    expect(input.closeMonitor).toHaveBeenCalledWith('monitor-1');
    expect(input.clearToken).not.toHaveBeenCalled();
  });

  it('keeps a successfully bound monitor alive when token cleanup fails', async () => {
    const input = deps({ clearToken: vi.fn(() => { throw new Error('cache unavailable'); }) });
    await expect(relaunchExecutionMonitor(input, 'project-1', 'execution-1')).resolves.toEqual({
      ok: true, value: { sessionId: 'monitor-1' }
    });
    expect(input.closeMonitor).not.toHaveBeenCalled();
  });

  it('rejects a concurrent relaunch before it can read or spend the same token', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const input = deps({ confirm: vi.fn(async () => { await pending; return true; }) });
    const first = relaunchExecutionMonitor(input, 'project-1', 'execution-1');
    await Promise.resolve();
    await expect(relaunchExecutionMonitor(input, 'project-1', 'execution-1')).resolves.toEqual({
      ok: false, code: 'CONFLICT', message: 'monitor relaunch already in progress'
    });
    expect(input.readToken).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(input.readToken).toHaveBeenCalledOnce();
  });
});
