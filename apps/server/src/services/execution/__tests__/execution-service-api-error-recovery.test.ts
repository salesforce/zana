import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService, assignmentText } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-api-recovery-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }]
};
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unitInput = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] };

function build(filePath: string, clock: { t: number }, over: Record<string, unknown> = {}) {
  const now = () => clock.t;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const inbox = { append: vi.fn(async () => undefined) };
  const logError = vi.fn();
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
    replyToSession, now, inbox, logError,
    claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
    resolveExactNativeRecoverySnapshots: (record: { nativeRecoverySnapshots?: never[] }) => record.nativeRecoverySnapshots ?? [],
    ...over
  } as never);
  return { service, store, replyToSession, inbox, logError };
}

async function startClaimed(service: SquadExecutionService, store: ReturnType<typeof createExecutionStore>) {
  const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unitInput] } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
  const record = (await store.get('execution-1'))!;
  const unit = record.workUnits![0];
  return { record, unit, fence: { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! } };
}

async function recordRecovery(store: ReturnType<typeof createExecutionStore>, unit: { id: string; claimId?: string; claimGeneration?: number }, deadlineAt: number) {
  await store.recordWorkerRecovery('execution-1', {
    workUnitId: unit.id, claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, slotId: 'slot-1',
    step: 'waiting', errorKind: 'rate_limit', errorText: '429', deadlineAt, severity: 'warning', summary: 'waiting'
  });
}

describe('SquadExecutionService API-error recovery hooks', () => {
  it('assignmentText produces the exact text the dispatcher delivers', async () => fixture(async (filePath) => {
    const { service, store, replyToSession } = build(filePath, { t: 1_000 });
    const { record, unit } = await startClaimed(service, store);
    const delivered = replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')?.[1];
    expect(delivered).toBe(assignmentText(record, {
      workUnitId: unit.id, slotId: 'slot-1', title: unit.title ?? '', task: unit.task, files: unit.files,
      claimId: unit.claimId, claimGeneration: unit.claimGeneration
    }));
    expect(delivered).toContain(`Claim fence: claimId=${unit.claimId}; claimGeneration=${unit.claimGeneration}.`);
  }));

  it('assignmentText omits the claim line without a fence', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 });
    const { record } = await startClaimed(service, store);
    const text = assignmentText(record, { workUnitId: 'a', slotId: 'slot-1', title: '', task: 'do a' });
    expect(text).toBe(`You are assigned work unit \`a\`.\nTask: do a\n\nClose the unit through exactly one structured outcome: execution.work.complete, execution.work.block, execution.work.fail, or execution.work.release. Do not send routine progress or results to the coordinator.`);
  }));

  it('findWorkerClaim returns the claimed unit of a slot only', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 });
    const { unit, fence } = await startClaimed(service, store);
    await expect(service.findWorkerClaim('execution-1', 'slot-1')).resolves.toEqual({ workUnitId: unit.id, ...fence });
    await expect(service.findWorkerClaim('execution-1', 'slot-2')).resolves.toBeUndefined();
    await expect(service.findWorkerClaim('missing', 'slot-1')).resolves.toBeUndefined();
  }));

  it('redeliverClaim sends the preface and assignment, and refuses a different fence', async () => fixture(async (filePath) => {
    const { service, store, replyToSession } = build(filePath, { t: 1_000 });
    const { fence, unit } = await startClaimed(service, store);
    const first = replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')![1] as string;
    replyToSession.mockClear();
    await expect(service.redeliverClaim('execution-1', unit.id, fence, 'worker-1', 'PREFACE')).resolves.toBe(true);
    expect(replyToSession).toHaveBeenCalledWith('worker-1', `PREFACE\n\n${first}`);
    replyToSession.mockClear();
    await expect(service.redeliverClaim('execution-1', unit.id, { ...fence, claimGeneration: 9 }, 'worker-1', 'P')).resolves.toBe(false);
    await expect(service.redeliverClaim('execution-1', 'nope', fence, 'worker-1', 'P')).resolves.toBe(false);
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('redeliverClaim reports a transport that does not accept the text', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const deliverToWorker = vi.fn(async () => true);
    const { service, store } = build(filePath, clock, { deliverToWorker });
    const { fence, unit } = await startClaimed(service, store);
    deliverToWorker.mockResolvedValueOnce(false as never);
    await expect(service.redeliverClaim('execution-1', unit.id, fence, 'worker-1', 'P')).resolves.toBe(false);
  }));

  it('blockApiErrorToHuman blocks, wakes the coordinator, records the inbox entry and re-dispatches', async () => fixture(async (filePath) => {
    const { service, store, replyToSession, inbox } = build(filePath, { t: 1_000 });
    const { fence, unit } = await startClaimed(service, store);
    await recordRecovery(store, unit, 100_000);
    const dispatch = vi.spyOn(store, 'dispatchReady');
    await expect(service.blockApiErrorToHuman('execution-1', unit.id, fence)).resolves.toBe(true);
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits![0].state).toBe('BLOCKED');
    const blocker = record.blockers!.find((entry) => entry.workUnitId === unit.id)!;
    expect(blocker).toMatchObject({ audience: 'human', resolved: false });
    expect(blocker.question).toContain('stopped after an API error');
    expect(replyToSession).toHaveBeenCalledWith('coordinator', `NO_PROGRESS_EXHAUSTED: work unit ${unit.id} stopped after an API error and did not recover — check the worker terminal or restart the run.`);
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'execution-1', blockerId: blocker.id, comments: blocker.question }));
    expect(dispatch).toHaveBeenCalled();
  }));

  it('blockApiErrorToHuman swallows a guard rejection', async () => fixture(async (filePath) => {
    const { service, store, logError } = build(filePath, { t: 1_000 });
    const { fence, unit } = await startClaimed(service, store);
    await expect(service.blockApiErrorToHuman('execution-1', unit.id, fence)).resolves.toBe(false); // no recovery recorded
    expect((await store.get('execution-1'))!.workUnits![0].state).toBe('CLAIMED');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('API-error block skipped'), expect.anything());
  }));

  it('blockApiErrorToHuman logs a persistence failure without throwing', async () => fixture(async (filePath) => {
    const { service, store, logError } = build(filePath, { t: 1_000 });
    const { fence, unit } = await startClaimed(service, store);
    vi.spyOn(store, 'blockKickoffFailure').mockRejectedValueOnce(new Error('disk'));
    await expect(service.blockApiErrorToHuman('execution-1', unit.id, fence)).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('API-error block FAILED'), expect.any(Error));
  }));

  describe('lease sweep', () => {
    const idle = { getAgentState: () => 'idle' };

    it('renews an expired lease while recovery is active before its deadline', async () => fixture(async (filePath) => {
      const clock = { t: 1_000 };
      const { service, store } = build(filePath, clock, idle);
      const { unit } = await startClaimed(service, store);
      clock.t = unit.leaseExpiresAt! + 1;
      await recordRecovery(store, unit, clock.t + 60_000);
      await service.reconcileActive();
      const after = (await store.get('execution-1'))!.workUnits![0];
      expect(after).toMatchObject({ state: 'CLAIMED', claimGeneration: 1 });
      expect(after.leaseExpiresAt).toBeGreaterThan(clock.t);
    }));

    it('reclaims the restful worker once the recovery deadline has passed', async () => fixture(async (filePath) => {
      const clock = { t: 1_000 };
      const { service, store } = build(filePath, clock, idle);
      const { unit } = await startClaimed(service, store);
      clock.t = unit.leaseExpiresAt! + 1;
      await recordRecovery(store, unit, clock.t + 60_000);
      clock.t += 60_001;
      await service.reconcileActive();
      const after = (await store.get('execution-1'))!.workUnits![0];
      expect(after.claimGeneration === 1 && after.state === 'CLAIMED').toBe(false);
    }));

    it('reclaims a restful worker without recovery as before', async () => fixture(async (filePath) => {
      const clock = { t: 1_000 };
      const { service, store } = build(filePath, clock, idle);
      const { unit } = await startClaimed(service, store);
      clock.t = unit.leaseExpiresAt! + 1;
      await service.reconcileActive();
      const after = (await store.get('execution-1'))!.workUnits![0];
      expect(after.claimGeneration === 1 && after.state === 'CLAIMED').toBe(false);
    }));
  });

  describe('stalled-claim sweep', () => {
    it('treats an active recovery before its deadline as live, not wedged', async () => fixture(async (filePath) => {
      const clock = { t: 1_000 };
      const { service, store } = build(filePath, clock);
      const { unit } = await startClaimed(service, store);
      expect((await store.get('execution-1'))!.coordinatorState).toBe('PARKED');
      clock.t += 700_000; // beyond the default job-team stall window
      await recordRecovery(store, unit, clock.t + 60_000);
      await service.redispatchStalled();
      expect((await store.get('execution-1'))!.workUnits![0]).toMatchObject({ state: 'CLAIMED', claimGeneration: 1 });
    }));

    it('treats the same claim as wedged once the recovery deadline has passed', async () => fixture(async (filePath) => {
      const clock = { t: 1_000 };
      const { service, store } = build(filePath, clock);
      const { unit } = await startClaimed(service, store);
      clock.t += 700_000;
      await recordRecovery(store, unit, clock.t + 60_000);
      clock.t += 60_001;
      await service.redispatchStalled();
      expect((await store.get('execution-1'))!.workUnits![0].state).toBe('BLOCKED');
    }));
  });
});
