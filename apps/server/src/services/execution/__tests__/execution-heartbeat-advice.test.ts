import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DURABLE_CLAIM_STALL_MS, SquadExecutionService, assignmentText, withDurableClaimWallClockBackstop } from '../service.js';
import { createExecutionStore, type ExecutionDispatchAssignment, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Review round 1 fixes for #581 (F3/A6, F4): the heartbeat advice in the worker's assignment text.

describe('heartbeat advice in the assignment text (#581 F3/A6, F4)', () => {
  const assignment = (over: Partial<ExecutionDispatchAssignment> = {}): ExecutionDispatchAssignment =>
    ({ workUnitId: 'a', slotId: 'slot-1', title: 'A', task: 'do a', claimId: 'c-1', claimGeneration: 1, ...over });
  const record = (policy?: Record<string, unknown>) => ({ request: { policy }, workUnits: [] } as unknown as ExecutionRecord);

  it('a first delivery tells the worker to start at 1', () => {
    expect(assignmentText(record(), assignment())).toContain('(start at 1)');
  });

  it('a redelivery after earlier heartbeats names the next count, so heartbeats are not no-ops', () => {
    expect(assignmentText(record(), assignment({ turnCount: 6 }))).toContain('(start at 7)');
  });

  it('names the durable default stall ceiling, so the text cannot drift from the real one', () => {
    // Durable runs get this ceiling injected, and the 2-3 minute cadence stays well inside it.
    const injected = withDurableClaimWallClockBackstop('job-team', undefined)!.maxClaimStallMs!;
    expect(injected).toBe(DEFAULT_DURABLE_CLAIM_STALL_MS);
    expect(DEFAULT_DURABLE_CLAIM_STALL_MS).toBeGreaterThan(3 * 60_000);
    expect(assignmentText(record(), assignment())).toContain('every 2-3 minutes');
    expect(assignmentText(record(), assignment())).toContain(`no progress for ${injected / 60_000} minutes is taken back`);
  });
});

describe('redelivery carries the stored heartbeat count (#581 F8/A12)', () => {
  it('a claim heartbeated to 3 and then redelivered tells the worker to start at 4', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-heartbeat-advice-'));
    try {
      const filePath = join(dir, 'executions.json');
      const now = () => 1_000;
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
      const replyToSession = vi.fn(() => true);
      const service = new SquadExecutionService({
        store,
        artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
        authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
          version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
            { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
            { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
          ] } } }),
        launchTeam: async () => ({ ok: true }),
        getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }),
        cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
        replyToSession, now, resolveExactNativeRecoverySnapshots: () => []
      } as never);
      const unit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] };
      const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
      if (!started.ok) throw new Error(started.message);
      await service.dispatchReady({ executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' });
      let record = (await store.get('execution-1'))!;
      const claimed = record.workUnits![0];
      const fence = { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration! };
      record = await store.heartbeatWork('execution-1', record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { ...fence, turnCount: 3 });
      expect(record.workUnits![0].turnCount).toBe(3);
      replyToSession.mockClear();
      await expect(service.redeliverClaim('execution-1', 'a', fence, 'worker-1', 'PREFACE')).resolves.toBe(true);
      const text = (replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')![1]) as string;
      expect(text).toContain('(start at 4)');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
