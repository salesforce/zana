import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, KeyedColdStartSemaphore, type ExecutionRequestV1, SquadExecutionService, deriveJobTitle, dependencyResultsSection, deterministicTerminalSummary, withDurableClaimWallClockBackstop, MAX_DEP_RESULT_CHARS, AUTO_FAIL_SUMMARY } from '../service.js';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { createResumeGrantStore } from '../resume-grant-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-service-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release\nignored',
  slots: [{ initialTask: 'Run tests' }]
};

function deps(filePath: string, over: Partial<ConstructorParameters<typeof SquadExecutionService>[0]> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    ...over
  };
}

describe('dependencyResultsSection', () => {
  const rec = (units: ExecutionRecord['workUnits']): ExecutionRecord =>
    ({ workUnits: units } as unknown as ExecutionRecord);

  it('injects each completed direct dependency result, bounded per dep', () => {
    const section = dependencyResultsSection(rec([
      { id: 'choose', title: 'Choose label', task: 't', dependencies: [], state: 'COMPLETED', attempt: 1, result: 'x'.repeat(3_000), history: [] },
      { id: 'assemble', title: 'Assemble', task: 't', dependencies: ['choose'], state: 'READY', attempt: 1, history: [] }
    ]), 'assemble');
    expect(section).toContain('Upstream results');
    expect(section).toContain('`choose` (Choose label):');
    // per-dep char cap applied (2 KiB), not the raw 3 KiB result
    expect(section).toContain('x'.repeat(MAX_DEP_RESULT_CHARS));
    expect(section).not.toContain('x'.repeat(MAX_DEP_RESULT_CHARS + 1));
  });

  it('returns empty when the unit has no dependency with a stored result', () => {
    const units: ExecutionRecord['workUnits'] = [
      { id: 'a', title: 'A', task: 't', dependencies: [], state: 'READY', attempt: 1, history: [] },
      { id: 'b', title: 'B', task: 't', dependencies: ['a'], state: 'READY', attempt: 1, history: [] }
    ];
    expect(dependencyResultsSection(rec(units), 'b')).toBe(''); // dep 'a' not completed → no result
    expect(dependencyResultsSection(rec(units), 'a')).toBe(''); // no dependencies at all
    expect(dependencyResultsSection(rec(units), 'ghost')).toBe(''); // unknown unit
  });
});

describe('execution admission', () => {
  it('shares exact dry-run result with real admission and prevents invalid DAG spawn', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new ExecutionService(deps(filePath, { launchTeam }));
    const invalid = {
      ...request,
      coordinationMode: 'job-team' as const,
      workUnits: [
        { id: 'a', title: 'A', task: 'A', dependencies: ['b'], files: ['a'], verification: ['test'] },
        { id: 'b', title: 'B', task: 'B', dependencies: ['a'], files: ['b'], verification: ['test'] }
      ]
    };
    const preview = await service.dryRun('project-1', invalid);
    const started = await service.start('owner', 'project-1', invalid);
    expect(preview.ready).toBe(false);
    expect(preview.checks).toContainEqual(expect.objectContaining({ code: 'DAG_VALID', status: 'FAIL' }));
    expect(started).toEqual({ ok: false, code: 'ADMISSION_FAILED', message: 'work unit dependency cycle' });
    expect(launchTeam).not.toHaveBeenCalled();
  }));

  it('fails closed on stale required provider health before authorization', async () => fixture(async (filePath) => {
    const authorizeTeamLaunch = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      authorizeTeamLaunch,
      admissionInput: () => ({
        slotCount: 1, maxSlots: 1, initialTasks: ['work'], requiredProviders: ['provider'], now: 10,
        inventory: { version: 1, observedAt: 0, maxAgeMs: 1, skills: [], mcpServers: [], models: [], providers: [{ id: 'provider', status: 'available' }] }
      })
    }));
    await expect(service.start('owner', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'ADMISSION_FAILED', message: 'provider health is unknown'
    });
    expect(authorizeTeamLaunch).not.toHaveBeenCalled();
  }));

  it('revalidates admission digest after authorization and before spawn', async () => fixture(async (filePath) => {
    let generation = 0;
    const launchTeam = vi.fn();
    const revokeTeamAuthorizations = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      launchTeam,
      authorizeTeamLaunch: () => ({ ok: true as const, value: {
        teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'auth-1' }],
        context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] }
      } }),
      admissionInput: () => ({ slotCount: 1, maxSlots: 1, initialTasks: [`work-${generation++}`] })
      , revokeTeamAuthorizations
    }));
    await expect(service.start('owner', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'STALE_PREFLIGHT', message: 'Team admission changed after authorization'
    });
    expect(launchTeam).not.toHaveBeenCalled();
    expect(revokeTeamAuthorizations).toHaveBeenCalledWith(['auth-1']);
  }));

  it('returns a stable fail-closed result when admission input rejects', async () => fixture(async (filePath) => {
    const authorizeTeamLaunch = vi.fn();
    const logError = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      authorizeTeamLaunch, logError,
      admissionInput: async () => { throw new Error('provider credentials leaked detail'); }
    }));
    await expect(service.start('owner', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'ADMISSION_FAILED', message: 'Team admission could not be evaluated'
    });
    expect(authorizeTeamLaunch).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('project-1:request-1'), expect.any(Error));
  }));

  it('revokes authorization when admission revalidation rejects', async () => fixture(async (filePath) => {
    let calls = 0;
    const revokeTeamAuthorizations = vi.fn();
    const launchTeam = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      launchTeam, revokeTeamAuthorizations,
      authorizeTeamLaunch: () => ({ ok: true as const, value: {
        teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'auth-1' }],
        context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] }
      } }),
      admissionInput: async () => {
        if (++calls > 1) throw new Error('inventory failed');
        return { slotCount: 1, maxSlots: 1, initialTasks: ['work'] };
      }
    }));
    await expect(service.start('owner', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'STALE_PREFLIGHT', message: 'Team admission could not be revalidated'
    });
    expect(revokeTeamAuthorizations).toHaveBeenCalledWith(['auth-1']);
    expect(launchTeam).not.toHaveBeenCalled();
  }));
});

describe('execution claim recovery', () => {
  it('observes proven-dead expired claims before enforce and reclaims only when enabled', async () => fixture(async (filePath) => {
    let now = 1_000;
    const logError = vi.fn();
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    now += 300_000; // past the default lease window
    const base = deps(filePath, { store, now: () => now, logError, getTeamLaunch: async () => ({ workers: [] }), claimRecoveryObserveEnabled: () => true });
    const observe = new ExecutionService(base);
    await observe.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0].state).toBe('CLAIMED');
    expect(logError).toHaveBeenCalled();
    const enforce = new ExecutionService({ ...base, claimRecoveryEnforceEnabled: () => true });
    await enforce.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  it('does not reclaim a live worker while its output-renewed lease is still fresh', async () => fixture(async (filePath) => {
    // The host renews the claim lease from observed PTY output (renewWorkerLease). A worker
    // that keeps emitting output — even while non-restful ('working') — keeps its lease fresh
    // and must NOT be reclaimed as silent.
    let now = 1_000;
    // Short injected lease so renewal is genuinely load-bearing: at expiry the host's
    // output-driven renew must refresh it, otherwise the reconcile below would reclaim.
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now, workClaimLeaseMs: 90_000 });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, lease→91_000
    now += 90_000; // now=91_000: the original lease has just expired...
    await store.renewWorkerLease(record.id, 'slot-1'); // ...but output activity refreshed it (→181_000)
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'working', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0].state).toBe('CLAIMED');
  }));

  // Runs e531f415 + df216947: a live worker stuck non-restful ('working') that stopped
  // emitting output lets its PTY-driven lease lapse. Reclaiming it at lease expiry killed a
  // live worker and churned its finished work (e531f415). Now the agent state proves
  // liveness: at lease expiry the reconcile RENEWS the lease from that non-output signal
  // instead of reclaiming (churn → near-zero), and the wall-clock ceiling — NOT lease
  // expiry — is the hard stop for a worker that stays 'working' but is genuinely hung
  // (df216947). So the freeze is still bounded, just at the ceiling rather than the lease.
  it('renews a live non-restful (working) worker at lease expiry and reclaims it only at the wall-clock ceiling (runs e531f415, df216947)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 900_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, lease→301_000
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'working', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    now += 300_000; // now=301_000: lease expired, NO output renewal — but the worker is alive + 'working'
    await service.reconcileActive();
    const renewed = (await store.get(record.id))?.workUnits?.[0];
    expect(renewed?.state).toBe('CLAIMED'); // renewed from agent state, NOT reclaimed
    expect(renewed?.leaseExpiresAt).toBe(601_000); // now(301_000) + default lease(300_000)
    now += 600_000; // now=901_000: 900_000 >= 900_000 wall-clock ceiling → force reclaim despite still 'working'
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  // The wall-clock backstop still fires for a worker whose LEASE is kept fresh but that makes
  // no OUTPUT progress — the ceiling is keyed to `progressAt`, and this worker renews only its
  // lease (store-direct renewWorkerLease, no advanceProgress), so progressAt stays frozen at
  // claim time and the state-agnostic ceiling force-reclaims it. (A worker making REAL output
  // progress resets the ceiling and is NOT reclaimed while it progresses — see run 928ff675 below.)
  it('reclaims a worker that keeps its lease fresh but makes no output progress once it outlives the wall-clock ceiling', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 120_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'working', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    now += 99_000; // now=100_000: still streaming (lease renewed), 99_000 < 120_000 ceiling
    await store.renewWorkerLease(record.id, 'slot-1');
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0].state).toBe('CLAIMED');
    now += 30_000; // now=130_000: lease renewed but progressAt frozen at 1_000 → 129_000 >= 120_000 ceiling → force reclaim
    await store.renewWorkerLease(record.id, 'slot-1');
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  // Live run 928ff675 (the fix): the wall-clock ceiling is keyed to OUTPUT progress
  // (`progressAt`), NOT raw claim age, so a worker that keeps making progress — emitting output
  // that advances progressAt — is NEVER force-reclaimed while it progresses, even long past
  // claimedAt+ceiling. Only once its output stops for the full ceiling window does the backstop
  // fire. Keying it to `claimedAt` force-reclaimed a demonstrably-live, 68%-CPU verify-upstream
  // worker mid-work every ceiling window and re-dispatched from zero — infinite churn on any
  // unit that legitimately outlives the ceiling. A short lease makes each renew persist so the
  // host OUTPUT path (advanceProgress:true) actually advances progressAt.
  it('does NOT force-reclaim a worker that keeps making OUTPUT progress past the raw claim-age ceiling (run 928ff675)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now, workClaimLeaseMs: 40_000 });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 120_000, maxClaimStallMs: 100_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, progressAt=1_000, lease→41_000
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'working', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    // Worker emits output every 35s (< the 40s lease, so each renew is within the persist window
    // and advances progressAt). It keeps working well past claimedAt+120_000 (the raw ceiling) —
    // the progress-keyed ceiling must NOT reclaim it while it makes progress.
    for (const elapsed of [35_000, 70_000, 105_000, 140_000]) {
      now = 1_000 + elapsed;
      await service.renewWorkerLease(record.id, 'slot-1'); // host OUTPUT path: advanceProgress:true
      await service.reconcileActive();
      const unit = (await store.get(record.id))?.workUnits?.[0];
      expect(unit?.state).toBe('CLAIMED');
      expect(unit?.progressAt).toBe(now); // output kept the progress clock fresh
    }
    // now=141_000 > claimedAt+120_000: past the raw ceiling age, yet still CLAIMED (progressing).
    // Output stops; once progress goes stale for the full ceiling window, the backstop fires.
    now += 130_000; // 130_000 >= 120_000 wall-clock since the last progressAt
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  it('reclaims an expired claim when its live worker returned to rest without an outcome', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    now += 300_000; // past the default lease window
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'waiting', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  // Live run b1bd2906: a lone CLAIMED unit whose worker is alive + 'working' but has produced
  // no OUTPUT for a full window — the "claimed but not working" hole. The progress-aware stall
  // ceiling reclaims it well before the blunt wall-clock ceiling, without a restful state.
  it('reclaims a live non-restful worker that has produced no output progress within maxClaimStallMs (run b1bd2906)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 900_000, maxClaimStallMs: 200_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, progressAt=1_000, lease→301_000
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'working', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    now += 300_000; // now=301_000: lease expired, no output → progress stale 300_000 >= 200_000 stall, but 300_000 < 900_000 wall-clock
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  // The counterpart: with a LARGE stall ceiling the same silent-but-'working' worker is NOT
  // stall-reclaimed at lease expiry — it is renewed from agent state, and that renewal must
  // NOT advance progressAt (only real output does), so the stall clock keeps counting.
  it('renews (does not stall-reclaim) a live non-restful worker still within maxClaimStallMs, leaving progressAt frozen', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 900_000, maxClaimStallMs: 500_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, progressAt=1_000
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'working', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    now += 300_000; // now=301_000: lease expired, progress stale 300_000 < 500_000 stall → renew, not reclaim
    await service.reconcileActive();
    const unit = (await store.get(record.id))?.workUnits?.[0];
    expect(unit?.state).toBe('CLAIMED');
    expect(unit?.leaseExpiresAt).toBe(601_000); // renewed from agent state
    expect(unit?.progressAt).toBe(1_000); // agent-state renewal does NOT count as output progress
  }));

  // Remote-opencode zombie: the outer ssh/tmux WRAPPER stays alive (process:'running')
  // after the inner agent dies, and an OSC/hook-less harness reads agent-state 'unknown'
  // forever — so WITHOUT a liveness signal reconcile renews the claim into a zombie
  // (well within both the stall and wall-clock windows) and every redispatch re-types the
  // assignment into the surviving bash shell. The provider-supplied `getWorkerLiveness`
  // 'dead' verdict reclaims immediately, BEFORE the state/stall/renew logic.
  it('reclaims an expired claim whose shell wrapper is alive but its inner agent is dead (remote-opencode zombie)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 900_000, maxClaimStallMs: 500_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, lease→301_000
    const closeWorkerSession = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      getAgentState: () => 'unknown', // OSC/hook-less remote worker reads unknown forever
      getWorkerLiveness: () => 'dead',  // provider probe proves the inner agent is gone
      closeWorkerSession,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    now += 300_000; // now=301_000: lease expired, but 300_000 < 500_000 stall AND < 900_000 wall-clock — ONLY liveness can trigger
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
    // Reclaiming the claim frees the WORK; closing the worker session reaps the
    // surviving outer shell/tmux wrapper (host closeExpected → killRemoteTmux) so
    // the zombie doesn't leak CPU until quit→boot. The captured-PID reap can't do
    // it (that pid is the exited inner agent, not the wrapper).
    expect(closeWorkerSession).toHaveBeenCalledWith('worker-1');
  }));

  // Symmetry guard: a confirmed-ALIVE agent (and an 'unknown'/unwired liveness) must NOT be
  // reclaimed by the liveness branch — it renews from agent state exactly as before, so the
  // signal can only ever DEMOTE a proven-dead zombie, never over-reclaim a live worker.
  it('renews (does not liveness-reclaim) an expired claim whose inner agent is confirmed alive', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 900_000, maxClaimStallMs: 500_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    const closeWorkerSession = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      getAgentState: () => 'working', getWorkerLiveness: () => 'alive',
      closeWorkerSession,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    now += 300_000; // lease expired, within both windows — alive worker must be RENEWED
    await service.reconcileActive();
    const unit = (await store.get(record.id))?.workUnits?.[0];
    expect(unit?.state).toBe('CLAIMED');
    expect(unit?.leaseExpiresAt).toBe(601_000);
    // A live worker is NEVER closed — the close hook fires ONLY on a proven-dead
    // zombie, so it can never reap a healthy worker's session out from under it.
    expect(closeWorkerSession).not.toHaveBeenCalled();
  }));
});

describe('execution usage and typed completion', () => {
  it('retries parallel exact claim-fenced outcomes once after main-owned CAS collision', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], readOnly: true },
      { id: 'b', title: 'B', task: 'B', dependencies: [], readOnly: true }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'b');
    const [a, b] = record.workUnits!;
    const outcomes = await Promise.all([
      service.completeWork({ executionId: record.id, projectId: record.projectId, role: 'worker', slotId: 'slot-1' }, 'a', 'done', { claimId: a.claimId!, claimGeneration: a.claimGeneration! }, true),
      service.completeWork({ executionId: record.id, projectId: record.projectId, role: 'worker', slotId: 'slot-2' }, 'b', 'done', { claimId: b.claimId!, claimGeneration: b.claimGeneration! }, true)
    ]);
    expect(outcomes).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  }));
  it('blocks new claims at token budget and never treats unknown usage as zero spend', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', { ...request, policy: { usageBudget: { maxTokens: 10 } } });
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    const worker = { executionId: record.id, projectId: record.projectId, role: 'worker' as const, slotId: 'slot-1' };
    await store.appendUsageObservation(record.id, {
      observationId: 'o', executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 's', workAttempt: 0, claimGeneration: 0,
      adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 1, provider: 'p', routingIdentity: 'r', cumulative: { inputTokens: 10 }, completeness: 'complete', observedAt: 1
    });
    await expect(service.claimWork(worker, 'unit')).resolves.toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });

    const unknownStore = createExecutionStore({ filePath: `${filePath}.unknown`, id: () => 'execution-2' });
    const unknownService = new ExecutionService(deps(`${filePath}.unknown`, { store: unknownStore }));
    await unknownService.start('owner', 'project-1', { ...request, launchRequestId: 'unknown', policy: { usageBudget: { maxTokens: 10 } } });
    let unknown = (await unknownStore.get('execution-2'))!;
    unknown = await unknownStore.registerPlan(unknown.id, unknown.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    await expect(unknownService.claimWork({ ...worker, executionId: unknown.id }, 'unit')).resolves.toMatchObject({ ok: true });
  }));

  it('captures main-owned deltas and blocks after persistent telemetry gap grace', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const readSessionStats = vi.fn(async () => null);
    const service = new ExecutionService(deps(filePath, {
      store, readSessionStats,
      getTeamLaunch: async () => ({ orchestratorSessionId: 'lead', workers: [{ slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, policy: { usageBudget: { maxTokens: 100 } } });
    for (let index = 0; index < 3; index += 1) await service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    expect(await store.get('execution-1')).toMatchObject({ state: 'BLOCKED', telemetryGapCount: 3, usageObservations: [{ completeness: 'partial' }, { completeness: 'partial' }, { completeness: 'partial' }], resourceBlock: { kind: 'telemetry-unavailable' } });
  }));

  it('logs lifecycle and stats failures with bounded execution context', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const logError = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      store, logError,
      getTeamLaunch: async () => { throw new Error('lifecycle failed'); },
      readSessionStats: async () => { throw new Error('stats failed'); }
    }));
    await service.start('owner', 'project-1', request);
    await service.observeSessionUsage('execution-1', 'worker', 'terminal');
    expect(logError.mock.calls.map(([message]) => message)).toEqual([
      'execution usage lifecycle failed (execution=execution-1, session=worker, sample=terminal)',
      'execution usage stats failed (execution=execution-1, session=worker, sample=terminal)'
    ]);
  }));

  it('replays unchanged heartbeat exactly and captures USD for at-budget admission', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const readSessionStats = vi.fn(async () => ({ tokens: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 2, files: [], queue: [] }));
    let now = 10;
    const service = new ExecutionService(deps(filePath, {
      store, readSessionStats, now: () => now++,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, policy: { usageBudget: { maxUsd: 2 } } });
    await service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    await service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    await service.observeSessionUsage('execution-1', 'worker', 'outcome');
    await service.observeSessionUsage('execution-1', 'worker', 'outcome');
    const record = (await store.get('execution-1'))!;
    expect(record.usageObservations).toHaveLength(2);
    expect(record.usageObservations?.[0]).toMatchObject({ cumulative: { providerCostUsd: 2 }, completeness: 'complete' });
    expect(record.state).toBe('BLOCKED');
    expect(record.resourceBlock).toMatchObject({ kind: 'usage-budget' });
  }));

  it('serializes concurrent usage capture for one session', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let releaseFirst!: () => void;
    const firstStats = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let statsCalls = 0;
    const service = new ExecutionService(deps(filePath, {
      store,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' }] }),
      readSessionStats: async () => {
        statsCalls += 1;
        if (statsCalls === 1) await firstStats;
        return { tokens: { input: statsCalls, output: 0, cacheRead: 0, cacheWrite: 0 }, files: [], queue: [] };
      }
    }));
    await service.start('owner', 'project-1', request);

    const heartbeat = service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    await vi.waitFor(() => expect(statsCalls).toBe(1));
    const outcome = service.observeSessionUsage('execution-1', 'worker', 'outcome');
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();

    await expect(Promise.all([heartbeat, outcome])).resolves.toEqual([undefined, undefined]);
    const observations = (await store.get('execution-1'))?.usageObservations ?? [];
    expect(observations.map(({ sequence, sampleKind }) => ({ sequence, sampleKind }))).toEqual([
      { sequence: 1, sampleKind: 'heartbeat' },
      { sequence: 2, sampleKind: 'outcome' }
    ]);
    expect(new Set(observations.map((observation) => observation.observationId)).size).toBe(2);
  }));

  it('coalesces queued sample kinds while keeping different sessions concurrent', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let releaseWorker!: () => void;
    const workerStats = new Promise<void>((resolve) => { releaseWorker = resolve; });
    const calls: string[] = [];
    const service = new ExecutionService(deps(filePath, {
      store,
      getTeamLaunch: async () => ({ workers: [
        { slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' },
        { slotId: 'slot-2', sessionId: 'peer', projectId: 'project-1' }
      ] }),
      readSessionStats: async (sessionId) => {
        calls.push(sessionId);
        if (sessionId === 'worker') await workerStats;
        return { tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, files: [], queue: [] };
      }
    }));
    await service.start('owner', 'project-1', request);

    const first = service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    await vi.waitFor(() => expect(calls).toEqual(['worker']));
    const duplicate = service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    const outcome = service.observeSessionUsage('execution-1', 'worker', 'outcome');
    const duplicateOutcome = service.observeSessionUsage('execution-1', 'worker', 'outcome');
    await expect(service.observeSessionUsage('execution-1', 'peer', 'heartbeat')).resolves.toBeUndefined();
    expect(calls).toEqual(['worker', 'peer']);
    releaseWorker();
    await expect(Promise.all([first, duplicate, outcome, duplicateOutcome])).resolves.toEqual([undefined, undefined, undefined, undefined]);
    expect(calls).toEqual(['worker', 'peer', 'worker']);
  }));

  it('replays unchanged cost-only samples without requiring token counters', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, {
      store, readSessionStats: async () => ({ costUsd: 1.25, files: [], queue: [] }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, policy: { usageBudget: { maxUsd: 10 } } });
    await service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    await service.observeSessionUsage('execution-1', 'worker', 'heartbeat');
    expect((await store.get('execution-1'))?.usageObservations).toHaveLength(1);
  }));

  it('uses stats model consistently after compaction without recounting session totals', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxUsageObservationsPerExecution: 1 });
    const service = new ExecutionService(deps(filePath, {
      store, readSessionStats: async () => ({ model: 'actual-model', tokens: { input: 15, output: 0, cacheRead: 0, cacheWrite: 0 }, files: [], queue: [] }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', request);
    await store.replaceResolvedModels('execution-1', [{ slotId: 'slot-1', provider: 'provider', model: 'configured-model' } as never]);
    await store.appendUsageObservation('execution-1', {
      observationId: 'old', executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 'worker', workAttempt: 0, claimGeneration: 0,
      adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 1, provider: 'provider', model: 'actual-model', routingIdentity: 'slot-1:provider:actual-model', cumulative: { inputTokens: 10 }, completeness: 'complete', observedAt: 1
    });
    await store.appendUsageObservation('execution-1', {
      observationId: 'other', executionAttempt: 1, role: 'worker', slotId: 'other', sessionId: 'other', workAttempt: 0, claimGeneration: 0,
      adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 1, provider: 'provider', routingIdentity: 'other:provider:unknown', cumulative: { inputTokens: 1 }, completeness: 'complete', observedAt: 2
    });
    await service.observeSessionUsage('execution-1', 'worker', 'outcome');
    const record = (await store.get('execution-1'))!;
    expect(record.usageObservations?.find((item) => item.sessionId === 'worker')).toMatchObject({ model: 'actual-model', routingIdentity: 'slot-1:provider:actual-model', sequence: 2, delta: { inputTokens: 5 } });
  }));

  it('atomically blocks when concurrent samples cross token budget and telemetry gap thresholds', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await new ExecutionService(deps(filePath, { store })).start('owner', 'project-1', { ...request, policy: { usageBudget: { maxTokens: 10 } } });
    const sample = (id: string, sessionId: string, sequence: number, tokens?: number) => ({
      observationId: id, executionAttempt: 1, role: 'worker' as const, slotId: sessionId, sessionId, workAttempt: 0, claimGeneration: 0,
      adapterEpoch: 0, sampleKind: 'heartbeat' as const, sequence, provider: 'p', routingIdentity: sessionId,
      cumulative: tokens === undefined ? {} : { inputTokens: tokens }, completeness: tokens === undefined ? 'partial' as const : 'complete' as const,
      observedAt: sequence, ...(tokens === undefined ? { gap: 'missing' as const } : {})
    });
    await Promise.all([
      store.appendUsageObservation('execution-1', sample('a', 'a', 1, 6), { telemetryGapGraceSamples: 3 }),
      store.appendUsageObservation('execution-1', sample('b', 'b', 1, 4), { telemetryGapGraceSamples: 3 })
    ]);
    expect(await store.get('execution-1')).toMatchObject({ state: 'BLOCKED', resourceBlock: { kind: 'usage-budget' } });

    const gaps = createExecutionStore({ filePath: `${filePath}.gaps`, id: () => 'execution-2' });
    await new ExecutionService(deps(`${filePath}.gaps`, { store: gaps })).start('owner', 'project-1', { ...request, launchRequestId: 'gaps', policy: { usageBudget: { maxTokens: 100 } } });
    await Promise.all(['a', 'b', 'c'].map((id) => gaps.appendUsageObservation('execution-2', sample(id, id, 1), { telemetryGapGraceSamples: 3 })));
    expect(await gaps.get('execution-2')).toMatchObject({ state: 'BLOCKED', telemetryGapCount: 3, resourceBlock: { kind: 'telemetry-unavailable' } });
  }));

  it('admits new work below USD budget', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', { ...request, policy: { usageBudget: { maxUsd: 2 } } });
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    await store.appendUsageObservation(record.id, {
      observationId: 'usd', executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 'worker', workAttempt: 0, claimGeneration: 0,
      adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 1, provider: 'p', routingIdentity: 'r', cumulative: { providerCostUsd: 1.99 }, completeness: 'complete', observedAt: 1
    });
    await expect(service.claimWork({ executionId: record.id, projectId: record.projectId, role: 'worker', slotId: 'slot-1' }, 'unit')).resolves.toMatchObject({ ok: true });
  }));

  it('does not let telemetry persistence failure reject valid work completion', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, { store, readSessionStats: async () => ({ tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, files: [], queue: [] }), getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker', projectId: 'project-1' }] }) }));
    await service.start('owner', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    const unit = record.workUnits![0];
    vi.spyOn(store, 'appendUsageObservation').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.completeWork({ executionId: record.id, projectId: record.projectId, role: 'worker', slotId: 'slot-1', principalId: 'worker' }, 'unit', 'done', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! }, true)).resolves.toMatchObject({ ok: true });
  }));

  it('requests bounded typed repairs without closing claim then completes valid structured output', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const replies: string[] = [];
    const service = new ExecutionService(deps(filePath, { store, replyToSession: (_id, text) => { replies.push(text); return true; }, getTeamLaunch: async () => ({ orchestratorSessionId: 'lead' }) }));
    await service.start('owner', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, output: { version: 1, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    const unit = record.workUnits![0];
    const binding = { executionId: record.id, projectId: record.projectId, role: 'worker' as const, slotId: 'slot-1', principalId: 'worker-1' };
    const claim = { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
    await expect(service.completeWork(binding, 'unit', 'required prose', claim, true, { ok: 'yes' })).resolves.toMatchObject({ ok: false, code: 'TYPED_OUTPUT_REPAIR', value: { workUnits: [{ state: 'CLAIMED' }] } });
    record = (await store.get(record.id))!;
    await expect(service.completeWork(binding, 'unit', 'required prose', claim, true, { ok: true })).resolves.toMatchObject({ ok: true, value: { workUnits: [{ state: 'COMPLETED', result: 'required prose', structuredResult: { ok: true } }] } });
    expect(replies).toContainEqual(expect.stringContaining('TYPED_OUTPUT_REPAIR:'));
  }));

  it('counts distinct invalid payloads with same reason but coalesces exact duplicate', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, { store, replyToSession: () => true }));
    await service.start('owner', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], output: { version: 1, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    const unit = record.workUnits![0];
    const binding = { executionId: record.id, projectId: record.projectId, role: 'worker' as const, slotId: 'slot-1', principalId: 'worker-1' };
    const claim = { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
    await service.completeWork(binding, 'unit', 'x', claim, true, { ok: 'one' });
    await service.completeWork(binding, 'unit', 'x', claim, true, { ok: 'one' });
    await service.completeWork(binding, 'unit', 'x', claim, true, { ok: 'two' });
    expect((await store.get(record.id))?.workUnits?.[0].repairDigests).toHaveLength(2);
  }));
});

describe('KeyedColdStartSemaphore', () => {
  it('serializes same-key bursts while independent keys proceed', async () => {
    const semaphore = new KeyedColdStartSemaphore(1);
    const first = await semaphore.acquire('provider:account');
    const same = semaphore.acquire('provider:account');
    const other = await semaphore.acquire('other:account');
    expect(other).toBeTypeOf('function');
    let sameAcquired = false;
    void same.then((release) => { sameAcquired = !!release; release?.(); });
    await Promise.resolve();
    expect(sameAcquired).toBe(false);
    first?.();
    await same;
    expect(sameAcquired).toBe(true);
    other?.();
  });

  it('drops a canceled waiter after wake and leaves permit reusable', async () => {
    const semaphore = new KeyedColdStartSemaphore(1);
    const first = await semaphore.acquire('provider:account');
    let canceled = false;
    const waiting = semaphore.acquire('provider:account', () => canceled);
    await Promise.resolve();
    canceled = true;
    first?.();
    await expect(waiting).resolves.toBeUndefined();
    const next = await semaphore.acquire('provider:account');
    expect(next).toBeTypeOf('function');
    next?.();
  });

  it('wakes a live waiter behind a canceled waiter', async () => {
    const semaphore = new KeyedColdStartSemaphore(1);
    const first = await semaphore.acquire('provider:account');
    let canceled = false;
    const canceledWaiter = semaphore.acquire('provider:account', () => canceled);
    const liveWaiter = semaphore.acquire('provider:account');
    await Promise.resolve();
    canceled = true;
    first?.();
    await expect(canceledWaiter).resolves.toBeUndefined();
    const release = await liveWaiter;
    expect(release).toBeTypeOf('function');
    release?.();
  });

  it('wakes a live waiter behind a canceled predicate that throws', async () => {
    const semaphore = new KeyedColdStartSemaphore(1);
    const first = await semaphore.acquire('provider:account');
    let checks = 0;
    const throwingWaiter = semaphore.acquire('provider:account', () => {
      if (++checks > 1) throw new Error('cancel probe failed');
      return false;
    });
    const liveWaiter = semaphore.acquire('provider:account');
    await Promise.resolve();
    first?.();
    await expect(throwingWaiter).rejects.toThrow('cancel probe failed');
    const release = await liveWaiter;
    expect(release).toBeTypeOf('function');
    release?.();
  });

  it('times out queued acquisition without leaking the permit', async () => {
    vi.useFakeTimers();
    try {
      const semaphore = new KeyedColdStartSemaphore(1);
      const first = await semaphore.acquire('provider:account');
      const waiting = semaphore.acquire('provider:account', () => false, 10);
      await vi.advanceTimersByTimeAsync(10);
      await expect(waiting).resolves.toBeUndefined();
      first?.();
      const next = await semaphore.acquire('provider:account');
      expect(next).toBeTypeOf('function');
      next?.();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('deterministicTerminalSummary', () => {
  it('assembles bounded unit, policy, and artifact evidence without model output', () => {
    const summary = deterministicTerminalSummary({
      state: 'FAILED',
      workUnits: [
        { id: 'done', title: 'Build', task: 'build', dependencies: [], state: 'COMPLETED', attempt: 1, result: 'built', history: [] },
        { id: 'failed', title: 'Verify', task: 'verify', dependencies: ['done'], state: 'FAILED', attempt: 1, failureCode: 'VALIDATION_FAILED', failure: 'Bearer secret-value', history: [] }
      ],
      policyResult: { version: 1, executionId: 'execution-1', attempt: 1, outputDigest: 'out', extensionDigest: 'ext', status: 'FAILED', summary: 'policy rejected' }
    } as ExecutionRecord, [{ name: 'report.json', mediaType: 'application/json', contentDigest: 'sha256:report' } as never], [
      { eventType: 'outcome', summary: 'Verification report stored' } as never
    ]);
    expect(summary).toContain('# Execution failed');
    expect(summary).toContain('- Build [COMPLETED]');
    expect(summary).not.toContain('built');
    expect(summary).toContain('- Verify [FAILED]: VALIDATION_FAILED');
    expect(summary).not.toContain('secret-value');
    expect(summary).toContain('Policy: FAILED - policy rejected');
    expect(summary).toContain('- outcome: Verification report stored');
    expect(summary).toContain('- report.json (application/json, sha256:report)');
    expect(summary.length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('SquadExecutionService', () => {
  it('exposes generic execution API while defaulting durable launch metadata to Team', async () => fixture(async (filePath) => {
    const service = new ExecutionService(deps(filePath));
    const genericRequest: ExecutionRequestV1 = { ...request, launchDisplay: { label: 'Release execution' } };
    const started = await service.start('session-1', 'project-1', genericRequest);
    expect(started).toMatchObject({
      ok: true,
      value: { launchKind: 'team', launchDisplay: { label: 'Release execution' }, request: { launchKind: 'team', launchDisplay: { label: 'Release execution' } } }
    });
  }));

  it('persists generic preplanned work before launching the Team', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new ExecutionService(deps(filePath, { launchTeam }));
    const started = await service.start('session-1', 'project-1', {
      ...request,
      coordinationMode: 'job-team',
      workUnits: [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]
    });
    expect(started).toMatchObject({ ok: true, value: { workUnits: [expect.objectContaining({ id: 'a', state: 'READY' })] } });
    expect(launchTeam).toHaveBeenCalledTimes(1);
  }));

  it('launches freeform as a durable execution with no upfront DAG for Path B registration', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new ExecutionService(deps(filePath, { launchTeam }));
    const started = await service.start('session-1', 'project-1', {
      ...request,
      objective: 'Infer and ship',
      coordinationMode: 'freeform',
      origin: 'explicit'
    });
    expect(started).toMatchObject({
      ok: true,
      value: { coordinationMode: 'freeform', origin: 'explicit', request: { objective: 'Infer and ship' } }
    });
    expect(started.ok && started.value.workUnits).toBeUndefined();
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({
      coordinationMode: 'freeform',
      jobContext: expect.objectContaining({ objective: 'Infer and ship' })
    }));
  }));

  it('replays pre-normalization records when launchKind remains omitted', async () => fixture(async (filePath) => {
    let launchCount = 0;
    const input = deps(filePath, { launchTeam: async () => { launchCount += 1; return { ok: true }; } });
    const service = new ExecutionService(input);
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { records: Array<{ launchKind?: unknown; launchDisplay?: unknown; request: Record<string, unknown> }> };
    delete state.records[0].launchKind;
    delete state.records[0].launchDisplay;
    delete state.records[0].request.launchKind;
    delete state.records[0].request.launchDisplay;
    await writeFile(filePath, JSON.stringify(state));

    const replay = await service.start('session-1', 'project-1', request);
    expect(replay).toMatchObject({ ok: true, value: { id: 'execution-1' } });
    expect(launchCount).toBe(1);
  }));

  it('treats explicit Team launch kind as the legacy default for idempotency', async () => fixture(async (filePath) => {
    let launchCount = 0;
    const service = new ExecutionService(deps(filePath, { launchTeam: async () => { launchCount += 1; return { ok: true }; } }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    await expect(service.start('session-1', 'project-1', { ...request, launchKind: 'team' })).resolves.toMatchObject({ ok: true, value: { id: 'execution-1' } });
    expect(launchCount).toBe(1);
  }));

  it('separates host-bound coordinator and worker authority across executions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner-1', 'project-1', request);
    await service.start('owner-2', 'project-1', { ...request, launchRequestId: 'request-2' });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead-1', role: 'orchestrator' as const };
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.registerPlan(coordinator, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }])).resolves.toMatchObject({ ok: true });
    await expect(service.claimWork(worker, 'a')).resolves.toMatchObject({ ok: true, value: { workUnits: [{ assignedSlotId: 'slot-1' }] } });
    await expect(service.completeWork({ ...worker, slotId: 'slot-2' }, 'a', 'forged')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinatorBinding({ ...coordinator, executionId: 'execution-2' }, 'execution-1', 'forged')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
  }));

  it('separates coordinator assignment from worker self-claim', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'worker-1', role: 'worker' as const };
    await service.registerPlan(coordinator, [
      { id: 'assigned', title: 'Assigned', task: 'Assigned', dependencies: [], readOnly: true },
      { id: 'claimed', title: 'Claimed', task: 'Claimed', dependencies: [], readOnly: true }
    ]);
    await expect(service.claimWork(coordinator, 'assigned')).resolves.toEqual({
      ok: false, code: 'DENIED', message: 'coordinator must use execution.work.assign'
    });
    await expect(service.assignWork(coordinator, 'assigned', 'worker-1')).resolves.toMatchObject({ ok: true });
    await expect(service.claimWork(worker, 'claimed')).resolves.toMatchObject({
      ok: true, value: { workUnits: expect.arrayContaining([expect.objectContaining({ id: 'claimed', assignedSlotId: 'worker-1' })]) }
    });
  }));

  it('rejects coordinator work outcomes while allowing assigned workers', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'worker-1', role: 'worker' as const };
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, coordinator, 'a', 'worker-1');
    await expect(service.completeWork(coordinator, 'a', 'wrong')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.failWork(coordinator, 'a', 'wrong')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.blockWork(coordinator, 'a', { id: 'b', question: 'Wrong?' })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.releaseWork(coordinator, 'a')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeWork(worker, 'a', 'done')).resolves.toMatchObject({ ok: true });
  }));

  it('dispatch_ready is coordinator-only and pushes the assigned task to the worker session', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'slot-1', role: 'worker' as const };
    await expect(service.dispatchReady(worker)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    const dispatched = await service.dispatchReady(coordinator);
    expect(dispatched).toMatchObject({ ok: true, value: { coordinatorState: 'PARKED', workUnits: [{ id: 'a', state: 'CLAIMED', assignedSlotId: 'slot-1' }] } });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    expect(replyToSession.mock.calls[0]?.[1]).not.toContain('agent_send');
  }));

  it('does not type an assignment into a dead-agent worker (releases instead of stdin-echo into the surviving shell)', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const deliverToWorker = vi.fn(() => true);
    const closeWorkerSession = vi.fn();
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, deliverToWorker, closeWorkerSession,
      getWorkerLiveness: () => 'dead', // worker's inner agent is gone; the shell wrapper survives
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    // Assignment was RELEASED back to READY, never written into the dead-agent's shell.
    const after = await service.status('owner', 'project-1', 'execution-1');
    expect(after?.workUnits).toMatchObject([{ id: 'a', state: 'READY' }]);
    expect(deliverToWorker).not.toHaveBeenCalled();
    expect(replyToSession).not.toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    // AND the dead worker's surviving shell/tmux wrapper is reaped, not left to leak.
    expect(closeWorkerSession).toHaveBeenCalledWith('worker-1');
  }));

  it('does not dispatch to a worker whose process already terminated (reconciled prior-run session; no liveness probe needed)', async () => fixture(async (filePath) => {
    // A restart reconciles a prior-run worker to `process:'exited'` but keeps its
    // sessionId (team-lifecycle-store reconcileStartup). A recovered board would then
    // re-dispatch a unit to that stale sessionId, count it delivered, never heartbeat,
    // and churn dispatch↔lease-reclaim to the run timeout (live run f0f44413). The
    // terminal-process guard is authoritative and needs NO liveness probe — note there
    // is deliberately NO getWorkerLiveness dep here, yet the assignment is still released.
    const replyToSession = vi.fn(() => true);
    const deliverToWorker = vi.fn(() => true);
    const closeWorkerSession = vi.fn();
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, deliverToWorker, closeWorkerSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      // Prior-run worker: sessionId RETAINED, process reconciled to a terminal state.
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'exited' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    const after = await service.status('owner', 'project-1', 'execution-1');
    expect(after?.workUnits).toMatchObject([{ id: 'a', state: 'READY' }]);
    expect(deliverToWorker).not.toHaveBeenCalled();
    expect(replyToSession).not.toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    // A terminal-process worker's OUTER wrapper has ALREADY exited — there is no
    // zombie to reap, so the close hook must NOT fire here (only the alive-shell/
    // dead-inner-agent case reaps).
    expect(closeWorkerSession).not.toHaveBeenCalled();
  }));

  // End-to-end containment + recovery for the remote-opencode zombie: the outer shell
  // stays alive so getTeamLaunch keeps returning the slot as a worker, but the inner
  // agent is dead. This is the ONE loop the isolated tests above don't chain: prove that
  // REPEATED reconcile+redispatch sweeps NEVER type an assignment into the dead shell
  // (no stdin-echo garbage, no model spend — the whole point of the fix), the unit stays
  // recoverable (READY, not wedged into a zombie CLAIMED), AND the instant the worker is
  // replaced (liveness flips 'dead'→'alive') the very next sweep delivers. Nothing here
  // is fictional: it composes only the wired delivery guard + redispatch behavior.
  it('contains a dead-agent zombie across repeated sweeps then recovers the moment its worker is live', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    let liveness: 'dead' | 'alive' = 'dead'; // inner agent gone; shell wrapper survives
    const replyToSession = vi.fn(() => true);
    const deliverToWorker = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, deliverToWorker, now,
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      getAgentState: () => 'unknown', // OSC/hook-less remote worker reads unknown forever
      getWorkerLiveness: () => liveness,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator); // dead worker → guard releases to READY

    // Repeated sweeps over a dead worker: unit stays READY, no assignment ever delivered.
    for (let sweep = 0; sweep < 4; sweep++) {
      clock.t += 700_000; // past both stall (600k) and any renew window each pass
      await service.reconcileActive();
      await service.redispatchStalled();
      const contained = await service.status('owner', 'project-1', 'execution-1');
      expect(contained?.workUnits).toMatchObject([{ id: 'a', state: 'READY' }]);
    }
    expect(deliverToWorker).not.toHaveBeenCalled();
    expect(replyToSession).not.toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));

    // Worker replaced with a live agent → next sweep delivers. Recovery, not a spin.
    liveness = 'alive';
    clock.t += 700_000;
    await service.redispatchStalled();
    const recovered = await service.status('owner', 'project-1', 'execution-1');
    expect(recovered?.workUnits).toMatchObject([{ id: 'a', state: 'CLAIMED', assignedSlotId: 'slot-1' }]);
    expect(deliverToWorker).toHaveBeenCalled(); // assignment finally reached the live worker
  }));

  it('registerPlan auto-dispatches ready units to workers (host-neutral kickoff; no separate dispatch_ready)', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    // Flow B/C: start with NO seeded work units — the coordinator authors the plan.
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team' });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    // The coordinator's single authoring WRITE (register) implies dispatch: the
    // ready unit is CLAIMED + pushed to the worker and the coordinator PARKS,
    // all without a separate dispatch_ready call (the fragile second model call).
    const registered = await service.registerPlan(coordinator, [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    expect(registered).toMatchObject({ ok: true, value: { coordinatorState: 'PARKED', workUnits: [{ id: 'a', state: 'CLAIMED', assignedSlotId: 'slot-1' }] } });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    // A later explicit dispatch_ready remains a harmless no-op — nothing new is READY.
    const pushesAfterRegister = replyToSession.mock.calls.length;
    await expect(service.dispatchReady(coordinator)).resolves.toMatchObject({ ok: true });
    expect(replyToSession.mock.calls.length).toBe(pushesAfterRegister);
  }));

  it('redispatchStalled recovers a run wedged with READY units and nothing in flight', async () => fixture(async (filePath) => {
    // First delivery FAILS → the unit is released back to READY with 0 CLAIMED:
    // the exact wedge (no work edge left to re-fire cascadeDispatch).
    const replyToSession = vi.fn(() => false);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    const wedged = await service.status('owner', 'project-1', 'execution-1');
    expect(wedged?.workUnits?.some((unit) => unit.state === 'CLAIMED')).toBe(false);
    expect(wedged?.workUnits).toMatchObject([{ id: 'a', state: 'READY' }]);
    // Delivery now succeeds; the periodic sweep re-attempts dispatch and recovers.
    replyToSession.mockReturnValue(true);
    await service.redispatchStalled();
    const recovered = await service.status('owner', 'project-1', 'execution-1');
    expect(recovered?.workUnits).toMatchObject([{ id: 'a', state: 'CLAIMED', assignedSlotId: 'slot-1' }]);
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    // With the unit now in flight (CLAIMED), a second sweep is a no-op.
    const pushes = replyToSession.mock.calls.length;
    await service.redispatchStalled();
    expect(replyToSession.mock.calls.length).toBe(pushes);
  }));

  // Live run c33a6715: a unit stayed CLAIMED with `deliveries: []`, its worker idle
  // in standby (assignment never reached it) and coordinator PARKED, so 0 CLAIMED
  // never held — the old redispatchStalled skipped it as "work in flight" and only
  // the blunt 10-min stall ceiling in reconcileActive could break it (then re-handed
  // the same undelivered slot). A CLAIMED unit whose `progressAt` never advanced past
  // `claimedAt` for the stall window under a PARKED coordinator is NOT in flight.
  function wedgedClaimDeps(filePath: string, now: () => number, replyToSession: ReturnType<typeof vi.fn>, over: Record<string, unknown> = {}) {
    return deps(filePath, {
      store: createExecutionStore({ filePath, id: () => 'execution-1', now }),
      replyToSession, now,
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }),
      ...over
    });
  }
  async function startWedgedClaim(service: InstanceType<typeof SquadExecutionService>) {
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
  }

  it('redispatchStalled reclaims a stranded CLAIMED unit (no output progress, PARKED coordinator) and re-dispatches it', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(wedgedClaimDeps(filePath, now, replyToSession));
    await startWedgedClaim(service);
    const claimed = await service.status('owner', 'project-1', 'execution-1');
    expect(claimed?.coordinatorState).toBe('PARKED');
    expect(claimed?.workUnits?.[0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', claimGeneration: 1 });
    // Worker never produced OUTPUT → progressAt frozen at claim time. After the stall
    // window the sweep reclaims the stranded claim and re-dispatches (fresh generation).
    clock.t += 700_000; // >= default job-team maxClaimStallMs (600_000)
    replyToSession.mockClear();
    await service.redispatchStalled();
    const recovered = await service.status('owner', 'project-1', 'execution-1');
    expect(recovered?.workUnits?.[0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', claimGeneration: 2 });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
  }));

  it('redispatchStalled reclaims a claim whose output progressed ONCE then went stale (un-mask; run 47823553)', async () => fixture(async (filePath) => {
    // The masking bug: a bare OpenCode worker ECHOES the injected paste once (a single
    // real-output heartbeat), advancing progressAt past claimedAt, then goes silent.
    // The old `progressed = progressAt > claimedAt` short-circuit then treated the dead
    // claim as live FOREVER and this sweep never reclaimed it. Liveness is now RECENCY:
    // progressAt stale past the stall window is reclaimed regardless of "ever progressed".
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const service = new SquadExecutionService(wedgedClaimDeps(filePath, now, replyToSession, { store }));
    await startWedgedClaim(service);
    const claimed = (await store.get('execution-1'))!.workUnits![0];
    expect(claimed).toMatchObject({ state: 'CLAIMED', progressAt: 1_000, claimedAt: 1_000 });
    // Single output blip: one worker heartbeat turn advances progressAt above claimedAt.
    clock.t = 60_000;
    await store.heartbeatWork('execution-1', (await store.get('execution-1'))!.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration!, turnCount: 1 });
    expect((await store.get('execution-1'))!.workUnits![0].progressAt).toBe(60_000); // progressed past claim
    // Then silent past the stall window → recency governs, so the stale claim reclaims.
    clock.t = 60_000 + 700_000; // now - progressAt >= job-team maxClaimStallMs (600_000)
    replyToSession.mockClear();
    await service.redispatchStalled();
    const recovered = (await store.get('execution-1'))!.workUnits![0];
    expect(recovered).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', claimGeneration: 2 });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
  }));

  it('blocks a churning unit to a human after KICKOFF_FAILURE_BLOCK_THRESHOLD never-turned reclaims (self-heal escape hatch)', async () => fixture(async (filePath) => {
    // A worker that accepts each dispatch but NEVER starts a turn would otherwise be
    // reclaimed → re-dispatched down the same broken delivery path forever (a silently
    // wedged run). At the threshold the engine STOPS churning and surfaces an actionable
    // HUMAN_BLOCKER on the board / inbox instead — the "never sit broken" mandate.
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const service = new SquadExecutionService(wedgedClaimDeps(filePath, now, replyToSession, { store }));
    await startWedgedClaim(service);
    for (let sweep = 0; sweep < KICKOFF_FAILURE_BLOCK_THRESHOLD; sweep++) {
      clock.t += 700_000; // past job-team maxClaimStallMs each pass → reclaim + re-dispatch
      await service.redispatchStalled();
    }
    const blocked = (await store.get('execution-1'))!;
    expect(blocked.workUnits![0]).toMatchObject({ state: 'BLOCKED' });
    expect(blocked.workUnits![0].assignedSlotId).toBeUndefined();
    expect(blocked.state).toBe('BLOCKED');
    const blocker = blocked.blockers?.find((entry) => entry.workUnitId === 'a');
    expect(blocker).toMatchObject({ audience: 'human', resolved: false });
    expect(blocker?.question).toContain('never started a turn');
    // Coordinator woken with the actionable blocker (not a silent spin).
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('HUMAN_BLOCKER'));
    // Churn has stopped: a further sweep finds no CLAIMED unit and re-dispatches nothing.
    replyToSession.mockClear();
    clock.t += 700_000;
    await service.redispatchStalled();
    expect(replyToSession).not.toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    expect((await store.get('execution-1'))!.workUnits![0].state).toBe('BLOCKED');
  }));

  // A team with MORE THAN ONE authorized worker slot: the engine self-heals across
  // slots (re-home before block) and only blocks when EVERY slot is exhausted.
  function twoWorkerWedgedDeps(filePath: string, now: () => number, replyToSession: ReturnType<typeof vi.fn>, over: Record<string, unknown> = {}) {
    return deps(filePath, {
      store: createExecutionStore({ filePath, id: () => 'execution-1', now }),
      replyToSession, now,
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' },
          { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'w2-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [
        { slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' },
        { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1' }
      ] }),
      ...over
    });
  }

  it('self-heals a churning unit onto a DIFFERENT worker slot before ever blocking a human', async () => fixture(async (filePath) => {
    // The "coordinator reassigns before it asks a person" half of the mandate: a unit
    // that churns to threshold on slot-1 is re-homed onto the untried slot-2 and
    // re-dispatched to its worker — NOT blocked — because a slot-specific delivery
    // failure may not recur on a fresh peer. Harness-agnostic (core churn state only).
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const service = new SquadExecutionService(twoWorkerWedgedDeps(filePath, now, replyToSession, { store }));
    await startWedgedClaim(service);
    for (let sweep = 0; sweep < KICKOFF_FAILURE_BLOCK_THRESHOLD; sweep++) {
      clock.t += 700_000; // past job-team maxClaimStallMs each pass → reclaim + re-dispatch
      replyToSession.mockClear();
      await service.redispatchStalled();
    }
    const record = (await store.get('execution-1'))!;
    // Reassigned + re-dispatched onto the untried slot-2 worker; not blocked, no blocker.
    expect(record.workUnits![0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-2' });
    expect(record.state).not.toBe('BLOCKED');
    expect(record.blockers ?? []).toHaveLength(0);
    expect(replyToSession).toHaveBeenCalledWith('worker-2', expect.stringContaining('assigned work unit `a`'));
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.stringContaining('HUMAN_BLOCKER'));
  }));

  it('blocks to a human with a linked inbox entry only after EVERY worker slot is exhausted', async () => fixture(async (filePath) => {
    // Reassignment is bounded: once the unit has churned on every authorized worker
    // slot the engine stops re-homing and surfaces an actionable HUMAN_BLOCKER — woken
    // on the coordinator AND appended to the Inbox (the gap reported live was a "needs
    // you" run with NO inbox message). Inbox append is unconditional on a human block.
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const inbox = { append: vi.fn(async () => undefined) };
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const service = new SquadExecutionService(twoWorkerWedgedDeps(filePath, now, replyToSession, { store, inbox }));
    await startWedgedClaim(service);
    // slot-1 exhausts (3) → reassign to slot-2 → slot-2 exhausts (3) → both tried → block.
    for (let sweep = 0; sweep < KICKOFF_FAILURE_BLOCK_THRESHOLD * 2; sweep++) {
      clock.t += 700_000;
      await service.redispatchStalled();
    }
    const blocked = (await store.get('execution-1'))!;
    expect(blocked.state).toBe('BLOCKED');
    expect(blocked.workUnits![0]).toMatchObject({ state: 'BLOCKED' });
    expect(blocked.workUnits![0].assignedSlotId).toBeUndefined();
    const blocker = blocked.blockers?.find((entry) => entry.workUnitId === 'a');
    expect(blocker).toMatchObject({ audience: 'human', resolved: false });
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('HUMAN_BLOCKER'));
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'execution-1', projectId: 'project-1', blockerId: blocker!.id, comments: blocker!.question
    }));
  }));

  it('redispatchStalled leaves a stranded CLAIMED unit untouched when claim-recovery enforce is OFF', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(wedgedClaimDeps(filePath, now, replyToSession, { claimRecoveryEnforceEnabled: () => false }));
    await startWedgedClaim(service);
    clock.t += 700_000;
    replyToSession.mockClear();
    await service.redispatchStalled();
    const after = await service.status('owner', 'project-1', 'execution-1');
    expect(after?.workUnits?.[0]).toMatchObject({ state: 'CLAIMED', claimGeneration: 1 }); // unchanged
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('redispatchStalled treats a still-fresh claim as in flight and does not reclaim it', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(wedgedClaimDeps(filePath, now, replyToSession));
    await startWedgedClaim(service);
    clock.t += 100_000; // < maxClaimStallMs → not yet stranded
    replyToSession.mockClear();
    await service.redispatchStalled();
    const after = await service.status('owner', 'project-1', 'execution-1');
    expect(after?.workUnits?.[0]).toMatchObject({ state: 'CLAIMED', claimGeneration: 1 }); // still in flight
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('redispatchStalled isolates a per-run cascadeDispatch failure and still recovers the other runs', async () => fixture(async (filePath) => {
    // Finding (per-execution isolation): the final per-record cascadeDispatch is wrapped
    // so a rejection for ONE wedged run cannot abort the sweep and starve every later
    // run behind it in the listActive() order. A persistently-failing first record must
    // NOT block recovery of the rest.
    let n = 0;
    const logError = vi.fn();
    const store = createExecutionStore({ filePath, id: () => `execution-${++n}` });
    const replyToSession = vi.fn(() => false); // first delivery fails → unit released to READY, 0 CLAIMED
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, logError,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    // Two independent runs, each wedged to READY with 0 CLAIMED (no work edge to re-fire).
    for (const executionId of ['execution-1', 'execution-2']) {
      await service.start('owner', 'project-1', { ...request, launchRequestId: `request-${executionId}`, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
      await service.dispatchReady({ executionId, projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const });
    }
    // Now the sweep's final dispatch fails ONLY for execution-1.
    const cascade = vi.spyOn(service as unknown as { cascadeDispatch: (id: string) => Promise<void> }, 'cascadeDispatch')
      .mockImplementation(async (id: string) => { if (id === 'execution-1') throw new Error('cascade boom'); });
    logError.mockClear();
    await service.redispatchStalled();
    expect(cascade).toHaveBeenCalledWith('execution-1'); // attempted (and threw)
    expect(cascade).toHaveBeenCalledWith('execution-2'); // NOT starved by the first failure
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('stalled-redispatch dispatch failed for execution-1'), expect.any(Error));
  }));

  it('escalateKickoffFailures surfaces a real reassignment persistence failure and does NOT fall through to a human block', async () => fixture(async (filePath) => {
    // Finding (typed-guard distinction): a no-op guard rejection from reassignment is
    // EXPECTED (fall through to the human block); a genuine store/persistence failure is
    // NOT — it must be surfaced as "FAILED (persistence)" and must NOT be masked by a
    // block attempt on the same broken store (which would hide a unit left neither
    // reassigned nor blocked). Only a WorkUnitRecoveryGuardError reaches the block half.
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const logError = vi.fn();
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const service = new SquadExecutionService(wedgedClaimDeps(filePath, now, replyToSession, { store, logError }));
    await startWedgedClaim(service);
    // Reassignment fails with a PLAIN Error (a real store failure), not a no-op guard.
    const reassignSpy = vi.spyOn(store, 'reassignKickoffToFreshSlot').mockRejectedValue(new Error('sqlite disk I/O error'));
    const blockSpy = vi.spyOn(store, 'blockKickoffFailure');
    for (let sweep = 0; sweep <= KICKOFF_FAILURE_BLOCK_THRESHOLD; sweep++) {
      clock.t += 700_000; // past job-team maxClaimStallMs each pass → reclaim (climbs kickoffFailures)
      await service.redispatchStalled();
    }
    expect(reassignSpy).toHaveBeenCalled();
    expect(blockSpy).not.toHaveBeenCalled(); // real failure short-circuits BEFORE the human block
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('kickoff-failure reassignment FAILED (persistence) for execution-1/a'), expect.any(Error));
    // It is a real failure, not a guard "skipped" no-op.
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining('reassignment skipped for execution-1/a'), expect.anything());
    // The unit is still not blocked (the escape hatch never fired on a broken store).
    expect((await store.get('execution-1'))!.workUnits![0].state).not.toBe('BLOCKED');
  }));

  it.each([
    ['SEMANTIC_CONFLICT', 'SEMANTIC_CONFLICT'],
    ['POLICY_ESCALATION', 'POLICY_ESCALATION']
  ] as const)('wakes parked coordinator only for %s worker failure lane', async (failureCode, expected) => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, deliverToWorker: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    replyToSession.mockClear();
    await service.failWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', 'needs judgment', failureCode);
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain(expected);
    expect(await store.get('execution-1')).toMatchObject({ state: 'RUNNING', coordinatorState: 'ACTIVE' });
  }));

  it('retains a failed coordinator wake and retries it on a later idle edge', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Choose?' });
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('HUMAN_BLOCKER');
    replyToSession.mockReturnValue(true);
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  it('attempts immediate wake delivery without optional idle-state wiring', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    replyToSession.mockClear();
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Choose?' });
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('HUMAN_BLOCKER'));
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  it('logs coordinator wake persistence and drain failures with execution context', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const logError = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, queueCoordinatorWake: async () => { throw new Error('disk failed'); } },
      logError,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Choose?' });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('wake persistence failed for execution-1'), expect.any(Error));

    const drain = new SquadExecutionService(deps(filePath, {
      store: { ...store, getInProject: async () => { throw new Error('read failed'); } },
      logError
    }));
    await drain.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('wake drain failed for execution-1'), expect.any(Error));
  }));

  it('delivers a durable wake immediately when coordinator is already idle', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    replyToSession.mockClear();
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Choose?' });
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('HUMAN_BLOCKER'));
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  it('leaves a wake queued while the coordinator is busy, then delivers on its restful edge (RISK-1)', async () => fixture(async (filePath) => {
    let coordinatorState: 'working' | 'idle' = 'working';
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, getAgentState: () => coordinatorState,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    replyToSession.mockClear();
    // Coordinator is busy: the wake must NOT be wedged into its TUI, and must stay queued.
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Choose?' });
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.anything());
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('HUMAN_BLOCKER');
    // Coordinator returns to rest: the idle-edge retry delivers the queued wake and acks it.
    coordinatorState = 'idle';
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('HUMAN_BLOCKER'));
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  // ROOT CAUSE of "coordinator parks on its own self-heal blocker": a remote/opencode
  // coordinator with no mesh dot resolves to AgentStatusTracker 'unknown' forever. The old
  // gate hard-blocked every non-restful state, so an `unknown` wake was stranded, and the
  // raw-idle-edge retry (host.ts) never fired for a coordinator that emits no idle edge. Fix:
  // (1) the gate delivers an `unknown` wake once it ages past COORDINATOR_WAKE_UNKNOWN_STALE_MS
  //     (20s), while working/blocked still hard-block; (2) drainPendingCoordinatorWakes() is a
  // reconcile-tick poll that triggers delivery WITHOUT needing a raw idle edge.
  type MeshlessState = 'unknown' | 'working' | 'blocked' | 'idle';
  function meshlessWakeFixture(filePath: string, nowRef: () => number, stateRef: () => MeshlessState) {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: nowRef });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, now: nowRef, getAgentState: () => stateRef(), deliverToWorker: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    return { store, service, replyToSession };
  }
  async function seedCoordinatorSelfHealWake(service: InstanceType<typeof SquadExecutionService>, replyToSession: ReturnType<typeof vi.fn>) {
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    replyToSession.mockClear();
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Which target file?', audience: 'coordinator' });
  }

  it('holds an unknown-state coordinator wake until the staleness bound, then delivers it', async () => fixture(async (filePath) => {
    let now = 1_000_000;
    const { store, service, replyToSession } = meshlessWakeFixture(filePath, () => now, () => 'unknown');
    await seedCoordinatorSelfHealWake(service, replyToSession);
    // Fresh wake vs an unknown coordinator: held (could be a transient startup `unknown`).
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.anything());
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('SEMANTIC_CONFLICT');
    // Just before the bound: still held.
    now += 19_000;
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.anything());
    expect((await store.get('execution-1'))?.coordinatorWakes).toHaveLength(1);
    // Past the bound: delivered + acked so the meshless coordinator is never stranded.
    now += 2_000;
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('SEMANTIC_CONFLICT'));
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  it('never delivers to a working/blocked coordinator however stale the wake, only on a truly restful edge', async () => fixture(async (filePath) => {
    let now = 1_000_000;
    let state: MeshlessState = 'working';
    const { store, service, replyToSession } = meshlessWakeFixture(filePath, () => now, () => state);
    await seedCoordinatorSelfHealWake(service, replyToSession);
    now += 10 * 60_000; // long past any staleness bound
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.anything());
    state = 'blocked';
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.anything());
    expect((await store.get('execution-1'))?.coordinatorWakes).toHaveLength(1);
    // Only a genuinely at-rest coordinator receives the wake (no mid-turn wedge).
    state = 'idle';
    await service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('SEMANTIC_CONFLICT'));
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  it('drainPendingCoordinatorWakes (reconcile poll) delivers a stale unknown-coordinator wake with no idle edge', async () => fixture(async (filePath) => {
    let now = 1_000_000;
    const { store, service, replyToSession } = meshlessWakeFixture(filePath, () => now, () => 'unknown');
    await seedCoordinatorSelfHealWake(service, replyToSession);
    replyToSession.mockClear();
    // Before the bound the poll is a no-op.
    now += 10_000;
    await service.drainPendingCoordinatorWakes();
    expect(replyToSession).not.toHaveBeenCalledWith('coordinator', expect.anything());
    expect((await store.get('execution-1'))?.coordinatorWakes).toHaveLength(1);
    // Past the bound the reconcile poll — NOT a raw idle edge — gets the self-heal ask delivered.
    now += 15_000;
    await service.drainPendingCoordinatorWakes();
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('SEMANTIC_CONFLICT'));
    expect((await store.get('execution-1'))?.coordinatorWakes).toEqual([]);
  }));

  it('wakes parked coordinator for a human blocker', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    replyToSession.mockClear();
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Choose target?' });
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('HUMAN_BLOCKER');
    expect(await store.get('execution-1')).toMatchObject({ coordinatorState: 'ACTIVE' });
  }));

  it('routes a coordinator-audience block to a SEMANTIC_CONFLICT wake carrying the blockerId, with no human inbox entry', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const inbox = { append: vi.fn(async () => undefined) };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, inbox, deliverToWorker: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Which target file?', audience: 'coordinator' });
    const message = (await store.get('execution-1'))?.coordinatorWakes?.[0]?.message;
    expect(message).toContain('SEMANTIC_CONFLICT');
    expect(message).toContain('blockerId=blocker');
    expect(message).toContain('Which target file?');
    expect(inbox.append).not.toHaveBeenCalled(); // self-heal lane: no human is involved
    // durable blocker stamped audience so the resolve path can authorize the coordinator
    expect((await store.get('execution-1'))?.blockers?.[0]).toMatchObject({ id: 'blocker', audience: 'coordinator', resolved: false });
  }));

  it('default block audience stays human: HUMAN_BLOCKER wake plus a linked inbox entry (back-compat)', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const inbox = { append: vi.fn(async () => undefined) };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, inbox, deliverToWorker: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Need a human decision?' });
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('HUMAN_BLOCKER');
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'execution-1', blockerId: 'blocker', comments: 'Need a human decision?' }));
    expect((await store.get('execution-1'))?.blockers?.[0]?.audience).toBeUndefined(); // no audience stamped = human
  }));

  it('coordinator answers a coordinator-audience block: delivery enqueued to the worker slot, and the worker ack resolves the blocker + returns the unit to CLAIMED', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Which file?', audience: 'coordinator' });

    const answered = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'Write to a.txt.');
    expect(answered).toMatchObject({ ok: true, pending: true });
    // answer landed as a PENDING delivery targeted to the blocked worker's slot; unit still BLOCKED until the worker acks
    const afterAnswer = (await store.get('execution-1'))!;
    expect(afterAnswer.deliveries).toEqual([expect.objectContaining({ slotId: 'slot-1', blockerId: 'blocker', state: 'PENDING', payload: { text: 'Write to a.txt.' } })]);
    expect(afterAnswer.workUnits.find((unit) => unit.id === 'a')?.state).toBe('BLOCKED');

    // the worker's own pull/ack (unchanged machinery) resolves the blocker and returns the unit to CLAIMED
    const worker = { role: 'worker' as const, slotId: 'slot-1', executionId: 'execution-1', projectId: 'project-1' };
    const pulled = await store.pullBlockerDelivery(worker);
    await store.ackBlockerDelivery(worker, pulled!.id, pulled!.leaseId!, { delivered: true });
    const resolved = (await store.get('execution-1'))!;
    expect(resolved.blockers?.[0]).toMatchObject({ id: 'blocker', resolved: true, response: 'Write to a.txt.' });
    expect(resolved.workUnits.find((unit) => unit.id === 'a')?.state).toBe('CLAIMED');
  }));

  it('coordinator answer is idempotent on the deterministic client request id (one delivery for a re-issued answer)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Which file?', audience: 'coordinator' });
    await service.answerBlockerByCoordinator(coordinator, 'blocker', 'Write to a.txt.');
    await service.answerBlockerByCoordinator(coordinator, 'blocker', 'Write to a.txt.');
    expect((await store.get('execution-1'))?.deliveries).toHaveLength(1);
  }));

  // --- Stuck-coordinator escalation sweep (Fix B): a coordinator self-heal ask the
  // coordinator never answered flips to a human blocker + inbox entry after a dwell. ---
  function escalationService(filePath: string, nowRef: () => number, inbox: { append: ReturnType<typeof vi.fn> }) {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: nowRef });
    const service = new SquadExecutionService(deps(filePath, {
      store, inbox, now: nowRef,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    return { store, service };
  }
  const ESCALATE_COORDINATOR = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
  async function seedCoordinatorBlock(service: SquadExecutionService, opts?: { options?: string[] }) {
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    await service.dispatchReady(ESCALATE_COORDINATOR);
    await service.blockWork({ ...ESCALATE_COORDINATOR, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Which file?', ...(opts?.options ? { options: opts.options } : {}), audience: 'coordinator' });
  }

  it('escalates a stale coordinator blocker to a human (audience flip + inbox) once the dwell passes', async () => fixture(async (filePath) => {
    let now = 1000;
    const inbox = { append: vi.fn(async () => undefined) };
    const { store, service } = escalationService(filePath, () => now, inbox);
    await seedCoordinatorBlock(service, { options: ['a.txt', 'b.txt'] });
    expect(inbox.append).not.toHaveBeenCalled(); // coordinator lane never appends on block

    now += 5 * 60_000 + 1; // past COORDINATOR_BLOCKER_ESCALATE_MS
    await service.escalateStaleCoordinatorBlockers();

    const blocker = (await store.get('execution-1'))?.blockers?.[0];
    expect(blocker).toMatchObject({ id: 'blocker', audience: 'human', resolved: false });
    expect(blocker?.escalatedAt).toBeDefined();
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'execution-1', blockerId: 'blocker', comments: 'Which file?' }));
  }));

  it('does NOT escalate a coordinator blocker before the dwell passes', async () => fixture(async (filePath) => {
    let now = 1000;
    const inbox = { append: vi.fn(async () => undefined) };
    const { store, service } = escalationService(filePath, () => now, inbox);
    await seedCoordinatorBlock(service);

    now += 60_000; // under the 5-minute dwell
    await service.escalateStaleCoordinatorBlockers();

    const blocker = (await store.get('execution-1'))?.blockers?.[0];
    expect(blocker?.audience).toBe('coordinator');
    expect(blocker?.escalatedAt).toBeUndefined();
    expect(inbox.append).not.toHaveBeenCalled();
  }));

  it('does NOT escalate while a coordinator answer delivery is still in flight', async () => fixture(async (filePath) => {
    let now = 1000;
    const inbox = { append: vi.fn(async () => undefined) };
    const { store, service } = escalationService(filePath, () => now, inbox);
    await seedCoordinatorBlock(service);
    await service.answerBlockerByCoordinator(ESCALATE_COORDINATOR, 'blocker', 'Write to a.txt.'); // PENDING delivery, worker hasn't pulled

    now += 5 * 60_000 + 1;
    await service.escalateStaleCoordinatorBlockers();

    const blocker = (await store.get('execution-1'))?.blockers?.[0];
    expect(blocker?.audience).toBe('coordinator'); // an answer is landing; not stuck
    expect(blocker?.escalatedAt).toBeUndefined();
    expect(inbox.append).not.toHaveBeenCalled();
  }));

  it('escalates a stale coordinator blocker at most once (idempotent across sweeps)', async () => fixture(async (filePath) => {
    let now = 1000;
    const inbox = { append: vi.fn(async () => undefined) };
    const { store, service } = escalationService(filePath, () => now, inbox);
    await seedCoordinatorBlock(service);

    now += 5 * 60_000 + 1;
    await service.escalateStaleCoordinatorBlockers();
    const firstEscalatedAt = (await store.get('execution-1'))?.blockers?.[0]?.escalatedAt;

    now += 5 * 60_000; // another full dwell later
    await service.escalateStaleCoordinatorBlockers();

    expect(inbox.append).toHaveBeenCalledTimes(1);
    const blocker = (await store.get('execution-1'))?.blockers?.[0];
    expect(blocker?.audience).toBe('human');
    expect(blocker?.escalatedAt).toBe(firstEscalatedAt); // not re-stamped
  }));

  it('denies a coordinator answering a human-audience blocker (still owner-only)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Human?' }); // default human audience
    await expect(service.answerBlockerByCoordinator(coordinator, 'blocker', 'answer')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    expect((await store.get('execution-1'))?.deliveries ?? []).toEqual([]);
  }));

  it('denies a non-orchestrator caller of execution.work.answer', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    await service.blockWork({ ...coordinator, slotId: 'slot-1', role: 'worker' }, 'a', { id: 'blocker', question: 'Which file?', audience: 'coordinator' });
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.answerBlockerByCoordinator(worker, 'blocker', 'answer')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
  }));

  it('wakes parked coordinator for blocked policy evaluation', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, deliverToWorker: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    await service.dispatchReady({ executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' });
    replyToSession.mockClear();
    await service.recordPolicyResult('project-1', 'execution-1', {
      version: 1, executionId: 'execution-1', attempt: 1, outputDigest: 'output', extensionDigest: 'extension', status: 'BLOCKED', summary: 'Approval required'
    });
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('POLICY_ESCALATION');
    expect(await store.get('execution-1')).toMatchObject({ coordinatorState: 'ACTIVE' });
  }));

  it('dispatch_ready surfaces a clear error when no plan is registered (defensive plan-readiness gate)', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    // No execution.plan.register call — a producer that skipped structuring the
    // plan must NOT silently hang; the engine surfaces the missing plan.
    const dispatched = await service.dispatchReady(coordinator);
    expect(dispatched).toMatchObject({ ok: false, code: 'INVALID' });
    expect(dispatched.ok === false && dispatched.message).toContain('execution.plan.register');
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('retries worker cancellation on a watchdog re-fire after a partial planless teardown', async () => fixture(async (filePath) => {
    // Grace expiry transitions to FAILED but the worker cancellation throws
    // (transient). The watchdog re-fires; the retry must re-run the idempotent
    // teardown on the already-FAILED record instead of returning early, else the
    // run stays FAILED with its workers still live.
    const cancelTeamLaunch = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, code: 'CANCEL_FAILED', message: 'transient' })
      .mockResolvedValue({ ok: true as const, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService(deps(filePath, { store, cancelTeamLaunch }));
    await service.start('owner', 'project-1', request);

    await expect((service as unknown as { failPlanlessExecution(id: string): Promise<void> })
      .failPlanlessExecution('execution-1')).rejects.toThrow(/CANCEL_FAILED/);
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
    expect(cancelTeamLaunch).toHaveBeenCalledTimes(1);

    await (service as unknown as { failPlanlessExecution(id: string): Promise<void> })
      .failPlanlessExecution('execution-1');
    expect(cancelTeamLaunch).toHaveBeenCalledTimes(2);
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
  }));

  it('cascades a newly-ready dependent to a free worker on completion with no coordinator relay', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: ['a'], files: ['b.txt'], verification: ['check b'] }
    ] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'slot-1', role: 'worker' as const };
    await service.dispatchReady(coordinator); // a → slot-1 (push #1)
    await expect(service.completeWork(worker, 'a', 'done')).resolves.toMatchObject({ ok: true }); // frees slot-1, makes b READY → cascade
    const record = await store.get('execution-1');
    expect(record?.workUnits?.find((u) => u.id === 'b')).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
    expect(replyToSession).toHaveBeenLastCalledWith('worker-1', expect.stringContaining('assigned work unit `b`'));
  }));

  it('engine auto-finalizes a fully-completed DAG without an orchestrator execution.complete', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true as const, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession: () => true, cancelTeamLaunch,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: ['a'], files: ['b.txt'], verification: ['check b'] }
    ] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'slot-1', role: 'worker' as const };
    await service.dispatchReady(coordinator);
    await service.completeWork(worker, 'a', 'done'); // a done, b still pending → NOT finalized
    expect((await store.get('execution-1'))?.state).toBe('RUNNING');
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
    await service.completeWork(worker, 'b', 'done'); // terminal unit → engine auto-finalizes
    const record = await store.get('execution-1');
    expect(record?.state).toBe('COMPLETED');
    expect(record?.finalSummary).toContain('# Execution completed');
    expect(record?.finalSummary).toContain('- A [COMPLETED]');
    expect(record?.finalSummary).not.toContain('done');
    expect(cancelTeamLaunch).toHaveBeenCalledWith('owner', 'request-1');
  }));

  it('routes assignment pushes through deliverToWorker (idle-gated) when provided, bypassing raw replyToSession', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const deliverToWorker = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, replyToSession, deliverToWorker,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }
    ] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await service.dispatchReady(coordinator);
    // idle-gate is the single delivery path — raw replyToSession must not be used for the push
    expect(deliverToWorker).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
    expect(replyToSession).not.toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'));
  }));

  it('returns a claim to READY when assignment delivery fails', async () => fixture(async (filePath) => {
    const deliverToWorker = vi.fn(() => false);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, deliverToWorker, replyToSession: () => false,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
        slots: [{ slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1' }]
      } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }
    ] });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    await expect(service.dispatchReady(coordinator)).resolves.toMatchObject({ ok: true });
    expect(deliverToWorker).toHaveBeenCalledTimes(1);
    expect((await store.get('execution-1'))?.workUnits?.[0]).toMatchObject({ state: 'READY', attempt: 1 });
    expect(await store.get('execution-1')).toMatchObject({ coordinatorState: 'ACTIVE' });
    expect((await store.get('execution-1'))?.coordinatorWakes?.[0]?.message).toContain('could not be delivered');
  }));

  it('lets execution owner retry, release, and reassign eligible work only within durable roster', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'slot-1', personaId: 'persona', authorizationIdDigest: 'digest-1' },
        { slotId: 'slot-2', personaId: 'persona', authorizationIdDigest: 'digest-2' }
      ] }
    } }), getTeamLaunch: async () => ({ workers: [
      { slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' },
      { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1' }
    ] }) }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team' });
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'failed', title: 'Failed', task: 'Retry me', dependencies: [], files: ['failed.txt'], verification: ['check failed'] },
      { id: 'claimed', title: 'Claimed', task: 'Release me', dependencies: [], files: ['claimed.txt'], verification: ['check claimed'] },
      { id: 'ready', title: 'Ready', task: 'Reassign me', dependencies: [], files: ['ready.txt'], verification: ['check ready'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'failed', 'slot-1');
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'failed', 'boom');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'claimed', 'slot-1');

    const board = service as SquadExecutionService & {
      retryWorkFromBoard(owner: string, project: string, execution: string, version: number, unit: string, slot?: string): Promise<unknown>;
      releaseWorkFromBoard(owner: string, project: string, execution: string, version: number, unit: string): Promise<unknown>;
      reassignWorkFromBoard(owner: string, project: string, execution: string, version: number, unit: string, slot: string): Promise<unknown>;
    };
    expect(typeof board.retryWorkFromBoard).toBe('function');
    await expect(board.retryWorkFromBoard('other', 'project-1', record.id, record.stateVersion, 'failed', 'slot-2')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(board.retryWorkFromBoard('owner', 'project-1', record.id, record.stateVersion, 'failed', 'forged')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    const retried = await board.retryWorkFromBoard('owner', 'project-1', record.id, record.stateVersion, 'failed', 'slot-2') as { ok: true; value: typeof record };
    expect(retried.value.workUnits).toContainEqual(expect.objectContaining({ id: 'failed', state: 'READY', assignedSlotId: 'slot-2' }));
    record = (await store.get(record.id))!;
    expect(record.workUnits).toContainEqual(expect.objectContaining({ id: 'failed', state: 'CLAIMED', assignedSlotId: 'slot-2' }));
    const released = await board.releaseWorkFromBoard('owner', 'project-1', record.id, record.stateVersion, 'claimed') as { ok: true; value: typeof record };
    expect(released.ok).toBe(true);
    record = (await store.get(record.id))!;
    expect(record.workUnits?.find((unit) => unit.id === 'claimed')).toMatchObject({ id: 'claimed', state: 'CLAIMED', assignedSlotId: 'slot-1' });
    const failed = record.workUnits?.find((unit) => unit.id === 'failed');
    if (!failed) throw new Error('missing retried unit');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: failed.assignedSlotId! }, failed.id, 'done');
    const ready = record.workUnits?.find((unit) => unit.id === 'ready');
    if (!ready) throw new Error('missing ready unit');
    const reassigned = await board.reassignWorkFromBoard('owner', 'project-1', record.id, record.stateVersion, ready.id, 'slot-2') as { ok: true; value: typeof record };
    expect(reassigned.ok).toBe(true);
    expect((await store.get(record.id))?.workUnits).toContainEqual(expect.objectContaining({ id: 'ready', state: 'CLAIMED', assignedSlotId: 'slot-2' }));
  }));

  it('dispatches an independent sibling after typed failure and settles failed DAG after runnable work completes', async () => fixture(async (filePath) => {
    const deliverToWorker = vi.fn(() => true);
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true as const, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, deliverToWorker, cancelTeamLaunch,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1' },
          { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'w2' }
        ] } } }),
      getTeamLaunch: async () => ({ workers: [
        { slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' },
        { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1' }
      ] })
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'root', title: 'Root', task: 'root', dependencies: [], files: ['root.txt'], verification: ['check'] },
      { id: 'dependent', title: 'Dependent', task: 'dependent', dependencies: ['root'], files: ['dependent.txt'], verification: ['check'] },
      { id: 'independent', title: 'Independent', task: 'independent', dependencies: [], files: ['independent.txt'], verification: ['check'] }
    ] });
    let record = (await store.get('execution-1'))!;
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'root', 'slot-1');
    const worker1 = { executionId: record.id, projectId: record.projectId, slotId: 'slot-1', role: 'worker' as const };
    await expect(service.failWork(worker1, 'root', 'tests failed', 'VALIDATION_FAILED')).resolves.toMatchObject({ ok: true });
    record = (await store.get(record.id))!;
    expect(record.workUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root', state: 'FAILED', failureCode: 'VALIDATION_FAILED' }),
      expect.objectContaining({ id: 'dependent', state: 'SKIPPED' }),
      expect.objectContaining({ id: 'independent', state: 'CLAIMED', assignedSlotId: 'slot-2' })
    ]));
    expect(deliverToWorker).toHaveBeenCalledTimes(1);
    expect(deliverToWorker).toHaveBeenCalledWith('worker-2', expect.stringContaining('`independent`'));
    await service.completeWork({ ...worker1, slotId: 'slot-2' }, 'independent', 'done');
    record = (await store.get(record.id))!;
    expect(record.state).toBe('FAILED');
    expect(record.finalSummary).toContain('# Execution failed');
    expect(record.finalSummary).toContain('- Root [FAILED]: VALIDATION_FAILED');
    expect(cancelTeamLaunch).toHaveBeenCalledWith('owner', 'request-1');
    expect((await service.events('owner', 'project-1', record.id)).events).toContainEqual(expect.objectContaining({ summary: AUTO_FAIL_SUMMARY }));
  }));

  it('retries auto-finalization once after a stale state conflict', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let failExecutionCalls = 0;
    const service = new SquadExecutionService(deps(filePath, {
      store: {
        ...store,
        failExecution: async (...args) => {
          failExecutionCalls += 1;
          if (failExecutionCalls === 1) throw new Error('stale execution state');
          return store.failExecution(...args);
        }
      }
    }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'unit', title: 'Unit', task: 'fail', dependencies: [], files: ['unit.txt'], verification: ['check'] }
    ] });
    let record = (await store.get('execution-1'))!;
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    const worker = { executionId: record.id, projectId: record.projectId, slotId: 'slot-1', role: 'worker' as const };
    await expect(service.failWork(worker, 'unit', 'failed')).resolves.toMatchObject({ ok: true });
    expect((await store.get(record.id))?.state).toBe('FAILED');
    expect(failExecutionCalls).toBe(2);
  }));

  it('accepts producer events and artifacts from bound cohort and stamps authority server-side', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('owner', 'project-1', request);
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.reportBoundEvent(worker, { id: 'event-1', type: 'progress', severity: 'info', summary: 'working' })).resolves.toMatchObject({ ok: true });
    await expect(service.putBoundArtifact(worker, 'result.md', 'text/markdown', 'done')).resolves.toMatchObject({ ok: true });
    const events = await service.events('owner', 'project-1', 'execution-1');
    expect(events.events).toContainEqual(expect.objectContaining({ id: 'event-1', slotId: 'slot-1', producerRole: 'worker' }));
  }));

  it('binds source reads to the coordinator execution and persisted content reference', async () => fixture(async (filePath) => {
    const sources = { list: vi.fn(async () => ({ sources: [{ id: 'source-1' }] })), read: vi.fn(async () => ({ content: 'chunk', totalBytes: 5 })) };
    const service = new SquadExecutionService(deps(filePath, { sources: sources as never }));
    await service.start('owner', 'project-1', { ...request, sourceBundle: { contentRef: 'request-1/sources.json', sources: [{ id: 'source-1', name: 'source.txt', mediaType: 'text/plain', byteSize: 5, contentDigest: `sha256:${'1'.repeat(64)}`, extractionStatus: 'READY', extractionWarnings: [] }] } });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    await expect(service.listSources(coordinator, { offset: 0, limit: 10 })).resolves.toMatchObject({ ok: true });
    await expect(service.readSource(coordinator, 'source-1', { offset: 0, maxBytes: 4 })).resolves.toMatchObject({ ok: true, value: { content: 'chunk' } });
    await expect(service.readSource({ ...coordinator, role: 'worker' as const }, 'source-1', { offset: 0, maxBytes: 4 })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    expect(sources.read).toHaveBeenCalledWith(
      'request-1/sources.json',
      'source-1',
      { offset: 0, maxBytes: 4 },
      [expect.objectContaining({ id: 'source-1', contentDigest: `sha256:${'1'.repeat(64)}` })],
      expect.any(Function)
    );
  }));

  it('runs execution-aware source retention as best-effort maintenance', async () => fixture(async (filePath) => {
    const retainedSourceContentRefs = vi.fn(async () => new Set(['execution-1/sources.json']));
    const pruneSnapshots = vi.fn(async () => undefined);
    const store = createExecutionStore({ filePath });
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, retainedSourceContentRefs } as never,
      sources: { list: vi.fn(), read: vi.fn(), pruneSnapshots } as never
    }));
    await expect(service.pruneRetainedSources()).resolves.toBeUndefined();
    expect(pruneSnapshots).toHaveBeenCalledWith(new Set(['execution-1/sources.json']), 30 * 24 * 60 * 60 * 1_000);

    retainedSourceContentRefs.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(service.pruneRetainedSources()).resolves.toBeUndefined();
  }));

  it('requires the live coordinator for explicit completion', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('worker-1', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true, value: { state: 'COMPLETED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('loads bounded artifacts for unbound coordinator completion', async () => fixture(async (filePath) => {
    const artifacts = { list: vi.fn(async () => [{ id: 'artifact-1', executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'report.md', mediaType: 'text/markdown', contentDigest: `sha256:${'1'.repeat(64)}`, content: 'secret', createdAt: 1 }]) };
    const service = new SquadExecutionService(deps(filePath, { artifacts: artifacts as never, getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator' }) }));
    await service.start('session-1', 'project-1', request);
    const result = await service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done');
    expect(result).toMatchObject({ ok: true, value: { assembledResult: { artifacts: [{ name: 'report.md' }] } } });
    expect(artifacts.list).toHaveBeenCalledWith('execution-1', 'project-1');
  }));

  it('assembles only artifacts from current execution retry attempt', async () => fixture(async (filePath) => {
    const artifacts = { list: vi.fn(async () => [
      { id: 'stale', executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'stale.md', mediaType: 'text/markdown', contentDigest: `sha256:${'1'.repeat(64)}`, content: 'old', createdAt: 1 },
      { id: 'current', executionId: 'execution-1', attempt: 2, projectId: 'project-1', name: 'current.md', mediaType: 'text/markdown', contentDigest: `sha256:${'2'.repeat(64)}`, content: 'new', createdAt: 2 }
    ]) };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, artifacts: artifacts as never, getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator' }) }));
    let record = (await store.claim({ callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Retry', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'work' }], resolvedModels: [] } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'starting');
    record = await store.transition(record.id, record.stateVersion, 'BLOCKED', 'warning', 'retry');
    record = await store.beginRetry(record.id, record.stateVersion);
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'running');
    const result = await service.completeByCoordinator('coordinator', 'project-1', record.id, 'done');
    expect(result).toMatchObject({ ok: true, value: { attempt: 2, assembledResult: { artifacts: [{ name: 'current.md' }] } } });
  }));

  it('allows a bound monitor to complete after its coordinator exits', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const input = deps(filePath, { getTeamLaunch });
    const service = new SquadExecutionService(input);
    await service.start('session-1', 'project-1', request);
    await input.store.addEffectiveOwner('execution-1', 'monitor');
    await expect(service.completeByCoordinator('monitor', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true, value: { state: 'COMPLETED' } });
  }));

  it('keeps an execution running when its coordinator exits for monitor recovery', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.handleCoordinatorExit('project-1', 'execution-1', 'monitor');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    await service.handleCoordinatorExit('project-1', 'execution-1', 'coordinator');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('stops an overdue execution and cancels its Team lifecycle', async () => fixture(async (filePath) => {
    let now = 1_000_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, {
      store,
      now: () => now,
      cancelTeamLaunch,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
    now += 101;
    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'STOPPED' });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('stops at its deadline without renderer status or list polling', async () => fixture(async (filePath) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now: Date.now });
      const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
      const service = new SquadExecutionService(deps(filePath, { store, now: Date.now, cancelTeamLaunch }));

      await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
      await vi.advanceTimersByTimeAsync(101);

      await expect(store.get('execution-1')).resolves.toMatchObject({ state: 'STOPPED' });
      expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    } finally {
      vi.useRealTimers();
    }
  }));

  it('cancels workers spawned after deadline wins during launch startup', async () => fixture(async (filePath) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      let releaseLaunch!: () => void;
      const launchStarted = new Promise<void>((resolve) => { releaseLaunch = resolve; });
      const launchTeam = vi.fn(async () => {
        await launchStarted;
        return { ok: true };
      });
      const cancelTeamLaunch = vi.fn()
        .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'lifecycle not reserved yet' })
        .mockResolvedValue({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } });
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now: Date.now });
      const service = new SquadExecutionService(deps(filePath, { store, now: Date.now, launchTeam, cancelTeamLaunch }));

      const starting = service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
      await vi.advanceTimersByTimeAsync(101);
      await vi.waitFor(async () => expect(await store.get('execution-1')).toMatchObject({ state: 'STOPPED' }));
      releaseLaunch();

      await expect(starting).resolves.toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
      await vi.waitFor(() => expect(cancelTeamLaunch).toHaveBeenCalledTimes(2));
      expect((await store.get('execution-1'))?.state).toBe('STOPPED');
    } finally {
      vi.useRealTimers();
    }
  }));

  it('returns success when a fast coordinator completes before Team launch returns', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let service!: SquadExecutionService;
    const launchTeam = vi.fn(async () => {
      await service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done during launch');
      return { ok: true };
    });
    service = new SquadExecutionService(deps(filePath, {
      store,
      launchTeam,
      getTeamLaunch: async () => ({
        orchestratorSessionId: 'coordinator',
        workers: [{ slotId: 'orchestrator:lead', sessionId: 'coordinator', projectId: 'project-1', process: 'running' }]
      })
    }));

    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({
      ok: true,
      value: { state: 'COMPLETED', finalSummary: 'done during launch' }
    });
  }));

  it('does not fail from a partial all-exited lifecycle while Team launch is still adding slots', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let service!: SquadExecutionService;
    let releaseLaunch!: () => void;
    const launchBlocked = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    const launchTeam = vi.fn(async () => {
      await launchBlocked;
      return { ok: true };
    });
    const getTeamLaunch = vi.fn(async () => ({
      workers: [{ slotId: 'worker-1', sessionId: 'worker-1', projectId: 'project-1', process: 'exited' }]
    }));
    service = new SquadExecutionService(deps(filePath, { store, launchTeam, getTeamLaunch }));

    const starting = service.start('session-1', 'project-1', request);
    await vi.waitFor(async () => expect(await store.get('execution-1')).toMatchObject({ state: 'STARTING' }));
    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'STARTING' });
    releaseLaunch();

    await expect(starting).resolves.toMatchObject({ ok: true, value: { state: 'RUNNING' } });
  }));

  it('records slot launch failure details during reconciliation', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({
      workers: [{ slotId: 'worker-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }],
      launchResult: {
        failedSlots: [{ slotId: 'worker-2', reason: 'project identity changed after preflight' }]
      }
    }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);

    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'FAILED' });
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { events: Array<{ summary: string }> };
    expect(state.events.at(-1)?.summary).toBe('worker-2: project identity changed after preflight');
  }));

  it('records per-slot exit detail when all Team slots exit without completion', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({
      workers: [
        { slotId: 'worker-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'exited', exitCode: 1, exitReason: 'OpenCode exited 1: unsupported flag.' },
        { slotId: 'worker-2', sessionId: 'worker-2', projectId: 'project-1', task: 'unknown', process: 'exited', exitCode: 64 },
        { slotId: 'worker-3', sessionId: 'worker-3', projectId: 'project-1', task: 'unknown', process: 'exited', exitCode: 0, exitSignal: 9 }
      ]
    }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);

    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'FAILED' });
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { events: Array<{ summary: string }> };
    const summary = state.events.at(-1)?.summary ?? '';
    expect(summary).toContain('All Team slots exited without completion —');
    expect(summary).toContain('worker-1: OpenCode exited 1: unsupported flag.');
    expect(summary).toContain('worker-2: exited code 64');
    // A signal-killed worker with no exitReason and exitCode 0 must still
    // surface its signal, not fall through to a blank (filtered-out) detail.
    expect(summary).toContain('worker-3: exited code 0, signal 9');
  }));

  it('retries timeout cancellation when cancellation returns failure or throws', async () => fixture(async (filePath) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      const cancelTeamLaunch = vi.fn()
        .mockResolvedValueOnce({ ok: false, code: 'TRANSPORT', message: 'cancel unavailable' })
        .mockRejectedValueOnce(new Error('cancel threw'))
        .mockResolvedValue({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } });
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now: Date.now });
      const service = new SquadExecutionService(deps(filePath, { store, now: Date.now, cancelTeamLaunch }));
      await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });

      await vi.advanceTimersByTimeAsync(101);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(cancelTeamLaunch).toHaveBeenCalledTimes(3);
      expect((await store.get('execution-1'))?.state).toBe('STOPPED');
    } finally {
      vi.useRealTimers();
    }
  }));

  // Run 9e8cd072 (the fix): a deep, slow, sequential plan was STOPPED "Execution timed
  // out" at 2/6 units while unit 3 was actively heartbeating — a FIXED total-runtime cap
  // (createdAt + deadlineMs) guillotined a healthy run. The deadline is now an IDLE
  // deadline anchored on the last forward-progress (`progressAt`): a run that keeps
  // making output progress is never cut off, even long past createdAt + deadlineMs; it
  // times out only once it makes NO progress for a full deadline window.
  it('does NOT time out a run while a worker keeps making output progress, then stops it once it goes idle for a full deadline (run 9e8cd072)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now, workClaimLeaseMs: 40_000 });
    let record = (await store.claim({ callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { deadlineMs: 100_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt=1_000, progressAt=1_000
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new ExecutionService(deps(filePath, {
      store, now: () => now, cancelTeamLaunch,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));

    // Worker emits output long past createdAt + deadlineMs (101_000). Each output advances
    // progressAt and re-anchors the idle clock, so status polling must keep it RUNNING —
    // a fixed total cap would have STOPPED it at the first poll.
    for (const at of [90_000, 180_000, 270_000]) {
      now = at;
      await store.renewWorkerLease(record.id, 'slot-1', { advanceProgress: true }); // host OUTPUT path → progressAt=now
      await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'RUNNING' });
    }
    expect(cancelTeamLaunch).not.toHaveBeenCalled();

    // Output stops. Once progress is stale for a full deadline window, the run times out.
    now = 270_000 + 100_001; // 100_001 since the last progressAt (270_000)
    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'STOPPED' });
    expect(cancelTeamLaunch).toHaveBeenCalled();
  }));

  // The watchdog-timer path of the same fix: the timer is armed for a fixed instant, but
  // when it fires enforceDeadline re-reads the live record — if the run progressed since
  // arming it RE-ARMS instead of stopping, and only a genuinely idle run is stopped.
  it('re-arms the deadline timer when the run progressed since it armed, and stops it only once idle', async () => fixture(async (filePath) => {
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimer = vi.fn((fn: () => void) => { const id = nextTimer++; timers.set(id, fn); return id as unknown as NodeJS.Timeout; });
    const clearTimer = vi.fn((timer: NodeJS.Timeout) => timers.delete(timer as unknown as number));
    const fire = () => { const it = timers.entries().next(); if (it.done) throw new Error('no timer armed'); timers.delete(it.value[0]); it.value[1](); };
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now, workClaimLeaseMs: 40_000 });
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new ExecutionService(deps(filePath, {
      store, now: () => now, setTimer, clearTimer, cancelTeamLaunch,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    const started = await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100_000 } });
    if (!started.ok) throw new Error(started.message);
    const id = started.value.id;
    expect(timers.size).toBe(1); // deadline armed at createdAt(1_000) + 100_000

    // A worker claims and progresses well past that fixed instant.
    let rec = (await store.get(id))!;
    rec = await store.registerPlan(id, rec.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    rec = await store.claimWork(id, rec.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    now = 150_000;
    await store.renewWorkerLease(id, 'slot-1', { advanceProgress: true }); // progressAt=150_000

    // Timer fires at/after its armed instant; the run progressed (progressAt=150_000), so
    // it must RE-ARM (anchor 150_000 + 100_000 = 250_000) and stay RUNNING, not stop.
    fire();
    await vi.waitFor(() => expect(timers.size).toBe(1)); // re-armed (waits for enforceDeadline's async re-read)
    expect((await store.get(id))?.state).toBe('RUNNING');
    expect(cancelTeamLaunch).not.toHaveBeenCalled();

    // No further progress: the next fire past the idle window stops the run.
    now = 150_000 + 100_001;
    fire();
    await vi.waitFor(async () => expect((await store.get(id))?.state).toBe('STOPPED'));
    expect(cancelTeamLaunch).toHaveBeenCalled();
  }));

  it('re-arms an active deadline on idempotent start replay', async () => fixture(async (filePath) => {
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimer = vi.fn((fn: () => void) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    });
    const clearTimer = vi.fn((timer: NodeJS.Timeout) => timers.delete(timer as unknown as number));
    const service = new SquadExecutionService(deps(filePath, { setTimer, clearTimer }));
    await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 1_000 } });
    service.dispose();
    expect(timers.size).toBe(0);

    const replayService = new SquadExecutionService(deps(filePath, { setTimer, clearTimer }));
    await replayService.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 1_000 } });
    expect(timers.size).toBe(1);
    replayService.dispose();
  }));

  it('clears deadline timers on stop, completion, and dispose', async () => fixture(async (filePath) => {
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimer = vi.fn((fn: () => void) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    });
    const clearTimer = vi.fn((timer: NodeJS.Timeout) => timers.delete(timer as unknown as number));
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const service = new SquadExecutionService(deps(filePath, {
      store, setTimer, clearTimer,
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [] })
    }));

    const first = await service.start('owner', 'project-1', { ...request, policy: { deadlineMs: 1_000 } });
    if (!first.ok) throw new Error(first.message);
    await service.stop('owner', 'project-1', first.value.id, first.value.stateVersion);
    expect(timers.size).toBe(0);

    const second = await service.start('owner', 'project-1', { ...request, launchRequestId: 'request-2', policy: { deadlineMs: 1_000 } });
    if (!second.ok) throw new Error(second.message);
    await service.completeByCoordinator('coordinator', 'project-1', second.value.id, 'Done');
    expect(timers.size).toBe(0);

    await service.start('owner', 'project-1', { ...request, launchRequestId: 'request-3', policy: { deadlineMs: 1_000 } });
    service.dispose();
    expect(timers.size).toBe(0);
    expect(clearTimer).toHaveBeenCalledTimes(3);
  }));

  it('restores persisted active deadlines on boot without project polling', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    const first = new SquadExecutionService(deps(filePath, { store, now: () => now }));
    await first.start('owner', 'project-1', { ...request, policy: { deadlineMs: 100 } });
    first.dispose();
    now = 1_101;

    const pending: Array<() => void> = [];
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const restored = new SquadExecutionService(deps(filePath, {
      store, now: () => now, cancelTeamLaunch,
      setTimer: ((fn: () => void) => { pending.push(fn); return pending.length as unknown as NodeJS.Timeout; }),
      clearTimer: vi.fn()
    }));
    await restored.restoreDeadlines();
    expect(pending).toHaveLength(1);
    pending[0]();
    await vi.waitFor(async () => expect(await store.get('execution-1')).toMatchObject({ state: 'STOPPED' }));
    expect(cancelTeamLaunch).toHaveBeenCalledWith('owner', 'request-1');
    restored.dispose();
  }));

  it('prefers caller job title and launches only after durable reservation and authorization', async () => fixture(async (filePath) => {
    const authorizeTeamLaunch = vi.fn(() => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'auth-1' }],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:auth' }] }
    } }));
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch, launchTeam }));
    const result = await service.start('session-1', 'project-1', { ...request, jobTitle: 'Caller title' });
    expect(result).toMatchObject({ ok: true, value: { id: 'execution-1', jobTitle: 'Caller title', state: 'RUNNING', authorizationContext: { principalId: 'team:team-1:session-1:request-1' }, authorizationContextDigest: expect.any(String), launchIntent: { slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: expect.any(String) }] } } });
    expect(authorizeTeamLaunch).toHaveBeenCalledWith('session-1', 'team-1', 'project-1', 'request-1', {}, request.slots, request.coordinationMode, expect.stringMatching(/^launch-v1:/));
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({ requirePreauthorization: true }));
  }));

  it('preserves worker-only generic launch behavior unless Job Team mode is explicit', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam }));
    await service.start('session-1', 'project-1', request);
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.not.objectContaining({ coordinationMode: 'job-team' }));
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.not.objectContaining({ jobContext: expect.anything() }));
  }));

  it('blocks before launch when Team authorization rejects', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn();
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch: () => ({ ok: false as const, code: 'DENIED', message: 'team disabled' }), launchTeam, getTeamLaunch: async () => undefined }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'DENIED', message: 'team disabled' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('retries a pre-dispatch authorization block with a fresh Team launch request', async () => fixture(async (filePath) => {
    let calls = 0;
    const authorizeTeamLaunch = vi.fn((_caller: string, _team: string, _project: string, launchRequestId: string) => {
      calls += 1;
      if (calls === 1) return { ok: false as const, code: 'DENIED', message: 'team temporarily disabled' };
      return { ok: true as const, value: {
        teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'fresh-auth' }],
        context: { version: 1 as const, principalId: `team:team-1:session-1:${launchRequestId}`, authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:fresh' }] }
      } };
    });
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch, launchTeam }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    const blocked = await service.status('session-1', 'project-1', 'execution-1');
    if (!blocked) throw new Error('missing blocked execution');
    await expect(service.retry('session-1', 'project-1', 'execution-1', blocked.stateVersion)).resolves.toMatchObject({ ok: true, value: { id: 'execution-1', attempt: 2, state: 'RUNNING', teamLaunchRequestId: 'execution-1:attempt:2' } });
    expect(authorizeTeamLaunch).toHaveBeenLastCalledWith('session-1', 'team-1', 'project-1', 'execution-1:attempt:2', {}, request.slots, undefined, expect.stringMatching(/^launch-v1:/));
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({ launchRequestId: 'execution-1:attempt:2', executionId: 'execution-1', executionJobTitle: 'Build release' }));
  }));

  it('uses immutable audit owner for retries requested by an effective owner', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let tokenNumber = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `resume-token-${++tokenNumber}` });
    let calls = 0;
    const authorizeTeamLaunch = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 10, expiresAt: 20, slots: [] } } };
    });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants, authorizeTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    const grant = await service.mintResumeGrant('session-1', 'project-1', 'execution-1');
    if (!grant.ok) throw new Error('missing replacement grant');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', grant.value.token)).resolves.toMatchObject({ ok: true });
    const blocked = await store.get('execution-1');
    if (!blocked) throw new Error('missing execution');
    await expect(service.retry('session-2', 'project-1', 'execution-1', blocked.stateVersion)).resolves.toMatchObject({ ok: true });
    expect(authorizeTeamLaunch).toHaveBeenLastCalledWith('session-1', 'team-1', 'project-1', 'execution-1:attempt:2', {}, request.slots, undefined, expect.stringMatching(/^launch-v1:/));
  }));

  it('reruns workflow profile preflight before retry', async () => fixture(async (filePath) => {
    let preflights = 0;
    const service = new SquadExecutionService(deps(filePath, {
      authorizeTeamLaunch: () => ({ ok: false as const, code: 'DENIED', message: 'team disabled' }),
      preflightWorkflow: () => (++preflights === 1 ? { ok: true } : { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'profile drifted' })
    }));
    const workflow = { schemaVersion: 1 as const, profileId: 'profile', profileVersion: '1', controller: { personaId: 'controller', slotId: 'orchestrator:controller' }, workers: [], supportedRequestVersions: [1] };
    await service.start('session-1', 'project-1', { ...request, workflow });
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.retry('session-1', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'profile drifted' });
  }));

  it('blocks before launch when Team authorization lacks a durable context', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [] } }),
      launchTeam
    }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('derives title from first summary line and confines reads to execution owner', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    expect(deriveJobTitle(request)).toBe('Build release');
    expect(await service.status('replacement-session', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.list('replacement-session', 'project-1')).toEqual([]);
    expect(await service.events('replacement-session', 'project-1', 'execution-1')).toEqual({ events: [] });
    expect(await service.status('replacement-session', 'other-project', 'execution-1')).toBeUndefined();
    expect(await service.list('replacement-session', 'other-project')).toEqual([]);
    expect(await service.events('replacement-session', 'other-project', 'execution-1')).toEqual({ events: [] });
    await expect(service.stop('replacement-session', 'project-1', 'execution-1', 3)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rebinds a fresh owner with one durable grant without rewriting audit ownership', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, getTeamLaunch, cancelTeamLaunch }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true, value: { callerPrincipalId: 'session-1', effectiveOwnerPrincipalIds: ['session-2'] } });
    expect(await service.status('session-2', 'project-1', 'execution-1')).toMatchObject({ id: 'execution-1' });
    expect(await service.events('session-2', 'project-1', 'execution-1')).toMatchObject({ events: expect.any(Array) });
    const record = await service.status('session-2', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('session-2', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: true });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    await expect(service.resumeBinding('session-3', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false });
  }));

  it('rejects resume binding while an existing execution owner remains live', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants,
      hasLivePredecessor: (_projectId, ownerIds) => ownerIds.includes('session-1')
    }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken))
      .resolves.toEqual({ ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' });
  }));

  it('serializes competing resume bindings so only one replacement owner is admitted', async () => fixture(async (filePath) => {
    let token = 0;
    let firstCheck = true;
    let releaseCheck!: () => void;
    const checkStarted = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `resume-token-${++token}` });
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants,
      hasLivePredecessor: (_projectId, ownerIds) => {
        if (firstCheck) {
          firstCheck = false;
          releaseCheck();
          return false;
        }
        return ownerIds.includes('session-2');
      }
    }));
    await service.start('session-1', 'project-1', request);
    const replacement = await service.mintResumeGrant('session-1', 'project-1', 'execution-1');
    if (!replacement.ok) throw new Error('missing replacement grant');
    const binding = service.resumeBinding('session-2', 'project-1', 'execution-1', replacement.value.token);
    await checkStarted;
    const competing = service.resumeBinding('session-3', 'project-1', 'execution-1', replacement.value.token);
    await expect(binding).resolves.toMatchObject({ ok: true });
    await expect(competing).resolves.toEqual({
      ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor'
    });
  }));

  it('recovers a consumed binding after transient effective-owner persistence failure', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const addEffectiveOwner = store.addEffectiveOwner;
    let failOnce = true;
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, addEffectiveOwner: async (...args) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('temporary write failure');
        }
        return addEffectiveOwner(...args);
      } },
      resumeGrants: grants
    }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'BINDING_TRANSIENT' });
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true, value: { effectiveOwnerPrincipalIds: ['session-2'] } });
  }));

  it('revokes an abandoned consumed binding and removes its effective owner', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('abandoned-monitor', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await service.abandonResumeBinding('project-1', 'execution-1', 'abandoned-monitor');
    await expect(service.resumeBinding('abandoned-monitor', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.status('abandoned-monitor', 'project-1', 'execution-1')).toBeUndefined();
  }));

  it('lets immutable owner mint a replacement grant after start token is lost', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'replacement-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    await service.start('session-1', 'project-1', request);
    await expect(service.mintResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.mintResumeGrant('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: true, value: { token: 'replacement-token', expiresAt: expect.any(Number), generation: 1, recoveryGeneration: 1 } });
  }));

  it('converges after repeated CAS failures without advancing durable grant more than one generation', async () => fixture(async (filePath) => {
    let token = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const rotateRecoveryGeneration = store.rotateRecoveryGeneration;
    let crashesRemaining = 2;
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, rotateRecoveryGeneration: async (...args) => {
        if (crashesRemaining > 0) { crashesRemaining -= 1; throw new Error('simulated crash after grant rotate'); }
        return rotateRecoveryGeneration(...args);
      } },
      resumeGrants: grants
    }));
    await service.start('session-1', 'project-1', request);
    const record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token-2')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token-3')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: true, value: { token: 'token-4', generation: 1, recoveryGeneration: 1 } });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token-4')).resolves.toMatchObject({ ok: true });
  }));

  it('caps replacement grant expiry at fixed execution recovery deadline', async () => fixture(async (filePath) => {
    let clock = 10_000;
    let token = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, now: () => clock, token: () => `token-${++token}` });
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants, now: () => clock }));
    await service.start('session-1', 'project-1', request);
    const record = await store.get('execution-1');
    if (!record?.recoveryDeadlineAt) throw new Error('missing recovery deadline');
    clock += 20 * 24 * 60 * 60 * 1_000;
    const minted = await service.mintResumeGrant('session-1', 'project-1', record.id);
    expect(minted).toMatchObject({ ok: true, value: { expiresAt: record.recoveryDeadlineAt } });
  }));

  it('rotates recovery only after verified coordinator loss with exact CAS binding', async () => fixture(async (filePath) => {
    let token = 0;
    const cacheResumeToken = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    let live = false;
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants, cacheResumeToken,
      hasLivePredecessor: () => live
    }));
    await service.start('session-1', 'project-1', request);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');

    await expect(service.rotateRecoveryGrant('other-project', record.id, record.stateVersion, 0)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    live = true;
    await expect(service.rotateRecoveryGrant(record.projectId, record.id, record.stateVersion, 0)).resolves.toEqual({ ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live coordinator' });
    live = false;
    await expect(service.rotateRecoveryGrant(record.projectId, record.id, record.stateVersion - 1, 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    const rotated = await service.rotateRecoveryGrant(record.projectId, record.id, record.stateVersion, 0);
    expect(rotated).toMatchObject({ ok: true, value: { recoveryGeneration: 1, generation: 1, token: 'token-2' } });
    expect(cacheResumeToken).toHaveBeenLastCalledWith('project-1', 'execution-1', 'token-2', expect.any(Number));
    await expect(service.resumeBinding('replacement', 'project-1', 'execution-1', 'token-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.resumeBinding('replacement', 'project-1', 'execution-1', 'token-2')).resolves.toMatchObject({ ok: true });
    await expect(service.resumeBinding('replacement', 'project-1', 'execution-1', 'token-2')).resolves.toMatchObject({ ok: true });
  }));

  it('denies terminal recovery rotation and converges after token-cache failure', async () => fixture(async (filePath) => {
    let token = 0;
    let failCache = false;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, resumeGrants: grants,
      cacheResumeToken: () => { if (failCache) throw new Error('cache failed'); }
    }));
    await service.start('session-1', 'project-1', request);
    failCache = true;
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await expect(service.rotateRecoveryGrant('project-1', running.id, running.stateVersion, 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    const converging = await store.get(running.id);
    expect(converging).toMatchObject({ recoveryGeneration: 1 });
    failCache = false;
    await expect(service.rotateRecoveryGrant('project-1', running.id, converging!.stateVersion, 1)).resolves.toMatchObject({ ok: true, value: { generation: 2 } });
    const latest = await store.get(running.id);
    await store.transition(running.id, latest!.stateVersion, 'STOPPED', 'info', 'stopped');
    const terminal = await store.get(running.id);
    await expect(service.rotateRecoveryGrant('project-1', running.id, terminal!.stateVersion, terminal!.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('revokes durable grants and clears in-app token after terminal service transition', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const clearResumeToken = vi.fn();
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, clearResumeToken }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('session-1', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(clearResumeToken).toHaveBeenCalledWith('project-1', 'execution-1');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('runs terminal grant and token cleanup after coordinator completion', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const revoke = vi.spyOn(grants, 'revoke');
    const clearResumeToken = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants, clearResumeToken,
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [] })
    }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true });
    expect(revoke).toHaveBeenCalledWith('execution-1', 'project-1');
    expect(clearResumeToken).toHaveBeenCalledWith('project-1', 'execution-1');
  }));

  it('writes the initial resume token only through main-owned storage', async () => fixture(async (filePath) => {
    const cacheResumeToken = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, cacheResumeToken }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    expect(cacheResumeToken).toHaveBeenCalledWith('project-1', 'execution-1', 'resume-token', expect.any(Number));
  }));

  it('permits a fresh owner to bind and resume a blocked execution', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    const blocked = await store.transition('execution-1', running.stateVersion, 'BLOCKED', 'warning', 'Waiting');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await expect(service.resume('session-2', 'project-1', 'execution-1', blocked.stateVersion + 1, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: true, value: { state: 'RUNNING' } });
  }));

  it('rejects a consumed handoff when its execution became terminal', async () => fixture(async (filePath) => {
    const dependencySet = deps(filePath);
    const cancelTeamLaunch = vi.fn(dependencySet.cancelTeamLaunch);
    const service = new SquadExecutionService({ ...dependencySet, cancelTeamLaunch });
    await service.start('session-1', 'project-1', request);
    const running = await service.status('session-1', 'project-1', 'execution-1');
    if (!running) throw new Error('missing execution');
    await dependencySet.store.transition('execution-1', running.stateVersion, 'COMPLETED', 'info', 'Execution completed');
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'session-1', projectId: 'project-1', executionId: 'execution-1' }, 'stop', running.stateVersion + 1)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('records producer events once with stable sequence and owner scope', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const input = { id: 'event-1', slotId: 'slot-1', type: 'blocker' as const, severity: 'warning' as const, summary: 'Need input', blocker: { question: 'Ship now?', options: ['yes', 'no'] } };
    await expect(service.reportEvent('other', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.reportEvent('session-1', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: true, value: { outcome: 'accepted', event: { sequence: expect.any(Number), blocker: input.blocker } } });
    await expect(service.reportEvent('session-1', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: true, value: { outcome: 'replay' } });
  }));

  it('rejects bound work, events, and artifacts after terminal execution', async () => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await service.start('owner', 'project-1', request);
    const running = await input.store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await input.store.transition(running.id, running.stateVersion, 'COMPLETED', 'info', 'Done');
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.claimWork(worker, 'unit')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    await expect(service.reportBoundEvent(worker, { id: 'late', type: 'progress', severity: 'info', summary: 'late' })).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    await expect(service.putBoundArtifact(worker, 'late.txt', 'text/plain', 'late')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));


  it('completes worker-only Teams from worker task reports', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ projectId: 'project-1', task: 'caller-reported-complete' }] }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('COMPLETED');
  }));

  it('blocks a replay when lifecycle evidence is missing instead of trusting durable execution state', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => undefined }));
    await service.start('session-1', 'project-1', request);
    await expect(service.start('session-1', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'BLOCKED', message: 'execution is blocked'
    });
  }));

  it('records failed state when authorization throws', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch: () => { throw new Error('authorization store unavailable'); }, getTeamLaunch: async () => undefined }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, message: 'authorization store unavailable' });
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('does not report a failed launch as success after a concurrent state update', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const launchTeam = vi.fn(async () => {
      const record = await store.get('execution-1');
      if (!record) throw new Error('missing execution');
      await store.event(record.id, record.stateVersion, 'info', 'Concurrent update');
      throw new Error('launch transport failed');
    });
    const service = new SquadExecutionService(deps(filePath, { store, launchTeam }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
  }));

  it('does not block status polling during durable startup before Team lifecycle exists', async () => fixture(async (filePath) => {
    let releaseAuthorization!: () => void;
    const authorization = new Promise<never>((_resolve, reject) => { releaseAuthorization = () => reject(new Error('stop test')); });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, authorizeTeamLaunch: () => authorization, getTeamLaunch: async () => undefined }));
    const start = service.start('session-1', 'project-1', request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('STARTING');
    releaseAuthorization();
    await expect(start).resolves.toMatchObject({ ok: false });
  }));

  it('recovers stale startup without Team lifecycle as a blocker', async () => fixture(async (filePath) => {
    let now = 0;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    const claimed = await store.claim({
      callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Build',
      requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
    });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    now = 2 * 60_000;
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => undefined }));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('recovers a persisted startup when Team lifecycle has live workers', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Build', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] } });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => ({ workers: [{ projectId: 'project-1', process: 'running' }] }) }));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
  }));

  it('fails execution when Team lifecycle records failed launch slots or all workers exit', async () => fixture(async (filePath) => {
    const lifecycle = { workers: [{ projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('keeps failed partial launches stoppable while workers remain live', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');
    await expect(service.stop('session-1', 'project-1', 'execution-1', 5)).resolves.toMatchObject({ ok: true, value: { state: 'FAILED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('cancels live Team workers before dismissing terminal execution history', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');

    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toEqual({ ok: true, value: { dismissedSessionIds: ['worker-1'] } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.dismissedAt).toBeDefined();
  }));

  it('keeps terminal execution history visible when Team cancellation fails', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: false, code: 'CANCEL_FAILED', message: 'worker teardown unavailable' }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');

    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({
      ok: false, code: 'CANCEL_FAILED', message: 'worker teardown unavailable'
    });
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.dismissedAt).toBeUndefined();
  }));

  it('stops and dismisses blocked execution when Team cancellation returns NOT_FOUND', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND' as const, message: 'team launch request not found for caller' }));
    const preflightWorkflow = vi.fn(() => ({ ok: false as const, code: 'INVALID', message: 'workflow profile references an unknown persona' }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch, preflightWorkflow }));
    
    await service.start('session-1', 'project-1', { ...request, workflow: {} as any });
    
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record?.state).toBe('BLOCKED');
    
    // stop will gracefully ignore NOT_FOUND
    await expect(service.stop('session-1', 'project-1', 'execution-1', record!.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    
    // dismiss will gracefully ignore NOT_FOUND
    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: true });
  }));

  it('stops only caller-owned execution through the existing Team cancellation path', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.stop('session-1', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    await expect(service.stop('other', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rejects stale stop before Team cancellation', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.stop('session-1', 'project-1', 'execution-1', 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT', current: { stateVersion: 4 } });
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('responds only through an owned slot and resumes blocked work after delivery', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession }));
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    let record = await store.registerPlan(running.id, running.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Continue?' });
    await expect(service.resume('session-1', 'project-1', 'execution-1', record.stateVersion, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: true, pending: true, delivery: { blockerId: 'blocker-1', state: 'PENDING' }, value: { state: 'BLOCKED' } });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('execution.delivery.pull'));
    await expect(service.respond('session-1', 'project-1', 'execution-1', record.stateVersion + 1, 'other-slot', 'Nope')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('keeps accepted blocker delivery pending when best-effort PTY notification fails', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession: () => { throw new Error('notify failed'); } }));
    await service.start('session-1', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'b', question: 'Help?' });
    await expect(service.resume('session-1', 'project-1', 'execution-1', record.stateVersion, 'slot-1', 'Answer'))
      .resolves.toMatchObject({ ok: true, pending: true, notified: false, delivery: { state: 'PENDING' } });
    const after = await store.get('execution-1');
    expect(after).toMatchObject({ state: 'BLOCKED', blockers: [{ resolved: false }], workUnits: [{ state: 'BLOCKED' }], deliveries: [{ blockerId: 'b', state: 'PENDING' }] });
    expect(after?.blockers?.[0].response).toBeUndefined();
  }));

  it('targets exact blocker with caller idempotency identity', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    const accepted = await service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'client-1', 'Answer');
    expect(accepted).toMatchObject({ ok: true, delivery: { blockerId: 'blocker-1', clientRequestId: 'client-1' } });
    await expect(service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion + 1, 'blocker-1', 'client-1', 'Answer')).resolves.toMatchObject({ ok: true, delivery: { id: (accepted as { delivery: { id: string } }).delivery.id } });
    await expect(service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion + 1, 'missing', 'client-2', 'Answer')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('fans out two exact blocker responses to their independently authorized worker sessions', async () => fixture(async (filePath) => {
    const id = (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `delivery-${n}`; })();
    const store = createExecutionStore({ filePath, id });
    const replyToSession = vi.fn(() => true);
    const triggerDeliveryDrain = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      store,
      replyToSession,
      triggerDeliveryDrain,
      getTeamLaunch: async () => ({ workers: [
        { slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'A' },
        { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1', task: 'B' }
      ] })
    }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'] },
      { id: 'b', title: 'B', task: 'B', dependencies: [], files: ['b.txt'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'b', 'slot-2');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'First?' });
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'b', { id: 'blocker-2', question: 'Second?' });

    const first = await service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'client-1', 'Answer one');
    expect(first).toMatchObject({ ok: true, delivery: { blockerId: 'blocker-1', slotId: 'slot-1' } });
    const firstRecord = (first as { value: ExecutionRecord }).value;
    const second = await service.resumeBlocker('session-1', 'project-1', record.id, firstRecord.stateVersion, 'blocker-2', 'client-2', 'Answer two');
    expect(second).toMatchObject({ ok: true, delivery: { blockerId: 'blocker-2', slotId: 'slot-2' } });

    expect(replyToSession).toHaveBeenCalledTimes(2);
    expect(replyToSession.mock.calls.map(([sessionId]) => sessionId)).toEqual(['worker-1', 'worker-2']);
    expect(triggerDeliveryDrain.mock.calls.map(([sessionId]) => sessionId)).toEqual(['worker-1', 'worker-2']);
    expect((await store.get(record.id))?.deliveries).toMatchObject([
      { blockerId: 'blocker-1', slotId: 'slot-1', state: 'PENDING' },
      { blockerId: 'blocker-2', slotId: 'slot-2', state: 'PENDING' }
    ]);
  }));

  it('rejects blocker responses above the 16 KiB UTF-8 transport limit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await expect(service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'client-1', '😀'.repeat(4097)))
      .resolves.toEqual({ ok: false, code: 'INVALID', message: 'invalid execution blocker delivery request' });
  }));

  it('authorizes delivery retry by owner, project, blocker, delivery, and state version', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' })).record;
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { records: typeof record[] };
    state.records[0].deliveries![0].state = 'FAILED';
    await writeFile(filePath, JSON.stringify(state));
    record = state.records[0];
    const deliveryId = record.deliveries![0].id;
    await expect(service.retryBlockerDelivery('other', 'project-1', record.id, record.stateVersion, 'blocker-1', deliveryId)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.retryBlockerDelivery('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'wrong')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.retryBlockerDelivery('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', deliveryId)).resolves.toMatchObject({ ok: true, value: { deliveries: [{ id: deliveryId, clientRequestId: 'client-1', state: 'PENDING' }] } });
  }));

  it('pulls and acknowledges deliveries only through exact bound worker route', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await service.resume('session-1', 'project-1', record.id, record.stateVersion, 'slot-1', 'Answer');
    const worker = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1', authorizationId: 'auth-current' };
    await expect(service.pullDelivery({ ...worker, slotId: 'slot-2' })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    const pulled = await service.pullDelivery(worker);
    expect(pulled).toMatchObject({ ok: true, value: { id: expect.any(String), leaseId: expect.any(String), payload: { text: 'Answer' } } });
    if (!pulled.ok || !pulled.value) throw new Error('missing delivery');
    const ack = await service.ackDelivery(worker, pulled.value.id, pulled.value.leaseId!, { delivered: true });
    expect(ack).toMatchObject({ ok: true, value: { deliveryId: pulled.value.id, state: 'DELIVERED', blockerId: 'blocker-1', resolved: true } });
    expect(JSON.stringify(ack)).not.toContain('deliveries');
    expect(JSON.stringify(ack)).not.toContain('Answer');
  }));

  it('accepts an exact stale resume replay after delivery ack without sending twice', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    const accepted = await service.resume('session-1', 'project-1', record.id, record.stateVersion, 'slot-1', 'Answer');
    if (!accepted.ok) throw new Error('delivery was not accepted');
    const expectedStateVersion = accepted.value.stateVersion;
    const worker = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1', authorizationId: 'auth-current' };
    const pulled = await service.pullDelivery(worker);
    if (!pulled.ok || !pulled.value) throw new Error('missing delivery');
    await service.ackDelivery(worker, pulled.value.id, pulled.value.leaseId!, { delivered: true });
    const afterAck = (await store.get(record.id))!;

    await expect(service.resume('session-1', 'project-1', record.id, expectedStateVersion, 'slot-1', 'Answer'))
      .resolves.toMatchObject({ ok: true, replay: true, value: { stateVersion: afterAck.stateVersion, state: 'RUNNING' } });
    expect((await store.get(record.id))?.stateVersion).toBe(afterAck.stateVersion);
    expect(replyToSession).toHaveBeenCalledTimes(1);
    await expect(service.resume('session-1', 'project-1', record.id, expectedStateVersion, 'slot-1', 'Different'))
      .resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
  }));

  it('denies a stale same-slot worker and accepts the current restored worker session', async () => fixture(async (filePath) => {
    let currentSessionId = 'worker-old';
    let currentAuthorizationId = 'auth-old';
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: currentSessionId, authorizationId: currentAuthorizationId, projectId: 'project-1' }] }));
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await service.resume('session-1', 'project-1', record.id, record.stateVersion, 'slot-1', 'Secret answer');
    currentSessionId = 'worker-restored';
    currentAuthorizationId = 'auth-restored';
    const stale = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-old', authorizationId: 'auth-old' };
    const restored = { ...stale, principalId: currentSessionId, authorizationId: currentAuthorizationId };
    await expect(service.pullDelivery(stale)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.pullDelivery(restored)).resolves.toMatchObject({ ok: true, value: { recipientPrincipalId: 'worker-restored', recipientAuthorizationId: 'auth-restored' } });
  }));

  it('blocks legacy grant mint while a recovered monitor is live and converges concurrent mint calls', async () => fixture(async (filePath) => {
    let token = 0;
    let live = false;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, hasLivePredecessor: () => live }));
    await service.start('session-1', 'project-1', request);
    live = true;
    await expect(service.mintResumeGrant('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'LIVE_PREDECESSOR' });
    live = false;
    const [left, right] = await Promise.all([
      service.mintResumeGrant('session-1', 'project-1', 'execution-1'),
      service.mintResumeGrant('session-1', 'project-1', 'execution-1')
    ]);
    expect(left).toEqual(right);
  }));

  it('denies an unauthorized caller instead of joining an authorized resume-grant mint flight', async () => fixture(async (filePath) => {
    let releaseRotate!: () => void;
    const rotateGate = new Promise<void>((resolve) => { releaseRotate = resolve; });
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'owner-token' });
    const rotate = vi.fn(async (...args: Parameters<typeof grants.rotate>) => {
      await rotateGate;
      return grants.rotate(...args);
    });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: { ...grants, rotate } }));
    await service.start('owner', 'project-1', request);

    const ownerMint = service.mintResumeGrant('owner', 'project-1', 'execution-1');
    await vi.waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
    const unauthorizedMint = service.mintResumeGrant('intruder', 'project-1', 'execution-1');
    releaseRotate();

    await expect(ownerMint).resolves.toMatchObject({ ok: true, value: { token: 'owner-token' } });
    const denied = await unauthorizedMint;
    expect(denied).toMatchObject({ ok: false, code: 'DENIED' });
    expect(JSON.stringify(denied)).not.toContain('owner-token');
    expect(rotate).toHaveBeenCalledTimes(1);
  }));

  it('rejects stale resume before reading or messaging Team workers', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }));
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, replyToSession }));
    await service.start('session-1', 'project-1', request);
    await expect(service.resume('session-1', 'project-1', 'execution-1', 0, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(getTeamLaunch).toHaveBeenCalledTimes(0);
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('records write-once artifacts and permits same-project replacement reads', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":true}')).resolves.toMatchObject({ ok: true, value: { contentDigest: expect.stringMatching(/^sha256:/) } });
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":false}')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await service.listArtifacts('replacement-session', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.listArtifacts('replacement-session', 'other-project', 'execution-1')).toBeUndefined();
  }));

  it('reads a bounded durable snapshot without reconciling Team lifecycle', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [] }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":true}');
    const snapshot = await service.snapshot('session-1', 'project-1', 'execution-1');
    expect(snapshot).toMatchObject({ execution: { id: 'execution-1', state: 'RUNNING' }, executions: [{ id: 'execution-1' }], artifacts: [{ name: 'result.json' }], truncated: false });
    expect(getTeamLaunch).not.toHaveBeenCalled();
  }));

  it('reads exact bound execution snapshot without owner execution history', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    await service.start('owner', 'project-1', { ...request, launchRequestId: 'request-2' });
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const snapshot = await service.snapshotBound(binding);
    expect(snapshot).toMatchObject({ execution: { id: 'execution-1' }, executions: [{ id: 'execution-1' }] });
    expect(snapshot?.executions).toHaveLength(1);
    await expect(service.snapshotBound({ ...binding, executionId: 'execution-2' })).resolves.toMatchObject({ execution: { id: 'execution-2' } });
    await expect(service.snapshotBound({ ...binding, projectId: 'other-project' })).resolves.toBeUndefined();
  }));

  it('loads every retained bounded event page into terminal detail snapshots', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const base = deps(filePath, { store });
    await new SquadExecutionService(base).start('session-1', 'project-1', request);
    const eventsInProject = vi.fn(async (_projectId: string, _executionId: string, after: number) => {
      const start = after;
      const events = Array.from({ length: Math.min(100, 225 - start) }, (_, index) => ({ id: `event-${start + index + 1}`, sequence: start + index + 1 }));
      return { events, ...(start + events.length < 225 ? { nextSequence: start + events.length } : {}) };
    });
    const service = new SquadExecutionService({ ...base, store: { ...store, eventsInProject } as never });
    const snapshot = await service.snapshot('session-1', 'project-1', 'execution-1');
    expect(snapshot?.events).toHaveLength(225);
    expect(snapshot?.truncated).toBe(false);
    expect(eventsInProject).toHaveBeenCalledTimes(3);
  }));

  it('stops durable snapshot before later reads when total deadline expires', async () => fixture(async (filePath) => {
    let clock = 0;
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, monotonicNow: () => clock }));
    await service.start('session-1', 'project-1', request);
    const originalList = store.list;
    store.list = async (...args) => {
      clock = 15_000;
      return originalList(...args);
    };
    await expect(service.snapshot('session-1', 'project-1', 'execution-1')).rejects.toThrow('Snapshot exceeded 15-second budget');
  }));

  it('does not accept artifacts after execution reaches a terminal state', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await store.transition(running.id, running.stateVersion, 'COMPLETED', 'info', 'Done');
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'late.json', 'application/json', '{}')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('persists workflow preflight failure before blocking launch', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, {
      launchTeam,
      preflightWorkflow: () => ({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'missing controller slot' })
    }));
    await expect(service.start('session-1', 'project-1', {
      ...request,
      workflow: { schemaVersion: 1, profileId: 'profile', profileVersion: '1', controller: { personaId: 'controller', slotId: 'orchestrator:controller' }, workers: [], supportedRequestVersions: [1] }
    })).resolves.toEqual({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'missing controller slot' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect(await service.status('session-1', 'project-1', 'execution-1')).toMatchObject({ state: 'BLOCKED', jobTitle: 'Build release' });
  }));

  it('lists executions for an effective owner after a successful resume binding', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await expect(service.list('session-2', 'project-1')).resolves.toMatchObject([{ id: 'execution-1' }]);
  }));

  it('persists explicit resolved models and rejects duplicate slot snapshots', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    const started = await service.start('session-1', 'project-1', { ...request, resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }] });
    expect(started).toMatchObject({ ok: true, value: { resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }] } });
    const duplicate = await service.start('session-1', 'project-1', { ...request, launchRequestId: 'request-2', resolvedModels: [{ slotId: 'slot-1', provider: 'a', model: 'a' }, { slotId: 'slot-1', provider: 'b', model: 'b' }] });
    expect(duplicate).toEqual({ ok: false, code: 'INVALID', message: 'duplicate resolved model slot' });
  }));

  it('uses main-resolved route facts instead of caller-supplied snapshots', async () => fixture(async (filePath) => {
    const resolveTeamModelSnapshots = vi.fn(() => [{ slotId: 'slot-1', personaId: 'trusted', provider: 'provider', model: 'trusted-model' }]);
    const service = new SquadExecutionService(deps(filePath, {
      resolveTeamModelSnapshots
    }));
    const started = await service.start('session-1', 'project-1', {
      ...request, resolvedModels: [{ slotId: 'forged', provider: 'forged', model: 'forged-model' }]
    });
    expect(started).toMatchObject({ ok: true, value: { resolvedModels: [{ slotId: 'slot-1', personaId: 'trusted', model: 'trusted-model' }] } });
    expect(resolveTeamModelSnapshots).toHaveBeenCalledTimes(1);
  }));

  it('records optional policy result without rewriting generic execution completion', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const result = await service.recordPolicyResult('project-1', 'execution-1', {
      version: 1, executionId: 'execution-1', attempt: 1, outputDigest: 'sha256:output', extensionDigest: 'sha256:extension', status: 'ELIGIBLE_FOR_DELIVERY', summary: 'Policy approved'
    });
    expect(result).toMatchObject({ ok: true, value: { state: 'RUNNING', policyResult: { status: 'ELIGIBLE_FOR_DELIVERY' } } });
    expect(await service.recordPolicyResult('other-project', 'execution-1', {})).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it.each([
    [{ ...request, version: 2 }, 'invalid version'],
    [{ ...request, teamId: ' ' }, 'blank team'],
    [{ ...request, launchRequestId: '' }, 'blank request id'],
    [{ ...request, slots: [] }, 'empty slots'],
    [{ ...request, launchKind: 'unknown' }, 'unknown launch kind']
  ])('rejects malformed start input before durable reservation: %s', async (invalid, _label) => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await expect(service.start('session-1', 'project-1', invalid as never)).resolves.toEqual({ ok: false, code: 'INVALID', message: 'invalid execution request' });
    expect(await input.store.list('session-1', 'project-1')).toEqual([]);
  }));

  it('maps durable reservation and resume-grant failures without launching workers', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const storeFailure = new SquadExecutionService(deps(filePath, {
      store: { ...createExecutionStore({ filePath }), claim: async () => { throw 'store offline'; } }, launchTeam
    }));
    await expect(storeFailure.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'EXECUTION_STORE_ERROR', message: 'store offline' });
    const grants = { mint: vi.fn(async () => { throw 'grant offline'; }), consume: vi.fn(), revoke: vi.fn() };
    const grantFailure = new SquadExecutionService(deps(`${filePath}.grant`, { resumeGrants: grants as never, launchTeam }));
    await expect(grantFailure.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'EXECUTION_STORE_ERROR', message: 'grant offline' });
    expect(launchTeam).not.toHaveBeenCalled();
  }));

  it('enforces bound roles, missing executions, source membership, and dependency failures', async () => fixture(async (filePath) => {
    const sources = { list: vi.fn(async () => { throw 'list offline'; }), read: vi.fn(async () => { throw new Error('read offline'); }) };
    const artifacts = createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' });
    const put = artifacts.put;
    const service = new SquadExecutionService(deps(filePath, {
      sources: sources as never,
      artifacts: { ...artifacts, put: async (input) => input.name === 'throw.md' ? Promise.reject('artifact offline') : put(input) }
    }));
    await service.start('owner', 'project-1', { ...request, sourceBundle: { contentRef: 'sources.json', sources: [{ id: 'source-1', name: 'one.txt', mediaType: 'text/plain', byteSize: 3, contentDigest: `sha256:${'1'.repeat(64)}`, extractionStatus: 'READY', extractionWarnings: [] }] } });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, role: 'worker' as const, slotId: 'slot-1' };
    const missing = { ...coordinator, executionId: 'missing' };
    await expect(service.registerPlan(worker, [])).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.registerPlan(missing, [])).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.reportBoundEvent(missing, { id: 'e', type: 'progress', severity: 'info', summary: 'x' })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.putBoundArtifact(missing, 'x', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.listBoundArtifacts(missing)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.listSources(worker, {})).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.readSource(coordinator, 'foreign', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.listSources(coordinator, {})).resolves.toMatchObject({ ok: false, code: 'INVALID', message: 'list offline' });
    await expect(service.readSource(coordinator, 'source-1', {})).resolves.toMatchObject({ ok: false, code: 'INVALID', message: 'read offline' });
    await expect(service.putBoundArtifact(coordinator, 'throw.md', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'INVALID', message: 'artifact offline' });
    await expect(service.completeByCoordinatorBinding(worker, 'execution-1', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinatorBinding(coordinator, 'other', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
  }));

  it('validates completion, delivery, handoff, and cancellation boundaries', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const cancelTeamLaunch = vi.fn(async () => ({ ok: false as const, code: 'TRANSPORT', message: 'cancel unavailable' }));
    const service = new SquadExecutionService(deps(filePath, { replyToSession, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('session-1', 'project-1', 'execution-1', ' ')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.completeByCoordinator('session-1', 'project-1', 'missing', 'done')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.respond('session-1', 'project-1', 'execution-1', 4, '', 'answer')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.respond('session-1', 'project-1', 'execution-1', 4, 'slot-1', ' ')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.respond('other', 'project-1', 'execution-1', 4, 'slot-1', 'answer')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.respond('session-1', 'project-1', 'execution-1', 4, 'slot-1', 'answer')).resolves.toMatchObject({ ok: false, code: 'SESSION_GONE' });
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'other', projectId: 'project-1', executionId: 'execution-1' }, 'stop', 4)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'session-1', projectId: 'project-1', executionId: 'execution-1' }, 'respond', 5)).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.stop('session-1', 'project-1', 'execution-1', 4)).resolves.toEqual({ ok: false, code: 'TRANSPORT', message: 'cancel unavailable' });
  }));

  it('maps artifact, policy, retry, and resume-grant error paths', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    await service.start('session-1', 'project-1', request);
    await expect(service.putArtifact('other', 'project-1', 'execution-1', 'x', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', '', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.recordPolicyResult('project-1', 'missing', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.recordPolicyResult('project-1', 'execution-1', { version: 1, executionId: 'other', attempt: 1 })).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.retry('other', 'project-1', 'execution-1', 0)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.retry('session-1', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: false, code: 'RETRY_NOT_ALLOWED' });
    await expect(service.mintResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.revokeResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.revokeResumeGrant('session-1', 'project-1', 'execution-1', 'monitor')).resolves.toMatchObject({ ok: true });
  }));

  it('keeps active state when lifecycle lookup fails and handles worker failure terminal signals', async () => fixture(async (filePath) => {
    let lifecycle: unknown = undefined;
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => {
      if (lifecycle === 'throw') throw new Error('lifecycle offline');
      return lifecycle as never;
    } }));
    await service.start('session-1', 'project-1', request);
    lifecycle = 'throw';
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    lifecycle = { workers: [{ projectId: 'project-1', task: 'caller-reported-failed', process: 'running' }] };
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('covers delivery route denial, invalid input, and transient store branches', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const base = deps(filePath, { store });
    const service = new SquadExecutionService(base);
    await service.start('owner', 'project-1', request);
    const missing = { executionId: 'missing', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1' };
    const coordinator = { ...missing, executionId: 'execution-1', role: 'orchestrator' as const };
    const worker = { ...missing, executionId: 'execution-1' };
    await expect(service.pullDelivery(missing)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.pullDelivery(coordinator)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.ackDelivery(missing, 'delivery', 'lease', { delivered: true })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.ackDelivery(coordinator, 'delivery', 'lease', { delivered: true })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.ackDelivery(worker, 'delivery', 'lease', { delivered: true })).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.retryBlockerDelivery('owner', 'project-1', 'execution-1', 0, '', '')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.resumeBlocker('owner', 'project-1', 'execution-1', 0, '', '', '')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.resumeBlocker('other', 'project-1', 'execution-1', 0, 'b', 'c', 'text')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.listSources(coordinator, {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.readSource(coordinator, 'source', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('maps launch failure with default transport message', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: false }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam }));
    await expect(service.start('owner', 'project-1', request)).resolves.toEqual({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'Team launch failed' });
  }));

  it('covers lifecycle mismatch after startup completes', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let lifecycle: any = { workers: [{ projectId: 'project-1', process: 'running' }] };
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => lifecycle }));
    await service.start('owner', 'project-1', request);
    lifecycle = { workers: [{ projectId: 'wrong' }] };
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('covers owner read and control boundary variants', async () => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await service.start('owner', 'project-1', request);
    expect(await service.snapshot('other', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.listArtifacts('other', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.readArtifact('other', 'project-1', 'execution-1', 'missing')).toBeUndefined();
    expect(await service.readArtifact('owner', 'project-1', 'execution-1', 'missing')).toBeUndefined();
    await expect(service.reportEvent('other', 'project-1', 'execution-1', { id: 'e', type: 'progress', severity: 'info', summary: 'x' })).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.completeByCoordinator('owner', 'project-1', 'execution-1', 'x'.repeat(64 * 1024 + 1))).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'owner', projectId: 'project-1', executionId: 'execution-1' }, 'respond', 4, 'slot-1')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await service.handleCoordinatorExit('wrong', 'execution-1', 'coordinator');
    await service.handleCoordinatorExit('project-1', 'execution-1', 'other');
  }));

  it('covers recovery unavailable, malformed generation, and transient rotation branches', async () => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await service.start('owner', 'project-1', request);
    const record = await input.store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });

    const grants = { mint: vi.fn(), consume: vi.fn(), revoke: vi.fn(), rotate: vi.fn(async () => { throw new Error('storage offline'); }) };
    const rotating = new SquadExecutionService(deps(filePath, { resumeGrants: grants as never }));
    await expect(rotating.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'ROTATE_TRANSIENT' });
  }));

  it('covers project listing and title fallback variants', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('owner', 'project-1', request);
    await expect(service.listProject('project-1', undefined, 1)).resolves.toMatchObject({ records: [{ id: 'execution-1' }], hasMore: false });
    expect(deriveJobTitle({ teamId: 'team', summary: '  ' })).toBe('team');
    expect(deriveJobTitle({ teamId: 'team', jobTitle: ` ${'x'.repeat(300)} ` })).toHaveLength(240);
  }));

  it.each([
    [{ slotId: '', provider: 'p', model: 'm' }, 'blank slot'],
    [{ slotId: 's', provider: '', model: 'm' }, 'blank provider'],
    [{ slotId: 's', provider: 'p', model: '' }, 'blank model']
  ])('rejects malformed resolved-model snapshot: %s', async (model) => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await expect(service.start('owner', 'project-1', { ...request, resolvedModels: [model] })).resolves.toMatchObject({ ok: false, code: 'INVALID' });
  }));

  it('covers completed, failed, and stale failed stop variants', async () => fixture(async (filePath) => {
    const completedStore = createExecutionStore({ filePath, id: () => 'execution-1' });
    const completedService = new SquadExecutionService(deps(filePath, { store: completedStore }));
    await completedService.start('owner', 'project-1', request);
    let record = await completedStore.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await completedStore.transition(record.id, record.stateVersion, 'COMPLETED', 'info', 'done');
    await expect(completedService.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });

    const failedPath = `${filePath}.failed`;
    const failedStore = createExecutionStore({ filePath: failedPath, id: () => 'execution-2' });
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const failedService = new SquadExecutionService(deps(failedPath, { store: failedStore, launchTeam: async () => ({ ok: false }), cancelTeamLaunch }));
    await failedService.start('owner', 'project-1', { ...request, launchRequestId: 'request-2' });
    record = await failedStore.get('execution-2');
    if (!record) throw new Error('missing failed execution');
    await expect(failedService.stop('owner', 'project-1', record.id, record.stateVersion - 1)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    await expect(failedService.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'FAILED' } });
  }));

  it('covers worker-only lifecycle states that remain running or fail after every exit', async () => fixture(async (filePath) => {
    let lifecycle: any = { workers: [{ projectId: 'project-1', task: 'working', process: 'running' }] };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle }));
    await service.start('owner', 'project-1', request);
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    lifecycle = { workers: [{ projectId: 'project-1', task: 'working', process: 'exited' }] };
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('covers retry authorization-context, launch, and thrown transport failures', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let authorizationMode: 'deny' | 'missing' | 'ok' = 'deny';
    let launchMode: 'ok' | 'fail' | 'throw' = 'ok';
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => authorizationMode === 'deny'
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : authorizationMode === 'missing'
          ? { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [] } }
          : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] } } },
      launchTeam: async () => {
        if (launchMode === 'throw') throw 'transport offline';
        return launchMode === 'fail' ? { ok: false as const } : { ok: true as const };
      }
    }));
    await service.start('owner', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    authorizationMode = 'missing';
    await expect(service.retry('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE' });
    record = await store.get(record.id);
    if (!record) throw new Error('missing execution');
    authorizationMode = 'ok';
    launchMode = 'fail';
    await expect(service.retry('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'Team launch failed' });

    const throwPath = `${filePath}.throw`;
    const throwStore = createExecutionStore({ filePath: throwPath, id: () => 'execution-2' });
    let denyThrowRetry = true;
    const throwing = new SquadExecutionService(deps(throwPath, {
      store: throwStore,
      authorizeTeamLaunch: () => denyThrowRetry
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] } } },
      launchTeam: async () => { throw 'transport offline'; }
    }));
    await throwing.start('owner', 'project-1', { ...request, launchRequestId: 'request-2' });
    record = await throwStore.get('execution-2');
    if (!record) throw new Error('missing execution');
    denyThrowRetry = false;
    await expect(throwing.retry('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'transport offline' });
  }));

  it('covers source success without bundle, artifact replay, and delivery retry conflicts', async () => fixture(async (filePath) => {
    const sources = { list: vi.fn(), read: vi.fn() };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, sources: sources as never }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    await expect(service.listSources(coordinator, {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.readSource(coordinator, 'missing', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.putArtifact('owner', 'project-1', 'execution-1', 'same.txt', 'text/plain', 'same')).resolves.toMatchObject({ ok: true });
    await expect(service.putArtifact('owner', 'project-1', 'execution-1', 'same.txt', 'text/plain', 'same')).resolves.toMatchObject({ ok: true });
    await expect(service.retryBlockerDelivery('owner', 'project-1', 'execution-1', 0, 'blocker', 'delivery')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
  }));

  it('covers failed cancellation defaults and stopped terminal control', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, cancelTeamLaunch: async () => ({ ok: false }) }));
    await service.start('owner', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toEqual({ ok: false, code: 'CANCEL_FAILED', message: 'Team cancellation failed' });
    record = await store.get(record.id);
    if (!record) throw new Error('missing execution');
    record = await store.transition(record.id, record.stateVersion, 'STOPPED', 'info', 'stopped');
    await expect(service.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('covers failed-state cancellation defaults', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, launchTeam: async () => ({ ok: false }), cancelTeamLaunch: async () => ({ ok: false }) }));
    await service.start('owner', 'project-1', request);
    const record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toEqual({ ok: false, code: 'CANCEL_FAILED', message: 'Team cancellation failed' });
  }));

  it('automatically appends linked Inbox entry on blockWork', async () => fixture(async (filePath) => {
    const append = vi.fn(async (input) => ({ id: 'entry-1', ...input }));
    const inbox = { append };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, inbox }));
    
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    
    let record = await store.registerPlan(running.id, running.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    
    await service.blockWork({ role: 'worker', slotId: 'slot-1', projectId: 'project-1', executionId: 'execution-1' }, 'a', { id: 'blocker-1', question: 'Help?', options: ['Yes', 'No'] });
    
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      subject: 'Build release',
      comments: 'Help?',
      executionId: 'execution-1',
      blockerId: 'blocker-1',
      question: expect.objectContaining({
        allowOther: true,
        options: [
          { id: 'A', label: 'Yes' },
          { id: 'B', label: 'No' }
        ]
      })
    }));
  }));

  it('triggers immediate delivery drain check on blocker enqueue', async () => fixture(async (filePath) => {
    const triggerDeliveryDrain = vi.fn();
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, triggerDeliveryDrain }));
    await service.start('owner', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    
    await service.respond('owner', 'project-1', 'execution-1', record.stateVersion, 'slot-1', 'Done');
    expect(triggerDeliveryDrain).toHaveBeenCalledTimes(1);
    expect(triggerDeliveryDrain).toHaveBeenCalledWith('worker-1');
  }));

});

describe('provided-plan persistence caps', () => {
  // Regression: a "Plan provided in goal" launch seeds work units whose `task`
  // carries the full executable-step Work body (bounded at 16 KiB by the
  // preflight normalizer). The store's persist-time validWorkUnit used to bound
  // `task` at MAX_STRING (2 KiB), so a legitimately-large provided plan parsed
  // and normalized cleanly but died at persist ("invalid execution state before
  // persistence") — the exact live Squad-launch failure.
  it('persists a seeded work unit whose task exceeds MAX_STRING (2 KiB)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const bigTask = 'x'.repeat(4_000); // > 2 KiB, < 16 KiB
    const result = await store.claim({
      callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work',
      requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [],
      request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] },
      coordinationMode: 'structured',
      workUnits: [{ id: 'big', title: 'Big', task: bigTask, dependencies: [], readOnly: true, verification: ['check'] }]
    });
    expect(result.outcome).toBe('claimed');
    expect(result.record.workUnits?.[0]?.task).toBe(bigTask);
    // Prove it round-trips through the durable file (persist validated + wrote it).
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    expect(persisted.records[0].workUnits[0].task).toBe(bigTask);
  }));
});

// Anti-freeze backstop (run df216947): durable workers never heartbeat, so a stuck worker's
// claim can wedge forever unless the state-agnostic wall-clock reclaim has a ceiling to fire on.
describe('withDurableClaimWallClockBackstop', () => {
  const DEFAULT_MS = 20 * 60_000;
  const STALL_MS = 10 * 60_000;

  it('injects BOTH the wall-clock ceiling and the stall ceiling for every durable worker-DAG mode when unset', () => {
    for (const mode of ['job-team', 'structured', 'freeform'] as const) {
      expect(withDurableClaimWallClockBackstop(mode, undefined)).toEqual({ maxClaimWallClockMs: DEFAULT_MS, maxClaimStallMs: STALL_MS });
      // Preserves other policy fields, only adds the backstops.
      expect(withDurableClaimWallClockBackstop(mode, { deadlineMs: 5 })).toEqual({ deadlineMs: 5, maxClaimWallClockMs: DEFAULT_MS, maxClaimStallMs: STALL_MS });
    }
  });

  it('injects the missing stall ceiling even when the wall-clock ceiling is caller-set', () => {
    expect(withDurableClaimWallClockBackstop('structured', { maxClaimWallClockMs: 1_000 })).toEqual({ maxClaimWallClockMs: 1_000, maxClaimStallMs: STALL_MS });
  });

  it('leaves BOTH caller-set ceilings untouched (caller wins, referentially identical)', () => {
    const policy = { maxClaimWallClockMs: 1_000, maxClaimStallMs: 500 };
    expect(withDurableClaimWallClockBackstop('structured', policy)).toBe(policy);
  });

  it('does NOT inject for interactive/autonomous chat modes or an unknown mode', () => {
    expect(withDurableClaimWallClockBackstop('interactive-team', undefined)).toBeUndefined();
    expect(withDurableClaimWallClockBackstop('autonomous-team', undefined)).toBeUndefined();
    expect(withDurableClaimWallClockBackstop(undefined, undefined)).toBeUndefined();
    expect(withDurableClaimWallClockBackstop('interactive-team', { deadlineMs: 5 })).toEqual({ deadlineMs: 5 });
  });

  // Wiring: a started 'structured' run (the df216947 failure mode) persists the ceiling into
  // record.request.policy, where reconcileActive reads it to revive the dead wall-clock backstop.
  it('start persists the default ceiling for a structured run so reconcileActive can reclaim', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
        ] } } })
    }));
    const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'structured', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.value.request.policy?.maxClaimWallClockMs).toBe(DEFAULT_MS);
  }));
});

// Plan 3: generic execution-engine robustness. These use SYNTHETIC DAG shapes only
// (deep single-successor chain, fan-in, read-only step, stranded claim) — never the
// real license-cleanup plan, which changes run to run. Each test is grounded in a
// concrete live-run failure mode manual testing caught, and is written to FAIL if the
// corresponding engine guard is reverted (not a tautology that passes on broken code).
// The production-boundary halves live in the built-Electron specs
// (job-team-wedge-recovery / -stuck-worker-reclaim / -streaming-worker-no-reclaim);
// this file owns the cheap-to-parameterize engine-logic halves.
describe('execution DAG robustness (Plan 3: generic synthetic DAGs)', () => {
  // Durable job-team deps over N named worker slots (plus a lead orchestrator). Every
  // slot is reported by getTeamLaunch as a live 'running' PTY — the shape reconcile /
  // dispatch read. Pass `now` to drive the store + service off a controllable clock.
  function jobTeamDeps(
    filePath: string,
    slots: string[],
    over: Partial<ConstructorParameters<typeof SquadExecutionService>[0]> = {},
    now?: () => number
  ) {
    const workerSlots = slots.map((slotId, i) => ({ slotId, personaId: `p${i}`, authorizationIdDigest: `${slotId}-d` }));
    return deps(filePath, {
      store: createExecutionStore({ filePath, id: () => 'execution-1', ...(now ? { now } : {}) }),
      ...(now ? { now } : {}),
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
        slots: [{ slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' }, ...workerSlots]
      } } }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator',
        workers: slots.map((slotId) => ({ slotId, sessionId: `session-${slotId}`, projectId: 'project-1', process: 'running' })) }),
      ...over
    });
  }
  const coordinatorBinding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
  const workerBinding = (slotId: string) => ({ executionId: 'execution-1', projectId: 'project-1', slotId, role: 'worker' as const });
  const pushesFor = (spy: ReturnType<typeof vi.fn>, unitId: string) =>
    spy.mock.calls.filter((call) => String(call[1]).includes(`assigned work unit \`${unitId}\``)).length;
  // Complete whichever slot currently holds `unitId` (routing picks the free slot, so
  // read the live assignedSlotId rather than hard-coding it).
  async function completeUnit(service: InstanceType<typeof SquadExecutionService>, unitId: string) {
    const status = await service.status('owner', 'project-1', 'execution-1');
    const unit = status?.workUnits?.find((candidate) => candidate.id === unitId);
    if (!unit || unit.state !== 'CLAIMED' || !unit.assignedSlotId) throw new Error(`unit ${unitId} not CLAIMED (state ${unit?.state})`);
    return service.completeWork(workerBinding(unit.assignedSlotId), unitId, `result-${unitId}`);
  }

  it('scenario 1: a deep single-successor DAG (A→B→C→D→E→F) drains to COMPLETED with no wedge', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(jobTeamDeps(filePath, ['slot-1'], { replyToSession }));
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const workUnits = ids.map((id, i) => ({ id, title: id.toUpperCase(), task: `do ${id}`, dependencies: i ? [ids[i - 1]] : [], readOnly: true, verification: [`check ${id}`] }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits });
    await service.dispatchReady(coordinatorBinding);
    // Only the head is dispatchable; the whole tail stays PENDING behind its single dep.
    let status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.filter((u) => u.state === 'CLAIMED').map((u) => u.id)).toEqual(['a']);
    expect(status?.workUnits?.filter((u) => u.state === 'PENDING').map((u) => u.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
    // Walk the chain: each completion must cascade-dispatch EXACTLY the next unit — a
    // broken cascade leaves the successor PENDING forever (the classic wedge).
    for (const id of ids) expect((await completeUnit(service, id)).ok).toBe(true);
    status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.every((u) => u.state === 'COMPLETED')).toBe(true);
    expect(status?.state).toBe('COMPLETED'); // engine auto-finalized — no hang
    for (const id of ids) expect(pushesFor(replyToSession, id)).toBe(1); // each pushed once: no miss, no dup
  }));

  it('scenario 1b: a stranded mid-chain claim is reclaimed by redispatchStalled and NEVER leaks dispatch to its dependents', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(jobTeamDeps(filePath, ['slot-1'], { replyToSession }, () => clock.t));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], readOnly: true, verification: ['check a'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: ['a'], readOnly: true, verification: ['check b'] }
    ] });
    await service.dispatchReady(coordinatorBinding); // 'a' CLAIMED, coordinator PARKED, worker never emits output
    clock.t += 700_000; // past default job-team maxClaimStallMs (600_000) → 'a' is a stranded claim
    replyToSession.mockClear();
    await service.redispatchStalled();
    const status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.find((u) => u.id === 'a')).toMatchObject({ state: 'CLAIMED', claimGeneration: 2 }); // reclaimed + re-dispatched
    expect(status?.workUnits?.find((u) => u.id === 'b')?.state).toBe('PENDING'); // dependent must NOT advance while 'a' is unfinished
    expect(pushesFor(replyToSession, 'b')).toBe(0);
  }));

  it('scenario 5: a fan-in unit dispatches only after ALL dependencies complete, and exactly once', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(jobTeamDeps(filePath, ['slot-1', 'slot-2'], { replyToSession }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], readOnly: true, verification: ['check a'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: [], readOnly: true, verification: ['check b'] },
      { id: 'd', title: 'D', task: 'do d', dependencies: ['a', 'b'], readOnly: true, verification: ['check d'] }
    ] });
    await service.dispatchReady(coordinatorBinding);
    // Both roots claim concurrently on the two slots; the join stays PENDING.
    let status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.filter((u) => u.state === 'CLAIMED').map((u) => u.id).sort()).toEqual(['a', 'b']);
    expect(status?.workUnits?.find((u) => u.id === 'd')?.state).toBe('PENDING');
    // Completing ONE dependency must NOT release the join (its other dep is unfinished).
    await completeUnit(service, 'a');
    status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.find((u) => u.id === 'd')?.state).toBe('PENDING');
    expect(pushesFor(replyToSession, 'd')).toBe(0);
    // The SECOND completion releases the join — dispatched once, not twice.
    await completeUnit(service, 'b');
    status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.find((u) => u.id === 'd')).toMatchObject({ state: 'CLAIMED' });
    expect(pushesFor(replyToSession, 'd')).toBe(1);
    await completeUnit(service, 'd');
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('COMPLETED');
  }));

  it('scenario 3: a read-only, zero-file-output step completes normally (completion never depends on file writes)', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(jobTeamDeps(filePath, ['slot-1']));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [
      { id: 'ro', title: 'Read-only', task: 'inspect', dependencies: [], readOnly: true, files: [], verification: ['confirm findings'] }
    ] });
    await service.dispatchReady(coordinatorBinding);
    expect((await service.status('owner', 'project-1', 'execution-1'))?.workUnits?.[0]).toMatchObject({ id: 'ro', state: 'CLAIMED', assignedSlotId: 'slot-1' });
    // Worker did read-only analysis and wrote NO files. Completion is a tool call, not an
    // artifact scan — an empty file set must still complete + auto-finalize the run.
    expect((await service.completeWork(workerBinding('slot-1'), 'ro', 'analysis: all good')).ok).toBe(true);
    const status = await service.status('owner', 'project-1', 'execution-1');
    expect(status?.workUnits?.[0]).toMatchObject({ id: 'ro', state: 'COMPLETED', result: 'analysis: all good' });
    expect(status?.state).toBe('COMPLETED');
  }));

  // Bugs 1 (dead-agent/live-shell, run 5afae51a) + 2 (mesh-dot-absent, Symptom A). In BOTH
  // the worker's PTY process is alive ('running') but the AGENT is not producing output and
  // its status is either decayed to 'unknown' (an unreliable remote worker) or absent
  // (a worker that never registered an agent-mesh dot → undefined). NEITHER is a restful
  // state, so the engine must treat the claim as a LIVE worker (renew within the stall
  // window) and only reclaim it once OUTPUT progress has been frozen past maxClaimStallMs —
  // never renew a zombie shell forever, and never mistake 'unknown'/undefined for "at rest".
  it.each([
    ['decayed-remote status (unknown) — dead agent, live login shell (run 5afae51a)', 'unknown' as const],
    ['no agent-mesh dot (undefined) — worker never registered (Symptom A)', undefined]
  ])('bugs 1-2: a live-process worker with %s is renewed within the stall window, then reclaimed past it', async (_label, agentState) => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 900_000, maxClaimStallMs: 500_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt = progressAt = 1_000, lease → 301_000
    const over = agentState === undefined ? {} : { getAgentState: () => agentState };
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }), ...over }));
    now += 300_000; // now = 301_000: lease expired, but progress stale 300_000 < 500_000 stall → RENEW (do NOT reclaim a live worker)
    await service.reconcileActive();
    const renewed = (await store.get(record.id))?.workUnits?.[0];
    expect(renewed?.state).toBe('CLAIMED'); // not treated as an abandoned/restful claim
    expect(renewed?.progressAt).toBe(1_000); // agent-state renewal is NOT output progress
    expect(renewed?.leaseExpiresAt).toBe(601_000);
    now += 300_000; // now = 601_000: progress stale 600_000 >= 500_000 stall → reclaim the frozen zombie-shell claim
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  // The streaming/stuck BOUNDARY: the stall clock is measured from the last real OUTPUT
  // (progressAt), not from claim time. A single output event mid-run RESETS that clock, so a
  // worker that produced output more recently than maxClaimStallMs is renewed even though it
  // has been claimed far longer than a stall window — while the SAME elapsed run with no such
  // output (bugs 1-2 above) is reclaimed. This is the load-bearing difference between a live
  // worker briefly silent between tool calls and a frozen zombie shell.
  it('scenario 2: a real output event resets the stall clock, so the worker is renewed past claim+stall but reclaimed past output+stall', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [], policy: { maxClaimWallClockMs: 5_000_000, maxClaimStallMs: 400_000 } } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit'); // claimedAt = progressAt = 1_000
    // Status stays 'unknown' throughout (unreliable remote worker); liveness is the OUTPUT, not the dot.
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => 'unknown', getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    // Real worker output at 280_000 → advances progressAt AND lease. (The store only
    // persists a renewal within HEARTBEAT_PERSIST_REMAINING_MS = 30s of expiry, so the
    // output must land inside that window of the 301_000 lease to count.)
    now = 280_000;
    await store.renewWorkerLease(record.id, 'slot-1', { advanceProgress: true });
    now = 600_000; // lease expired; stall from CLAIM (599_000) already exceeds 400_000, but stall from OUTPUT (320_000) does NOT → RENEW
    await service.reconcileActive();
    const renewed = (await store.get(record.id))?.workUnits?.[0];
    expect(renewed?.state).toBe('CLAIMED'); // the 280_000 output reset the stall clock; a claim-time stall would have reclaimed here
    expect(renewed?.progressAt).toBe(280_000);
    expect(renewed?.leaseExpiresAt).toBe(900_000); // renewed lease = 600_000 + default 300_000
    now = 960_000; // lease expired again; stall from OUTPUT (710_000) now exceeds 400_000 → reclaim
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  // Bug 3: a stranded claim whose worker is genuinely at REST (idle/waiting/done) but reported
  // no outcome has ABANDONED the claim — it must be reclaimed at lease expiry (SILENT_WORKER),
  // not renewed. (Complements the wall-clock/stall reclaim for non-restful workers above.)
  it.each(['idle', 'waiting', 'done'] as const)('bug 3: a stranded claim whose worker is at rest (%s) is reclaimed at lease expiry, not renewed', async (restState) => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    now += 300_000; // past the default lease window
    const service = new ExecutionService(deps(filePath, { store, now: () => now, claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true, getAgentState: () => restState, getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }) }));
    await service.reconcileActive();
    expect((await store.get(record.id))?.workUnits?.[0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));
});
