import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { squadGoalTooLongMessage, squadStoredFieldTooLong, squadSummaryTooLongMessage } from '@zana-ai/zcc-domain/squad-proposal';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-goal-limit-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release\nignored',
  slots: [{ initialTask: 'Run tests' }]
};

function deps(filePath: string, over: Partial<ConstructorParameters<typeof SquadExecutionService>[0]> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    ...over
  };
}

describe('Squad goal and summary limit in the execution service and store', () => {
  it('rejects a 2,049-character objective by name and creates nothing; 2,048 starts', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await expect(service.start('owner', 'project-1', { ...request, objective: 'g'.repeat(2049) })).resolves.toEqual({
      ok: false, code: 'GOAL_TOO_LONG', message: squadGoalTooLongMessage(2049)
    });
    expect(await store.get('execution-1')).toBeUndefined();
    const ok = await service.start('owner', 'project-1', { ...request, objective: 'g'.repeat(2048) });
    expect(ok.ok).toBe(true);
  }));

  it('rejects a 2,049-character summary by name', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await expect(service.start('owner', 'project-1', { ...request, summary: 's'.repeat(2049) })).resolves.toEqual({
      ok: false, code: 'SUMMARY_TOO_LONG', message: squadSummaryTooLongMessage(2049)
    });
    expect(await store.get('execution-1')).toBeUndefined();
  }));

  it.each([
    ['objective', { objective: 'g'.repeat(2049) }, undefined, squadStoredFieldTooLong('goal', 2049)],
    ['summary', {}, 's'.repeat(2049), squadStoredFieldTooLong('summary', 2049)]
  ] as const)('store.claim rejects a long %s with the shared text', async (_name, requestOver, summary, message) => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await expect(store.claim({
      callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Long', requestDigest: 'd', launchRequestId: 'l',
      resolvedModels: [], ...(summary ? { summary } : {}),
      request: { version: 1, slots: [{ initialTask: 'Run' }], resolvedModels: [], ...requestOver }
    })).rejects.toThrow(message);
  }));

  it('still reports other invalid snapshots generically', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await expect(store.claim({
      callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Bad', requestDigest: 'd', launchRequestId: 'l',
      resolvedModels: [], request: { version: 2 } as never
    })).rejects.toThrow('invalid execution request snapshot');
  }));

  it('fits a timeout recovery objective inside the goal limit', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: (() => { let next = 0; return () => `execution-${++next}`; })(), now: () => now });
    const service = new SquadExecutionService(deps(filePath, { store, now: () => now }));
    const started = await service.start('owner', 'project-1', { ...request, launchRequestId: 'source-long', policy: { deadlineMs: 100 } });
    if (!started.ok) throw new Error('source launch failed');
    let source = await store.registerPlan(started.value.id, started.value.stateVersion, [
      { id: 'done', title: 'Inspect', task: 'Inspect', dependencies: [], readOnly: true },
      { id: 'pending', title: 'Report', task: 'Report', dependencies: ['done'], readOnly: true }
    ]);
    source = await store.claimWork(source.id, source.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'done');
    source = await store.completeWork(source.id, source.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'done', 'r'.repeat(2000));
    source = await store.claimWork(source.id, source.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'pending');
    source = await store.blockWork(source.id, source.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'pending', { id: 'blocker', question: 'Approve target A?' });
    now = 1_101;
    source = (await store.decideDeadline(source.id, 1_100, 0)).record;

    const recovered = await service.recoverTimedOut('owner', 'project-1', source.id, source.stateVersion, 'recover-long');
    expect(recovered).toMatchObject({ ok: true, value: { id: 'execution-2' } });
    const objective = (await store.get('execution-2'))?.request.objective ?? '';
    expect(objective.length).toBeLessThanOrEqual(2048);
    expect(objective).toContain('Recovery run');
    expect(objective).toContain('Approve target A?');
    expect(objective).toContain('Recovery context shortened to fit the 2,048-character goal limit. Full outputs: execution execution-1.]');
  }));
});
