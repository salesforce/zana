import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, WorkUnitRecoveryGuardError,
  type ExecutionWorkUnitInput, type ResolvedModelSnapshotV1
} from '../store.js';

/**
 * Kickoff-churn reassignment (WS1) after a worker stops or churns: the unit moves to an untried slot that still
 * meets the pins the run launched with. The roster is frozen at launch, so a live Squad that dropped or edited a
 * slot cannot widen or narrow who may take the unit. Behaviour end to end: e2e/job-team-kickoff-churn.spec.ts.
 */
async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-kickoff-frozen-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Store = ReturnType<typeof createExecutionStore>;
const model = (slotId: string, personaId: string, roles: string[]): ResolvedModelSnapshotV1 =>
  ({ slotId, personaId, provider: 'anthropic', model: 'm', label: personaId, roles });
const FROZEN = [model('w1', 'builder-persona', ['builder']), model('w2', 'reviewer-persona', ['reviewer']), model('w3', 'builder-two', ['builder', 'reviewer'])];
const slotsOf = (ids: string[]) => [
  { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'o' },
  ...ids.map((slotId) => ({ slotId, personaId: FROZEN.find((m) => m.slotId === slotId)!.personaId!, authorizationIdDigest: slotId }))
];

async function running(store: Store, slotIds: string[], units: Array<Partial<ExecutionWorkUnitInput> & { id: string }>) {
  let record = (await store.claim({
    callerPrincipalId: 's', projectId: 'project-1', teamId: 'team-1', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r',
    resolvedModels: [], request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] },
    routingPolicy: { version: 1 as const, hardRequirements: true }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, { version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: slotsOf(slotIds) }, 'digest');
  record = await store.replaceResolvedModels(record.id, FROZEN.filter((m) => slotIds.includes(m.slotId)));
  return store.registerPlan(record.id, record.stateVersion, units.map((unit) => ({ title: unit.id, task: 'Work', dependencies: [], readOnly: true, ...unit })));
}

async function claim(store: Store, executionId: string, slotId: string, workUnitId: string) {
  const record = (await store.get(executionId))!;
  return store.claimWork(executionId, record.stateVersion, { role: 'worker', slotId }, workUnitId);
}
async function churn(store: Store, executionId: string, slotId: string, workUnitId: string, times = KICKOFF_FAILURE_BLOCK_THRESHOLD) {
  let record = (await store.get(executionId))!;
  for (let i = 0; i < times; i++) {
    record = await claim(store, executionId, slotId, workUnitId);
    const unit = record.workUnits!.find((candidate) => candidate.id === workUnitId)!;
    record = await store.reclaimExpiredClaims(executionId, [{ workUnitId, claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
  }
  return record;
}
async function runA(store: Store, executionId: string) {
  const claimed = await claim(store, executionId, 'w1', 'a');
  const unit = unitOf(claimed, 'a');
  return store.completeWork(executionId, claimed.stateVersion, { role: 'worker', slotId: 'w1' }, 'a', 'done', { claimId: unit.claimId, claimGeneration: unit.claimGeneration });
}
const mk = (filePath: string) => createExecutionStore({ filePath, id: () => 'execution-1', now: () => 1_000 });
const unitOf = (record: { workUnits?: Array<{ id: string }> }, id: string) => record.workUnits!.find((unit) => unit.id === id) as any;

describe('kickoff reassignment keeps the frozen roster and pins', () => {
  it('after a worker stops and the live Squad drops it, the unit still goes to the untried frozen slot that meets its Required role', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, ['w1', 'w3'], [{ id: 'u', routing: { version: 1, requiredRole: 'builder' } }]);
    record = await churn(store, record.id, 'w1', 'u');
    // The worker stopped: a refresh from the live Squad no longer lists w1 and has renamed w3's roles.
    record = await store.replaceResolvedModels(record.id, [model('w3', 'builder-two', ['auditor'])]);
    expect(record.resolvedModels.map((entry) => entry.slotId)).toEqual(['w1', 'w3']);
    expect(record.resolvedModels.find((entry) => entry.slotId === 'w3')!.roles).toEqual(['builder', 'reviewer']);
    record = await store.reassignKickoffToFreshSlot(record.id, 'u');
    expect(unitOf(record, 'u')).toMatchObject({ state: 'READY', assignedSlotId: 'w3' });
    expect(unitOf(record, 'u').kickoffFailures).toBeUndefined();
    expect(unitOf(record, 'u').history.at(-1)).toMatchObject({ action: 'retried', slotId: 'w3', detail: 'kickoff reassigned to fresh worker slot' });
  }));

  it('a live edit that gives another slot the Required role does not make it eligible: reassignment refuses and the human block follows', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, ['w1', 'w2'], [{ id: 'u', routing: { version: 1, requiredRole: 'builder' } }]);
    record = await churn(store, record.id, 'w1', 'u');
    record = await store.replaceResolvedModels(record.id, [model('w1', 'builder-persona', ['builder']), model('w2', 'reviewer-persona', ['builder'])]);
    expect(record.resolvedModels.find((entry) => entry.slotId === 'w2')!.roles).toEqual(['reviewer']);
    await expect(store.reassignKickoffToFreshSlot(record.id, 'u')).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    record = await store.blockKickoffFailure(record.id, 'u');
    expect(unitOf(record, 'u').state).toBe('BLOCKED');
    expect(record.blockers).toEqual([expect.objectContaining({ workUnitId: 'u', audience: 'human', resolved: false })]);
  }));

  it('never re-homes a step onto a slot a Not same worker as reference ran on, and keeps the new slot after another refresh', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, ['w1', 'w2', 'w3'], [{ id: 'a' }, { id: 'b', dependencies: ['a'], routing: { version: 1, excludeSameWorkerAs: ['a'] } }]);
    record = await runA(store, record.id);
    record = await churn(store, record.id, 'w2', 'b');
    record = await store.reassignKickoffToFreshSlot(record.id, 'b');
    expect(unitOf(record, 'b').assignedSlotId).toBe('w3');
    record = await store.replaceResolvedModels(record.id, [model('w3', 'someone-else', ['x'])]);
    expect(unitOf(record, 'b').assignedSlotId).toBe('w3');
    expect(record.resolvedModels.map((entry) => entry.slotId)).toEqual(['w1', 'w2', 'w3']);
    expect(record.routingPolicy).toMatchObject({ version: 1, hardRequirements: true });
  }));

  it('with only the excluded slot left, reassignment refuses instead of breaking the pin', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, ['w1', 'w2'], [{ id: 'a' }, { id: 'b', dependencies: ['a'], routing: { version: 1, excludeSameWorkerAs: ['a'] } }]);
    record = await runA(store, record.id);
    record = await churn(store, record.id, 'w2', 'b');
    await expect(store.reassignKickoffToFreshSlot(record.id, 'b')).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
  }));

  it('a persona deleted after launch leaves the run alone: the frozen slot still takes and keeps the step', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, ['w1', 'w2'], [{ id: 'u', routing: { version: 1, requiredRole: 'builder' } }]);
    // The live Squad no longer resolves the persona behind w1 (deleted), so the refresh returns nothing for it.
    record = await store.replaceResolvedModels(record.id, [model('w2', 'reviewer-persona', ['reviewer'])]);
    expect(record.resolvedModels.find((entry) => entry.slotId === 'w1')).toMatchObject({ personaId: 'builder-persona', roles: ['builder'] });
    const { assignments } = await store.dispatchReady(record.id);
    expect(assignments).toMatchObject([{ workUnitId: 'u', slotId: 'w1' }]);
    record = await store.replaceResolvedModels(record.id, []);
    expect(record.resolvedModels.map((entry) => entry.slotId)).toEqual(['w1', 'w2']);
  }));
});
