import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
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


describe('enforced routing: question wording counts PASS slots only (#577 F10/A17)', () => {
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

describe('the service passes the routing enforcement flag to kickoff recovery (#577 F9/A11)', () => {
  it('an enforced run blocks to a human instead of moving the unit to an UNKNOWN slot', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const replyToSession = vi.fn(() => true);
    const workers = [{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer' }];
    const service = new SquadExecutionService({
      store,
      artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          ...workers.map((worker) => ({ ...worker, authorizationIdDigest: `${worker.slotId}-d` }))
        ] } } }),
      launchTeam: async () => ({ ok: true }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: workers.map((worker) => ({ slotId: worker.slotId, sessionId: `session-${worker.slotId}`, projectId: 'project-1' })) }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
      // engineer:0 has a context fact (PASS), engineer:1 has none (UNKNOWN for a context estimate).
      resolveTeamModelSnapshots: () => workers.map((worker) => ({ ...worker, provider: 'anthropic', model: 'm', ...(worker.slotId === 'engineer:0' ? { maxContextBytes: 10_000 } : {}) })),
      routingEnforcementEnabled: () => true,
      replyToSession, now, inbox: { append: vi.fn(async () => undefined) }, logError: vi.fn(),
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
    } as never);
    const unit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'], routing: { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 1_000 } };
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
    if (!started.ok) throw new Error(started.message);
    await service.dispatchReady({ executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' });
    expect((await store.get('execution-1'))!.workUnits![0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'engineer:0' });
    clock.t += 700_000;
    await service.redispatchStalled();
    const after = (await store.get('execution-1'))!.workUnits![0];
    expect(after.state).toBe('BLOCKED');
    expect(after.assignedSlotId).toBeUndefined();
    // The same enforcement flag reaches the question: only the PASS slot is named as able to take the unit.
    const blocker = (await store.get('execution-1'))!.blockers!.find((entry) => entry.workUnitId === 'a');
    expect(blocker!.question).toContain('the only worker slot that can take it (engineer:0)');
  }));
});
