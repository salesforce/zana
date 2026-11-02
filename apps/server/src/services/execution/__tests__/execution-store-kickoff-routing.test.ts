import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, WorkUnitRecoveryGuardError, type ExecutionWorkUnitInput } from '../store.js';

// Acceptance tests for #577: kickoff reassignment must honour the unit's routing (REQ-1..4, REQ-17).

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-kickoff-routing-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

function request() {
  return {
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
  };
}

type Store = ReturnType<typeof createExecutionStore>;
type Roster = Array<{ slotId: string; personaId: string; level?: 'low' | 'medium' | 'high' | 'extra-high' }>;

async function running(store: Store, roster: Roster, unit: Partial<ExecutionWorkUnitInput> = {}) {
  let record = (await store.claim(request())).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...roster.map((slot) => ({ slotId: slot.slotId, personaId: slot.personaId, authorizationIdDigest: slot.slotId }))
    ]
  }, 'authorization-digest');
  record = await store.replaceResolvedModels(record.id, roster.map((slot) => ({
    slotId: slot.slotId, personaId: slot.personaId, provider: 'anthropic', model: 'm', ...(slot.level ? { level: slot.level } : {})
  })));
  return store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, ...unit }]);
}

async function churn(store: Store, executionId: string, slotId: string, times = KICKOFF_FAILURE_BLOCK_THRESHOLD) {
  let record = (await store.get(executionId))!;
  for (let i = 0; i < times; i++) {
    record = await store.claimWork(executionId, record.stateVersion, { role: 'worker', slotId }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(executionId, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
  }
  return record;
}

const engineerRouting = { version: 1 as const, requiredRole: 'engineer' };
const today = (id = 'unit', title = 'Unit') =>
  `Work unit ${id} (${title}) made no progress on every eligible worker slot; its worker never started a turn. Check the worker terminal, then retry the unit or restart the run.`;

describe('kickoff reassignment honours routing (#577)', () => {
  it('REQ-1: picks the next untried engineer slot, never the reviewer seat', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    // Reviewer sits between the two engineers so roster order alone would pick it.
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'engineer:1' });
  }));

  it('REQ-2: throws WorkUnitRecoveryGuardError when every untried slot fails the routing', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0');
    const attempt = store.reassignKickoffToFreshSlot(record.id, 'unit');
    await expect(attempt).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    await expect(attempt).rejects.toThrow('no untried eligible worker slot for kickoff reassignment');
    // Unit is untouched: still READY, never pinned to the reviewer.
    const after = (await store.get(record.id))!.workUnits![0];
    expect(after.state).toBe('READY');
    expect(after.assignedSlotId).not.toBe('reviewer:0');
  }));

  it('REQ-3: a unit without routing still goes to the first untried slot in roster order', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ]);
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'reviewer:0' });
  }));

  it('REQ-4: the human question names the single slot that can take a routed unit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0', 1);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers).toEqual([expect.objectContaining({
      workUnitId: 'unit', audience: 'human', resolved: false,
      question: 'Work unit unit (Unit) made no progress, and the only worker slot that can take it (engineer:0) never started a turn. Check that worker\'s terminal, then retry the unit or restart the run.'
    })]);
  }));

  it('REQ-4: a unit without routing keeps today\'s exact question', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }]);
    record = await churn(store, record.id, 'engineer:0', 1);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toBe(today());
  }));

  it('REQ-4: a routed unit with several eligible slots keeps today\'s exact question', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0', 1);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toBe(today());
  }));

  it('REQ-17: an UNKNOWN slot (no level fact) is still picked, after any PASS slot', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer', level: 'high' },
      { slotId: 'engineer:1', personaId: 'engineer' }, // no level: UNKNOWN for minimumLevel
      { slotId: 'engineer:2', personaId: 'engineer', level: 'high' } // PASS, later in roster
    ], { routing: { version: 1, minimumLevel: 'medium' } });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0].assignedSlotId).toBe('engineer:2'); // PASS before UNKNOWN
  }));

  it('REQ-17: with only an UNKNOWN slot left it is picked rather than blocking', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer', level: 'high' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ], { routing: { version: 1, minimumLevel: 'medium' } });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'engineer:1' });
  }));
});
