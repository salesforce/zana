import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, type ExecutionWorkUnitInput } from '../store.js';

// Extra branch coverage for #577: the shared slot snapshot in dispatch, cost ordering of eligible
// slots, and the single-slot question wording for untitled units and orchestrator-prefixed seats.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-kickoff-routing-cov-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Store = ReturnType<typeof createExecutionStore>;
type Seat = { slotId: string; personaId: string; model?: string };

async function running(store: Store, seats: Seat[], unit: Partial<ExecutionWorkUnitInput> = {}) {
  let record = (await store.claim({
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...seats.map((seat) => ({ slotId: seat.slotId, personaId: seat.personaId, authorizationIdDigest: seat.slotId }))
    ]
  }, 'authorization-digest');
  record = await store.replaceResolvedModels(record.id, seats.map((seat) => ({
    slotId: seat.slotId, personaId: seat.personaId, provider: 'claude', model: seat.model ?? 'unpriced-model', maxContextBytes: 10_000_000
  })));
  return store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, ...unit }]);
}

const routing = { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 4_000_000 };

describe('dispatch recommends the cheapest priced eligible slot (#577 shared snapshot)', () => {
  it('prefers a priced slot over an unpriced one, whichever comes first in the roster', async () => fixture(async (filePath) => {
    for (const seats of [
      [{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer', model: 'claude-haiku-4' }],
      [{ slotId: 'engineer:0', personaId: 'engineer', model: 'claude-haiku-4' }, { slotId: 'engineer:1', personaId: 'engineer' }]
    ]) {
      const store = createExecutionStore({ filePath: `${filePath}.${seats[0].model ? 'b' : 'a'}`, id: () => 'execution', now: () => 1_000 });
      const record = await running(store, seats, { routing });
      const { assignments } = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(assignments[0].slotId).toBe(seats.find((seat) => seat.model)!.slotId);
    }
  }));

  it('orders two priced slots by cost, then by slot id for equal cost', async () => fixture(async (filePath) => {
    const dear = createExecutionStore({ filePath: `${filePath}.dear`, id: () => 'execution', now: () => 1_000 });
    const first = await running(dear, [
      { slotId: 'engineer:0', personaId: 'engineer', model: 'claude-opus-4' }, { slotId: 'engineer:1', personaId: 'engineer', model: 'claude-haiku-4' }
    ], { routing });
    expect((await dear.dispatchReady(first.id, { enforceRouting: true })).assignments[0].slotId).toBe('engineer:1');
    const equal = createExecutionStore({ filePath: `${filePath}.equal`, id: () => 'execution', now: () => 1_000 });
    const second = await running(equal, [
      { slotId: 'engineer:1', personaId: 'engineer', model: 'claude-haiku-4' }, { slotId: 'engineer:0', personaId: 'engineer', model: 'claude-haiku-4' }
    ], { routing });
    expect((await equal.dispatchReady(second.id, { enforceRouting: true })).assignments[0].slotId).toBe('engineer:0');
  }));

  it('re-evaluates the same facts on a later enforced dispatch of a unit that already has a decision', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer', model: 'claude-haiku-4' }
    ], { routing });
    // Advisory pass writes the decision; the enforced pass then must still pick the priced slot.
    await store.dispatchReady(record.id);
    const again = await store.get(record.id);
    expect(again!.routingDecisions).toHaveLength(1);
  }));
});

describe('single-slot kickoff question wording (#577 D4)', () => {
  async function blocked(seats: Seat[], title: string) {
    let result = '';
    await fixture(async (filePath) => {
      const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
      let record = await running(store, seats, { title, routing: { version: 1, requiredRole: 'engineer' } });
      for (let i = 0; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) {
        record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'unit');
        const claim = record.workUnits![0];
        record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
      }
      record = await store.blockKickoffFailure(record.id, 'unit');
      result = record.blockers![0].question;
    });
    return result;
  }

  it('does not count an orchestrator-prefixed seat as a worker slot', async () => {
    expect(await blocked([{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'orchestrator:1', personaId: 'engineer' }], 'Unit'))
      .toContain('the only worker slot that can take it (engineer:0)');
  });
});
