import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  boundTeamLaunchRequest,
  createTeamLifecycleIntegration,
  createTeamLifecycleStore,
  MAX_TEAM_INITIAL_TASK_BYTES,
  MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH,
  teamLaunchPayloadDigest
} from '../../launch/team-lifecycle-store.js';
import { atomicDurableWrite } from '../../harness-routing/storage.js';
import type { LaunchPrincipal } from '../../launch/types.js';
import type { TeamLifecycleClaim, TeamModernBindingContext } from '../../launch/team-lifecycle-store.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const otherThreadId = '22222222-2222-4222-8222-222222222222';
const modernContext: TeamModernBindingContext = {
  teamId: 'team-1', cohortId: 'cohort-1', role: 'worker', executionId: 'execution-1',
  projectId: 'project-1', hostId: 'host-1', workspaceEnvironmentId: 'env-1', providerId: 'provider-1',
  worktreePath: '/tmp/worktree', personaSnapshot: { id: 'persona-1', profile: 'codex', model: 'model-1', systemPrompt: 'implement safely' }
};

const runCapacity: Extract<LaunchPrincipal, { kind: 'team' }> = {
  kind: 'team', id: 'team:squad:caller:request-1', allowedProjectIds: ['project-1'], allowedTeamIds: ['squad'],
  maxConcurrent: 32, maxLaunchesPerRun: 32
};

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-team-lifecycle-'));
  try { await run(join(dir, 'lifecycle.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

function claimInput(callerPrincipalId: string, payloadDigest = 'digest'): TeamLifecycleClaim {
  return {
    callerPrincipalId,
    launchRequestId: 'request-1',
    payloadDigest,
    capacity: { principal: runCapacity, launched: 0 },
    launchResult: completedResult().value,
    workers: [{
      sessionId: 'session-1', cohortId: 'cohort-1', slotId: 'slot-1', personaId: 'persona-1',
      projectId: 'project-1', authorizationId: 'authorization-1', process: 'authorized' as const,
      attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const
    }]
  };
}

function modernClaimInput() {
  const input = claimInput('principal-modern');
  input.capacity!.launched = 1;
  input.workers[0] = { ...input.workers[0], transport: 'MODERN', generation: 0, bindingState: 'RESERVED', modernContext };
  return input;
}

function pendingClaimInput(callerPrincipalId: string, payloadDigest = 'digest') {
  return { callerPrincipalId, launchRequestId: 'request-1', payloadDigest, capacity: { principal: runCapacity, launched: 0 } };
}

function completedResult() {
  return {
    ok: true as const,
    value: {
      launchRequestId: 'request-1', launched: 1, cohortId: 'cohort-1',
      workers: [{
        sessionId: 'session-1', cohortId: 'cohort-1', slotId: 'slot-1', personaId: 'persona-1',
        projectId: 'project-1', authorizationId: 'authorization-1'
      }],
      failedSlots: []
    }
  };
}

async function markClaimedWorkerRunning(
  store: ReturnType<typeof createTeamLifecycleStore>,
  recordId: string,
  slotId = 'slot-1'
): Promise<void> {
  await store.updateWorker(recordId, slotId, { process: 'spawning' });
  await store.updateWorker(recordId, slotId, { process: 'running' });
}

function withIdentity(input: ReturnType<typeof claimInput>, suffix: string) {
  input.launchRequestId = `request-${suffix}`;
  input.launchResult.launchRequestId = `request-${suffix}`;
  input.launchResult.cohortId = `cohort-${suffix}`;
  input.launchResult.workers[0] = {
    sessionId: `session-${suffix}`, cohortId: `cohort-${suffix}`, slotId: `slot-${suffix}`,
    personaId: `persona-${suffix}`, projectId: `project-${suffix}`, authorizationId: `authorization-${suffix}`
  };
  input.workers[0] = {
    ...input.launchResult.workers[0], process: 'authorized', attention: 'active', task: 'unknown', delivery: 'bound-at-spawn'
  };
  return input;
}

describe('team lifecycle store', () => {
  it('bounds Team launch input and rejects malformed or over-limit tasks', () => {
    const base = {
      teamId: 'team-1', projectId: 'project-1', callerPrincipalId: 'principal-1', launchRequestId: 'request-1',
      slots: [{ slotId: 'slot-1', authorizationId: 'authorization-1', initialTask: 'ship exact change' }],
      policy: { deadlineMs: 5_000 }
    };
    expect(boundTeamLaunchRequest(base)).toEqual(base);
    expect(() => boundTeamLaunchRequest({ ...base, slots: [{ ...base.slots[0], initialTask: 7 }] }))
      .toThrow('invalid initial task');
    expect(() => boundTeamLaunchRequest({
      ...base, slots: [{ ...base.slots[0], initialTask: 'é'.repeat(Math.floor(MAX_TEAM_INITIAL_TASK_BYTES / 2) + 1) }]
    })).toThrow('invalid initial task');
    expect(() => boundTeamLaunchRequest({
      ...base, launchRequestId: 'x'.repeat(MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH + 1)
    })).toThrow('invalid launch request id');
  });

  it('digests canonical Team payload intent including policy and host-derived authorization binding', () => {
    const base = {
      teamId: 'team-1', projectId: 'project-1', callerPrincipalId: 'principal-1', launchRequestId: 'request-1',
      slots: [{ slotId: 'slot-1', authorizationId: 'authorization-1', authorizationBinding: 'binding-1', initialTask: 'ship exact change' }],
      policy: { deadlineMs: 5_000 }
    };
    const digest = teamLaunchPayloadDigest(base);
    expect(digest).toBe(teamLaunchPayloadDigest({
      policy: { deadlineMs: 5_000 }, slots: [{ initialTask: 'ship exact change', authorizationId: 'authorization-2', authorizationBinding: 'binding-1', slotId: 'slot-1' }],
      launchRequestId: 'request-1', callerPrincipalId: 'principal-1', projectId: 'project-1', teamId: 'team-1'
    }));
    expect(digest).not.toBe(teamLaunchPayloadDigest({ ...base, projectId: 'project-2' }));
    expect(digest).not.toBe(teamLaunchPayloadDigest({ ...base, slots: [{ ...base.slots[0], initialTask: 'other task' }] }));
    expect(digest).not.toBe(teamLaunchPayloadDigest({ ...base, slots: [{ ...base.slots[0], authorizationBinding: 'binding-2' }] }));
    expect(digest).not.toBe(teamLaunchPayloadDigest({ ...base, policy: { deadlineMs: 6_000 } }));
    expect(digest).toMatch(/^launch-v1:[a-f0-9]{64}$/);
  });

  it('namespaces claims by principal, reports unfinished replay, and replays exact completed outcome', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, id: () => `record-${++next}`, now: () => 10 });
    const firstInput = pendingClaimInput('principal-a');
    const first = await store.claim(firstInput);
    const inProgress = await store.claim(pendingClaimInput('principal-a'));
    await store.complete(first.record.id, completedResult());
    const replay = await store.claim(pendingClaimInput('principal-a'));
    const conflict = await store.claim(pendingClaimInput('principal-a', 'changed'));
    const otherPrincipal = await store.claim(pendingClaimInput('principal-b'));

    expect(first.outcome).toBe('claimed');
    expect(inProgress.outcome).toBe('in-progress');
    expect(replay).toMatchObject({ outcome: 'replay', record: { outcome: { status: 'completed', result: { ok: true, value: { workers: [{ sessionId: 'session-1' }] } } } } });
    expect(conflict).toMatchObject({ outcome: 'conflict', record: { payloadDigest: 'digest' } });
    expect(otherPrincipal.outcome).toBe('claimed');
    expect(await store.list()).toHaveLength(2);
  }));

  it('replays a completed failure as failure', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(pendingClaimInput('principal-a'));
    await store.complete(claimed.record.id, { ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'no workers' });
    expect(await store.claim(pendingClaimInput('principal-a'))).toMatchObject({
      outcome: 'replay', record: { outcome: { status: 'completed', result: { ok: false, code: 'TEAM_LAUNCH_FAILED' } } }
    });
  }));

  it('releases capacity once on process terminal state but not blocked attention', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1', now: () => 10 });
    const claimed = await store.claim(claimInput('principal-a'));
    const id = claimed.record.id;

    const blocked = await store.updateWorker(id, 'slot-1', { attention: 'blocked' });
    expect(blocked.capacityReleasedNow).toBe(false);
    expect(blocked.worker).toMatchObject({ attention: 'blocked', capacityReleased: false });

    await store.updateWorker(id, 'slot-1', { process: 'spawning' });
    await store.updateWorker(id, 'slot-1', { process: 'running' });
    const exited = await store.updateWorker(id, 'slot-1', { process: 'exited' });
    const repeated = await store.updateWorker(id, 'slot-1', { process: 'exited' });
    expect(exited.capacityReleasedNow).toBe(true);
    expect(repeated.capacityReleasedNow).toBe(false);
    expect(repeated.worker.capacityReleased).toBe(true);
  }));

  it('persists canceled lifecycle transitions', async () => fixture(async (filePath) => {
    const initial = createTeamLifecycleStore({ filePath, id: () => 'record-1', now: () => 10 });
    const claimed = await initial.claim(claimInput('principal-a'));
    const canceled = await initial.cancel(claimed.record.id);
    expect(canceled).toMatchObject({
      state: 'cancel-pending', workers: [{ process: 'authorized', capacityReleased: false }], releasedSlotIds: []
    });

    const restarted = createTeamLifecycleStore({ filePath });
    expect(await restarted.get(claimed.record.id)).toMatchObject({ state: 'cancel-pending', workers: [{ process: 'authorized' }] });
  }));

  it('persists the launch-time orchestrator retention setting across restart', async () => fixture(async (filePath) => {
    const initial = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await initial.claim({ ...claimInput('principal-a'), retainOrchestrator: true });
    expect(claimed.record.retainOrchestrator).toBe(true);

    const restarted = createTeamLifecycleStore({ filePath });
    expect(await restarted.get(claimed.record.id)).toMatchObject({ retainOrchestrator: true });
  }));

  it('serializes concurrent same-principal request claims across store instances', async () => fixture(async (filePath) => {
    const first = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const second = createTeamLifecycleStore({ filePath, id: () => 'record-2' });
    const results = await Promise.all([
      first.claim(claimInput('principal-a')),
      second.claim(claimInput('principal-a'))
    ]);
    expect(results.map(({ outcome }) => outcome).sort()).toEqual(['claimed', 'in-progress']);
    expect(results[0].record.id).toBe(results[1].record.id);
    expect(await first.list()).toHaveLength(1);
  }));

  it('retains every active record while capping only terminal history', async () => fixture(async (filePath) => {
    expect(() => createTeamLifecycleStore({ filePath, maxRecords: 0 })).toThrow('invalid team lifecycle max records');
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, maxRecords: 1, id: () => `record-${++next}` });
    const active = await store.claim(withIdentity(claimInput('principal-active'), 'active'));
    const oldTerminal = await store.claim(withIdentity(claimInput('principal-old'), 'old'));
    await store.updateWorker(oldTerminal.record.id, 'slot-old', { process: 'spawn-failed' });
    await store.complete(oldTerminal.record.id, { ok: false, code: 'FAILED', message: 'old' });
    const recentTerminal = await store.claim(withIdentity(claimInput('principal-recent'), 'recent'));
    await store.updateWorker(recentTerminal.record.id, 'slot-recent', { process: 'spawn-failed' });
    await store.complete(recentTerminal.record.id, { ok: false, code: 'FAILED', message: 'recent' });

    expect((await store.list()).map(({ id }) => id)).toEqual([active.record.id, recentTerminal.record.id]);
  }));

  it('retains an empty in-progress claim while capping completed history', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, maxRecords: 1, id: () => `record-${++next}` });
    const pending = await store.claim({
      callerPrincipalId: 'principal-pending', launchRequestId: 'request-pending', payloadDigest: 'pending-digest'
    });
    const old = await store.claim({
      callerPrincipalId: 'principal-old', launchRequestId: 'request-old', payloadDigest: 'old-digest'
    });
    await store.complete(old.record.id, { ok: false, code: 'FAILED', message: 'old' });
    const recent = await store.claim({
      callerPrincipalId: 'principal-recent', launchRequestId: 'request-recent', payloadDigest: 'recent-digest'
    });
    await store.complete(recent.record.id, { ok: false, code: 'FAILED', message: 'recent' });

    expect((await store.list()).map(({ id }) => id)).toEqual([pending.record.id, recent.record.id]);
  }));

  it('reports canceled capacity releases exactly once', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));

    expect((await store.cancel(claimed.record.id)).releasedSlotIds).toEqual([]);
    expect((await store.cancel(claimed.record.id)).releasedSlotIds).toEqual([]);
  }));

  it('reconciles restart state against recovered sessions and releases missing capacity once', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, id: () => `record-${++next}` });
    const spawning = await store.claim(withIdentity(claimInput('principal-spawning'), 'spawning'));
    await store.updateWorker(spawning.record.id, 'slot-spawning', { process: 'spawning' });
    const running = await store.claim(withIdentity(claimInput('principal-running'), 'running'));
    await store.updateWorker(running.record.id, 'slot-running', { process: 'spawning' });
    await store.updateWorker(running.record.id, 'slot-running', { process: 'running' });
    const recovered = await store.claim(withIdentity(claimInput('principal-recovered'), 'recovered'));
    await store.updateWorker(recovered.record.id, 'slot-recovered', { process: 'spawning' });
    await store.updateWorker(recovered.record.id, 'slot-recovered', { process: 'running' });

    // Reconcile models an application RESTART: a fresh store instance reads the
    // persisted records (its in-flight set is empty), so prior-process orphans
    // are reconciled while a live process's in-flight launches are not.
    const restarted = createTeamLifecycleStore({ filePath });
    const first = await restarted.reconcileStartup(new Set(['session-recovered']));
    expect(first.releasedSlotIds.sort()).toEqual(['slot-running', 'slot-spawning']);
    expect(await store.get(spawning.record.id)).toMatchObject({ workers: [{ process: 'spawn-failed' }] });
    expect(await store.get(running.record.id)).toMatchObject({ workers: [{ process: 'exited' }] });
    expect(await store.get(recovered.record.id)).toMatchObject({ workers: [{ process: 'running', capacityReleased: false }] });
    expect((await restarted.reconcileStartup(new Set(['session-recovered']))).releasedSlotIds).toEqual([]);
  }));

  it('does NOT reconcile a launch the live process is mid-flight on (claim not yet completed)', async () => fixture(async (filePath) => {
    // Regression: the boot reconcile (armed behind a grace timer) must not race
    // an in-flight launch of the SAME process. The launch's own store instance
    // holds the record in its in-flight set, so reconcileStartup leaves it
    // in-progress instead of flipping it to completed=INTERRUPTED (which made
    // the subsequent complete() throw "already finalized").
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-live'));
    await markClaimedWorkerRunning(store, claimed.record.id);

    const result = await store.reconcileStartup(new Set());

    expect(result.records).toEqual([]);
    expect(await store.get(claimed.record.id)).toMatchObject({ outcome: { status: 'in-progress' } });
    // The launch can still finalize normally — no "already finalized" throw.
    const completed = await store.complete(claimed.record.id, completedResult());
    expect(completed.outcome).toMatchObject({ status: 'completed', result: { ok: true } });
  }));

  it('completes every stale in-progress request as interrupted on startup, including empty claims', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, id: () => `record-${++next}` });
    const empty = await store.claim(pendingClaimInput('principal-empty'));
    const live = await store.claim(claimInput('principal-live'));
    await markClaimedWorkerRunning(store, live.record.id);

    // A restart reconciles the persisted (prior-process) records: fresh instance.
    await createTeamLifecycleStore({ filePath }).reconcileStartup(new Set(['session-1']));

    expect(await store.get(empty.record.id)).toMatchObject({
      outcome: { status: 'completed', result: { ok: false, code: 'INTERRUPTED' } }
    });
    expect(await store.get(live.record.id)).toMatchObject({
      outcome: { status: 'completed', result: { ok: false, code: 'INTERRUPTED' } },
      workers: [{ process: 'running', capacityReleased: false }]
    });
    expect(await store.claim(pendingClaimInput('principal-empty'))).toMatchObject({
      outcome: 'replay', record: { outcome: { result: { ok: false, code: 'INTERRUPTED' } } }
    });
  }));

  it('rejects lifecycle claims whose workers are duplicate or differ from launch results', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const mismatched = claimInput('principal-mismatch');
    mismatched.workers[0].sessionId = 'different-session';
    await expect(store.claim(mismatched)).rejects.toThrow('team lifecycle workers do not match launch result');

    const duplicate = claimInput('principal-duplicate');
    duplicate.launchResult.launched = 2;
    duplicate.launchResult.workers.push({ ...duplicate.launchResult.workers[0] });
    duplicate.workers.push({ ...duplicate.workers[0] });
    await expect(store.claim(duplicate)).rejects.toThrow('duplicate team lifecycle worker');
  }));

  it('does not persist or revise an identical worker update', async () => fixture(async (filePath) => {
    let writes = 0;
    const store = createTeamLifecycleStore({
      filePath, id: () => 'record-1', now: () => 10,
      durableWrite: (...args) => { writes += 1; return atomicDurableWrite(...args); }
    });
    const claimed = await store.claim(claimInput('principal-a'));
    const before = await store.get(claimed.record.id);
    const result = await store.updateWorker(claimed.record.id, 'slot-1', { attention: 'active' });

    expect(result.record.revision).toBe(before?.revision);
    expect(result.record.updatedAt).toBe(before?.updatedAt);
    expect(writes).toBe(1);
  }));

  it('completion merges launch identities without resetting existing worker lifecycle state', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(pendingClaimInput('principal-a'));
    await store.addWorker(claimed.record.id, {
      sessionId: 'session-1', cohortId: 'cohort-1', slotId: 'slot-1', personaId: 'persona-1',
      projectId: 'project-1', authorizationId: 'authorization-1', process: 'spawning', attention: 'blocked',
      task: 'caller-reported-complete', delivery: 'delivery-attempted'
    });

    await store.complete(claimed.record.id, completedResult());

    expect(await store.get(claimed.record.id)).toMatchObject({
      workers: [{ process: 'spawning', attention: 'blocked', task: 'caller-reported-complete', delivery: 'delivery-attempted' }]
    });
  }));

  it('durably reserves a Modern worker before thread creation and acknowledges only matching generation', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-modern');
    input.workers[0] = {
      ...input.workers[0], transport: 'MODERN', generation: 0, bindingState: 'RESERVED',
      modernContext
    };
    input.capacity!.launched = 1;
    const claimed = await store.claim(input);

    const reservation = await store.reserveModernWorker(claimed.record.id, 'slot-1');
    expect(reservation).toMatchObject({ generation: 1, worker: { transport: 'MODERN', bindingState: 'CREATING', generation: 1 } });
    expect(await store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 2, otherThreadId)).toBe(false);
    expect(await store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, reservation!.threadId)).toBe(true);
    expect(await store.get(claimed.record.id)).toMatchObject({
      workers: [{ transport: 'MODERN', threadId: reservation!.threadId, generation: 1, bindingState: 'BOUND', capacityReleased: false }]
    });
  }));

  it('does not reap or release capacity for Modern reservations during startup reconciliation', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-modern');
    input.workers[0] = {
      ...input.workers[0], transport: 'MODERN', generation: 1, threadId, bindingState: 'UNCERTAIN', process: 'spawning',
      modernContext
    };
    input.capacity!.launched = 1;
    const claimed = await store.claim(input);

    const restarted = createTeamLifecycleStore({ filePath });
    const reconciled = await restarted.reconcileStartup(new Set());
    expect(reconciled).toEqual({ records: [], releasedSlotIds: [] });
    expect(await restarted.get(claimed.record.id)).toMatchObject({
      outcome: { status: 'in-progress' }, workers: [{ process: 'spawning', transport: 'MODERN', bindingState: 'UNCERTAIN', capacityReleased: false }]
    });
  }));

  it('resolves only acknowledged running Modern bindings in their project', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-modern');
    input.workers[0] = {
      ...input.workers[0], transport: 'MODERN', threadId, generation: 2, bindingState: 'BOUND', process: 'running',
      modernContext
    };
    input.capacity!.launched = 1;
    const claimed = await store.claim(input);
    await expect(store.findModernWorkerBinding(threadId, 'project-1')).resolves.toMatchObject({
      recordId: claimed.record.id, generation: 2, worker: { slotId: 'slot-1', modernContext: { executionId: 'execution-1' } }
    });
    await expect(store.findModernWorkerBinding(threadId, 'project-2')).resolves.toBeUndefined();
    await store.fenceCancel(claimed.record.id);
    await expect(store.findModernWorkerBinding(threadId, 'project-1')).resolves.toBeUndefined();
  }));

  it('reserves one UUID across concurrent duplicates, uncertainty and restart without reissuing create', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const claimed = await store.claim(modernClaimInput());
    const reservations = await Promise.all([
      store.reserveModernWorker(claimed.record.id, 'slot-1'),
      createTeamLifecycleStore({ filePath }).reserveModernWorker(claimed.record.id, 'slot-1')
    ]);
    const first = reservations.find((reservation) => reservation?.mayCreate)!;
    expect(first.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reservations.filter((reservation) => reservation?.mayCreate)).toHaveLength(1);
    expect(reservations.map((reservation) => reservation?.threadId)).toEqual([first.threadId, first.threadId]);
    expect(first.worker.modernContext).toEqual(modernContext);
    const restarted = createTeamLifecycleStore({ filePath });
    const reconciled = await restarted.reconcileStartup(new Set());
    expect(reconciled.releasedSlotIds).toEqual([]);
    expect(reconciled.records[0].workers[0].bindingState).toBe('UNCERTAIN');
    expect(await restarted.reserveModernWorker(claimed.record.id, 'slot-1')).toMatchObject({
      threadId: first.threadId, generation: 1, mayCreate: false, worker: { bindingState: 'UNCERTAIN', capacityReleased: false }
    });
    expect(await restarted.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, otherThreadId)).toBe(false);
    expect(await restarted.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, first.threadId)).toBe(true);
    const before = await restarted.get(claimed.record.id);
    expect(await restarted.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, first.threadId)).toBe(true);
    expect(await restarted.get(claimed.record.id)).toEqual(before);
    expect(await restarted.reserveModernWorker(claimed.record.id, 'slot-1')).toMatchObject({ mayCreate: false, generation: 1 });
  }));

  it('does not expose creation intent until durable write succeeds, including uncertain committed writes', async () => fixture(async (filePath) => {
    let failure: 'none' | 'before' | 'after' = 'none';
    const store = createTeamLifecycleStore({ filePath, durableWrite: (...args) => {
      if (failure === 'before') throw new Error('disk unavailable');
      atomicDurableWrite(...args);
      if (failure === 'after') throw new Error('ack lost');
    } });
    const claimed = await store.claim(modernClaimInput());
    failure = 'before';
    await expect(store.reserveModernWorker(claimed.record.id, 'slot-1')).rejects.toThrow('disk unavailable');
    expect((await store.get(claimed.record.id))?.workers[0]).toMatchObject({ generation: 0, bindingState: 'RESERVED' });
    failure = 'after';
    await expect(store.reserveModernWorker(claimed.record.id, 'slot-1')).rejects.toThrow('ack lost');
    failure = 'none';
    expect(await store.reserveModernWorker(claimed.record.id, 'slot-1')).toMatchObject({ mayCreate: false, generation: 1 });
  }));

  it('fences cancel before late ack and releases only exact terminal evidence once', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const claimed = await store.claim(modernClaimInput());
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    const reference = { recordId: claimed.record.id, slotId: 'slot-1', generation: 1, threadId: reservation.threadId };
    expect(await store.modernWorkerMayClose(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(false);
    await store.fenceCancel(claimed.record.id);
    const canceled = await store.get(claimed.record.id);
    await store.fenceCancel(claimed.record.id);
    expect(await store.get(claimed.record.id)).toEqual(canceled);
    expect(await store.acknowledgeModernWorker(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(false);
    expect(await store.reserveModernWorker(reference.recordId, reference.slotId)).toBeUndefined();
    expect(await store.modernWorkerMayClose(reference.recordId, reference.slotId, 2, reference.threadId)).toBe(false);
    expect(await store.modernWorkerMayClose(reference.recordId, reference.slotId, 1, otherThreadId)).toBe(false);
    expect(await store.modernWorkerMayClose(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(true);
    expect((await store.reconcileModernWorkers([{ ...reference, state: 'bound' }])).records).toEqual([]);
    expect((await store.reconcileModernWorkers([{ ...reference, generation: 2, state: 'terminal' }])).releasedSlotIds).toEqual([]);
    expect((await store.reconcileModernWorkers([{ ...reference, state: 'unknown' }])).releasedSlotIds).toEqual([]);
    expect((await store.reconcileModernWorkers([{ ...reference, state: 'terminal' }])).releasedAuthorizationIds).toEqual(['authorization-1']);
    expect((await store.reconcileModernWorkers([{ ...reference, state: 'terminal' }])).releasedAuthorizationIds).toEqual([]);
    expect(await store.get(claimed.record.id)).toMatchObject({ state: 'canceled', workers: [{ process: 'canceled', bindingState: 'TERMINAL', capacityReleased: true }] });
  }));

  it('recovers thread-created/ack-write-failed crash without creating replacement', async () => fixture(async (filePath) => {
    let failWrite = false;
    const store = createTeamLifecycleStore({ filePath, durableWrite: (...args) => {
      if (failWrite) throw new Error('ack persistence failed');
      atomicDurableWrite(...args);
    } });
    const claimed = await store.claim(modernClaimInput());
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    failWrite = true;
    await expect(store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, reservation.threadId)).rejects.toThrow('ack persistence failed');
    expect((await store.get(claimed.record.id))?.workers[0]).toMatchObject({ bindingState: 'CREATING', capacityReleased: false });
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect(await restarted.reserveModernWorker(claimed.record.id, 'slot-1')).toMatchObject({ threadId: reservation.threadId, mayCreate: false });
    await restarted.reconcileModernWorkers([{ recordId: claimed.record.id, slotId: 'slot-1', threadId: reservation.threadId, generation: 1, state: 'bound' }]);
    expect(await restarted.findModernWorkerBinding(reservation.threadId, 'project-1')).toMatchObject({ generation: 1 });
  }));

  it('recovers bound evidence, marks uncertainty, and forbids generic Modern process reaping', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const claimed = await store.claim(modernClaimInput());
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    const reference = { recordId: claimed.record.id, slotId: 'slot-1', generation: 1, threadId: reservation.threadId };
    expect(await store.workerMaySpawn(reference.recordId, reference.slotId)).toBe(false);
    expect(await store.claimWorkerRunning(reference.recordId, reference.slotId)).toBe(false);
    await expect(store.updateWorker(reference.recordId, reference.slotId, { process: 'spawn-failed' })).rejects.toThrow('generation-fenced');
    expect(await store.markModernWorkerUncertain(reference.recordId, reference.slotId, 2, reference.threadId)).toBe(false);
    expect(await store.markModernWorkerUncertain(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(true);
    const uncertain = await store.get(reference.recordId);
    expect(await store.markModernWorkerUncertain(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(true);
    expect(await store.get(reference.recordId)).toEqual(uncertain);
    await store.reconcileModernWorkers([{ ...reference, state: 'bound' }]);
    expect(await store.findModernWorkerBinding(reference.threadId, 'project-1')).toMatchObject({ generation: 1 });
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect(await restarted.findModernWorkerBinding(reference.threadId, 'project-1')).toBeUndefined();
    await restarted.reconcileModernWorkers([{ ...reference, state: 'bound' }]);
    await restarted.reconcileModernWorkers([{ ...reference, state: 'unknown' }]);
    expect(await restarted.findModernWorkerBinding(reference.threadId, 'project-1')).toBeUndefined();
    await restarted.reconcileModernWorkers([{ ...reference, state: 'terminal' }]);
    expect(await restarted.markModernWorkerUncertain(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(false);
    expect(await restarted.acknowledgeModernWorker(reference.recordId, reference.slotId, 1, reference.threadId)).toBe(false);
    expect(await restarted.reserveModernWorker(reference.recordId, reference.slotId)).toBeUndefined();
  }));

  it('preserves Modern capacity through failed completion and restores it after crash', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const claimed = await store.claim(pendingClaimInput('principal-modern'));
    await store.addWorker(claimed.record.id, modernClaimInput().workers[0]);
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    await store.complete(claimed.record.id, { ok: false, code: 'TIMEOUT', message: 'create outcome unknown' },
      { ...completedResult().value, launched: 0, workers: [] });
    const restored: string[][] = [];
    const integration = createTeamLifecycleIntegration({
      store: createTeamLifecycleStore({ filePath }), isLiveSession: () => false, closeSession: async () => false,
      releaseCapacity: () => { throw new Error('must retain uncertain capacity'); },
      restoreCapacity: (_capacity, active) => restored.push([...active])
    });
    await integration.reconcileStartup([]);
    expect(restored).toEqual([['authorization-1']]);
    expect(await store.get(claimed.record.id)).toMatchObject({ capacity: { launched: 1 }, workers: [{ threadId: reservation.threadId, capacityReleased: false }] });
  }));

  it('bounds reconciliation and rejects invalid generation, thread, context and duplicate identities', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const input = modernClaimInput();
    input.workers[0].modernContext = { ...modernContext, projectId: 'wrong-project' };
    await expect(store.claim(input)).rejects.toThrow('invalid team worker lifecycle state');
    const claimed = await store.claim(modernClaimInput());
    await expect(store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, 'not-uuid')).rejects.toThrow('invalid modern thread id');
    await expect(store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 0, threadId)).rejects.toThrow('invalid modern worker generation');
    const reference = { recordId: claimed.record.id, slotId: 'slot-1', generation: 1, threadId, state: 'unknown' as const };
    await expect(store.reconcileModernWorkers(Array(101).fill(reference))).rejects.toThrow('invalid modern reconciliation batch');
    await expect(store.reconcileModernWorkers([{ ...reference, state: 'bad' as 'unknown' }])).rejects.toThrow('invalid modern observation');
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    const other = modernClaimInput();
    other.launchRequestId = 'request-other';
    other.launchResult.launchRequestId = 'request-other';
    other.workers[0] = { ...other.workers[0], process: 'running', bindingState: 'BOUND', generation: 1, threadId: reservation.threadId };
    await expect(store.claim(other)).rejects.toThrow('duplicate modern thread identity');
  }));

  it('bounds Modern slot capacity and releases never-issued intent safely', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const uncounted = modernClaimInput();
    uncounted.capacity!.launched = 0;
    await expect(store.claim(uncounted)).rejects.toThrow('capacity exhausted');
    const claimed = await store.claim({ ...pendingClaimInput('principal-modern'), capacity: {
      principal: { ...runCapacity, maxConcurrent: 1, maxLaunchesPerRun: 1 }, launched: 0
    } });
    await store.addWorker(claimed.record.id, modernClaimInput().workers[0]);
    const worker = modernClaimInput().workers[0];
    await expect(store.addWorker(claimed.record.id, { ...worker, slotId: 'slot-2', sessionId: 'session-2', authorizationId: 'authorization-2' }))
      .rejects.toThrow('capacity exhausted');
    const canceled = await store.fenceCancel(claimed.record.id);
    expect(canceled).toMatchObject({ state: 'canceled', releasedSlotIds: ['slot-1'], workers: [{ generation: 0, bindingState: 'TERMINAL' }] });
    expect((await store.fenceCancel(claimed.record.id)).releasedSlotIds).toEqual([]);
    expect(await store.reserveModernWorker(claimed.record.id, 'slot-1')).toBeUndefined();
  }));
});

describe('team lifecycle integration', () => {
  it('updates exit and blocked attention, releasing capacity only on first terminal transition', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await markClaimedWorkerRunning(store, claimed.record.id);
    await store.complete(claimed.record.id, completedResult());
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store,
      isLiveSession: () => true,
      closeSession: async () => true,
      releaseCapacity: (authorizationId) => released.push(authorizationId)
    });
    integration.track((await store.get(claimed.record.id))!);

    await integration.onAgentStatus('session-1', 'blocked');
    expect(await store.get(claimed.record.id)).toMatchObject({ workers: [{ attention: 'blocked', process: 'running', capacityReleased: false }] });
    expect(released).toEqual([]);
    await integration.onAgentStatus('session-1', 'working');
    await integration.onSessionExit('session-1');
    await integration.onSessionExit('session-1');

    expect(await store.get(claimed.record.id)).toMatchObject({ workers: [{ attention: 'active', process: 'exited', capacityReleased: true }] });
    expect(released).toEqual(['authorization-1']);
  }));

  it('captures PTY exit detail (exitCode/signal/reason) on the worker at onSessionExit', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await markClaimedWorkerRunning(store, claimed.record.id);
    await store.complete(claimed.record.id, completedResult());
    const integration = createTeamLifecycleIntegration({
      store,
      isLiveSession: () => true,
      closeSession: async () => true,
      releaseCapacity: () => {}
    });
    integration.track((await store.get(claimed.record.id))!);

    await integration.onSessionExit('session-1', {
      exitCode: 1,
      signal: 0,
      reason: 'OpenCode rejected an unsupported flag and exited.'
    });

    expect(await store.get(claimed.record.id)).toMatchObject({
      workers: [{
        process: 'exited',
        exitCode: 1,
        exitSignal: 0,
        exitReason: 'OpenCode rejected an unsupported flag and exited.'
      }]
    });
  }));

  it('authorizes cancellation by stored principal and request, closes only that request, and is idempotent', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, id: () => `record-${++next}` });
    const a = await store.claim(withIdentity(claimInput('principal-a'), 'a'));
    const b = await store.claim(withIdentity(claimInput('principal-b'), 'b'));
    await markClaimedWorkerRunning(store, a.record.id, 'slot-a');
    await markClaimedWorkerRunning(store, b.record.id, 'slot-b');
    await store.complete(a.record.id, { ok: true, value: a.record.launchResult });
    await store.complete(b.record.id, { ok: true, value: b.record.launchResult });
    const closed: string[] = [];
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store,
      isLiveSession: () => true,
      closeSession: async (sessionId) => { closed.push(sessionId); return true; },
      releaseCapacity: (authorizationId) => released.push(authorizationId)
    });
    integration.track((await store.get(a.record.id))!);
    integration.track((await store.get(b.record.id))!);

    expect(await integration.cancelTeamLaunch('principal-a', 'request-b')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await integration.cancelTeamLaunch('principal-b', 'request-a')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(closed).toEqual([]);
    expect(await integration.cancelTeamLaunch('principal-a', 'request-a')).toEqual({
      ok: true, canceledSessionIds: ['session-a'], pendingSessionIds: [], lifecycleState: 'cancel-pending'
    });
    expect(await integration.cancelTeamLaunch('principal-a', 'request-a')).toEqual({
      ok: true, canceledSessionIds: [], pendingSessionIds: [], lifecycleState: 'cancel-pending'
    });
    expect(closed).toEqual(['session-a']);
    expect(released).toEqual([]);
    await integration.onSessionExit('session-a');
    expect(released).toEqual(['authorization-a']);
    expect(await store.get(a.record.id)).toMatchObject({ state: 'canceled', workers: [{ process: 'canceled' }] });
    expect(await store.get(b.record.id)).toMatchObject({ state: 'active', workers: [{ process: 'running' }] });
  }));

  it('atomically denies spawn after cancellation claims lifecycle state', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await store.updateWorker(claimed.record.id, 'slot-1', { process: 'spawning' });
    expect(await store.workerMaySpawn(claimed.record.id, 'slot-1')).toBe(true);
    await store.cancel(claimed.record.id);
    expect(await store.workerMaySpawn(claimed.record.id, 'slot-1')).toBe(false);
    expect(await store.claimWorkerRunning(claimed.record.id, 'slot-1')).toBe(false);
  }));

  it('atomically claims a spawned worker before reporting launch success', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await store.updateWorker(claimed.record.id, 'slot-1', { process: 'spawning' });
    expect(await store.claimWorkerRunning(claimed.record.id, 'slot-1')).toBe(true);
    expect(await store.claimWorkerRunning(claimed.record.id, 'slot-1')).toBe(false);
    expect(await store.get(claimed.record.id)).toMatchObject({ workers: [{ process: 'running' }] });
  }));

  it('keeps worker live and capacity reserved when close fails, then releases only after exit', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await markClaimedWorkerRunning(store, claimed.record.id);
    await store.complete(claimed.record.id, completedResult());
    let closeSucceeds = false;
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store,
      isLiveSession: () => true,
      closeSession: async () => closeSucceeds,
      releaseCapacity: (authorizationId) => released.push(authorizationId)
    });
    integration.track((await store.get(claimed.record.id))!);

    expect(await integration.cancelTeamLaunch('principal-a', 'request-1')).toEqual({
      ok: true, canceledSessionIds: [], pendingSessionIds: ['session-1'], lifecycleState: 'cancel-pending'
    });
    expect(await store.get(claimed.record.id)).toMatchObject({ state: 'cancel-pending', workers: [{ process: 'running', capacityReleased: false }] });
    expect(released).toEqual([]);

    closeSucceeds = true;
    expect(await integration.cancelTeamLaunch('principal-a', 'request-1')).toEqual({
      ok: true, canceledSessionIds: ['session-1'], pendingSessionIds: [], lifecycleState: 'cancel-pending'
    });
    expect(await store.get(claimed.record.id)).toMatchObject({ workers: [{ process: 'running', capacityReleased: false }] });
    expect(released).toEqual([]);

    await integration.onSessionExit('session-1');
    expect(await store.get(claimed.record.id)).toMatchObject({ state: 'canceled', workers: [{ process: 'canceled', capacityReleased: true }] });
    expect(released).toEqual(['authorization-1']);
  }));

  it('retains only the named orchestrator when requested during completion cleanup', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-a');
    input.launchResult = {
      ...input.launchResult,
      orchestratorSessionId: 'orchestrator-session',
      launched: 2,
      workers: [...input.launchResult.workers, {
        sessionId: 'orchestrator-session', cohortId: 'cohort-1', slotId: 'orchestrator', personaId: 'orchestrator',
        projectId: 'project-1', authorizationId: 'authorization-orchestrator'
      }]
    };
    input.workers = [...input.workers, {
      sessionId: 'orchestrator-session', cohortId: 'cohort-1', slotId: 'orchestrator', personaId: 'orchestrator',
      projectId: 'project-1', authorizationId: 'authorization-orchestrator', process: 'authorized',
      attention: 'active', task: 'unknown', delivery: 'bound-at-spawn'
    }];
    input.capacity!.launched = 2;
    const claimed = await store.claim(input);
    await markClaimedWorkerRunning(store, claimed.record.id);
    await markClaimedWorkerRunning(store, claimed.record.id, 'orchestrator');
    await store.complete(claimed.record.id, { ok: true, value: claimed.record.launchResult });
    const closed: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store, isLiveSession: () => true, closeSession: async (sessionId) => { closed.push(sessionId); return true; }, releaseCapacity: () => undefined
    });
    integration.track((await store.get(claimed.record.id))!);

    expect(await integration.cancelTeamLaunch('principal-a', 'request-1', { retainOrchestrator: true }))
      .toMatchObject({ canceledSessionIds: ['session-1'] });
    expect(closed).toEqual(['session-1']);
    expect(await store.get(claimed.record.id)).toMatchObject({
      workers: [{ sessionId: 'session-1', process: 'running' }, { sessionId: 'orchestrator-session', process: 'running' }]
    });
  }));

  it('keeps retained orchestrator capacity held until its session exits', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-a');
    input.launchResult = {
      ...input.launchResult,
      orchestratorSessionId: 'orchestrator-session',
      launched: 2,
      workers: [...input.launchResult.workers, {
        sessionId: 'orchestrator-session', cohortId: 'cohort-1', slotId: 'orchestrator', personaId: 'orchestrator',
        projectId: 'project-1', authorizationId: 'authorization-orchestrator'
      }]
    };
    input.workers = [...input.workers, {
      sessionId: 'orchestrator-session', cohortId: 'cohort-1', slotId: 'orchestrator', personaId: 'orchestrator',
      projectId: 'project-1', authorizationId: 'authorization-orchestrator', process: 'authorized',
      attention: 'active', task: 'unknown', delivery: 'bound-at-spawn'
    }];
    input.capacity!.launched = 2;
    const claimed = await store.claim(input);
    await markClaimedWorkerRunning(store, claimed.record.id);
    await markClaimedWorkerRunning(store, claimed.record.id, 'orchestrator');
    await store.complete(claimed.record.id, { ok: true, value: claimed.record.launchResult });
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store, isLiveSession: () => true, closeSession: async () => true, releaseCapacity: (id) => { released.push(id); }
    });
    integration.track((await store.get(claimed.record.id))!);

    await integration.cancelTeamLaunch('principal-a', 'request-1', { retainOrchestrator: true });
    expect(released).not.toContain('authorization-orchestrator');
    const exited = await store.updateWorker(claimed.record.id, 'orchestrator', { process: 'exited' });
    expect(exited.capacityReleasedNow).toBe(true);
  }));

  it('closes all sessions when orchestrator retention lacks a named orchestrator', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await markClaimedWorkerRunning(store, claimed.record.id);
    await store.complete(claimed.record.id, completedResult());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const closed: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store, isLiveSession: () => true, closeSession: async (sessionId) => { closed.push(sessionId); return true; }, releaseCapacity: () => undefined
    });
    integration.track((await store.get(claimed.record.id))!);

    await integration.cancelTeamLaunch('principal-a', 'request-1', { retainOrchestrator: true });
    expect(closed).toEqual(['session-1']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retainOrchestrator requested'));
    warn.mockRestore();
  }));

  it('keeps post-spawn cancellation pending and retryable when remote termination fails', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    await store.updateWorker(claimed.record.id, 'slot-1', { process: 'spawning' });
    await store.cancel(claimed.record.id);
    await store.complete(claimed.record.id, {
      ok: false,
      code: 'TEAM_LAUNCH_FAILED',
      message: 'slot-1: cleanup pending'
    }, { ...claimed.record.launchResult, workers: [], launched: 0 });
    const released: string[] = [];
    let closeSucceeds = false;
    const integration = createTeamLifecycleIntegration({
      store,
      isLiveSession: () => true,
      closeSession: async () => closeSucceeds,
      releaseCapacity: (authorizationId) => released.push(authorizationId)
    });
    integration.track((await store.get(claimed.record.id))!);

    expect(await integration.cancelTeamLaunch('principal-a', 'request-1')).toEqual({
      ok: true, canceledSessionIds: [], pendingSessionIds: ['session-1'], lifecycleState: 'cancel-pending'
    });
    expect(await store.get(claimed.record.id)).toMatchObject({
      state: 'cancel-pending',
      workers: [{ process: 'spawning', capacityReleased: false }]
    });
    expect(released).toEqual([]);

    closeSucceeds = true;
    expect(await integration.cancelTeamLaunch('principal-a', 'request-1')).toEqual({
      ok: true, canceledSessionIds: ['session-1'], pendingSessionIds: [], lifecycleState: 'cancel-pending'
    });
    await integration.onSessionExit('session-1');
    expect(await store.get(claimed.record.id)).toMatchObject({
      state: 'canceled',
      workers: [{ process: 'canceled', capacityReleased: true }]
    });
    expect(released).toEqual(['authorization-1']);
  }));

  it('reconciles restart against live sessions, rebuilds tracking, and releases missing capacity once', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createTeamLifecycleStore({ filePath, id: () => `record-${++next}` });
    const live = await store.claim(withIdentity(claimInput('principal-live'), 'live'));
    const missing = await store.claim(withIdentity(claimInput('principal-missing'), 'missing'));
    await markClaimedWorkerRunning(store, live.record.id, 'slot-live');
    await markClaimedWorkerRunning(store, missing.record.id, 'slot-missing');
    await store.complete(live.record.id, { ok: true, value: live.record.launchResult });
    await store.complete(missing.record.id, { ok: true, value: missing.record.launchResult });
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store,
      isLiveSession: (sessionId) => sessionId === 'session-live',
      closeSession: async () => true,
      releaseCapacity: (authorizationId) => released.push(authorizationId)
    });

    await integration.reconcileStartup(['session-live']);
    await integration.reconcileStartup(['session-live']);
    expect(await store.get(live.record.id)).toMatchObject({ workers: [{ process: 'running', capacityReleased: false }] });
    expect(await store.get(missing.record.id)).toMatchObject({ workers: [{ process: 'exited', capacityReleased: true }] });
    expect(released).toEqual(['authorization-missing']);

    await integration.onSessionExit('session-live');
    expect(released).toEqual(['authorization-missing', 'authorization-live']);
  }));

  it('reconstructs persisted Team run capacity before accepting new launches', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(pendingClaimInput('principal-a'));
    await store.addWorker(claimed.record.id, {
      sessionId: 'session-live', cohortId: 'cohort-1', slotId: 'slot-live', personaId: 'persona-1',
      projectId: 'project-1', authorizationId: 'authorization-live', process: 'running', attention: 'active',
      task: 'unknown', delivery: 'bound-at-spawn'
    });
    const restored: Array<{ principalId: string; launched: number; active: string[] }> = [];
    const restarted = createTeamLifecycleIntegration({
      store: createTeamLifecycleStore({ filePath }), isLiveSession: () => true, closeSession: async () => true,
      releaseCapacity: () => undefined,
      restoreCapacity: (capacity, active) => restored.push({
        principalId: capacity.principal.id, launched: capacity.launched, active: [...active]
      })
    });

    await restarted.reconcileStartup(['session-live']);

    expect(restored).toEqual([{ principalId: runCapacity.id, launched: 1, active: ['authorization-live'] }]);
  }));

  it('uses Modern thread liveness and termination callbacks for Modern workers', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-modern');
    input.workers[0] = {
      ...input.workers[0], transport: 'MODERN', threadId, generation: 4, bindingState: 'BOUND', process: 'running',
      modernContext
    };
    input.capacity!.launched = 1;
    const claimed = await store.claim(input);
    await store.complete(claimed.record.id, { ok: true, value: claimed.record.launchResult });
    const checked: string[] = [];
    const closed: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store, isLiveSession: () => { throw new Error('CLI liveness must not run'); }, closeSession: async () => true,
      isLiveModernThread: (threadId, _projectId, generation) => { checked.push(`${threadId}:${generation}`); return true; },
      closeModernThread: async (threadId, _projectId, generation) => { closed.push(`${threadId}:${generation}`); return true; },
      releaseCapacity: () => undefined
    });
    integration.track((await store.get(claimed.record.id))!);

    expect(await integration.cancelTeamLaunch('principal-modern', 'request-1')).toMatchObject({ ok: true, canceledSessionIds: ['session-1'] });
    expect(checked).toEqual([]);
    expect(closed).toEqual([`${threadId}:4`]);
  }));

  it('indexes acknowledged Modern workers by ACP thread identity for execution routing', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const input = claimInput('principal-modern');
    input.workers[0] = {
      ...input.workers[0], transport: 'MODERN', threadId, generation: 4,
      bindingState: 'BOUND', process: 'running',
      modernContext
    };
    input.capacity!.launched = 1;
    const claimed = await store.claim(input);
    const integration = createTeamLifecycleIntegration({ store, isLiveSession: () => false, closeSession: async () => false, releaseCapacity: () => undefined });
    integration.track(claimed.record);
    await expect(integration.resolveModernBinding(threadId, 'project-1')).resolves.toMatchObject({ executionId: 'execution-1', slotId: 'slot-1', role: 'worker', generation: 4 });
    await expect(integration.resolveModernBinding('session-1', 'project-1')).resolves.toBeUndefined();
  }));

  it('rejects stale cache authority after uncertainty and cancel, including out-of-order tracking', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const claimed = await store.claim(modernClaimInput());
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    const integration = createTeamLifecycleIntegration({ store, isLiveSession: () => false, closeSession: async () => false, releaseCapacity: () => undefined });
    integration.track(reservation.record);
    expect(integration.isTracked(reservation.threadId)).toBe(false);
    await store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, reservation.threadId);
    const bound = (await store.get(claimed.record.id))!;
    integration.track(bound);
    expect(integration.isTracked(reservation.threadId)).toBe(true);
    expect(integration.isTracked('session-1')).toBe(true);
    await store.markModernWorkerUncertain(claimed.record.id, 'slot-1', 1, reservation.threadId);
    await expect(integration.resolveModernBinding(reservation.threadId, 'project-1')).resolves.toBeUndefined();
    integration.track((await store.get(claimed.record.id))!);
    integration.track(bound);
    expect(integration.isTracked(reservation.threadId)).toBe(false);
    expect(integration.isTracked('session-1')).toBe(false);
    await store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, reservation.threadId);
    await store.fenceCancel(claimed.record.id);
    await expect(integration.resolveModernBinding(reservation.threadId, 'project-1')).resolves.toBeUndefined();
  }));

  it.each(['absent', 'false', 'throw', 'closed'] as const)('keeps Modern capacity when runtime is %s until attested terminal', async (runtime) => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    const claimed = await store.claim(modernClaimInput());
    const reservation = (await store.reserveModernWorker(claimed.record.id, 'slot-1'))!;
    await store.acknowledgeModernWorker(claimed.record.id, 'slot-1', 1, reservation.threadId);
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({
      store, isLiveSession: () => { throw new Error('CLI must not run'); }, closeSession: async () => false,
      isLiveModernThread: () => false,
      ...(runtime === 'absent' ? {} : { closeModernThread: async () => {
        if (runtime === 'throw') throw new Error('runtime stopped');
        return runtime === 'closed';
      } }),
      releaseCapacity: (authorizationId) => released.push(authorizationId)
    });
    integration.track((await store.get(claimed.record.id))!);
    const result = await integration.cancelTeamLaunch('principal-modern', 'request-1');
    expect(result).toMatchObject({ lifecycleState: 'cancel-pending', pendingSessionIds: runtime === 'closed' ? [] : ['session-1'] });
    expect(integration.isTracked(reservation.threadId)).toBe(false);
    await integration.onSessionExit(reservation.threadId);
    await integration.onSessionExit('session-1');
    expect(released).toEqual([]);
    expect((await store.get(claimed.record.id))?.workers[0].capacityReleased).toBe(false);
    const observation = { recordId: claimed.record.id, slotId: 'slot-1', generation: 1, threadId: reservation.threadId, state: 'terminal' as const };
    await integration.reconcileModernWorkers([observation]);
    await integration.reconcileModernWorkers([observation]);
    expect(released).toEqual(['authorization-1']);
    expect(await store.modernWorkerMayClose(claimed.record.id, 'slot-1', 1, reservation.threadId)).toBe(false);
  }));

  it('releases Modern pre-create cancellation once without calling runtime', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath });
    await store.claim(modernClaimInput());
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({ store, isLiveSession: () => false, closeSession: async () => false,
      closeModernThread: async () => { throw new Error('no create was issued'); }, releaseCapacity: (authorizationId) => released.push(authorizationId) });
    await integration.cancelTeamLaunch('principal-modern', 'request-1');
    await integration.cancelTeamLaunch('principal-modern', 'request-1');
    expect(released).toEqual(['authorization-1']);
  }));

  it('returns caller-scoped lifecycle state and records task outcome once', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    const claimed = await store.claim(claimInput('principal-a'));
    const integration = createTeamLifecycleIntegration({
      store, isLiveSession: () => true, closeSession: async () => true, releaseCapacity: () => undefined
    });

    expect(await integration.getTeamLaunch('principal-b', 'request-1')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await integration.reportTeamTask('principal-b', 'request-1', 'slot-1', 'complete'))
      .toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await integration.reportTeamTask('principal-a', 'request-1', 'slot-1', 'complete'))
      .toMatchObject({ ok: true, record: { workers: [{ task: 'caller-reported-complete' }] } });
    await expect(integration.reportTeamTask('principal-a', 'request-1', 'slot-1', 'failed'))
      .rejects.toThrow('invalid worker task transition');
    expect(await integration.getTeamLaunch('principal-a', 'request-1'))
      .toMatchObject({ ok: true, record: { id: claimed.record.id } });
  }));

  it('accepts a task report only from the exact spawned worker session', async () => fixture(async (filePath) => {
    const store = createTeamLifecycleStore({ filePath, id: () => 'record-1' });
    await store.claim(claimInput('principal-a'));
    const integration = createTeamLifecycleIntegration({ store, isLiveSession: () => true, closeSession: async () => true, releaseCapacity: () => undefined });
    await expect(integration.reportWorkerTask('other-session', 'request-1', 'slot-1', 'complete')).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(integration.reportWorkerTask('session-1', 'request-1', 'slot-1', 'complete')).resolves.toMatchObject({ ok: true, record: { workers: [{ task: 'caller-reported-complete' }] } });
  }));
});
