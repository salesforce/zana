import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, WorkUnitRecoveryGuardError, type ExecutionWorkUnitInput } from '../store.js';

// Kickoff reassignment, the human question and dispatch must honour the unit's routing.

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
type Roster = Array<{ slotId: string; personaId: string; level?: 'low' | 'medium' | 'high' | 'extra-high'; maxContextBytes?: number; model?: string }>;

async function running(store: Store, roster: Roster, unit: Partial<ExecutionWorkUnitInput> = {}, extra: ExecutionWorkUnitInput[] = []) {
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
    slotId: slot.slotId, personaId: slot.personaId, provider: slot.model ? 'claude' : 'anthropic', model: slot.model ?? 'm', ...(slot.level ? { level: slot.level } : {}),
    ...(slot.maxContextBytes === undefined ? {} : { maxContextBytes: slot.maxContextBytes })
  })));
  return store.registerPlan(record.id, record.stateVersion, [...extra, { id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, ...unit }]);
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

describe('kickoff reassignment honours routing', () => {
  it('picks the next untried engineer slot, never the reviewer seat', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    // Reviewer sits between the two engineers so roster order alone would pick it.
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'engineer:1' });
  }));

  it('throws WorkUnitRecoveryGuardError when every untried slot fails the routing', async () => fixture(async (filePath) => {
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

  it('a unit without routing still goes to the first untried slot in roster order', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ]);
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'reviewer:0' });
  }));

  it('the human question names the single slot that can take a routed unit', async () => fixture(async (filePath) => {
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

  it('a unit without routing keeps today\'s exact question', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }]);
    record = await churn(store, record.id, 'engineer:0', 1);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toBe(today());
  }));

  it('a routed unit with several eligible slots keeps today\'s exact question', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0', 1);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toBe(today());
  }));

  it('an UNKNOWN slot (no level fact) is still picked, after any PASS slot', async () => fixture(async (filePath) => {
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

  it('with only an UNKNOWN slot left it is picked rather than blocking', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer', level: 'high' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ], { routing: { version: 1, minimumLevel: 'medium' } });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'engineer:1' });
  }));

  it('a routed unit with no eligible slot at all keeps today\'s exact question', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'reviewer:0', personaId: 'reviewer' }, { slotId: 'reviewer:1', personaId: 'reviewer' }
    ], { routing: engineerRouting });
    record = await churn(store, record.id, 'reviewer:0', 1);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toBe(today());
  }));

  it('an unrouted unit skips a previously tried slot and takes the first untried one in roster order', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer' }, { slotId: 'engineer:2', personaId: 'engineer' }
    ]);
    record = await churn(store, record.id, 'engineer:1');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0].assignedSlotId).toBe('engineer:0');
  }));
});

describe('kickoff reassignment under enforced routing', () => {
  // Slot engineer:1 has no maxContextBytes fact, so a routed context estimate is UNKNOWN for it.
  const unknownRouting = { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 1_000 };
  const seats: Roster = [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: 10_000 }, { slotId: 'engineer:1', personaId: 'engineer' }];

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

describe('kickoff question length', () => {
  it('cuts a very long title so the blocker still persists', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }], { title: 'T'.repeat(2_000), routing: { version: 1, requiredRole: 'engineer' } });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.workUnits![0].state).toBe('BLOCKED');
    expect(record.blockers![0].question.length).toBeLessThanOrEqual(2_048);
  }));
});

describe('worker slot set is one definition', () => {
  it('treats an orchestrator-prefixed seat as a coordinator in dispatch, the question and reassignment alike', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'orchestrator:2', personaId: 'engineer' }], { routing: { version: 1, requiredRole: 'engineer' } });
    record = await churn(store, record.id, 'engineer:0');
    await expect(store.reassignKickoffToFreshSlot(record.id, 'unit')).rejects.toThrow('no untried eligible worker slot');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toContain('(engineer:0)');
  }));
});


describe('enforced routing: question wording counts PASS slots only', () => {
  const routing = { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 1_000 };

  it('names the only PASS slot even though another slot is UNKNOWN, when enforced', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: 10_000 }, { slotId: 'engineer:1', personaId: 'engineer' }], { routing });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.blockKickoffFailure(record.id, 'unit', undefined, { enforceRouting: true });
    expect(record.blockers![0].question).toContain('the only worker slot that can take it (engineer:0)');
  }));

  it('keeps the generic wording under advisory routing, where the UNKNOWN slot could take it', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: 10_000 }, { slotId: 'engineer:1', personaId: 'engineer' }], { routing });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toContain('made no progress on every eligible worker slot');
  }));
});

const costRouting = { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 4_000_000 };
const roomy = 10_000_000;

describe('dispatch recommends the cheapest priced eligible slot', () => {
  it('prefers a priced slot over an unpriced one, whichever comes first in the roster', async () => fixture(async (filePath) => {
    for (const seats of [
      [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: roomy }, { slotId: 'engineer:1', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }],
      [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }, { slotId: 'engineer:1', personaId: 'engineer', maxContextBytes: roomy }]
    ]) {
      const store = createExecutionStore({ filePath: `${filePath}.${seats[0].model ? 'b' : 'a'}`, id: () => 'execution', now: () => 1_000 });
      const record = await running(store, seats, { routing: costRouting });
      const { assignments } = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(assignments[0].slotId).toBe(seats.find((seat) => seat.model)!.slotId);
    }
  }));

  it('orders two priced slots by cost, then by slot id for equal cost', async () => fixture(async (filePath) => {
    const dear = createExecutionStore({ filePath: `${filePath}.dear`, id: () => 'execution', now: () => 1_000 });
    const first = await running(dear, [
      { slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-opus-4' }, { slotId: 'engineer:1', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }
    ], { routing: costRouting });
    expect((await dear.dispatchReady(first.id, { enforceRouting: true })).assignments[0].slotId).toBe('engineer:1');
    const equal = createExecutionStore({ filePath: `${filePath}.equal`, id: () => 'execution', now: () => 1_000 });
    const second = await running(equal, [
      { slotId: 'engineer:1', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }, { slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }
    ], { routing: costRouting });
    expect((await equal.dispatchReady(second.id, { enforceRouting: true })).assignments[0].slotId).toBe('engineer:0');
  }));

  it('assigns the freed slot on a later advisory pass without recording a second decision', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    // 'plain' takes the only worker slot, so the routed unit stays READY with its decision recorded.
    const record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }], { routing: costRouting },
      [{ id: 'plain', title: 'Plain', task: 'Work', dependencies: [], readOnly: true }]);
    const first = await store.dispatchReady(record.id);
    expect(first.record.workUnits!.find((unit) => unit.id === 'plain')!.state).toBe('CLAIMED');
    expect(first.record.routingDecisions).toHaveLength(1);
    // Free the slot: the advisory pass reuses the stored decision.
    const plain = first.record.workUnits!.find((unit) => unit.id === 'plain')!;
    const done = await store.completeWork(record.id, first.record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'plain', 'ok', { claimId: plain.claimId!, claimGeneration: plain.claimGeneration! });
    const advisory = await store.dispatchReady(done.id);
    expect(advisory.assignments).toMatchObject([{ workUnitId: 'unit', slotId: 'engineer:0' }]);
    expect(advisory.record.routingDecisions).toHaveLength(1);
  }));

  it('assigns the free slot on an enforced pass when a decision is already on record', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer', maxContextBytes: roomy, model: 'claude-haiku-4' }], { routing: costRouting },
      [{ id: 'plain', title: 'Plain', task: 'Work', dependencies: [], readOnly: true }]);
    const first = await store.dispatchReady(record.id);
    const plain = first.record.workUnits!.find((unit) => unit.id === 'plain')!;
    const done = await store.completeWork(record.id, first.record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'plain', 'ok', { claimId: plain.claimId!, claimGeneration: plain.claimGeneration! });
    const enforced = await store.dispatchReady(done.id, { enforceRouting: true });
    expect(enforced.assignments).toMatchObject([{ workUnitId: 'unit', slotId: 'engineer:0' }]);
  }));
});

describe('single-slot kickoff question wording', () => {
  it('does not count an orchestrator-prefixed seat as a worker slot', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'orchestrator:1', personaId: 'engineer' }], { routing: engineerRouting });
    record = await churn(store, record.id, 'engineer:0');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toContain('the only worker slot that can take it (engineer:0)');
  }));
});

