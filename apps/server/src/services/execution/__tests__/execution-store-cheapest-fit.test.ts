import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, type ExecutionWorkUnitInput } from '../store.js';
import { compareCheapestFit, NOMINAL_CONTEXT_BYTES, slotRankingPriceUsd } from '../routing-policy.js';

// Advisory cheapest-fit: price, unpriced-last, live-before-deferred (D11), stable roster-order ties.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-cheapest-fit-'));
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
interface Seat { slotId: string; personaId?: string; model?: string; provider?: string; skillAllowlist?: string[] }
const HAIKU = 'claude-haiku-4';
const SONNET = 'claude-sonnet-4';
const OPUS = 'claude-opus-4';

async function running(store: Store, roster: Seat[], unit: Partial<ExecutionWorkUnitInput> = {}) {
  let record = (await store.claim(request())).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...roster.map((slot) => ({ slotId: slot.slotId, personaId: slot.personaId ?? 'engineer', authorizationIdDigest: slot.slotId }))
    ]
  }, 'authorization-digest');
  // Unmodeled seats get a provider/model the catalog does not price.
  record = await store.replaceResolvedModels(record.id, roster.map((slot) => ({
    slotId: slot.slotId, personaId: slot.personaId ?? 'engineer', provider: slot.provider ?? (slot.model ? 'claude' : 'other'), model: slot.model ?? 'unpriced', maxContextBytes: 10_000_000,
    ...(slot.skillAllowlist ? { skillAllowlist: slot.skillAllowlist } : {})
  })));
  return store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, ...unit }]);
}

async function pick(filePath: string, roster: Seat[], unit: Partial<ExecutionWorkUnitInput> = {}, opts?: Parameters<Store['dispatchReady']>[1]) {
  const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
  const record = await running(store, roster, unit);
  return (await store.dispatchReady(record.id, opts)).assignments[0]?.slotId;
}

describe('advisory dispatch picks the cheapest eligible free slot', () => {
  it('orders haiku < sonnet < opus regardless of roster order', async () => fixture(async (filePath) => {
    expect(await pick(`${filePath}.a`, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: SONNET }, { slotId: 'w2', model: HAIKU }])).toBe('w2');
    expect(await pick(`${filePath}.b`, [{ slotId: 'w0', model: HAIKU }, { slotId: 'w1', model: SONNET }])).toBe('w0');
  }));

  it('ranks by price with an explicit byte estimate as well', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], { routing: { version: 1, estimatedContextBytes: 1_000 } })).toBe('w1');
  }));

  it('sorts unpriced slots after priced ones', async () => fixture(async (filePath) => {
    expect(await pick(`${filePath}.a`, [{ slotId: 'w0' }, { slotId: 'w1', model: OPUS }])).toBe('w1');
    expect(await pick(`${filePath}.b`, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1' }])).toBe('w0');
  }));

  it('keeps roster order on a price tie (including all unpriced: unchanged from first-free)', async () => fixture(async (filePath) => {
    expect(await pick(`${filePath}.a`, [{ slotId: 'w1', model: SONNET }, { slotId: 'w0', model: SONNET }])).toBe('w1');
    expect(await pick(`${filePath}.b`, [{ slotId: 'w1' }, { slotId: 'w0' }, { slotId: 'w2' }])).toBe('w1');
  }));

  it('sends the unit to the cheapest peer, not the just-finished slot, on a price tie', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: SONNET }, { slotId: 'w1', model: SONNET }], {}, { deprioritizeSlotId: 'w0' })).toBe('w1');
  }));

  it('still prefers a cheaper just-finished slot (price outranks deprioritize)', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: HAIKU }, { slotId: 'w1', model: OPUS }], {}, { deprioritizeSlotId: 'w0' })).toBe('w0');
  }));

  it('applies the preferredRole persona filter before price', async () => fixture(async (filePath) => {
    const roster = [{ slotId: 'w0', personaId: 'engineer', model: HAIKU }, { slotId: 'w1', personaId: 'reviewer', model: OPUS }, { slotId: 'w2', personaId: 'reviewer', model: SONNET }];
    expect(await pick(`${filePath}.a`, roster, { preferredRole: 'reviewer' })).toBe('w2');
    // No slot has the preferred persona: filter does not empty the pool.
    expect(await pick(`${filePath}.b`, roster, { preferredRole: 'ghost' })).toBe('w0');
  }));

  it('honors excludedSlots by skipping a cheaper no-progress slot', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'w0', model: HAIKU }, { slotId: 'w1', model: OPUS }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'w0' }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
    const { assignments } = await store.dispatchReady(record.id);
    expect(assignments[0].slotId).toBe('w1');
  }));

  it('does not mutate the immutable shadow decision', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], { routing: { version: 1, requiredRole: 'engineer', estimatedContextBytes: 1_000 } });
    const first = await store.dispatchReady(record.id);
    const decisions = JSON.stringify(first.record.routingDecisions);
    expect(first.assignments[0].slotId).toBe('w1');
    expect(decisions).toContain('"recommendedSlotId":"w1"');
  }));
});

describe('live-before-deferred (D11)', () => {
  const deferred = (...ids: string[]) => ({ deferredSlotIds: new Set(ids) });
  it('a live slot beats a deferred slot of the same price', async () => fixture(async (filePath) => {
    expect(await pick(`${filePath}.a`, [{ slotId: 'w0', model: SONNET }, { slotId: 'w1', model: SONNET }], {}, deferred('w0'))).toBe('w1');
    expect(await pick(`${filePath}.b`, [{ slotId: 'w0' }, { slotId: 'w1' }], {}, deferred('w0'))).toBe('w1');
  }));
  it('a strictly cheaper deferred slot beats a live one', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], {}, deferred('w1'))).toBe('w1');
  }));
  it('an all-deferred roster still dispatches by price then roster order', async () => fixture(async (filePath) => {
    expect(await pick(`${filePath}.a`, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], {}, deferred('w0', 'w1'))).toBe('w1');
    expect(await pick(`${filePath}.b`, [{ slotId: 'w0' }, { slotId: 'w1' }], {}, deferred('w0', 'w1'))).toBe('w0');
  }));
});

describe('enforce mode', () => {
  const routing = { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 1_000 };
  it('follows the recommendation for routed units', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], { routing }, { enforceRouting: true })).toBe('w1');
  }));
  it('unrouted units use cheapest-fit in enforce mode too', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], {}, { enforceRouting: true })).toBe('w1');
  }));
  async function excludeW0(filePath: string, roster: Seat[], unit: Partial<ExecutionWorkUnitInput>) {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, roster, unit);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'w0' }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
    return store.dispatchReady(record.id, { enforceRouting: true });
  }
  it('dispatches to another free PASS slot when the cheapest qualified slot is excluded (AC2)', async () => fixture(async (filePath) => {
    const { assignments } = await excludeW0(filePath, [{ slotId: 'w0', model: HAIKU }, { slotId: 'w1', model: OPUS }], { routing });
    expect(assignments.map((a) => a.slotId)).toEqual(['w1']);
  }));
  it('leaves the unit READY when every qualified slot is excluded', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, [{ slotId: 'w0', model: HAIKU }, { slotId: 'w1', personaId: 'reviewer', model: OPUS }], { routing });
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'w0' }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
    const { assignments, record: after } = await store.dispatchReady(record.id, { enforceRouting: true });
    expect(assignments).toEqual([]);
    expect(after.workUnits![0].state).toBe('READY');
  }));
});

describe('advisory dispatch respects routing and skill reach', () => {
  it('never sends a requiredRole unit to a cheaper slot of another role', async () => fixture(async (filePath) => {
    const roster = [{ slotId: 'w0', personaId: 'engineer', model: HAIKU }, { slotId: 'w1', personaId: 'reviewer', model: OPUS }, { slotId: 'w2', personaId: 'reviewer', model: SONNET }];
    expect(await pick(filePath, roster, { routing: { version: 1, requiredRole: 'reviewer' } })).toBe('w2');
  }));
  it('honors hardSlotId over a cheaper slot', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: HAIKU }, { slotId: 'w1', model: OPUS }], { routing: { version: 1, hardSlotId: 'w1' } })).toBe('w1');
  }));
  it('falls back to cheapest open slot when no slot passes routing (advisory)', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], { routing: { version: 1, requiredRole: 'ghost' } })).toBe('w1');
  }));
  it('keeps cheapest-fit across all slots when routing has no hard constraint', async () => fixture(async (filePath) => {
    expect(await pick(filePath, [{ slotId: 'w0', model: OPUS }, { slotId: 'w1', model: HAIKU }], { routing: { version: 1, preferredRole: 'ghost' } })).toBe('w1');
  }));
  it('skips a cheaper slot whose allowlist cannot reach a required skill', async () => fixture(async (filePath) => {
    const roster = [{ slotId: 'w0', model: HAIKU, skillAllowlist: ['zcc-inbox'] }, { slotId: 'w1', model: OPUS }, { slotId: 'w2', model: SONNET, skillAllowlist: ['plugin:review'] }];
    expect(await pick(`${filePath}.a`, roster, { requires: { skills: ['review'] } })).toBe('w2');
    expect(await pick(`${filePath}.b`, roster, { requires: { skills: ['review'] }, routing: { version: 1 } })).toBe('w2');
    expect(await pick(`${filePath}.c`, roster, {})).toBe('w0');
  }));
  it('fails a skill-requiring unit NO_QUALIFIED_ROUTE when no worker slot at all reaches the skill, even without routing', async () => fixture(async (filePath) => {
    const roster = [{ slotId: 'w0', model: HAIKU, skillAllowlist: ['zcc-inbox'] }];
    const store = createExecutionStore({ filePath: `${filePath}.a`, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, roster, { requires: { skills: ['review'] } });
    const { record: after, assignments } = await store.dispatchReady(record.id);
    expect(assignments).toEqual([]);
    expect(after.workUnits![0]).toMatchObject({ state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE', failure: 'no authorized worker slot allows every required skill' });
    expect((await store.get(record.id))!.workUnits![0].state).toBe('FAILED');
  }));
  it('keeps a skill-requiring unit READY (not failed) while the only capable slot is busy', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const roster = [{ slotId: 'w0', model: HAIKU, skillAllowlist: ['review'] }];
    let record = await running(store, roster, { id: 'a', requires: { skills: ['review'] } } as Partial<ExecutionWorkUnitInput>);
    record = (await store.dispatchReady(record.id)).record;
    expect(record.workUnits![0].state).toBe('CLAIMED');
  }));
  it('an allowlist on a non-enforcing harness does not restrict the slot', async () => fixture(async (filePath) => {
    const roster = [{ slotId: 'w0', model: HAIKU, provider: 'codex', skillAllowlist: ['zcc-inbox'] }];
    expect(await pick(filePath, roster, { requires: { skills: ['review'] } })).toBe('w0');
  }));
  it('enforce treats a skill-restricted slot as FAIL', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [{ slotId: 'w0', model: HAIKU, skillAllowlist: ['zcc-inbox'] }], { requires: { skills: ['review'] }, routing: { version: 1 } });
    const { record: after } = await store.dispatchReady(record.id, { enforceRouting: true });
    expect(after.workUnits![0]).toMatchObject({ state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE' });
    expect(after.routingDecisions![0].candidates[0].reasons).toContain('skill unreachable: review');
  }));
});

describe('kickoff reassignment uses the same comparator', () => {
  async function reassigned(filePath: string, roster: Seat[], unit: Partial<ExecutionWorkUnitInput>, opts?: Parameters<Store['reassignKickoffToFreshSlot']>[2]) {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, roster, unit);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: roster[0].slotId }, 'unit');
    for (let i = 0; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) {
      const claim = (await store.get(record.id))!.workUnits![0];
      record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
      if (i < KICKOFF_FAILURE_BLOCK_THRESHOLD - 1) record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: roster[0].slotId }, 'unit');
    }
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit', opts);
    return record.workUnits![0].assignedSlotId;
  }
  const roster = (a: Seat, b: Seat, c: Seat): Seat[] => [{ slotId: 'w0', model: SONNET }, a, b, c];

  it('picks the cheapest untried slot without routing', async () => fixture(async (filePath) => {
    expect(await reassigned(filePath, roster({ slotId: 'w1', model: OPUS }, { slotId: 'w2', model: HAIKU }, { slotId: 'w3' }), {})).toBe('w2');
  }));
  it('with no pricing data keeps first untried (unchanged behavior)', async () => fixture(async (filePath) => {
    expect(await reassigned(filePath, [{ slotId: 'w0' }, { slotId: 'w1' }, { slotId: 'w2' }], {})).toBe('w1');
  }));
  it('never reassigns to a slot whose allowlist cannot reach a required skill', async () => fixture(async (filePath) => {
    const seats = roster({ slotId: 'w1', model: HAIKU, skillAllowlist: ['zcc-inbox'] }, { slotId: 'w2', model: OPUS }, { slotId: 'w3', model: OPUS, skillAllowlist: ['zcc-inbox'] });
    expect(await reassigned(filePath, seats, { requires: { skills: ['review'] }, routing: { version: 1 } })).toBe('w2');
  }));
  it('never reassigns an UNROUTED unit to a skill-restricted slot', async () => fixture(async (filePath) => {
    const seats = roster({ slotId: 'w1', model: HAIKU, skillAllowlist: ['zcc-inbox'] }, { slotId: 'w2', model: OPUS }, { slotId: 'w3', model: OPUS, skillAllowlist: ['zcc-inbox'] });
    expect(await reassigned(filePath, seats, { requires: { skills: ['review'] } })).toBe('w2');
  }));
  it('does not skill-restrict an unrouted reassignment onto a non-enforcing harness', async () => fixture(async (filePath) => {
    const seats = roster({ slotId: 'w1', model: HAIKU, provider: 'codex', skillAllowlist: ['zcc-inbox'] }, { slotId: 'w2', model: OPUS, skillAllowlist: ['zcc-inbox'] }, { slotId: 'w3', model: OPUS, skillAllowlist: ['zcc-inbox'] });
    expect(await reassigned(filePath, seats, { requires: { skills: ['review'] } })).toBe('w1');
  }));
  it('throws when every untried slot is skill-restricted (unrouted)', async () => fixture(async (filePath) => {
    const seats = roster({ slotId: 'w1', model: HAIKU, skillAllowlist: ['zcc-inbox'] }, { slotId: 'w2', model: OPUS, skillAllowlist: ['zcc-inbox'] }, { slotId: 'w3', model: OPUS, skillAllowlist: ['zcc-inbox'] });
    await expect(reassigned(filePath, seats, { requires: { skills: ['review'] } })).rejects.toThrow(/no untried worker slot/);
  }));
  it('picks the cheapest PASS slot under routing and never a FAIL slot', async () => fixture(async (filePath) => {
    const seats = roster({ slotId: 'w1', model: OPUS }, { slotId: 'w2', personaId: 'reviewer', model: HAIKU }, { slotId: 'w3', model: SONNET });
    expect(await reassigned(filePath, seats, { routing: { version: 1, requiredRole: 'engineer' } })).toBe('w3');
  }));
  it('prefers a live slot over a deferred one at the same price, but a cheaper deferred wins', async () => fixture(async (filePath) => {
    const same = roster({ slotId: 'w1', model: SONNET }, { slotId: 'w2', model: SONNET }, { slotId: 'w3', model: SONNET });
    expect(await reassigned(`${filePath}.a`, same, {}, { deferredSlotIds: new Set(['w1']) })).toBe('w2');
    const cheaper = roster({ slotId: 'w1', model: OPUS }, { slotId: 'w2', model: SONNET }, { slotId: 'w3', model: HAIKU });
    expect(await reassigned(`${filePath}.b`, cheaper, {}, { deferredSlotIds: new Set(['w3']) })).toBe('w3');
  }));
});

describe('comparator and price helpers', () => {
  it('never subtracts undefined and treats equal candidates as ties', () => {
    expect(compareCheapestFit({ slotId: 'a' }, { slotId: 'b', priceUsd: 1 })).toBe(1);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b' })).toBe(-1);
    expect(compareCheapestFit({ slotId: 'a' }, { slotId: 'b' })).toBe(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 2 }, { slotId: 'b', priceUsd: 1 })).toBe(1);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1 })).toBe(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1, deferred: true }, { slotId: 'b', priceUsd: 1 })).toBe(1);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1 }, 'a')).toBe(1);
  });
  it('prices at the nominal size by default and is undefined without catalog data', () => {
    expect(slotRankingPriceUsd({ provider: 'claude', model: HAIKU })).toBe(slotRankingPriceUsd({ provider: 'claude', model: HAIKU }, NOMINAL_CONTEXT_BYTES));
    expect(slotRankingPriceUsd({ provider: 'claude', model: HAIKU })).toBeGreaterThan(0);
    expect(slotRankingPriceUsd({ provider: 'cursor', model: 'x' })).toBeUndefined();
    expect(slotRankingPriceUsd({})).toBeUndefined();
  });
});
