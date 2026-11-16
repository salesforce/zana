import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_UNKNOWN_ESCALATE_MS, createExecutionStore, mergeFrozenRoster, type ExecutionWorkUnitInput, type ResolvedModelSnapshotV1 } from '../store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-review-fixes-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Store = ReturnType<typeof createExecutionStore>;
const SLOTS = [
  { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'o' },
  { slotId: 'eng:0', personaId: 'engineer', authorizationIdDigest: 'e' }
];
const ENG: ResolvedModelSnapshotV1 = { slotId: 'eng:0', personaId: 'engineer', provider: 'anthropic', model: 'm', label: 'Engineer', roles: ['builder'] };

async function started(store: Store, opts: { policy?: boolean; model?: ResolvedModelSnapshotV1 } = {}) {
  let record = (await store.claim({
    callerPrincipalId: 's', projectId: 'project-1', teamId: 'team-1', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] },
    ...(opts.policy === false ? {} : { routingPolicy: { version: 1 as const, hardRequirements: true } })
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, { version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: SLOTS }, 'digest');
  return store.replaceResolvedModels(record.id, [opts.model ?? ENG]);
}
const plan = (store: Store, id: string, version: number, units: Array<Partial<ExecutionWorkUnitInput> & { id: string }>) =>
  store.registerPlan(id, version, units.map((unit) => ({ title: unit.id, task: 'Work', dependencies: [], readOnly: true, ...unit })));
const mk = (filePath: string, now: () => number = () => 1_000) => createExecutionStore({ filePath, id: () => 'execution-1', now });

describe('finding 1: a running job keeps the roster it launched with', () => {
  it('a refresh from an edited live Squad takes live facts but keeps frozen identity, roles and allowlists', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    let record = await started(store, { model: { ...ENG, skillAllowlist: ['s1'], mcpServers: ['m1'] } });
    record = await store.replaceResolvedModels(record.id, [
      { slotId: 'eng:0', personaId: 'engineer', provider: 'openai', model: 'm2', level: 'high' as never, label: 'Renamed', roles: ['auditor'], skillAllowlist: [], mcpServers: ['evil'] },
      { slotId: 'new:0', personaId: 'extra', provider: 'openai', model: 'm3' }
    ]);
    expect(record.resolvedModels).toHaveLength(1);
    expect(record.resolvedModels[0]).toMatchObject({ slotId: 'eng:0', personaId: 'engineer', label: 'Engineer', roles: ['builder'], skillAllowlist: ['s1'], mcpServers: ['m1'], provider: 'openai', model: 'm2', level: 'high' });
  }));

  it('mergeFrozenRoster: a swapped persona or a missing slot keeps the frozen entry; no frozen roster takes the refresh', () => {
    const frozen = [ENG, { slotId: 'eng:1', personaId: 'qa', provider: 'a', model: 'm' }];
    expect(mergeFrozenRoster(undefined, [ENG])).toEqual([ENG]);
    expect(mergeFrozenRoster([], [ENG])).toEqual([ENG]);
    const merged = mergeFrozenRoster(frozen, [{ slotId: 'eng:0', personaId: 'someone-else', provider: 'x', model: 'y' }]);
    expect(merged).toEqual(frozen);
    const unlabeled = mergeFrozenRoster([{ slotId: 'a', provider: 'p', model: 'm' }], [{ slotId: 'a', provider: 'q', model: 'n', label: 'L', roles: ['r'] }]);
    expect(unlabeled).toEqual([{ slotId: 'a', provider: 'q', model: 'n' }]);
  });
});

describe('finding 2: no-route blockers are distinct per step', () => {
  it('two concurrent no-route blockers have their own id and slot identity and resolve independently', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const record = await started(store);
    const registered = await plan(store, record.id, record.stateVersion, [
      { id: 'a', routing: { version: 1 as const, requiredRole: 'reviewer' } },
      { id: 'b', routing: { version: 1 as const, requiredRole: 'auditor' } }
    ]);
    const result = await store.dispatchReady(registered.id, { enforceRouting: false });
    expect(result.noRouteBlockerIds).toHaveLength(2);
    const [first, second] = result.record.blockers!;
    expect(first.id).not.toBe(second.id);
    expect(first.slotId).not.toBe(second.slotId);
    expect(new Set(result.record.blockers!.map((blocker) => `${blocker.slotId}\0${blocker.noRoute}`)).size).toBe(2);
    expect(first.slotId).toBe('engine:no-route:a');
    const after = await store.resolveNoRouteBlocker(registered.id, undefined, first.id, 'skip a');
    const open = after.blockers!.filter((blocker) => !blocker.resolved);
    expect(open.map((blocker) => blocker.id)).toEqual([second.id]);
    expect(after.blockers!.find((blocker) => blocker.id === first.id)).toMatchObject({ resolved: true, response: 'skip a' });
    expect(after.workUnits!.find((unit) => unit.id === 'b')!.state).toBe('BLOCKED');
  }));
});

describe('finding 3: the all-UNKNOWN wait survives an earlier decision', () => {
  const NEEDS_LEVEL = { id: 'a', routing: { version: 1 as const, minimumLevel: 'high' as never } };
  it('arms and fires even when an advisory pass already recorded a decision for the step', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const store = mk(filePath, () => clock.t);
    const record = await started(store);
    // 'busy' takes the only worker, so 'a' is READY with a recorded (advisory) decision and no free slot.
    const registered = await plan(store, record.id, record.stateVersion, [{ id: 'busy' }, NEEDS_LEVEL]);
    const advisory = await store.dispatchReady(registered.id, { enforceRouting: false });
    expect(advisory.record.routingDecisions?.some((decision) => decision.workUnitId === 'a')).toBe(true);
    expect(advisory.record.workUnits!.find((unit) => unit.id === 'a')).toMatchObject({ state: 'READY' });
    const armed = await store.dispatchReady(registered.id, { enforceRouting: true });
    expect(armed.record.workUnits!.find((unit) => unit.id === 'a')!.unknownSince).toBe(1_000);
    clock.t += ALL_UNKNOWN_ESCALATE_MS - 1;
    expect((await store.dispatchReady(registered.id, { enforceRouting: true })).noRouteBlockerIds).toEqual([]);
    clock.t += 1;
    const fired = await store.dispatchReady(registered.id, { enforceRouting: true });
    expect(fired.noRouteBlockerIds).toHaveLength(1);
    expect(fired.record.workUnits!.find((unit) => unit.id === 'a')).toMatchObject({ state: 'BLOCKED' });
  }));

  it('a known level clears the clock on the same already-decided path', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const store = mk(filePath, () => clock.t);
    const record = await started(store);
    const registered = await plan(store, record.id, record.stateVersion, [{ id: 'busy' }, NEEDS_LEVEL]);
    await store.dispatchReady(registered.id, { enforceRouting: false });
    await store.dispatchReady(registered.id, { enforceRouting: true });
    await store.replaceResolvedModels(registered.id, [{ ...ENG, level: 'high' as never }]);
    clock.t += ALL_UNKNOWN_ESCALATE_MS * 2;
    const known = await store.dispatchReady(registered.id, { enforceRouting: true });
    expect(known.noRouteBlockerIds).toEqual([]);
    expect(known.record.workUnits!.find((unit) => unit.id === 'a')!.unknownSince).toBeUndefined();
  }));
});

describe('finding 4: a plan never silently loses Not same worker as', () => {
  const anti = [{ id: 'a' }, { id: 'b', dependencies: ['a'], routing: { version: 1 as const, excludeSameWorkerAs: ['a'] } }];
  it('registerPlan refuses on a run with no hard-requirement policy, and accepts it on one that has it', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const legacy = await started(store, { policy: false });
    await expect(plan(store, legacy.id, legacy.stateVersion, anti)).rejects.toThrow(/Not same worker as.*does not enforce/);
    expect((await store.get(legacy.id))!.workUnits ?? []).toHaveLength(0);
    await expect(plan(store, legacy.id, legacy.stateVersion, [{ id: 'a' }])).resolves.toMatchObject({ workUnits: [{ id: 'a' }] });
  }));
  it('registerPlan accepts it under a hard policy', async () => fixture(async (filePath) => {
    const store = mk(filePath);
    const run = await started(store);
    await expect(plan(store, run.id, run.stateVersion, anti)).resolves.toMatchObject({ workUnits: [{ id: 'a' }, { id: 'b' }] });
  }));
  it('claim with a plan refuses it without a policy and accepts a hard policy', async () => fixture(async (filePath) => {
    const base = { callerPrincipalId: 's', projectId: 'project-1', teamId: 'team-1', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [], request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] } };
    const workUnits = anti.map((unit) => ({ title: unit.id, task: 'Work', dependencies: [], readOnly: true, verification: ['ok'], ...unit })) as ExecutionWorkUnitInput[];
    await expect(mk(filePath).claim({ ...base, workUnits } as never)).rejects.toThrow(/does not enforce/);
    await expect(mk(`${filePath}.2`).claim({ ...base, workUnits, routingPolicy: { version: 1 as const, hardRequirements: true } } as never)).resolves.toBeTruthy();
  }));
});
