import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { executionBoardProjection, projectExecutionProjection } from '../projection.js';

// MT-5 (1)/(2): durable run survives an app restart (store + service recreated from the same file).

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-exec-restart-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release', slots: [{ initialTask: 'Run tests' }] };
const worker = { role: 'worker' as const, slotId: 'slot-1' };

function boot(filePath: string) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
  });
  return { store, service };
}

async function seedPartialRun(store: ReturnType<typeof boot>['store'], service: ReturnType<typeof boot>['service']) {
  const started = await service.start('owner', 'project-1', request);
  if (!started.ok) throw new Error('launch failed');
  let rec = await store.registerPlan(started.value.id, started.value.stateVersion, [
    { id: 'done', title: 'Done', task: 'Inspect', dependencies: [], readOnly: true },
    { id: 'todo', title: 'Todo', task: 'Report', dependencies: ['done'], readOnly: true }
  ]);
  rec = await store.claimWork(rec.id, rec.stateVersion, worker, 'done');
  rec = await store.completeWork(rec.id, rec.stateVersion, worker, 'done', 'kept');
  return rec;
}

describe('MT-5 durable run across restart', () => {
  it('keeps same Run ID and finished unit after restart; orchestrator-less run offers Recover orchestrator', async () => fixture(async (filePath) => {
    const first = boot(filePath);
    const before = await seedPartialRun(first.store, first.service);

    const second = boot(filePath); // "quit + reopen"
    const after = await second.store.get(before.id);
    expect(after).toMatchObject({ id: 'execution-1', state: 'RUNNING' });
    expect(after?.workUnits?.find((u) => u.id === 'done')).toMatchObject({ state: 'COMPLETED', result: 'kept' });
    expect(after?.workUnits?.find((u) => u.id === 'todo')?.state).not.toBe('COMPLETED');
    expect((await second.service.status('owner', 'project-1', before.id))?.id).toBe('execution-1');

    // no live orchestrator terminal after relaunch -> projection requests monitor recovery on the SAME run
    const projected = projectExecutionProjection([after as ExecutionRecord], []);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ executionId: 'execution-1', recoveryAttention: true, coordinator: { status: 'lost' }, recovery: { status: 'available' } });
  }));

  it('stopped run survives restart: completed work recorded, fresh-plan relaunch keeps it and re-readies incomplete work', async () => fixture(async (filePath) => {
    const first = boot(filePath);
    const seeded = await seedPartialRun(first.store, first.service);
    await first.store.transition(seeded.id, seeded.stateVersion, 'STOPPED', 'info', 'stopped');

    const second = boot(filePath);
    const stopped = await second.store.get(seeded.id);
    expect(stopped?.state).toBe('STOPPED');
    expect(executionBoardProjection(stopped as ExecutionRecord).recovery?.actions.freshPlan).toEqual({ available: true });

    const resumed = await second.service.resumeRun('owner', 'project-1', seeded.id, (stopped as ExecutionRecord).stateVersion);
    expect(resumed).toMatchObject({ ok: true, value: { id: 'execution-1', state: 'RUNNING', attempt: 2 } });
    const units = (await second.store.get(seeded.id))?.workUnits ?? [];
    expect(units.find((u) => u.id === 'done')).toMatchObject({ state: 'COMPLETED', result: 'kept' });
    expect(units.find((u) => u.id === 'todo')?.state).toBe('READY');
  }));
});
