import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assignmentRequirementFailures, createExecutionStore, hardRequirementsActive, recordedLevelPolicy,
  type ExecutionRecord, type ResolvedModelSnapshotV1
} from '../store.js';

/**
 * Requirement 19: every new field is optional and no version is bumped, so an older Zana still loads a record the
 * new code wrote, and a record written before the gate (no `routingPolicy`) still loads and dispatches as before.
 */
async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-legacy-record-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}
type Store = ReturnType<typeof createExecutionStore>;
const MODEL: ResolvedModelSnapshotV1 = { slotId: 'w1', personaId: 'eng', provider: 'anthropic', model: 'm', label: 'Engineer', roles: ['builder'] };

async function written(store: Store, policy?: Record<string, unknown>) {
  let record = (await store.claim({
    callerPrincipalId: 's', projectId: 'p', teamId: 't', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] },
    ...(policy ? { routingPolicy: policy as never } : {})
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'o', authorizedAt: 1, expiresAt: 2,
    slots: [{ slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'o' }, { slotId: 'w1', personaId: 'eng', authorizationIdDigest: 'w' }]
  }, 'digest');
  record = await store.replaceResolvedModels(record.id, [MODEL]);
  return store.registerPlan(record.id, record.stateVersion, [
    { id: 'a', title: 'a', task: 'Work', dependencies: [], readOnly: true, routing: { version: 1, requiredRole: 'builder', preferRoles: ['review'] } }
  ]);
}

/** What the previous release checked on a record's routing facts; unknown fields were ignored, never rejected. */
function previousReleaseAccepts(record: ExecutionRecord): boolean {
  const policy = record.routingPolicy;
  const policyOk = policy === undefined || (typeof policy === 'object' && policy.version === 1 && typeof policy.hardRequirements === 'boolean');
  const routingOk = (record.workUnits ?? []).every((unit) => unit.routing === undefined || (unit.routing.version === 1 && typeof unit.routing.requiredRole !== 'number'));
  return policyOk && routingOk && Array.isArray(record.resolvedModels) && record.resolvedModels.every((m) => typeof m.slotId === 'string' && typeof m.provider === 'string');
}
async function mutateFile(filePath: string, edit: (record: any) => void) {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as { records: any[] };
  for (const record of raw.records) edit(record);
  await writeFile(filePath, JSON.stringify(raw));
}

describe('records and the old validators', () => {
  it('a record written by the new code keeps every version at 1 and passes the previous release checks', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 1_000 });
    const record = await written(store, { version: 1, hardRequirements: true, requested: true, levelEnforced: true, degradedSlots: [{ slotId: 'w1', why: 'level-unknown' }] });
    const reloaded = (await createExecutionStore({ filePath }).get(record.id))!;
    expect(reloaded.routingPolicy).toMatchObject({ version: 1, hardRequirements: true, requested: true, levelEnforced: true });
    expect(reloaded.workUnits![0].routing).toMatchObject({ version: 1, requiredRole: 'builder', preferRoles: ['review'] });
    expect(previousReleaseAccepts(reloaded)).toBe(true);
  }));

  it('removing every new field still loads (all new fields are optional)', async () => fixture(async (filePath) => {
    const record = await written(createExecutionStore({ filePath, id: () => 'execution-1', now: () => 1_000 }), { version: 1, hardRequirements: true, requested: true, levelEnforced: true, degradedSlots: [{ slotId: 'w1', why: 'level-unknown' }] });
    await mutateFile(filePath, (entry) => {
      delete entry.routingPolicy;
      for (const model of entry.resolvedModels ?? []) delete model.roles;
      for (const unit of entry.workUnits ?? []) { delete unit.routing.preferRoles; delete unit.routing.excludeSameWorkerAs; delete unit.unknownSince; delete unit.noRoute; }
      for (const decision of entry.routingDecisions ?? []) { delete decision.chosenSlotId; delete decision.chosenReason; }
    });
    const reloaded = (await createExecutionStore({ filePath }).get(record.id))!;
    expect(reloaded.routingPolicy).toBeUndefined();
    expect(reloaded.workUnits![0].routing).toEqual({ version: 1, requiredRole: 'builder' });
  }));

  it('a run with no routingPolicy loads, enforces nothing, and dispatches as before', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 1_000 });
    const record = await written(store);
    const reloaded = (await createExecutionStore({ filePath }).get(record.id))!;
    expect(reloaded.routingPolicy).toBeUndefined();
    expect(hardRequirementsActive(reloaded)).toBe(false);
    expect(recordedLevelPolicy(reloaded)).toBeUndefined();
    // The unit asks for a role the slot lacks; with no recorded policy that is not a hard failure.
    expect(assignmentRequirementFailures(reloaded, { routing: { version: 1, requiredRole: 'auditor' } }, { slotId: 'w1', personaId: 'eng' })).toEqual({ hardFailures: [], softFailures: [] });
  }));

  it('a policy recorded before the per-requirement flags loads and gives no recorded level policy', async () => fixture(async (filePath) => {
    const record = await written(createExecutionStore({ filePath, id: () => 'execution-1', now: () => 1_000 }), { version: 1, hardRequirements: true });
    const reloaded = (await createExecutionStore({ filePath }).get(record.id))!;
    expect(reloaded.routingPolicy).toEqual({ version: 1, hardRequirements: true });
    expect(recordedLevelPolicy(reloaded)).toBeUndefined();
    expect(hardRequirementsActive(reloaded)).toBe(true);
  }));

  it('a policy with the wrong version is still rejected (the version is never bumped, so any other value is corrupt)', async () => fixture(async (filePath) => {
    const record = await written(createExecutionStore({ filePath, id: () => 'execution-1', now: () => 1_000 }), { version: 1, hardRequirements: true });
    await mutateFile(filePath, (entry) => { entry.routingPolicy.version = 2; });
    await expect(createExecutionStore({ filePath }).get(record.id)).rejects.toThrow('invalid shape');
  }));
});
