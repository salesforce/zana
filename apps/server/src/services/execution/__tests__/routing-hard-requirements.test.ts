import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignmentRequirementFailures, createExecutionStore, hardRequirementsActive, sameWorkerExclusions, type ExecutionWorkUnitInput } from '../store.js';
import { compareCheapestFit, evaluateSlotEligibility, preferMatchCount, preferRoleItems, splitRoleList } from '../routing-policy.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-hard-req-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Store = ReturnType<typeof createExecutionStore>;
interface Seat { slotId: string; personaId: string; label?: string; roles?: string[]; model?: string; skillAllowlist?: string[]; mcpServers?: string[]; level?: 'low' | 'medium' | 'high' | 'extra-high' }

async function running(store: Store, roster: Seat[], units: Array<Partial<ExecutionWorkUnitInput> & { id: string }>, opts: { policy?: boolean; enforce?: boolean } = {}) {
  let record = (await store.claim({
    callerPrincipalId: 's', projectId: 'p', teamId: 't', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] },
    ...(opts.policy === false ? {} : { routingPolicy: { version: 1 as const, hardRequirements: true } })
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...roster.map((slot) => ({ slotId: slot.slotId, personaId: slot.personaId, authorizationIdDigest: slot.slotId }))
    ]
  }, 'digest');
  record = await store.replaceResolvedModels(record.id, roster.map((slot) => ({
    slotId: slot.slotId, personaId: slot.personaId, provider: slot.skillAllowlist || slot.mcpServers ? 'claude' : 'anthropic', model: slot.model ?? 'm',
    ...(slot.label ? { label: slot.label } : {}), ...(slot.roles ? { roles: slot.roles } : {}), ...(slot.level ? { level: slot.level } : {}),
    ...(slot.skillAllowlist ? { skillAllowlist: slot.skillAllowlist } : {}), ...(slot.mcpServers ? { mcpServers: slot.mcpServers } : {})
  })));
  return store.registerPlan(record.id, record.stateVersion, units.map((unit) => ({ title: unit.id, task: 'Work', dependencies: [], readOnly: true, ...unit })));
}

const mk = (filePath: string) => createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
const eng = (n: number, extra: Partial<Seat> = {}): Seat => ({ slotId: `eng:${n}`, personaId: 'engineer', label: 'Engineer', ...extra });

describe('role matching and ranking helpers', () => {
  it('splits, trims and lowercases role lists', () => {
    expect(splitRoleList(' A, b ,,C')).toEqual(['a', 'b', 'c']);
    expect(splitRoleList(undefined)).toEqual([]);
  });
  it('reports each missing required role item as its own hard failure', () => {
    const result = evaluateSlotEligibility({ version: 1, requiredRole: 'Reviewer, Security' }, { slotId: 's', personaId: 'p', label: 'Reviewer' });
    expect(result.status).toBe('FAIL');
    expect(result.hardFailures).toEqual(['required role missing: security']);
    expect(result.softFailures).toEqual([]);
  });
  it('classifies level as soft and role as hard', () => {
    const result = evaluateSlotEligibility({ version: 1, requiredRole: 'x', minimumLevel: 'high' }, { slotId: 's', personaId: 'p', level: 'low' });
    expect(result.hardFailures).toHaveLength(1);
    expect(result.softFailures).toEqual(['minimum model level unmet']);
  });
  it('counts Prefer role items and reads preferredRole as one item', () => {
    const slot = { personaId: 'engineer', label: 'Lead', roles: ['review', 'rust'] };
    expect(preferRoleItems({ preferRoles: ['Review, rust'], preferredRole: 'engineer' })).toEqual(['review', 'rust', 'engineer']);
    expect(preferMatchCount({ preferRoles: ['review', 'rust', 'go'] }, slot)).toBe(2);
    expect(preferMatchCount({ preferredRole: 'engineer' }, slot)).toBe(1);
    expect(preferMatchCount(undefined, slot)).toBe(0);
  });
  it('ranks tie-breaks in order: prefer matches, price, started, not just-finished, then equal', () => {
    const c = (slotId: string, o: object = {}) => ({ slotId, ...o });
    expect(compareCheapestFit(c('a', { preferMatches: 2, priceUsd: 9 }), c('b', { preferMatches: 1, priceUsd: 1 }))).toBeLessThan(0);
    expect(compareCheapestFit(c('a', { priceUsd: 2 }), c('b', { priceUsd: 1 }))).toBeGreaterThan(0);
    expect(compareCheapestFit(c('a'), c('b', { priceUsd: 1 }))).toBeGreaterThan(0);
    expect(compareCheapestFit(c('a', { deferred: true }), c('b'))).toBeGreaterThan(0);
    expect(compareCheapestFit(c('a'), c('b'), 'a')).toBeGreaterThan(0);
    expect(compareCheapestFit(c('a'), c('b'))).toBe(0);
  });
});

describe('dispatch ranking is identical in enforced and advisory mode', () => {
  for (const enforceRouting of [true, false]) {
    it(`prefers the slot matching most Prefer role items (enforce=${enforceRouting})`, async () => fixture(async (filePath) => {
      const store = mk(filePath);
      const record = await running(store, [eng(0, { roles: ['impl'] }), eng(1, { roles: ['impl', 'rust'] }), eng(2)],
        [{ id: 'unit', routing: { version: 1, requiredRole: 'engineer', preferRoles: ['impl', 'rust'] } }]);
      const { assignments, record: after } = await store.dispatchReady(record.id, { enforceRouting });
      expect(assignments.map((a) => a.slotId)).toEqual(['eng:1']);
      expect(after.routingDecisions![0]).toMatchObject({ chosenSlotId: 'eng:1' });
      expect(after.routingDecisions![0].chosenReason).toContain('2 prefer-role match');
    }));
    it(`falls to roster order when all else ties (enforce=${enforceRouting})`, async () => fixture(async (filePath) => {
      const store = mk(filePath);
      const record = await running(store, [eng(0), eng(1)], [{ id: 'unit', routing: { version: 1, requiredRole: 'engineer' } }]);
      expect((await store.dispatchReady(record.id, { enforceRouting })).assignments[0].slotId).toBe('eng:0');
    }));
    it(`deprioritizes the just-finished slot (enforce=${enforceRouting})`, async () => fixture(async (filePath) => {
      const store = mk(filePath);
      const record = await running(store, [eng(0), eng(1)], [{ id: 'unit', routing: { version: 1, requiredRole: 'engineer' } }]);
      expect((await store.dispatchReady(record.id, { enforceRouting, deprioritizeSlotId: 'eng:0' })).assignments[0].slotId).toBe('eng:1');
    }));
  }
});

describe('hard requirements never fall back', () => {
  it('advisory: role mismatch never runs on a non-matching slot and the unit escalates as unsatisfiable', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0)], [{ id: 'unit', routing: { version: 1, requiredRole: 'reviewer' } }]);
    const { assignments, record: after } = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(assignments).toEqual([]);
    expect(after.workUnits![0]).toMatchObject({ state: 'BLOCKED' });
    expect(after.blockers).toMatchObject([{ audience: 'coordinator', noRoute: true, question: expect.stringContaining('Roles offered: engineer') }]);
  }));
  it('advisory: a role-matching busy slot makes the unit wait, never fall back to a free non-matching slot', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0), { slotId: 'rev:0', personaId: 'reviewer', label: 'Reviewer' }], [
      { id: 'a', routing: { version: 1, requiredRole: 'reviewer' } },
      { id: 'b', routing: { version: 1, requiredRole: 'reviewer' } }
    ]);
    const first = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(first.assignments.map((a) => `${a.workUnitId}:${a.slotId}`)).toEqual(['a:rev:0']);
    expect(first.record.workUnits![1].state).toBe('READY');
  }));
  it('advisory: skill and MCP misses never fall back', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0, { skillAllowlist: ['other'] })], [{ id: 'unit', requires: { skills: ['needed'] } }]);
    const { assignments, record: after } = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(assignments).toEqual([]);
    expect(after.workUnits![0].state).toBe('BLOCKED');
    expect(after.blockers![0].noRoute).toBe(true);
  }));
  it('advisory: level miss still falls back to any free slot (soft)', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0, { level: 'low' })], [{ id: 'unit', routing: { version: 1, requiredRole: 'engineer', minimumLevel: 'high' } }]);
    expect((await store.dispatchReady(record.id, { enforceRouting: false })).assignments.map((a) => a.slotId)).toEqual(['eng:0']);
  }));
  it('Not same worker as: excludes every slot in the referenced claim history', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, [eng(0), eng(1)], [
      { id: 'build', routing: { version: 1, requiredRole: 'engineer' } },
      { id: 'review', dependencies: ['build'], routing: { version: 1, requiredRole: 'engineer', excludeSameWorkerAs: ['build'] } }
    ]);
    const first = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(first.assignments[0]).toMatchObject({ workUnitId: 'build', slotId: 'eng:0' });
    record = await store.completeWork(record.id, first.record.stateVersion, { role: 'worker', slotId: 'eng:0' }, 'build', 'done').catch(async () => first.record);
    const reviewUnit = (await store.get(record.id))!;
    expect(sameWorkerExclusions(reviewUnit, reviewUnit.workUnits![1])).toEqual(new Set(['eng:0']));
  }));
  it('Not same worker as: escalates (blocks) when exclusion leaves no roster slot, in both modes', async () => fixture(async (filePath) => {
    for (const enforceRouting of [true, false]) {
      const store = mk(filePath + String(enforceRouting));
      const record = await running(store, [eng(0)], [
        { id: 'build', routing: { version: 1, requiredRole: 'engineer' } },
        { id: 'review', dependencies: ['build'], routing: { version: 1, requiredRole: 'engineer', excludeSameWorkerAs: ['build'] } }
      ]);
      const first = await store.dispatchReady(record.id, { enforceRouting });
      const done = await store.completeWork(record.id, first.record.stateVersion, { role: 'worker', slotId: 'eng:0' }, 'build', 'done');
      const next = await store.dispatchReady(done.id, { enforceRouting });
      expect(next.assignments).toEqual([]);
      expect(next.record.workUnits!.find((u) => u.id === 'review')).toMatchObject({ state: 'BLOCKED' });
    }
  }));
});

describe('hard predicate on every assignment path', () => {
  it('claimWork rejects a coordinator assignment to a non-matching slot', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0), { slotId: 'rev:0', personaId: 'reviewer', label: 'Reviewer' }], [{ id: 'unit', routing: { version: 1, requiredRole: 'reviewer' } }]);
    await expect(store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'eng:0')).rejects.toThrow(/cannot run on eng:0.*required role missing: reviewer/);
    const ok = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'rev:0');
    expect(ok.workUnits![0].assignedSlotId).toBe('rev:0');
  }));
  it('dispatch leaves an assignedSlotId pointing at a non-matching slot unclaimed', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, [eng(0), { slotId: 'rev:0', personaId: 'reviewer', label: 'Reviewer' }], [{ id: 'unit', routing: { version: 1, requiredRole: 'reviewer' } }]);
    record = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'eng:0').catch(async () => record);
    const unit = (await store.get(record.id))!.workUnits![0];
    // Even if a record carried the bad pin, assignment predicate reports the failure.
    const failures = assignmentRequirementFailures(record, unit, { slotId: 'eng:0', personaId: 'engineer' });
    expect(failures.hardFailures).toEqual(['required role missing: reviewer']);
  }));
  it('reassignWork rejects a pin that violates hard requirements instead of leaving the unit READY forever', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0), { slotId: 'rev:0', personaId: 'reviewer', label: 'Reviewer' }], [{ id: 'unit', routing: { version: 1, requiredRole: 'reviewer' } }]);
    await expect(store.reassignWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'eng:0')).rejects.toThrow(/cannot run on eng:0.*required role missing: reviewer/);
    const ok = await store.reassignWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'rev:0');
    expect(ok.workUnits![0].assignedSlotId).toBe('rev:0');
  }));
  it('retryWork rejects a pin that violates hard requirements and leaves the unit failed', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await running(store, [eng(0), { slotId: 'rev:0', personaId: 'reviewer', label: 'Reviewer' }], [{ id: 'unit', routing: { version: 1, requiredRole: 'reviewer' } }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'rev:0');
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'rev:0' }, 'unit', 'boom');
    expect(record.workUnits![0].state).toBe('FAILED');
    await expect(store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'eng:0')).rejects.toThrow(/cannot run on eng:0.*required role missing: reviewer/);
    expect((await store.get(record.id))!.workUnits![0].state).toBe('FAILED');
    const ok = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator' }, 'unit', 'rev:0');
    expect(ok.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'rev:0' });
  }));
  it('kickoff reassignment skips a slot with a hard failure', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0), { slotId: 'rev:0', personaId: 'reviewer', label: 'Reviewer' }], [{ id: 'unit', routing: { version: 1, requiredRole: 'engineer' } }]);
    const failures = assignmentRequirementFailures(record, record.workUnits![0], { slotId: 'rev:0', personaId: 'reviewer' });
    expect(failures.hardFailures.length).toBeGreaterThan(0);
  }));
  it('a run without routingPolicy dispatches as before (advisory fallback keeps working)', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await running(store, [eng(0)], [{ id: 'unit', routing: { version: 1, requiredRole: 'reviewer' } }], { policy: false });
    expect(hardRequirementsActive(record)).toBe(false);
    expect(assignmentRequirementFailures(record, record.workUnits![0], { slotId: 'eng:0', personaId: 'engineer' })).toEqual({ hardFailures: [], softFailures: [] });
    expect((await store.dispatchReady(record.id, { enforceRouting: false })).assignments.map((a) => a.slotId)).toEqual(['eng:0']);
  }));
  it('a record with routingPolicy round-trips through the store', async () => fixture(async (filePath) => {
    const record = await running(mk(filePath), [eng(0)], [{ id: 'unit' }]);
    expect((await mk(filePath).get(record.id))!.routingPolicy).toEqual({ version: 1, hardRequirements: true });
  }));
});
