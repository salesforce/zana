import { describe, expect, it, vi } from 'vitest';
import { onOrchestratorIdle, type OrchestratorIdleDeps } from '../coordinator-idle.js';

const deps = (over: Partial<OrchestratorIdleDeps> = {}): OrchestratorIdleDeps => ({
  drainCoordinatorWake: vi.fn(async () => undefined),
  getExecution: vi.fn(async () => ({ squadWorktree: { path: '/wt' } })),
  projectPath: vi.fn(() => '/project'),
  onCoordinatorIdle: vi.fn(async () => 'done'),
  logError: vi.fn(),
  ...over
});
const session = { projectId: 'p', cohort: { executionId: 'e', slotId: 's', role: 'orchestrator' } };

describe('onOrchestratorIdle', () => {
  it('is a no-op for non-orchestrators and sessions without an execution', () => {
    const d = deps();
    expect(onOrchestratorIdle(d, 'sid', { projectId: 'p' })).toBeUndefined();
    expect(onOrchestratorIdle(d, 'sid', { projectId: 'p', cohort: { executionId: 'e', role: 'worker' } })).toBeUndefined();
    expect(onOrchestratorIdle(d, 'sid', { projectId: 'p', cohort: { role: 'orchestrator' } })).toBeUndefined();
    expect(d.drainCoordinatorWake).not.toHaveBeenCalled();
  });

  it('drains the wake and hands off using the squad worktree root', async () => {
    const d = deps();
    const r = onOrchestratorIdle(d, 'sid', session)!;
    await Promise.all([r.wake, r.handoff]);
    expect(d.drainCoordinatorWake).toHaveBeenCalledWith('p', 'e', 'sid');
    expect(d.onCoordinatorIdle).toHaveBeenCalledWith({ sessionId: 'sid', projectId: 'p', projectRoot: '/wt', executionId: 'e', slotId: 's' });
  });

  it('falls back to the project path when the execution is missing or has no worktree', async () => {
    for (const exec of [undefined, {}]) {
      const d = deps({ getExecution: vi.fn(async () => exec) });
      await onOrchestratorIdle(d, 'sid', session)!.handoff;
      expect(d.onCoordinatorIdle).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/project' }));
    }
  });

  it('skips handoff without a root or slot id', async () => {
    const noRoot = deps({ getExecution: vi.fn(async () => undefined), projectPath: vi.fn(() => undefined) });
    await onOrchestratorIdle(noRoot, 'sid', session)!.handoff;
    const noSlot = deps();
    await onOrchestratorIdle(noSlot, 'sid', { projectId: 'p', cohort: { executionId: 'e', role: 'orchestrator' } })!.handoff;
    expect(noRoot.onCoordinatorIdle).not.toHaveBeenCalled();
    expect(noSlot.onCoordinatorIdle).not.toHaveBeenCalled();
  });

  it('logs wake drain and handoff failures instead of throwing', async () => {
    const d = deps({
      drainCoordinatorWake: vi.fn(async () => { throw new Error('wake'); }),
      onCoordinatorIdle: vi.fn(async () => { throw new Error('handoff'); })
    });
    const r = onOrchestratorIdle(d, 'sid', session)!;
    await Promise.all([r.wake, r.handoff]);
    expect(d.logError).toHaveBeenCalledWith('execution coordinator wake sid', expect.any(Error));
    expect(d.logError).toHaveBeenCalledWith('team plan handoff sid', expect.any(Error));
  });
});
