import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimSquadWorktreeFollowUp, releaseSquadWorktreeFollowUp, squadWorktreeFollowUpExecution
} from '../squad-worktree-lifecycle.js';
import {
  cleanupOrchestratorOnExit, createFollowUpClaims, createNativeRecoveryCapture, teardownTerminalExecutionOnExit
} from '../squad-session-lifecycle.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createFollowUpClaims', () => {
  afterEach(() => {
    for (const id of ['s1', 's2', 's3']) releaseSquadWorktreeFollowUp('ex1', id);
  });

  function make(caps: any[], live: string[] = []) {
    const restoreCapabilities = {
      list: vi.fn(() => caps),
      findSession: vi.fn((id: string) => caps.find((c) => c.sessionId === id)),
      put: vi.fn()
    };
    return { restoreCapabilities, claims: createFollowUpClaims({ restoreCapabilities, listLiveSessionIds: async () => live }) };
  }

  it('restoreClaim ignores capabilities without ids and restores others', async () => {
    const { claims } = make([]);
    await claims.restoreClaim({ sessionId: 's1' } as never);
    await claims.restoreClaim({ followUpExecutionId: 'ex1' } as never);
    expect(squadWorktreeFollowUpExecution('s1')).toBeUndefined();
    await claims.restoreClaim({ sessionId: 's1', followUpExecutionId: 'ex1' } as never);
    expect(squadWorktreeFollowUpExecution('s1')).toBe('ex1');
  });

  it('restoreSurvivingClaims restores only live sessions', async () => {
    const caps = [
      { sessionId: 's1', followUpExecutionId: 'ex1' },
      { sessionId: 's2', followUpExecutionId: 'ex1' },
      { followUpExecutionId: 'ex1' }
    ];
    const { claims } = make(caps, ['s1']);
    await claims.restoreSurvivingClaims();
    expect(squadWorktreeFollowUpExecution('s1')).toBe('ex1');
    expect(squadWorktreeFollowUpExecution('s2')).toBeUndefined();
  });

  it('clearClaim clears only capabilities with a follow-up id', () => {
    const cap = { sessionId: 's1', followUpExecutionId: 'ex1', x: 1 };
    const { claims, restoreCapabilities } = make([cap, { sessionId: 's2' }]);
    claims.clearClaim('missing');
    claims.clearClaim('s2');
    expect(restoreCapabilities.put).not.toHaveBeenCalled();
    claims.clearClaim('s1');
    expect(restoreCapabilities.put).toHaveBeenCalledWith({ ...cap, followUpExecutionId: undefined });
  });

  it('releaseOnExit is a no-op without a claim, else releases and clears', async () => {
    const cap = { sessionId: 's3', followUpExecutionId: 'ex1' };
    const { claims, restoreCapabilities } = make([cap]);
    expect(claims.releaseOnExit('s3')).toBeUndefined();
    claimSquadWorktreeFollowUp('ex1', 's3');
    await claims.releaseOnExit('s3');
    expect(squadWorktreeFollowUpExecution('s3')).toBeUndefined();
    expect(restoreCapabilities.put).toHaveBeenCalledTimes(1);
  });
});

describe('createNativeRecoveryCapture', () => {
  const session = (over: any = {}) => ({
    id: 'sess', projectId: 'p', profile: 'claude', personaId: 'per',
    cohort: { executionId: 'e', slotId: 'sl', role: 'worker', configuredProfile: 'cfg' }, ...over
  });
  const record = (over: any = {}) => ({ id: 'e', state: 'RUNNING', stateVersion: 3, attempt: 2, ...over });
  function make(rec: any, ...nativeArg: [string | undefined?]) {
    const nativeId = nativeArg.length ? nativeArg[0] : 'nat';
    const executionStore = {
      getInProject: vi.fn(async () => rec),
      upsertNativeRecoverySnapshot: vi.fn(async () => undefined)
    };
    const logError = vi.fn();
    const capture = createNativeRecoveryCapture({ executionStore, nativeConversationIdFor: () => nativeId, logError });
    return { executionStore, logError, capture };
  }

  it.each([
    ['no cohort', { cohort: undefined }],
    ['no executionId', { cohort: { slotId: 's', role: 'worker' } }],
    ['no slotId', { cohort: { executionId: 'e', role: 'worker' } }],
    ['bad role', { cohort: { executionId: 'e', slotId: 's', role: 'other' } }],
    ['no persona', { personaId: undefined }]
  ])('skips: %s', async (_n, over) => {
    const { capture, executionStore } = make(record());
    capture(session(over) as never);
    await flush();
    expect(executionStore.getInProject).not.toHaveBeenCalled();
  });

  it('skips with no native id', async () => {
    const { capture, executionStore } = make(record(), undefined);
    capture(session() as never);
    await flush();
    expect(executionStore.getInProject).not.toHaveBeenCalled();
  });

  it('upserts a snapshot for a worker, using configuredProfile', async () => {
    const { capture, executionStore } = make(record());
    capture(session() as never);
    await flush();
    expect(executionStore.upsertNativeRecoverySnapshot).toHaveBeenCalledWith('e', 3, {
      attempt: 2, slotId: 'sl', role: 'worker', personaId: 'per', profileId: 'cfg', nativeConversationId: 'nat'
    });
  });

  it('uses orchestrator role and session profile fallback', async () => {
    const { capture, executionStore } = make(record());
    capture(session({ cohort: { executionId: 'e', slotId: 'sl', role: 'orchestrator' } }) as never);
    await flush();
    expect(executionStore.upsertNativeRecoverySnapshot).toHaveBeenCalledWith('e', 3, expect.objectContaining({ role: 'orchestrator', profileId: 'claude' }));
  });

  it.each(['COMPLETED', 'FAILED', 'STOPPED'])('skips terminal %s record', async (state) => {
    const { capture, executionStore } = make(record({ state }));
    capture(session() as never);
    await flush();
    expect(executionStore.upsertNativeRecoverySnapshot).not.toHaveBeenCalled();
  });

  it('skips missing record', async () => {
    const { capture, executionStore } = make(undefined);
    capture(session() as never);
    await flush();
    expect(executionStore.upsertNativeRecoverySnapshot).not.toHaveBeenCalled();
  });

  it('skips identical existing snapshot but upserts when it differs', async () => {
    const same = { slotId: 'sl', attempt: 2, nativeConversationId: 'nat', personaId: 'per', profileId: 'cfg' };
    const a = make(record({ nativeRecoverySnapshots: [same] }));
    a.capture(session() as never);
    await flush();
    expect(a.executionStore.upsertNativeRecoverySnapshot).not.toHaveBeenCalled();
    for (const diff of [{ attempt: 1 }, { nativeConversationId: 'old' }, { personaId: 'x' }, { profileId: 'x' }]) {
      const b = make(record({ nativeRecoverySnapshots: [{ ...same, ...diff }] }));
      b.capture(session() as never);
      await flush();
      expect(b.executionStore.upsertNativeRecoverySnapshot).toHaveBeenCalled();
    }
    const c = make(record({ nativeRecoverySnapshots: [{ ...same, slotId: 'other' }] }));
    c.capture(session() as never);
    await flush();
    expect(c.executionStore.upsertNativeRecoverySnapshot).toHaveBeenCalled();
  });

  it('logs lookup and upsert failures', async () => {
    const a = make(record());
    a.executionStore.getInProject.mockRejectedValueOnce(new Error('boom'));
    a.capture(session() as never);
    await flush();
    expect(a.logError).toHaveBeenCalledWith('execution native recovery snapshot sess', expect.any(Error));
    const b = make(record());
    b.executionStore.upsertNativeRecoverySnapshot.mockRejectedValueOnce(new Error('x'));
    b.capture(session() as never);
    await flush();
    expect(b.logError).toHaveBeenCalledTimes(1);
  });
});

describe('exit teardown', () => {
  function deps(over: any = {}) {
    return {
      executionStore: { get: vi.fn(async () => undefined as any), getInProject: vi.fn(async () => undefined as any) },
      handleSquadWorktreeTerminal: vi.fn(async () => undefined),
      teamPlanHandoff: { forget: vi.fn() },
      inferredPlanCorrection: { forget: vi.fn() },
      projects: { listProjects: vi.fn(() => [{ id: 'p', path: '/proj' }]) },
      cleanupHandoffFiles: vi.fn(async () => undefined),
      logError: vi.fn(),
      ...over
    };
  }

  it('teardown: no-ops without execution id / worktree / terminal state', async () => {
    const d = deps();
    await teardownTerminalExecutionOnExit(d, null);
    await teardownTerminalExecutionOnExit(d, { projectId: 'p' });
    expect(d.executionStore.get).not.toHaveBeenCalled();
    const s = { projectId: 'p', cohort: { executionId: 'e' } };
    await teardownTerminalExecutionOnExit(d, s); // record undefined
    d.executionStore.get.mockResolvedValueOnce({ state: 'COMPLETED' });
    await teardownTerminalExecutionOnExit(d, s); // no worktree
    d.executionStore.get.mockResolvedValueOnce({ state: 'RUNNING', squadWorktree: { path: '/w' } });
    await teardownTerminalExecutionOnExit(d, s);
    expect(d.handleSquadWorktreeTerminal).not.toHaveBeenCalled();
  });

  it('teardown: handles terminal worktree and logs handler failure', async () => {
    const d = deps();
    const rec = { state: 'COMPLETED', squadWorktree: { path: '/w' } };
    d.executionStore.get.mockResolvedValue(rec);
    const s = { projectId: 'p', cohort: { executionId: 'e' } };
    await teardownTerminalExecutionOnExit(d, s);
    expect(d.handleSquadWorktreeTerminal).toHaveBeenCalledWith(rec);
    d.handleSquadWorktreeTerminal.mockRejectedValueOnce(new Error('bad'));
    await teardownTerminalExecutionOnExit(d, s);
    expect(d.logError).toHaveBeenCalledWith('execution terminal teardown e', expect.any(Error));
  });

  it('cleanup: ignores non-orchestrators and missing ids', () => {
    const d = deps();
    expect(cleanupOrchestratorOnExit(d, null)).toBeUndefined();
    expect(cleanupOrchestratorOnExit(d, { projectId: 'p', cohort: { executionId: 'e', role: 'worker' } })).toBeUndefined();
    expect(cleanupOrchestratorOnExit(d, { projectId: 'p', cohort: { role: 'orchestrator' } })).toBeUndefined();
    expect(d.teamPlanHandoff.forget).not.toHaveBeenCalled();
  });

  const orch = { projectId: 'p', cohort: { executionId: 'e', role: 'orchestrator' } };

  it('cleanup: prefers worktree path', async () => {
    const d = deps();
    d.executionStore.getInProject.mockResolvedValue({ state: 'COMPLETED', workUnits: [{ id: 'a' }], squadWorktree: { path: '/wt' } });
    await cleanupOrchestratorOnExit(d, orch);
    expect(d.teamPlanHandoff.forget).toHaveBeenCalledWith('e');
    expect(d.inferredPlanCorrection.forget).toHaveBeenCalledWith('e');
    expect(d.cleanupHandoffFiles).toHaveBeenCalledWith('/wt', 'e', { keepAuthoredPlan: false });
  });

  it('cleanup: keeps the authored plan only while a planless run can still be relaunched', async () => {
    const keepsPlan = async (record: object) => {
      const d = deps();
      d.executionStore.getInProject.mockResolvedValue(record);
      await cleanupOrchestratorOnExit(d, orch);
      return d.cleanupHandoffFiles.mock.calls[0][2].keepAuthoredPlan;
    };
    // A retry or recovery reads the same per-execution file, so it survives.
    expect(await keepsPlan({ state: 'FAILED', workUnits: [] })).toBe(true);
    expect(await keepsPlan({ state: 'STOPPED' })).toBe(true);
    expect(await keepsPlan({ state: 'RUNNING', workUnits: [] })).toBe(true);
    // Registered, superseded, or never relaunchable: nothing will read it again.
    expect(await keepsPlan({ state: 'FAILED', workUnits: [{ id: 'a' }] })).toBe(false);
    expect(await keepsPlan({ state: 'FAILED', workUnits: [], successorExecutionId: 'next' })).toBe(false);
    expect(await keepsPlan({ state: 'COMPLETED', workUnits: [] })).toBe(false);
    expect(await keepsPlan({ state: 'STOPPED', timeoutReason: 'unresolved-blocker' })).toBe(false);
    expect(await keepsPlan({ state: 'STOPPED', timeoutReason: 'plan-correction-cancelled' })).toBe(false);
  });

  it('cleanup: falls back to project path, else nothing', async () => {
    const d = deps();
    await cleanupOrchestratorOnExit(d, orch);
    expect(d.cleanupHandoffFiles).toHaveBeenCalledWith('/proj', 'e', { keepAuthoredPlan: false });
    const d2 = deps({ projects: { listProjects: () => [] } });
    await cleanupOrchestratorOnExit(d2, orch);
    expect(d2.cleanupHandoffFiles).not.toHaveBeenCalled();
  });

  it('cleanup: swallows errors', async () => {
    const d = deps();
    d.executionStore.getInProject.mockRejectedValue(new Error('x'));
    await expect(cleanupOrchestratorOnExit(d, orch)).resolves.toBeUndefined();
    const d2 = deps();
    d2.cleanupHandoffFiles.mockRejectedValue(new Error('y'));
    await expect(cleanupOrchestratorOnExit(d2, orch)).resolves.toBeUndefined();
  });
});
