import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignmentText } from '../service.js';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, type ExecutionDispatchAssignment, type ExecutionRecord, type ExecutionWorkUnitInput } from '../store.js';

// Review round 1 fixes for #577 (A7, A8, F5).

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-review-fixes-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Store = ReturnType<typeof createExecutionStore>;
type Seat = { slotId: string; personaId: string; maxContextBytes?: number };

async function running(store: Store, seats: Seat[], unit: Partial<ExecutionWorkUnitInput> = {}, policy?: Record<string, unknown>) {
  let record = (await store.claim({
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [], ...(policy ? { policy } : {}) }
  } as never)).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...seats.map((seat) => ({ slotId: seat.slotId, personaId: seat.personaId, authorizationIdDigest: seat.slotId }))
    ]
  }, 'authorization-digest');
  record = await store.replaceResolvedModels(record.id, seats.map((seat) => ({
    slotId: seat.slotId, personaId: seat.personaId, provider: 'claude', model: 'claude-haiku-4',
    ...(seat.maxContextBytes === undefined ? {} : { maxContextBytes: seat.maxContextBytes })
  })));
  return store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, ...unit }]);
}

async function churn(store: Store, executionId: string, slotId: string) {
  let record = (await store.get(executionId))!;
  for (let i = 0; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) {
    record = await store.claimWork(executionId, record.stateVersion, { role: 'worker', slotId }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(executionId, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
  }
  return record;
}

describe('kickoff reassignment under enforced routing (#577 A7)', () => {
  // Slot engineer:1 has no maxContextBytes fact, so a routed context estimate is UNKNOWN for it.
  const unknownRouting = { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 1_000 };
  const seats: Seat[] = [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: 10_000 }, { slotId: 'engineer:1', personaId: 'engineer' }];

  it('advisory routing still falls back to an UNKNOWN slot', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, seats, { routing: unknownRouting });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0].assignedSlotId).toBe('engineer:1');
  }));

  it('enforced routing refuses an UNKNOWN slot, so the unit goes to a human instead of a refused delivery', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, seats, { routing: unknownRouting });
    record = await churn(store, record.id, 'engineer:0');
    await expect(store.reassignKickoffToFreshSlot(record.id, 'unit', { enforceRouting: true })).rejects.toThrow('no untried eligible worker slot');
  }));
});

describe('kickoff question length (#577 A8)', () => {
  it('cuts a very long title so the blocker still persists', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }], { title: 'T'.repeat(2_000), routing: { version: 1, requiredRole: 'engineer' } });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.workUnits![0].state).toBe('BLOCKED');
    expect(record.blockers![0].question.length).toBeLessThanOrEqual(2_048);
  }));
});

describe('worker slot set is one definition (#577 F5)', () => {
  it('treats an orchestrator-prefixed seat as a coordinator in dispatch, the question and reassignment alike', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'orchestrator:2', personaId: 'engineer' }], { routing: { version: 1, requiredRole: 'engineer' } });
    record = await churn(store, record.id, 'engineer:0');
    await expect(store.reassignKickoffToFreshSlot(record.id, 'unit')).rejects.toThrow('no untried eligible worker slot');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toContain('(engineer:0)');
  }));
});

