import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, EXECUTION_RECOVERY_TTL_MS, KICKOFF_FAILURE_BLOCK_THRESHOLD } from '../store.js';
import { usageRollup } from '../contracts.js';
import { MAX_TEAM_INITIAL_TASK_BYTES } from '../../launch/team-lifecycle-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

function request() {
  return {
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
  };
}

/**
 * Drive a work unit through `count` NEVER-TURNED claim→reclaim cycles — the
 * kickoff-churn signature (worker accepts the assignment, never starts a turn,
 * gets reclaimed). Returns the record with `kickoffFailures === count`, unit READY.
 */
async function accumulateKickoffFailures(store: ReturnType<typeof createExecutionStore>, count: number) {
  let record = (await store.claim(request())).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
  for (let i = 0; i < count; i++) {
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: 'dead', force: true }]);
  }
  return record;
}

describe('execution store', () => {
  it('persists immutable usage deltas with exact replay and explicit reset epochs', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    const record = (await store.claim(request())).record;
    const base = {
      observationId: 'observation-1', executionAttempt: 1, role: 'worker' as const, slotId: 'slot-1', sessionId: 'session-1',
      workUnitId: 'unit', workAttempt: 1, claimGeneration: 1, adapterEpoch: 0, sampleKind: 'heartbeat' as const, sequence: 1,
      provider: 'provider', model: 'model', routingIdentity: 'route', cumulative: { inputTokens: 10 }, completeness: 'complete' as const, observedAt: 10
    };
    const first = await store.appendUsageObservation(record.id, base);
    expect(first).toMatchObject({ outcome: 'accepted', observation: { delta: { inputTokens: 10 }, adapterEpoch: 0 } });
    expect(first.record.stateVersion).toBe(record.stateVersion);
    await expect(store.appendUsageObservation(record.id, base)).resolves.toMatchObject({ outcome: 'replay' });
    await expect(store.appendUsageObservation(record.id, { ...base, cumulative: { inputTokens: 11 } })).rejects.toThrow('usage observation conflict');
    await expect(store.appendUsageObservation(record.id, { ...base, observationId: 'tuple-conflict' })).rejects.toThrow('usage observation sequence conflict');
    const second = await store.appendUsageObservation(record.id, { ...base, observationId: 'observation-2', sequence: 2, cumulative: { inputTokens: 15 } });
    expect(second.observation.delta).toEqual({ inputTokens: 5 });
    await expect(store.appendUsageObservation(record.id, { ...base, observationId: 'delayed-regression', sequence: 3, cumulative: { inputTokens: 2 } })).rejects.toThrow('usage counter regression without newer adapter epoch');
    const reset = await store.appendUsageObservation(record.id, { ...base, observationId: 'observation-3', adapterEpoch: 1, sequence: 1, cumulative: { inputTokens: 2 } });
    expect(reset.observation).toMatchObject({ adapterEpoch: 1, gap: 'regression', delta: { inputTokens: 2 } });
    await expect(store.appendUsageObservation(record.id, { ...base, observationId: 'stale', sequence: 1, cumulative: { inputTokens: 10 } })).rejects.toThrow('usage observation epoch conflict');
  }));

  it('rejects changed delayed sequences instead of creating reset epochs', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(request())).record;
    const sample = (observationId: string, sequence: number, inputTokens: number) => ({
      observationId, executionAttempt: 1, role: 'worker' as const, slotId: 'slot-1', sessionId: 'session-1', workAttempt: 0,
      claimGeneration: 0, adapterEpoch: 0, sampleKind: 'heartbeat' as const, sequence, provider: 'p', routingIdentity: 'r',
      cumulative: { inputTokens }, completeness: 'complete' as const, observedAt: sequence
    });
    await store.appendUsageObservation(record.id, sample('one', 1, 10));
    await store.appendUsageObservation(record.id, sample('two', 2, 20));
    await expect(store.appendUsageObservation(record.id, sample('delayed', 1, 5))).rejects.toThrow('usage observation sequence conflict');
    await expect(store.appendUsageObservation(record.id, sample('two', 2, 20))).resolves.toMatchObject({ outcome: 'replay' });
  }));

  it('preserves compacted usage replay identity and rejects changed delayed payloads', async () => fixture(async (filePath) => {
    const observationCap = 3;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10, maxUsageObservationsPerExecution: observationCap });
    const record = (await store.claim(request())).record;
    const sample = (sequence: number) => ({
      observationId: `observation-${sequence}`, executionAttempt: 1, role: 'worker' as const, slotId: 'slot-1', sessionId: 'session-1',
      workAttempt: 0, claimGeneration: 0, adapterEpoch: 0, sampleKind: 'heartbeat' as const, sequence,
      provider: 'provider', model: 'model', routingIdentity: 'route', cumulative: { inputTokens: sequence }, completeness: 'complete' as const, observedAt: sequence
    });
    for (let sequence = 1; sequence <= observationCap + 1; sequence += 1) {
      await store.appendUsageObservation(record.id, sample(sequence));
    }
    const compacted = await store.get(record.id);
    expect(compacted?.usageBaseline?.cursors?.[0]).toMatchObject({ sequence: 1, observationId: 'observation-1' });
    await expect(store.appendUsageObservation(record.id, sample(1))).resolves.toMatchObject({ outcome: 'replay' });
    await expect(store.appendUsageObservation(record.id, { ...sample(1), cumulative: { inputTokens: 999 } })).rejects.toThrow('usage observation conflict');
    expect((await store.get(record.id))?.usageBaseline?.gapCount).toBe(0);
  }));

  it('coalesces typed wake keys while preserving bounded FIFO acknowledgement', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(request())).record;
    const wake = { cause: 'TYPED_OUTPUT_REPAIR' as const, message: 'repair', workUnitId: 'unit', stateOrClaimGeneration: '1' };
    const first = await store.queueCoordinatorWake(record.id, wake);
    const duplicate = await store.queueCoordinatorWake(record.id, wake);
    expect(duplicate.stateVersion).toBe(first.stateVersion);
    expect(duplicate.coordinatorWakes).toHaveLength(1);
    expect(duplicate.coordinatorWakes?.[0]).toMatchObject({ version: 1, cause: 'TYPED_OUTPUT_REPAIR', workUnitId: 'unit' });
  }));

  it('keeps typed completion claim active for two unique repairs then fails and fences it', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{
      id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true,
      output: { version: 1, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }
    }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claim = { claimId: record.workUnits![0].claimId!, claimGeneration: record.workUnits![0].claimGeneration! };
    const first = await store.recordOutputRepair(record.id, record.stateVersion, 'unit', claim, `sha256:${'1'.repeat(64)}`);
    expect(first).toMatchObject({ outcome: 'accepted', record: { workUnits: [{ state: 'CLAIMED' }] } });
    await expect(store.recordOutputRepair(record.id, first.record.stateVersion, 'unit', claim, `sha256:${'1'.repeat(64)}`)).resolves.toMatchObject({ outcome: 'replay' });
    const second = await store.recordOutputRepair(record.id, first.record.stateVersion, 'unit', claim, `sha256:${'2'.repeat(64)}`);
    const exhausted = await store.recordOutputRepair(record.id, second.record.stateVersion, 'unit', claim, `sha256:${'3'.repeat(64)}`);
    expect(exhausted).toMatchObject({ outcome: 'exhausted', record: { workUnits: [{ state: 'FAILED', failureCode: 'VALIDATION_FAILED' }] } });
    await expect(store.recordOutputRepair(record.id, exhausted.record.stateVersion, 'unit', claim, `sha256:${'4'.repeat(64)}`)).rejects.toThrow('work unit is not claimed');
  }));

  it('persists assembled terminal result separately and one evaluator-version proposal', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 50 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, verification: ['test'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'done');
    record = await store.completeExecution(record.id, record.stateVersion, 'legacy summary', [{ name: 'report', mediaType: 'text/plain', contentDigest: `sha256:${'1'.repeat(64)}` } as never]);
    expect(record).toMatchObject({ finalSummary: 'legacy summary', assembledResult: { outcome: 'success', summary: 'legacy summary', units: [{ id: 'unit', result: 'done' }] } });
    const evaluated = await store.setRouteFitProposal(record.id);
    expect(evaluated.routeFitProposal).toMatchObject({ evaluatorVersion: 'route-fit-v1', active: false, fit: 'indeterminate' });
    await expect(store.setRouteFitProposal(record.id, { ...evaluated.routeFitProposal!, fit: 'appropriate' })).resolves.toEqual(evaluated);
  }));

  it('rejects malformed assembled-result members on durable load', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.completeExecution(record.id, record.stateVersion, 'done');
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    durable.records[0].assembledResult.units = [{ id: 7, title: 'bad', state: 'COMPLETED' }];
    await writeFile(filePath, JSON.stringify(durable));
    await expect(createExecutionStore({ filePath }).get(record.id)).rejects.toThrow('corrupt execution store');
  }));
  it('rejects malformed route-fit members and proposed routing keys', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STOPPED', 'info', 'stop');
    const base = { version: 1 as const, evaluatorVersion: 'custom-v2', active: false as const, outcome: 'failure' as const, fit: 'indeterminate' as const, reason: 'none', evaluatedAt: 1, samples: 0 };
    await expect(store.setRouteFitProposal(record.id, { ...base, selected: [{ workUnitId: 7 }] } as never)).rejects.toThrow('invalid route fit proposal');
    await expect(store.setRouteFitProposal(record.id, { ...base, selected: [], proposedRouting: { minimumLevel: 'high', secret: true } } as never)).rejects.toThrow('invalid route fit proposal');
  }));
  it('queues coordinator wakes as a bounded FIFO and acknowledges by stable id', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(request())).record;
    await store.queueCoordinatorWake(record.id, 'first');
    await store.queueCoordinatorWake(record.id, 'second');
    let queued = await store.get(record.id);
    expect(queued?.coordinatorWakes).toEqual([
      expect.objectContaining({ id: 'execution-1:wake:1', message: 'first' }),
      expect.objectContaining({ id: 'execution-1:wake:2', message: 'second' })
    ]);
    await store.acknowledgeCoordinatorWake(record.id, 'execution-1:wake:1');
    queued = await store.get(record.id);
    expect(queued?.coordinatorWakes?.map((wake) => wake.message)).toEqual(['second']);
    await store.acknowledgeCoordinatorWake(record.id, 'execution-1:wake:1');
    expect((await store.get(record.id))?.coordinatorWakes?.map((wake) => wake.message)).toEqual(['second']);
    for (let index = 2; index <= 100; index += 1) await store.queueCoordinatorWake(record.id, `wake-${index}`);
    await expect(store.queueCoordinatorWake(record.id, 'overflow')).rejects.toThrow('coordinator wake queue is full');
    expect((await store.get(record.id))?.coordinatorWakes).toHaveLength(100);
  }));

  it('treats same-slot claim and completion retries as durable replays', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], files: ['unit.txt'], verification: ['check unit'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claimReplay = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    expect(claimReplay.workUnits?.[0]).toMatchObject({ state: 'CLAIMED', attempt: 1, assignedSlotId: 'worker-1' });
    record = await store.completeWork(claimReplay.id, claimReplay.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'done');
    const completeReplay = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'ignored replay');
    expect(completeReplay.workUnits?.[0]).toMatchObject({ state: 'COMPLETED', result: 'done' });
  }));

  it('mints fenced leases and coalesces heartbeats until renewal is due', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claim = record.workUnits![0];
    expect(claim).toMatchObject({ claimGeneration: 1, claimedBy: { slotId: 'worker-1' }, heartbeatAt: now, turnCount: 0 });
    const noWrite = await store.heartbeatWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', { claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, turnCount: 0 });
    expect(noWrite.stateVersion).toBe(record.stateVersion);
    now += 270_000; // within HEARTBEAT_PERSIST_REMAINING_MS of the 300_000 lease expiry → renewal due
    const renewed = await store.heartbeatWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', { claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, turnCount: 1 });
    expect(renewed.workUnits![0]).toMatchObject({ heartbeatAt: now, turnCount: 1, leaseExpiresAt: now + 300_000 });
    await expect(store.heartbeatWork(renewed.id, renewed.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', { claimId: 'stale', claimGeneration: 1 })).rejects.toThrow('stale work claim');
  }));

  it('pages claimed work and reclaims only matching expired claim fences', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const unit = record.workUnits![0];
    expect((await store.listActiveClaims(undefined, 1)).records).toHaveLength(1);
    now += 300_000; // past the default WORK_CLAIM_LEASE_MS lease window
    const unchanged = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: 'wrong', claimGeneration: unit.claimGeneration!, reason: 'dead' }]);
    expect(unchanged.workUnits![0].state).toBe('CLAIMED');
    const reclaimed = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: 'dead' }]);
    expect(reclaimed.workUnits![0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
    expect(reclaimed.workUnits![0]).not.toHaveProperty('claimId');
  }));

  it('honors an injected workClaimLeaseMs when stamping a claim lease', async () => fixture(async (filePath) => {
    // The lease TTL is injectable (default WORK_CLAIM_LEASE_MS=300_000) so the
    // built-Electron reclaim E2E can drive the real backstop in seconds.
    const now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now, workClaimLeaseMs: 2_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const unit = record.workUnits![0];
    expect(unit.claimedAt).toBe(1_000);
    expect(unit.leaseExpiresAt).toBe(3_000); // claimedAt + injected 2_000, NOT the 300_000 default
  }));

  it('rejects a non-positive workClaimLeaseMs option', async () => fixture(async (filePath) => {
    expect(() => createExecutionStore({ filePath, workClaimLeaseMs: 0 })).toThrow('invalid execution work claim lease');
    expect(() => createExecutionStore({ filePath, workClaimLeaseMs: -5 })).toThrow('invalid execution work claim lease');
    expect(() => createExecutionStore({ filePath, workClaimLeaseMs: 1.5 })).toThrow('invalid execution work claim lease');
  }));

  it('renewWorkerLease renews the active claim lease from observed worker output', async () => fixture(async (filePath) => {
    // Host wires this off PTY output activity: a live worker refreshes its lease so the
    // reconcile sweep never reclaims it as silent. Uses a short 2_000ms lease for clarity.
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now, workClaimLeaseMs: 2_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit'); // lease→3_000
    now += 1_500; // now=2_500, remaining 500ms is within HEARTBEAT_PERSIST_REMAINING_MS
    const renewed = await store.renewWorkerLease(record.id, 'worker-1');
    expect(renewed?.workUnits![0]).toMatchObject({ heartbeatAt: 2_500, leaseExpiresAt: 4_500 }); // now + 2_000
  }));

  it('renewWorkerLease is a no-op when no unit is claimed by the slot', async () => fixture(async (filePath) => {
    const now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    const record = (await store.claim(request())).record; // claimed but no plan/work claim yet
    expect(await store.renewWorkerLease(record.id, 'worker-1')).toBeUndefined();
    expect(await store.renewWorkerLease('missing', 'worker-1')).toBeUndefined();
  }));

  it('claimWork stamps progressAt at the claim time', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 4_200, workClaimLeaseMs: 2_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    expect(record.workUnits![0].progressAt).toBe(4_200);
  }));

  it('renewWorkerLease WITHOUT advanceProgress renews the lease but does NOT advance progressAt', async () => fixture(async (filePath) => {
    // The agent-state renewal path (reconcileActive) keeps a silent worker's lease
    // alive without touching progressAt, so the stall ceiling can still reclaim it.
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now, workClaimLeaseMs: 2_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit'); // progressAt=1_000, lease→3_000
    now += 1_500; // now=2_500, within HEARTBEAT_PERSIST_REMAINING_MS of expiry
    const renewed = await store.renewWorkerLease(record.id, 'worker-1'); // advanceProgress defaults off
    expect(renewed?.workUnits![0]).toMatchObject({ leaseExpiresAt: 4_500, progressAt: 1_000 }); // lease moved, progress frozen
  }));

  it('renewWorkerLease WITH advanceProgress advances progressAt (real worker output)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now, workClaimLeaseMs: 2_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit'); // lease→3_000
    now += 1_500; // now=2_500
    const renewed = await store.renewWorkerLease(record.id, 'worker-1', { advanceProgress: true });
    expect(renewed?.workUnits![0]).toMatchObject({ leaseExpiresAt: 4_500, progressAt: 2_500 });
  }));

  it('heartbeatWork advances progressAt when it mutates (a cohort worker turn is real progress)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit'); // progressAt=1_000
    const claim = record.workUnits![0];
    now += 5_000; // now=6_000
    const beat = await store.heartbeatWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', { claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, turnCount: 1 });
    expect(beat.workUnits![0].progressAt).toBe(6_000); // a turnCount bump mutates → progress advances
  }));

  it('reclaimExpiredClaims honors force to reclaim a still-fresh lease (wall-clock backstop)', async () => fixture(async (filePath) => {
    // The state-agnostic wall-clock ceiling must reclaim even a claim whose lease is fresh
    // (a worker that streams output forever, renewing its lease, yet never completes). The
    // lease-expiry floor otherwise blocks it; `force` bypasses that floor.
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit'); // lease→301_000
    const unit = record.workUnits![0];
    now += 10_000; // now=11_000, lease still fresh (< 301_000)
    const kept = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: 'ceiling' }]);
    expect(kept.workUnits![0].state).toBe('CLAIMED'); // floor blocks reclaim of a fresh lease
    const forced = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: 'ceiling', force: true }]);
    expect(forced.workUnits![0]).toMatchObject({ state: 'READY', claimGeneration: 1 });
  }));

  it('completeWork recovers a finished worker whose claim was reclaimed (non-destructive)', async () => fixture(async (filePath) => {
    // Run b56e63f5: a worker finished but a reconcile had already reclaimed its
    // silent claim, so the unit sat READY. The old code discarded the finished
    // result ('work unit is not claimed') → churn. Now the last claim holder can
    // still complete a reclaimed-but-idle unit and its real result is kept.
    const store = createExecutionStore({ filePath, id: () => 'execution' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const unit = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: 'dead', force: true }]);
    expect(record.workUnits![0].state).toBe('READY');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'done anyway');
    expect(record.workUnits![0]).toMatchObject({ state: 'COMPLETED', result: 'done anyway' });
  }));

  it('completeWork accepts a late completion of the EXACT reclaimed claim while the unit stays READY (run b56e63f5)', async () => fixture(async (filePath) => {
    // The reconcile reclaimed a still-live silent worker; the unit sits READY and has
    // NOT been re-claimed. The worker then finishes and completes under its reclaimed
    // claim (the MCP tool always passes requireClaim=true). The recorded reclaimedClaim
    // authorizes exactly this — the real result is kept, not discarded into a churn loop.
    const store = createExecutionStore({ filePath, id: () => 'execution' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const reclaimed = record.workUnits![0]; // gen 1 — the claim the worker completes under
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: reclaimed.claimId!, claimGeneration: reclaimed.claimGeneration!, reason: 'silent', force: true }]);
    expect(record.workUnits![0].state).toBe('READY');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'verified', { claimId: reclaimed.claimId!, claimGeneration: reclaimed.claimGeneration! }, true);
    expect(record.workUnits![0]).toMatchObject({ state: 'COMPLETED', result: 'verified' });
  }));

  it('completeWork REJECTS a stale-generation completion once the unit was re-claimed on the SAME slot (slot reuse; run e531f415)', async () => fixture(async (filePath) => {
    // Slot ids are reused across worker restarts: worker A is reclaimed, a replacement
    // B starts in the SAME slot and re-claims (fresh generation), then zombie A finishes
    // and tries to complete under its now-stale generation. Accepting it would clobber
    // B's live, possibly mid-edit attempt — the claim-generation fence must reject it,
    // and the unit must stay CLAIMED by B's generation.
    const store = createExecutionStore({ filePath, id: () => 'execution' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const stale = record.workUnits![0]; // gen 1 — the zombie's stale claim
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: stale.claimId!, claimGeneration: stale.claimGeneration!, reason: 'silent', force: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit'); // gen 2, same slot, replacement worker
    expect(record.workUnits![0]).toMatchObject({ state: 'CLAIMED', claimGeneration: 2, assignedSlotId: 'worker-1' });
    await expect(store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'zombie result', { claimId: stale.claimId!, claimGeneration: stale.claimGeneration! }, true))
      .rejects.toThrow('stale work claim');
    const after = await store.get(record.id);
    expect(after!.workUnits![0]).toMatchObject({ state: 'CLAIMED', claimGeneration: 2 });
    expect(after!.workUnits![0].result).toBeUndefined();
  }));

  it('completeWork never resurrects a FAILED unit from a stale worker', async () => fixture(async (filePath) => {
    // A worker whose claim was reclaimed and then FAILED (by the coordinator, or a
    // fresh worker) must not be un-failed by a late stale completion.
    const store = createExecutionStore({ filePath, id: () => 'execution' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const stale = record.workUnits![0];
    // fail the unit through a live re-claim so it is genuinely FAILED
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'gave up', 'UNKNOWN', { claimId: stale.claimId!, claimGeneration: stale.claimGeneration! }, true);
    expect(record.workUnits![0].state).toBe('FAILED');
    await expect(store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'late done', { claimId: stale.claimId!, claimGeneration: stale.claimGeneration! }, true))
      .rejects.toThrow('work unit is not claimed');
    const after = await store.get(record.id);
    expect(after!.workUnits![0]).toMatchObject({ state: 'FAILED', failure: 'gave up' });
  }));

  it('completeWork rejects recovery when a different slot has re-claimed the unit', async () => fixture(async (filePath) => {
    // Reclaimed then re-dispatched to another worker: the new holder wins (may be
    // mid-edit); the old worker's late completion must NOT clobber it.
    const store = createExecutionStore({ filePath, id: () => 'execution' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:lead' }, 'unit', 'worker-1');
    const unit = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: 'dead', force: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:lead' }, 'unit', 'worker-2');
    await expect(store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', 'late')).rejects.toThrow('work unit is assigned to another slot');
  }));

  it('completeWork rejects recovery from a slot that never held the unit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const unit = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason: 'dead', force: true }]);
    await expect(store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-9' }, 'unit', 'nope')).rejects.toThrow('work unit is not claimed');
  }));

  it('counts a never-turned reclaim as a kickoff failure (churn signature; run 47823553)', async () => fixture(async (filePath) => {
    // A worker that repeatedly accepts the unit but never starts a turn is stuck at
    // DELIVERY, not making progress. Each reclaim of a turnCount-0 claim bumps the
    // counter (captured before clearClaim wipes turnCount) so the engine can escape.
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await accumulateKickoffFailures(store, 2);
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', kickoffFailures: 2 });
  }));

  it('does NOT count a reclaim of a unit that already turned (mid-work stall is not kickoff churn)', async () => fixture(async (filePath) => {
    // Once a worker reports turnCount > 0 the kickoff succeeded; a later stall/reclaim
    // is genuine mid-work loss, NOT the never-started signature, so it must never bump
    // kickoffFailures (which would let a normal reclaim trip the human-block escape hatch).
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claim = record.workUnits![0];
    record = await store.heartbeatWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', { claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, turnCount: 1 });
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: 'dead', force: true }]);
    expect(record.workUnits![0]).toMatchObject({ state: 'READY' });
    expect(record.workUnits![0].kickoffFailures).toBeUndefined();
  }));

  it('a real worker turn clears an accumulated kickoffFailures (kickoff proven succeeded)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await accumulateKickoffFailures(store, 2); // kickoffFailures = 2, unit READY
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claim = record.workUnits![0];
    expect(claim.kickoffFailures).toBe(2); // survives the re-claim (clearClaim preserves it)
    record = await store.heartbeatWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit', { claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, turnCount: 1 });
    expect(record.workUnits![0]).toMatchObject({ turnCount: 1 });
    expect(record.workUnits![0].kickoffFailures).toBeUndefined(); // the turn cleared it
  }));

  it('blockKickoffFailure blocks to a human at the threshold and is a guarded no-op otherwise', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    // Below threshold → refuses (never spuriously blocks a still-recoverable unit).
    const below = await accumulateKickoffFailures(store, KICKOFF_FAILURE_BLOCK_THRESHOLD - 1);
    await expect(store.blockKickoffFailure(below.id, 'unit')).rejects.toThrow('kickoff failures below block threshold');
    // One more never-turned reclaim reaches the threshold → block to a human.
    let record = await store.claimWork(below.id, below.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'unit');
    const claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: 'dead', force: true }]);
    expect(record.workUnits![0].kickoffFailures).toBe(KICKOFF_FAILURE_BLOCK_THRESHOLD);
    const blocked = await store.blockKickoffFailure(record.id, 'unit');
    expect(blocked.workUnits![0]).toMatchObject({ state: 'BLOCKED' });
    expect(blocked.workUnits![0].assignedSlotId).toBeUndefined();
    expect(blocked.workUnits![0]).not.toHaveProperty('claimId');
    expect(blocked.state).toBe('BLOCKED');
    const blocker = blocked.blockers?.find((entry) => entry.workUnitId === 'unit');
    expect(blocker).toMatchObject({ audience: 'human', resolved: false });
    expect(blocker?.question).toContain('never started a turn');
    // Idempotent: escalating an already-blocked unit refuses (no dup blocker / no churn).
    await expect(store.blockKickoffFailure(record.id, 'unit')).rejects.toThrow('work unit is not blockable for kickoff failure');
  }));

  it('retryWork restores a kickoff-blocked unit to READY with a fresh kickoff budget', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await accumulateKickoffFailures(store, KICKOFF_FAILURE_BLOCK_THRESHOLD);
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.workUnits![0].state).toBe('BLOCKED');
    record = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY' });
    expect(record.workUnits![0].kickoffFailures).toBeUndefined(); // human fixed the worker → fresh budget
  }));

  it('reassignKickoffToFreshSlot re-homes a churned unit onto an untried worker slot with a fresh budget', async () => fixture(async (filePath) => {
    // SELF-HEAL: a unit that churned to the block threshold on ONE worker slot is
    // re-homed onto a DIFFERENT authorized worker slot it has not run on yet, with a
    // fresh kickoff budget — a wedged / mis-wired worker may simply not recur on a peer.
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.setAuthorizationContext(record.id, record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1' },
        { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'w2' }
      ]
    }, 'authorization-digest');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    // Churn on slot-1 to the block threshold (worker accepts each claim, never turns).
    for (let i = 0; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) {
      record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
      const claim = record.workUnits![0];
      record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: 'dead', force: true }]);
    }
    expect(record.workUnits![0].kickoffFailures).toBe(KICKOFF_FAILURE_BLOCK_THRESHOLD);
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    // Pinned to the untried worker slot (never the orchestrator), still READY, fresh budget.
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'slot-2' });
    expect(record.workUnits![0].kickoffFailures).toBeUndefined();
    expect(record.workUnits![0].history.at(-1)).toMatchObject({ action: 'retried', slotId: 'slot-2' });
  }));

  it('reassignKickoffToFreshSlot throws (→ caller blocks) below threshold, when every slot was tried, and when not READY', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.setAuthorizationContext(record.id, record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1' }
      ]
    }, 'authorization-digest');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
    // Below threshold → refuses (unit still recoverable in place, no spurious re-home).
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    let claim = record.workUnits![0];
    record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: 'dead', force: true }]);
    await expect(store.reassignKickoffToFreshSlot(record.id, 'unit')).rejects.toThrow('kickoff failures below block threshold');
    // Churn the ONLY worker slot the rest of the way to threshold; it is now the sole tried slot.
    for (let i = 1; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) {
      record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
      claim = record.workUnits![0];
      record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: 'dead', force: true }]);
    }
    expect(record.workUnits![0].kickoffFailures).toBe(KICKOFF_FAILURE_BLOCK_THRESHOLD);
    await expect(store.reassignKickoffToFreshSlot(record.id, 'unit')).rejects.toThrow('no untried worker slot for kickoff reassignment');
    // Not READY (already blocked) → the state guard refuses before the threshold check.
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.workUnits![0].state).toBe('BLOCKED');
    await expect(store.reassignKickoffToFreshSlot(record.id, 'unit')).rejects.toThrow('work unit is not reassignable for kickoff failure');
  }));

  it('propagates failed dependencies as skipped and restores them on retry', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'root', title: 'Root', task: 'Root', dependencies: [], readOnly: true },
      { id: 'child', title: 'Child', task: 'Child', dependencies: ['root'], readOnly: true },
      { id: 'grandchild', title: 'Grandchild', task: 'Grandchild', dependencies: ['child'], readOnly: true },
      { id: 'independent', title: 'Independent', task: 'Independent', dependencies: [], readOnly: true }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'root', 'slot-1');
    const beforeFailureVersion = record.stateVersion;
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'root', 'bad input', 'VALIDATION_FAILED');
    expect(record.stateVersion).toBe(beforeFailureVersion + 1);
    expect(record.workUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root', state: 'FAILED', failureCode: 'VALIDATION_FAILED', failure: 'bad input' }),
      expect.objectContaining({ id: 'child', state: 'SKIPPED' }),
      expect.objectContaining({ id: 'grandchild', state: 'SKIPPED' }),
      expect.objectContaining({ id: 'independent', state: 'READY' })
    ]));
    await expect(store.retryWork(record.id, beforeFailureVersion, { role: 'orchestrator', slotId: 'lead' }, 'root')).rejects.toThrow('stale execution state');
    record = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'root');
    expect(record.workUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root', state: 'READY' }),
      expect.objectContaining({ id: 'child', state: 'PENDING' }),
      expect.objectContaining({ id: 'grandchild', state: 'PENDING' })
    ]));
    expect(record.workUnits?.find((unit) => unit.id === 'root')).not.toHaveProperty('failureCode');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'root', 'slot-1');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'root', 'done');
    expect(record.workUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'child', state: 'READY' }),
      expect.objectContaining({ id: 'grandchild', state: 'PENDING' })
    ]));
    expect((await createExecutionStore({ filePath }).get(record.id))?.workUnits).toContainEqual(expect.objectContaining({ id: 'child', state: 'READY' }));
  }));

  it('does not crash readiness derivation for legacy records with a missing dependency', async () => fixture(async (filePath) => {
    let store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'root', title: 'Root', task: 'Root', dependencies: [], readOnly: true },
      { id: 'child', title: 'Child', task: 'Child', dependencies: ['root'], readOnly: true }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'root');
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { records: Array<{ workUnits: Array<{ id: string; dependencies: string[] }> }> };
    persisted.records[0].workUnits.find((unit) => unit.id === 'child')!.dependencies = ['missing'];
    await writeFile(filePath, JSON.stringify(persisted));
    store = createExecutionStore({ filePath });
    const completed = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'root', 'done');
    expect(completed.workUnits?.find((unit) => unit.id === 'child')).toMatchObject({ state: 'PENDING' });
  }));

  it('leaves explicitly pinned ready work unclaimed while its target slot is busy', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.setAuthorizationContext(record.id, record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1' },
        { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'w2' }
      ]
    }, 'authorization-digest');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'busy', title: 'Busy', task: 'Busy', dependencies: [], readOnly: true },
      { id: 'pinned', title: 'Pinned', task: 'Pinned', dependencies: [], readOnly: true }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'busy', 'slot-2');
    record = await store.reassignWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'pinned', 'slot-2');
    const dispatched = await store.dispatchReady(record.id);
    expect(dispatched.assignments).toEqual([]);
    expect(dispatched.record.workUnits?.find((unit) => unit.id === 'pinned')).toMatchObject({ state: 'READY', assignedSlotId: 'slot-2' });
  }));
  it('releases multiple undelivered assignments in one state transition', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.setAuthorizationContext(record.id, record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1' },
        { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'w2' }
      ]
    }, 'authorization-digest');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], readOnly: true },
      { id: 'b', title: 'B', task: 'B', dependencies: [], readOnly: true }
    ]);
    const dispatched = await store.dispatchReady(record.id);
    const released = await store.releaseUndelivered(record.id, dispatched.assignments);
    expect(released.stateVersion).toBe(dispatched.record.stateVersion + 1);
    expect(released.workUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a', state: 'READY' }),
      expect.objectContaining({ id: 'b', state: 'READY' })
    ]));
    expect(released.workUnits?.every((unit) => unit.assignedSlotId === undefined)).toBe(true);
  }));
  it('persists tasks up to Team launch UTF-8 limit instead of generic metadata limit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const task = 'x'.repeat(MAX_TEAM_INITIAL_TASK_BYTES);
    const claimed = await store.claim({
      ...request(),
      request: { version: 1, slots: [{ initialTask: task }], resolvedModels: [] }
    });
    expect(claimed.record.request.slots[0].initialTask).toBe(task);

    const exactMultibyte = 'é'.repeat(MAX_TEAM_INITIAL_TASK_BYTES / 2);
    const multibyte = await store.claim({
      ...request(), launchRequestId: 'request-2',
      request: { version: 1, slots: [{ initialTask: exactMultibyte }], resolvedModels: [] }
    });
    expect(multibyte.record.request.slots[0].initialTask).toBe(exactMultibyte);

    await expect(store.claim({
      ...request(), launchRequestId: 'request-3',
      request: { version: 1, slots: [{ initialTask: 'é'.repeat(Math.floor(MAX_TEAM_INITIAL_TASK_BYTES / 2) + 1) }], resolvedModels: [] }
    })).rejects.toThrow('invalid execution request snapshot');
  }));
  it('defaults generic launch metadata to Team and rejects unknown durable launch kinds', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), launchDisplay: { label: 'Release execution' }, request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [], launchDisplay: { label: 'Release execution' } } });
    expect(claimed.record).toMatchObject({ launchKind: 'team', launchDisplay: { label: 'Release execution' }, request: { launchKind: 'team', launchDisplay: { label: 'Release execution' } } });
    await expect(store.claim({
      ...request(), launchRequestId: 'request-2', launchKind: 'unknown' as never,
      request: { version: 1, launchKind: 'unknown' as never, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
    })).rejects.toThrow('invalid execution launch kind');
  }));
  it('derives durable launch metadata from request snapshot and rejects conflicts', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const snapshot = { version: 1 as const, launchKind: 'team' as const, launchDisplay: { label: 'Release execution' }, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] };
    await expect(store.claim({ ...request(), launchKind: 'team', launchDisplay: { label: 'Other execution' }, request: snapshot })).rejects.toThrow('execution launch display disagrees with request snapshot');
    const claimed = await store.claim({ ...request(), request: snapshot });
    expect(claimed.record).toMatchObject({ launchKind: 'team', launchDisplay: { label: 'Release execution' }, request: snapshot });
  }));
  it('CAS-rotates recovery generation and replaces stale effective owners', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    expect(record.recoveryDeadlineAt).toBe(record.createdAt + EXECUTION_RECOVERY_TTL_MS);
    record = await store.addEffectiveOwner(record.id, 'stale-owner');
    const rotated = await store.rotateRecoveryGeneration(record.id, record.stateVersion, 0, 1);
    expect(rotated).toMatchObject({ recoveryGeneration: 1, effectiveOwnerPrincipalIds: [], stateVersion: record.stateVersion + 1 });
    await expect(store.rotateRecoveryGeneration(record.id, record.stateVersion, 0, 1)).rejects.toThrow('stale execution state');
    await expect(store.rotateRecoveryGeneration(record.id, rotated.stateVersion, 0, 2)).rejects.toThrow('stale execution recovery generation');
  }));
  it('persists a fixed recovery deadline derived from creation across later writes', async () => fixture(async (filePath) => {
    let clock = 10_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock });
    let record = (await store.claim(request())).record;
    const deadline = record.createdAt + EXECUTION_RECOVERY_TTL_MS;
    expect(record.recoveryDeadlineAt).toBe(deadline);
    clock += 20 * 24 * 60 * 60 * 1_000;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    expect(record.recoveryDeadlineAt).toBe(deadline);
    expect((await createExecutionStore({ filePath, now: () => clock }).get(record.id))?.recoveryDeadlineAt).toBe(deadline);
  }));
  it('migrates old records without a delivery outbox', async () => fixture(async (filePath) => {
    const seed = createExecutionStore({ filePath, id: () => 'execution-1' });
    await seed.claim(request());
    const legacy = JSON.parse(await readFile(filePath, 'utf8')) as { records: Array<Record<string, unknown>> };
    delete legacy.records[0].deliveries;
    await writeFile(filePath, JSON.stringify(legacy));
    const store = createExecutionStore({ filePath });
    expect((await store.get('execution-1'))?.deliveries).toEqual([]);
  }));

  it('migrates persisted request goal to objective at read time', async () => fixture(async (filePath) => {
    const seed = createExecutionStore({ filePath, id: () => 'execution-1' });
    await seed.claim({ ...request(), request: { ...request().request, objective: 'Ship safely' } });
    const legacy = JSON.parse(await readFile(filePath, 'utf8')) as { records: Array<{ request: Record<string, unknown> }> };
    legacy.records[0]!.request.goal = legacy.records[0]!.request.objective;
    delete legacy.records[0]!.request.objective;
    await writeFile(filePath, JSON.stringify(legacy));

    const record = await createExecutionStore({ filePath }).get('execution-1');
    expect(record?.request).toMatchObject({ objective: 'Ship safely' });
    expect(record?.request).not.toHaveProperty('goal');
  }));

  it('requires a registered completed DAG for both durable coordination modes', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    for (const coordinationMode of ['structured', 'freeform'] as const) {
      let record = (await store.claim({
        ...request(), launchRequestId: coordinationMode, requestDigest: coordinationMode, coordinationMode
      })).record;
      record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
      record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
      await expect(store.completeExecution(record.id, record.stateVersion, 'done')).rejects.toThrow('execution plan is required');
    }
  }));

  it('persists legacy source digest upgrades only when trusted metadata still matches', async () => fixture(async (filePath) => {
    const legacySource = {
      id: 'source-1', name: 'source.txt', mediaType: 'text/plain', byteSize: 7,
      contentDigest: `sha256:${'1'.repeat(64)}`, extractionStatus: 'READY' as const, extractionWarnings: []
    };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim({
      ...request(),
      request: { ...request().request, sourceBundle: { contentRef: 'execution-1/sources.json', sources: [legacySource] } }
    });
    const upgraded = { ...legacySource, extractedTextDigest: legacySource.contentDigest };

    await expect(store.upgradeSourceBundle('execution-1', [legacySource], [upgraded])).resolves.toBeUndefined();
    expect((await store.get('execution-1'))?.request.sourceBundle?.sources).toEqual([upgraded]);
    await expect(store.upgradeSourceBundle('execution-1', [legacySource], [upgraded])).resolves.toBeUndefined();
    await expect(store.upgradeSourceBundle('execution-1', [{ ...legacySource, name: 'tampered.txt' }], [upgraded]))
      .resolves.toBeUndefined();
    await expect(store.upgradeSourceBundle('execution-1', [{ ...legacySource, name: 'tampered.txt' }], [{ ...upgraded, extractedTextDigest: `sha256:${'2'.repeat(64)}` }]))
      .rejects.toThrow('execution source metadata changed before upgrade');
  }));

  it('enqueues exact blocker responses idempotently with version and UTF-8 bounds', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `delivery-${n}`; })() });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Help?' });
    const enqueued = await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' });
    expect(enqueued).toMatchObject({ outcome: 'accepted', delivery: { id: 'delivery-2', clientRequestId: 'client-1', blockerId: 'blocker-1', workUnitId: 'a', slotId: 'slot-1', state: 'PENDING', attempt: 0 } });
    await expect(store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-race', blockerId: 'blocker-1', text: 'Answer' })).rejects.toThrow('stale execution state');
    await expect(store.enqueueBlockerDelivery(record.id, enqueued.record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' })).resolves.toMatchObject({ outcome: 'replay', delivery: { id: 'delivery-2' } });
    await expect(store.enqueueBlockerDelivery(record.id, enqueued.record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Different' })).rejects.toThrow('delivery client request conflict');
    await expect(store.enqueueBlockerDelivery(record.id, enqueued.record.stateVersion, { clientRequestId: 'client-2', blockerId: 'blocker-1', text: 'Replacement' })).rejects.toThrow('execution blocker already has an active delivery');
    await expect(store.enqueueBlockerDelivery(record.id, enqueued.record.stateVersion, { clientRequestId: 'client-2', blockerId: 'missing', text: 'Answer' })).rejects.toThrow('execution blocker not found');
    await expect(store.enqueueBlockerDelivery(record.id, enqueued.record.stateVersion, { clientRequestId: 'client-3', blockerId: 'blocker-1', text: '😀'.repeat(4097) })).rejects.toThrow('delivery payload exceeds 16384 bytes');
  }));

  it('escalates a coordinator-audience blocker to human exactly once (a second sweep is a no-op)', async () => fixture(async (filePath) => {
    let now = 100;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Which?', audience: 'coordinator' });

    now = 200;
    // A background sweep runs with no caller stateVersion (undefined skips the CAS), so it survives concurrent writes.
    const escalated = await store.escalateBlockerToHuman(record.id, 'blocker-1');
    expect(escalated.blockers?.find((blocker) => blocker.id === 'blocker-1')).toMatchObject({ audience: 'human', escalatedAt: 200, resolved: false });

    // The audience flip is itself the idempotency guard: a re-escalate now sees a human blocker and refuses.
    now = 300;
    await expect(store.escalateBlockerToHuman(record.id, 'blocker-1')).rejects.toThrow('only a coordinator-audience blocker');
    expect((await store.get(record.id))?.blockers?.find((blocker) => blocker.id === 'blocker-1')?.escalatedAt).toBe(200); // not re-stamped
  }));

  it('refuses to escalate a human-audience blocker, a missing blocker, or a resolved one', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionStore({ filePath, id: () => id++ === 0 ? 'execution-1' : `delivery-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] },
      { id: 'b', title: 'B', task: 'B', dependencies: [], files: ['b.txt'], verification: ['check b'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'human-blocker', question: 'Owner?' }); // no audience → human lane

    await expect(store.escalateBlockerToHuman(record.id, 'human-blocker')).rejects.toThrow('only a coordinator-audience blocker');
    await expect(store.escalateBlockerToHuman(record.id, 'missing')).rejects.toThrow('execution blocker not found');

    // Resolve a coordinator blocker on a second unit via a delivered answer, then confirm a resolved blocker can't escalate.
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'b', 'slot-2');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'b', { id: 'coord-blocker', question: 'Which?', audience: 'coordinator' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'coord-blocker', text: 'Answer' })).record;
    const leased = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-2', role: 'worker' });
    await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-2', role: 'worker' }, leased!.id, leased!.leaseId!, { delivered: true });
    await expect(store.escalateBlockerToHuman(record.id, 'coord-blocker')).rejects.toThrow('is resolved');
  }));

  it('rejects a work retry while a human answer is in flight and keeps the delivery deliverable', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionStore({ filePath, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'retry', title: 'Retry', task: 'Retry', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'retry', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'retry', { id: 'blocker-retry', question: 'Q?' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'retry-client', blockerId: 'blocker-retry', text: 'Retry answer' })).record;
    const leased = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' });
    // A LEASED answer is still in flight; retrying the unit here would discard it.
    await expect(store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'retry'))
      .rejects.toThrow('in-flight blocker response');
    // The delivery survived: acknowledging it resolves the blocker with the answer intact.
    const ack = await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, leased!.id, leased!.leaseId!, { delivered: true });
    expect(ack.outcome).toBe('accepted');
    expect(ack.record.blockers?.find((blocker) => blocker.id === 'blocker-retry')).toMatchObject({ resolved: true, response: 'Retry answer' });
  }));

  it('allows a work retry once an in-flight answer exhausts its delivery attempts', async () => fixture(async (filePath) => {
    let now = 0;
    let id = 0;
    const store = createExecutionStore({ filePath, now: () => now, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'retry', title: 'Retry', task: 'Retry', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'retry', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'retry', { id: 'blocker-retry', question: 'Q?' });
    await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'retry-client', blockerId: 'blocker-retry', text: 'Retry answer' });
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const lease = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' });
      const ack = await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, lease!.id, lease!.leaseId!, { delivered: false, error: 'worker offline' });
      now = ack.delivery.nextAttemptAt ?? now;
    }
    record = (await store.get(record.id))!;
    expect(record.deliveries?.[0]?.state).toBe('FAILED');
    // With no deliverable answer left, the coordinator may retry the blocked unit.
    const retried = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'retry');
    expect(retried.workUnits?.find((unit) => unit.id === 'retry')).toMatchObject({ state: 'READY' });
    expect(retried.blockers?.find((blocker) => blocker.id === 'blocker-retry')).toMatchObject({ resolved: true });
  }));

  it('blocks new admission after resource exhaustion but accepts already fenced outcome', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'claimed', title: 'Claimed', task: 'Finish', dependencies: [], readOnly: true },
      { id: 'ready', title: 'Ready', task: 'Wait', dependencies: [], readOnly: true },
      { id: 'failed', title: 'Failed', task: 'Retry', dependencies: [], readOnly: true }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'claimed');
    const claim = { claimId: record.workUnits![0].claimId!, claimGeneration: record.workUnits![0].claimGeneration! };
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'failed');
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'failed', 'failed');
    record = await store.blockForResource(record.id, 'budget exhausted', 'usage-budget');
    await expect(store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'ready')).rejects.toThrow('budget exhausted');
    await expect(store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'failed')).rejects.toThrow('budget exhausted');
    expect((await store.dispatchReady(record.id)).assignments).toEqual([]);
    const completed = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'claimed', 'done', claim, true);
    expect(completed.workUnits).toContainEqual(expect.objectContaining({ id: 'claimed', state: 'COMPLETED' }));
  }));

  it('retains delivered records for 30 days without evicting active deliveries', async () => fixture(async (filePath) => {
    let now = 1;
    let id = 0;
    const store = createExecutionStore({ filePath, now: () => now, id: () => id++ === 0 ? 'execution-1' : `delivery-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    const units = Array.from({ length: 100 }, (_, index) => ({ id: `u-${index}`, title: `U ${index}`, task: 'task', dependencies: [] }));
    record = await store.registerPlan(record.id, record.stateVersion, units);
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { records: typeof record[] };
    const seeded = state.records[0];
    seeded.blockers = units.map((unit, index) => ({
      id: `b-${index}`, workUnitId: unit.id, slotId: 'slot-1', question: 'Q?', resolved: false, createdAt: now
    }));
    seeded.deliveries = Array.from({ length: 128 }, (_, index) => ({
      id: `delivery-${index}`, clientRequestId: `c-${index}`, blockerId: `b-${index % 100}`,
      workUnitId: `u-${index % 100}`, slotId: 'slot-1', payload: { text: `A ${index}` },
      state: index === 0 || index >= 100 ? 'DELIVERED' as const : 'PENDING' as const,
      attempt: index === 0 || index >= 100 ? 1 : 0, createdAt: now, updatedAt: now,
      ...(index === 0 || index >= 100 ? { deliveredAt: index === 0 ? now : now + 1 } : {})
    }));
    await writeFile(filePath, JSON.stringify(state));
    expect((await store.get(record.id))?.deliveries).toHaveLength(128);
    const deliveredId = seeded.deliveries[0].id;
    now += 30 * 24 * 60 * 60 * 1_000 - 1;
    expect((await store.get(record.id))?.deliveries?.some((delivery) => delivery.id === deliveredId)).toBe(true);
    now += 2;
    await store.producerEvent(record.id, { id: 'prune-trigger', type: 'progress', severity: 'info', summary: 'tick' });
    const afterRetention = await store.get(record.id);
    expect(afterRetention?.deliveries?.some((delivery) => delivery.id === deliveredId)).toBe(false);
    expect(afterRetention?.deliveries?.filter((delivery) => delivery.state === 'PENDING')).toHaveLength(99);
  }));

  it('route-binds stable pull leases and resolves only the acknowledged blocker', async () => fixture(async (filePath) => {
    let now = 10;
    let id = 0;
    const store = createExecutionStore({ filePath, now: () => now, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }, { id: 'b', title: 'B', task: 'B', dependencies: [] }]);
    for (const unit of ['a', 'b']) {
      record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, unit, 'slot-1');
      record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, unit, { id: `blocker-${unit}`, question: 'Q?' });
    }
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-a', text: 'Answer' })).record;
    expect(await store.pullBlockerDelivery({ executionId: record.id, projectId: 'other', slotId: 'slot-1', role: 'worker' })).toBeUndefined();
    expect(await store.pullBlockerDelivery({ executionId: 'other', projectId: 'project-1', slotId: 'slot-1', role: 'worker' })).toBeUndefined();
    expect(await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-2', role: 'worker' })).toBeUndefined();
    const first = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' });
    const retry = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' });
    expect(retry).toMatchObject({ id: first?.id, leaseId: first?.leaseId });
    await expect(store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, first!.id, 'stale', { delivered: true })).rejects.toThrow('delivery lease is not current');
    const ack = await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, first!.id, first!.leaseId!, { delivered: true });
    expect(ack.record).toMatchObject({ state: 'BLOCKED', blockers: [{ id: 'blocker-a', resolved: true, response: 'Answer' }, { id: 'blocker-b', resolved: false }] });
    await expect(store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, first!.id, first!.leaseId!, { delivered: true })).resolves.toMatchObject({ outcome: 'replay' });
  }));

  it('rebinds an expired delivery lease to the restored worker identity and denies the stale worker', async () => fixture(async (filePath) => {
    let now = 10;
    let id = 0;
    const store = createExecutionStore({ filePath, now: () => now, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' })).record;
    const workerA = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-a', authorizationId: 'auth-a' };
    const workerB = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-b', authorizationId: 'auth-b' };
    const first = await store.pullBlockerDelivery(workerA);
    now = first!.leaseExpiresAt!;
    const restored = await store.pullBlockerDelivery(workerB);
    expect(restored).toMatchObject({ id: first!.id, recipientPrincipalId: 'worker-b', recipientAuthorizationId: 'auth-b', state: 'LEASED' });
    expect(restored!.leaseId).not.toBe(first!.leaseId);
    await expect(store.pullBlockerDelivery(workerA)).resolves.toBeUndefined();
    await expect(store.ackBlockerDelivery(workerA, restored!.id, restored!.leaseId!, { delivered: true })).rejects.toThrow('delivery route is not authorized');
  }));

  it('backs failed deliveries off through attempt eight and bounds errors by UTF-8 bytes', async () => fixture(async (filePath) => {
    let now = 0;
    let id = 0;
    const store = createExecutionStore({ filePath, now: () => now, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' });
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const lease = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' });
      if (!lease) throw new Error(`missing attempt ${attempt}`);
      expect(lease.attempt).toBe(attempt);
      const ack = await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, lease.id, lease.leaseId!, { delivered: false, error: '😀'.repeat(400) });
      expect(Buffer.byteLength(ack.delivery.lastError ?? '', 'utf8')).toBeLessThanOrEqual(1024);
      if (attempt < 8) {
        expect(ack.delivery.state).toBe('PENDING');
        expect(await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' })).toBeUndefined();
        now = ack.delivery.nextAttemptAt!;
      } else expect(ack.delivery.state).toBe('FAILED');
    }
    expect(await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' })).toBeUndefined();
  }));

  it('permits one explicit manual retry after natural attempt-eight exhaustion without changing durable identity', async () => fixture(async (filePath) => {
    let now = 0;
    let id = 0;
    const store = createExecutionStore({ filePath, now: () => now, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' })).record;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const lease = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' });
      const ack = await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, lease!.id, lease!.leaseId!, { delivered: false, error: 'offline' });
      record = ack.record;
      now = ack.delivery.nextAttemptAt ?? now;
    }
    record = (await store.get(record.id))!;
    const deliveryId = record.deliveries![0].id;
    const retried = await store.retryBlockerDelivery(record.id, record.stateVersion, 'blocker-1', record.deliveries![0].id);
    expect(retried.deliveries?.[0]).toMatchObject({ id: deliveryId, clientRequestId: 'client-1', blockerId: 'blocker-1', state: 'PENDING', attempt: 0, manualRetryCount: 1, nextAttemptAt: now });
    expect(retried.deliveries?.[0].lastError).toBeUndefined();
    await expect(store.retryBlockerDelivery(record.id, retried.stateVersion, 'blocker-1', 'wrong')).rejects.toThrow('delivery route is not authorized');
    const retriedState = JSON.parse(await readFile(filePath, 'utf8')) as { records: typeof retried[] };
    retriedState.records[0].deliveries![0].state = 'FAILED';
    retriedState.records[0].deliveries![0].attempt = 8;
    await writeFile(filePath, JSON.stringify(retriedState));
    await expect(store.retryBlockerDelivery(record.id, retried.stateVersion, 'blocker-1', deliveryId)).rejects.toThrow('delivery retry is not allowed');
  }));
  it('registers a bounded DAG with stable ids and derives initial readiness', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const planned = await store.registerPlan(claimed.record.id, claimed.record.stateVersion, [
      { id: 'implement', title: 'Implement', task: 'Change code', dependencies: [], files: ['src/main/a.ts'], verification: ['unit test'] },
      { id: 'verify', title: 'Verify', task: 'Run checks', dependencies: ['implement'], readOnly: true }
    ]);
    expect(planned.workUnits).toEqual([
      expect.objectContaining({ id: 'implement', state: 'READY', attempt: 0, files: ['src/main/a.ts'] }),
      expect.objectContaining({ id: 'verify', state: 'PENDING', attempt: 0 })
    ]);
    expect((await store.get(claimed.record.id))?.workUnits).toEqual(planned.workUnits);
    await expect(store.registerPlan(planned.id, planned.stateVersion, [
      { id: 'same', title: 'One', task: 'One', dependencies: [] },
      { id: 'same', title: 'Two', task: 'Two', dependencies: [] }
    ])).rejects.toThrow('duplicate work unit id');
    await expect(store.registerPlan(planned.id, planned.stateVersion, [
      { id: 'missing', title: 'Missing', task: 'Missing', dependencies: ['unknown'] }
    ])).rejects.toThrow('missing work unit dependency');
    await expect(store.registerPlan(planned.id, planned.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: ['b'] },
      { id: 'b', title: 'B', task: 'B', dependencies: ['a'] }
    ])).rejects.toThrow('work unit dependency cycle');
  }));

  it('replays an identical registered plan without changing durable state', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const units = [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }];
    const planned = await store.registerPlan(claimed.record.id, claimed.record.stateVersion, units);
    const replay = await store.registerPlan(planned.id, planned.stateVersion, units);
    expect(replay).toEqual(planned);
    await expect(store.registerPlan(planned.id, planned.stateVersion, [
      { ...units[0], task: 'Changed' }
    ])).rejects.toThrow('execution plan already registered with different work units');
  }));

  it('persists a complete preplanned DAG atomically with execution reservation', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({
      ...request(), coordinationMode: 'job-team',
      workUnits: [
        { id: 'one', title: 'One', task: 'One', dependencies: [], files: ['one.txt'], verification: ['check one'] },
        { id: 'two', title: 'Two', task: 'Two', dependencies: ['one'], readOnly: true, files: ['one.txt'], verification: ['check two'] }
      ]
    });
    expect(claimed.record.workUnits).toEqual([
      expect.objectContaining({ id: 'one', state: 'READY', files: ['one.txt'], verification: ['check one'] }),
      expect.objectContaining({ id: 'two', state: 'PENDING', readOnly: true, verification: ['check two'] })
    ]);
    expect(claimed.record.blockers).toEqual([]);
    const reloaded = createExecutionStore({ filePath });
    await expect(reloaded.get(claimed.record.id)).resolves.toMatchObject({
      workUnits: [
        { id: 'one', state: 'READY', files: ['one.txt'], verification: ['check one'] },
        { id: 'two', state: 'PENDING', readOnly: true, verification: ['check two'] }
      ],
      blockers: []
    });
    await expect(store.claim({
      ...request(), coordinationMode: 'job-team', launchRequestId: 'bad-request', requestDigest: 'bad-digest',
      workUnits: [{ id: 'bad', title: 'Bad', task: 'Bad', dependencies: [], verification: ['check bad'] }]
    })).rejects.toThrow('mutating work unit requires file scope');
  }));

  it('claims only ready authorized work, persists attempts/history, and unlocks dependents', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.registerPlan(claimed.record.id, 0, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] },
      { id: 'b', title: 'B', task: 'B', dependencies: ['a'], files: ['b.txt'], verification: ['check b'] }
    ]);
    await expect(store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'b')).rejects.toThrow('work unit is not ready');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:lead' }, 'a', 'slot-1');
    expect(record.workUnits?.[0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', attempt: 1, history: [{ action: 'claimed', slotId: 'slot-1', attempt: 1 }] });
    await expect(store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'a', 'wrong')).rejects.toThrow('work unit is assigned to another slot');
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', 'test failed');
    expect(record.workUnits?.[0]).toMatchObject({ state: 'FAILED', failure: 'test failed' });
    record = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:lead' }, 'a', 'slot-2');
    expect(record.workUnits?.[0]).toMatchObject({ state: 'READY', assignedSlotId: 'slot-2', attempt: 1 });
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'a');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-2' }, 'a', 'done');
    expect(record.workUnits).toEqual([
      expect.objectContaining({ state: 'COMPLETED', attempt: 2 }),
      expect.objectContaining({ state: 'READY' })
    ]);
  }));

  it('requires coordinators to assign ready work to a worker slot', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.setAuthorizationContext(claimed.record.id, 0, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
      slots: [
        { slotId: 'worker-1', personaId: 'worker', authorizationIdDigest: 'worker-digest' },
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-digest' }
      ]
    }, 'context');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }
    ]);
    const coordinator = { role: 'orchestrator' as const, slotId: 'orchestrator:lead' };
    await expect(store.claimWork(record.id, record.stateVersion, coordinator, 'a')).rejects.toThrow('coordinator assignment requires assigned slot id');
    await expect(store.claimWork(record.id, record.stateVersion, coordinator, 'a', 'orchestrator:lead')).rejects.toThrow('coordinator must assign work to a worker slot');
    await expect(store.claimWork(record.id, record.stateVersion, coordinator, 'a', 'worker-1')).resolves.toMatchObject({
      workUnits: [expect.objectContaining({ assignedSlotId: 'worker-1' })]
    });
  }));

  it('normalizes file scopes and prevents overlapping mutating claims', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.registerPlan(claimed.record.id, 0, [
      { id: 'one', title: 'One', task: 'One', dependencies: [], files: ['./src/main/a.ts'] },
      { id: 'two', title: 'Two', task: 'Two', dependencies: [], files: ['src/main'] },
      { id: 'read', title: 'Read', task: 'Read', dependencies: [], files: ['src/main/a.ts'], readOnly: true },
      { id: 'broad', title: 'Broad', task: 'Broad', dependencies: [] }
    ]);
    expect(record.workUnits?.[0].files).toEqual(['src/main/a.ts']);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'one', 'slot-1');
    await expect(store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'two', 'slot-2')).rejects.toThrow('overlapping mutating file scope');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'read', 'slot-2');
    await expect(store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'broad', 'slot-3')).rejects.toThrow('overlapping mutating file scope');
    await expect(store.registerPlan(record.id, record.stateVersion, [{ id: 'bad', title: 'Bad', task: 'Bad', dependencies: [], files: ['../secret'] }])).rejects.toThrow('invalid work unit file scope');
    await expect(store.registerPlan(record.id, record.stateVersion, [{ id: 'bad', title: 'Bad', task: 'Bad', dependencies: [], files: ['/tmp/secret'] }])).rejects.toThrow('invalid work unit file scope');
  }));

  it('rejects a job-team registerPlan unit that mutates without declaring file scope', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await expect(store.registerPlan(claimed.record.id, claimed.record.stateVersion, [
      { id: 'unit-a', title: 'Unit A', task: 'Do work', dependencies: [] }
    ])).rejects.toThrow('mutating work unit requires file scope');
  }));

  it('rejects a job-team registerPlan unit missing verification', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await expect(store.registerPlan(claimed.record.id, claimed.record.stateVersion, [
      { id: 'unit-a', title: 'Unit A', task: 'Do work', dependencies: [], files: ['src/x.ts'] }
    ])).rejects.toThrow('work unit requires verification');
  }));

  it('registers a well-formed job-team registerPlan with disjoint mutating units that are both independently claimable', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.setAuthorizationContext(claimed.record.id, claimed.record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
      slots: [
        { slotId: 'lead', personaId: 'lead', authorizationIdDigest: 'lead-digest' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'worker-1-digest' },
        { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'worker-2-digest' }
      ]
    }, 'context');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'unit-a', title: 'Unit A', task: 'Do work', dependencies: [], files: ['src/x.ts'], verification: ['check a'] },
      { id: 'unit-b', title: 'Unit B', task: 'Do other work', dependencies: [], files: ['src/y.ts'], verification: ['check b'] },
      { id: 'unit-review', title: 'Review', task: 'Review both', dependencies: ['unit-a', 'unit-b'], readOnly: true, verification: ['check review'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'unit-a', 'slot-1');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'unit-b', 'slot-2');
    expect(record.workUnits).toEqual([
      expect.objectContaining({ id: 'unit-a', state: 'CLAIMED', assignedSlotId: 'slot-1' }),
      expect.objectContaining({ id: 'unit-b', state: 'CLAIMED', assignedSlotId: 'slot-2' }),
      expect.objectContaining({ id: 'unit-review', state: 'PENDING' })
    ]);
  }));

  it('stays lenient for a non-job-team registerPlan with a scope-less mutating unit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await expect(store.registerPlan(claimed.record.id, claimed.record.stateVersion, [
      { id: 'unit-a', title: 'Unit A', task: 'Do work', dependencies: [] }
    ])).resolves.toMatchObject({
      workUnits: [expect.objectContaining({ id: 'unit-a', state: 'READY' })]
    });
  }));

  it('durably blocks a claimed unit with exact work, slot, and options', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'running');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    const blocked = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', {
      id: 'blocker-1', question: 'Choose?', options: ['A', 'B']
    });
    expect(blocked).toMatchObject({ state: 'BLOCKED', blockers: [{ id: 'blocker-1', workUnitId: 'a', slotId: 'slot-1', question: 'Choose?', options: ['A', 'B'] }] });
  }));

  it('rejects early completion and persists the full final summary', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.registerPlan(claimed.record.id, 0, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    await expect(store.completeExecution(record.id, record.stateVersion, 'full final summary')).rejects.toThrow('required work units are incomplete');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'worker-1');
    record = await store.completeWork(record.id, record.stateVersion, { role: 'worker', slotId: 'worker-1' }, 'a', 'done');
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    const complete = await store.completeExecution(record.id, record.stateVersion, 'full final summary');
    expect(complete).toMatchObject({ state: 'COMPLETED', finalSummary: 'full final summary' });
  }));

  it('requires a registered non-empty plan only for persisted Job Team executions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const legacy = await store.claim(request());
    const job = await store.claim({ ...request(), launchRequestId: 'job-request', requestDigest: 'job-digest', coordinationMode: 'job-team' });
    if (legacy.outcome !== 'claimed' || job.outcome !== 'claimed') throw new Error('expected claims');
    let legacyRecord = await store.transition(legacy.record.id, 0, 'STARTING', 'info', 'start');
    legacyRecord = await store.transition(legacyRecord.id, legacyRecord.stateVersion, 'RUNNING', 'info', 'run');
    await expect(store.completeExecution(legacyRecord.id, legacyRecord.stateVersion, 'legacy done')).resolves.toMatchObject({ state: 'COMPLETED' });
    let jobRecord = await store.transition(job.record.id, 0, 'STARTING', 'info', 'start');
    jobRecord = await store.transition(jobRecord.id, jobRecord.stateVersion, 'RUNNING', 'info', 'run');
    await expect(store.completeExecution(jobRecord.id, jobRecord.stateVersion, 'invalid')).rejects.toThrow('execution plan is required');
  }));

  it('rejects coordinator assignment outside persisted authorization roster', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.setAuthorizationContext(claimed.record.id, 0, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
      slots: [{ slotId: 'worker-1', personaId: 'persona', authorizationIdDigest: 'digest' }]
    }, 'context');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    await expect(store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'forged-slot'))
      .rejects.toThrow('assigned slot is not authorized');
  }));

  it('retrying blocked work resolves its blocker and returns execution to RUNNING', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ ...request(), coordinationMode: 'job-team' });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.setAuthorizationContext(record.id, record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
      slots: [{ slotId: 'slot-1', personaId: 'persona', authorizationIdDigest: 'digest' }]
    }, 'context');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'b', question: 'Help?' });
    record = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    expect(record).toMatchObject({ state: 'RUNNING', blockers: [{ id: 'b', resolved: true }], workUnits: [{ state: 'READY' }] });
  }));

  it('claims once, replays equal input, and rejects changed input', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    expect((await store.claim(request())).outcome).toBe('claimed');
    expect((await store.claim(request())).outcome).toBe('replay');
    expect((await store.claim({ ...request(), requestDigest: 'changed' })).outcome).toBe('conflict');
  }));

  it('persists ordered events and rejects stale or invalid transitions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    await expect(store.transition(running.id, 1, 'COMPLETED', 'info', 'Done')).rejects.toThrow('stale execution state');
    await expect(store.transition(running.id, 2, 'READY', 'info', 'Back')).rejects.toThrow('invalid execution transition');
    const events = await store.events('session-1', 'project-1', claimed.record.id);
    expect(events.events.map((event) => [event.sequence, event.state, event.stateVersion, event.kind])).toEqual([[1, 'READY', 0, undefined], [2, 'STARTING', 1, 'transition'], [3, 'RUNNING', 2, 'transition']]);
  }));

  it('confines list and events to caller principal and project', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    expect(await store.list('other-session', 'project-1')).toEqual([]);
    expect(await store.list('session-1', 'other-project')).toEqual([]);
    expect(await store.events('other-session', 'project-1', claimed.record.id)).toEqual({ events: [] });
  }));

  it('lists every execution in a project for main-owned projections', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim(request());
    expect((await store.listInProject('project-1')).records).toMatchObject([{ id: 'execution-1', callerPrincipalId: 'session-1' }]);
    expect((await store.listInProject('other-project')).records).toEqual([]);
  }));

  it('hides dismissed terminal executions without deleting retained evidence', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, starting.stateVersion, 'RUNNING', 'info', 'Running');
    const stopped = await store.transition(running.id, running.stateVersion, 'STOPPED', 'info', 'Stopped');
    await expect(store.dismiss(stopped.id)).resolves.toMatchObject({ dismissedAt: expect.any(Number) });
    expect(await store.get(stopped.id)).toMatchObject({ id: stopped.id, dismissedAt: expect.any(Number) });
    expect((await store.listInProject('project-1')).records).toEqual([]);
    await expect(store.dismiss(stopped.id)).resolves.toMatchObject({ id: stopped.id });
  }));

  it('refuses to dismiss active executions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await expect(store.dismiss(claimed.record.id)).rejects.toThrow('only terminal executions can be dismissed');
  }));

  it('lists retained source references for execution-aware snapshot retention', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({
      ...request(),
      request: {
        ...request().request,
        sourceBundle: {
          contentRef: 'execution-1/sources.json',
          sources: [{ id: 'source-1', name: 'input.txt', mediaType: 'text/plain', byteSize: 5, contentDigest: `sha256:${'1'.repeat(64)}`, extractionStatus: 'READY' as const, extractionWarnings: [] }]
        }
      }
    });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    expect(await store.retainedSourceContentRefs()).toEqual(new Set(['execution-1/sources.json']));
  }));

  it('keeps active records and paginates bounded event reads', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxRecords: 1 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    const page = await store.events('session-1', 'project-1', running.id, 0, 2);
    expect(page.events).toHaveLength(2);
    expect(page.nextSequence).toBe(2);
    expect(await store.get(running.id)).toMatchObject({ state: 'RUNNING' });
  }));

  it('preserves active transitions when compacting recent event history', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxEvents: 2 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    expect(await store.events('session-1', 'project-1', running.id, 0)).toMatchObject({
      events: [{ sequence: 2 }, { sequence: 3 }]
    });
  }));

  it('keeps newest active transition when event capacity is one', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxEvents: 1 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    expect(await store.events('session-1', 'project-1', claimed.record.id, 1)).toMatchObject({
      events: [{ sequence: 3 }]
    });
  }));

  it('keeps retained producer and lifecycle event sequences monotonic after compaction', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxEvents: 2 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.producerEvent(starting.id, { id: 'producer-1', type: 'progress', severity: 'info', summary: 'Progress' });
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    await store.producerEvent(running.id, { id: 'producer-2', type: 'outcome', severity: 'info', summary: 'Done' });
    expect((await store.events('session-1', 'project-1', running.id)).events.map((event) => event.sequence)).toEqual([4, 5]);
  }));

  it('bounds events per execution, preserves essential signals, and keeps other executions writable', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionStore({ filePath, id: () => `execution-${++id}`, maxEvents: 8, maxEventsPerExecution: 4 });
    const first = await store.claim(request());
    if (first.outcome !== 'claimed') throw new Error('expected claim');
    let current = await store.transition(first.record.id, first.record.stateVersion, 'STARTING', 'info', 'Starting');
    current = await store.transition(current.id, current.stateVersion, 'RUNNING', 'info', 'Running');
    await store.producerEvent(current.id, { id: 'blocker', type: 'blocker', severity: 'warning', summary: 'Need input', blocker: { question: 'Continue?' } });
    await store.producerEvent(current.id, { id: 'outcome', type: 'outcome', severity: 'info', summary: 'Outcome' });
    for (let index = 0; index < 20; index += 1) await store.producerEvent(current.id, { id: `progress-${index}`, type: 'progress', severity: 'info', summary: `Progress ${index}` });
    const events = (await store.events('session-1', 'project-1', current.id)).events;
    expect(events).toHaveLength(4);
    expect(events.map(({ id }) => id)).toEqual(expect.arrayContaining(['blocker', 'outcome']));
    await expect(store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' })).resolves.toMatchObject({ outcome: 'claimed' });
  }));

  it('rejects every durable mutation after terminal state', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'COMPLETED', 'info', 'done');
    await expect(store.event(record.id, record.stateVersion, 'info', 'late')).rejects.toThrow('execution is completed');
    await expect(store.command(record.id, record.stateVersion, 'late')).rejects.toThrow('execution is completed');
    await expect(store.producerEvent(record.id, { id: 'late', type: 'progress', severity: 'info', summary: 'late' })).rejects.toThrow('execution is completed');
    await expect(store.registerPlan(record.id, record.stateVersion, [{ id: 'late', title: 'Late', task: 'Late', dependencies: [] }])).rejects.toThrow('execution is completed');
  }));

  it('persists replayable producer role, attention, progress, and references', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.producerEvent(claimed.record.id, {
      id: 'event-1', slotId: 'slot-1', producerRole: 'worker', type: 'progress', severity: 'info', summary: 'Half done',
      attention: false, progress: { completed: 1, total: 2 }, references: [{ label: 'result', uri: 'artifact://result.json' }]
    });
    expect(await store.events('session-1', 'project-1', claimed.record.id)).toMatchObject({ events: [
      {}, { id: 'event-1', producerRole: 'worker', attention: false, progress: { completed: 1, total: 2 }, references: [{ label: 'result', uri: 'artifact://result.json' }] }
    ] });
  }));

  it('does not allow another execution to evict protected recent events', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let index = 0; return () => `execution-${++index}`; })(), maxEvents: 1 });
    const first = await store.claim(request());
    const second = await store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' });
    if (first.outcome !== 'claimed' || second.outcome !== 'claimed') throw new Error('expected claims');
    expect(await store.events('session-1', 'project-1', first.record.id, 1)).toMatchObject({ events: [] });
  }));

  it('requires resync for a future event cursor', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    expect(await store.events('session-1', 'project-1', claimed.record.id, 9)).toEqual({ events: [], resyncRequired: true });
  }));

  it('retains active records and preserves newest terminal history', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let i = 0; return () => `execution-${++i}`; })(), maxRecords: 3 });
    const active = await store.claim(request());
    const blocked = await store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' });
    const newerBlocked = await store.claim({ ...request(), launchRequestId: 'request-3', requestDigest: 'digest-3' });
    if (active.outcome !== 'claimed' || blocked.outcome !== 'claimed' || newerBlocked.outcome !== 'claimed') throw new Error('expected claims');
    const starting = await store.transition(blocked.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.transition(starting.id, 1, 'BLOCKED', 'warning', 'Blocked');
    const newerStarting = await store.transition(newerBlocked.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.transition(newerStarting.id, 1, 'BLOCKED', 'warning', 'Blocked');
    expect(await store.get(active.record.id)).toMatchObject({ state: 'READY' });
    expect(await store.get(blocked.record.id)).toMatchObject({ state: 'BLOCKED' });
    expect(await store.get(newerBlocked.record.id)).toMatchObject({ state: 'BLOCKED' });
  }));

  it('rejects new claims when active execution capacity is exhausted', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, maxRecords: 1 });
    await store.claim(request());
    await expect(store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' })).rejects.toThrow('active record limit');
  }));

  it('persists resolved model snapshots with the execution attempt', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const model = { slotId: 'slot-1', provider: 'provider', model: 'model', reasoning: 'high', level: 'high' as const, roleOwnedModel: true, capabilities: ['review'], modalities: ['text'], maxContextBytes: 1000, health: 'available' as const, observedAt: 10, maxAgeMs: 100 };
    const claim = await store.claim({ ...request(), resolvedModels: [model] });
    expect(claim).toMatchObject({ record: { resolvedModels: [model] } });
    expect((await createExecutionStore({ filePath }).get(claim.record.id))?.resolvedModels).toEqual([model]);
  }));

  it('compacts usage observations into a durable monotonic baseline beyond cap', async () => fixture(async (filePath) => {
    const observationCap = 3;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxUsageObservationsPerExecution: observationCap });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    for (let sequence = 1; sequence <= observationCap + 2; sequence += 1) {
      await store.appendUsageObservation(claimed.record.id, {
        observationId: `o-${sequence}`, executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 'worker', workAttempt: 0,
        claimGeneration: 0, adapterEpoch: 0, sampleKind: 'heartbeat', sequence, provider: 'p', routingIdentity: 'r',
        cumulative: { inputTokens: sequence, providerCostUsd: sequence / 100 }, completeness: 'complete', observedAt: sequence
      });
    }
    const record = await store.get(claimed.record.id);
    expect(record?.usageObservations).toHaveLength(observationCap);
    expect(record?.usageBaseline).toMatchObject({ inputTokens: 2, providerCostUsd: 0.02, observationCount: 2 });
    expect(usageRollup(record!.usageObservations!, record!.usageBaseline)).toMatchObject({ inputTokens: observationCap + 2, observationCount: observationCap + 2 });
  }));

  it('preserves last cumulative cursor when a compacted usage identity returns', async () => fixture(async (filePath) => {
    const observationCap = 3;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxUsageObservationsPerExecution: observationCap });
    const claimed = await store.claim(request());
    await store.appendUsageObservation(claimed.record.id, {
      observationId: 'returning-1', executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 'returning', workAttempt: 0,
      claimGeneration: 0, adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 1, provider: 'p', routingIdentity: 'returning-route',
      cumulative: { inputTokens: 10 }, completeness: 'complete', observedAt: 1
    });
    for (let sequence = 1; sequence <= observationCap; sequence += 1) {
      await store.appendUsageObservation(claimed.record.id, {
        observationId: `other-${sequence}`, executionAttempt: 1, role: 'worker', slotId: 'slot-2', sessionId: 'other', workAttempt: 0,
        claimGeneration: 0, adapterEpoch: 0, sampleKind: 'heartbeat', sequence, provider: 'p', routingIdentity: 'other-route',
        cumulative: { inputTokens: sequence }, completeness: 'complete', observedAt: sequence + 1
      });
    }
    const returned = await store.appendUsageObservation(claimed.record.id, {
      observationId: 'returning-2', executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 'returning', workAttempt: 0,
      claimGeneration: 0, adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 2, provider: 'p', routingIdentity: 'returning-route',
      cumulative: { inputTokens: 15 }, completeness: 'complete', observedAt: 2_000
    });
    expect(returned.observation.delta).toEqual({ inputTokens: 5 });
    expect(usageRollup(returned.record.usageObservations!, returned.record.usageBaseline).inputTokens).toBe(18);
  }));

  it('records one immutable host-issued authorization context', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const context = { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:auth' }] };
    const recorded = await store.setAuthorizationContext(starting.id, starting.stateVersion, context, 'sha256:context');
    expect(recorded).toMatchObject({ authorizationContext: context, authorizationContextDigest: 'sha256:context' });
    await expect(store.setAuthorizationContext(recorded.id, recorded.stateVersion, context, 'sha256:other')).rejects.toThrow('invalid execution authorization context');
  }));

  it('persists one prepared launch intent before dispatch', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const prepared = await store.prepareLaunchIntent(starting.id, starting.stateVersion, { version: 1, authorizationContextDigest: 'sha256:context', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: 'sha256:task' }] });
    expect(prepared.launchIntent).toMatchObject({ preparedAt: 10 });
    await expect(store.prepareLaunchIntent(prepared.id, prepared.stateVersion, { version: 1, authorizationContextDigest: 'sha256:context', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: 'sha256:task' }] })).rejects.toThrow('invalid execution launch intent');
  }));

  it('retries only a pre-dispatch blocked execution with a fresh Team launch request', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const blocked = await store.transition(starting.id, starting.stateVersion, 'BLOCKED', 'warning', 'Authorization denied');
    const retry = await store.beginRetry(blocked.id, blocked.stateVersion);
    expect(retry).toMatchObject({ id: 'execution-1', attempt: 2, state: 'STARTING', teamLaunchRequestId: 'execution-1:attempt:2', request: request().request });
    await expect(store.beginRetry(retry.id, retry.stateVersion)).rejects.toThrow('retry is not allowed');
  }));

  it('allows orchestrator role to pull and ack deliveries', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `delivery-${n}`; })() });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:med' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:med' }, 'a', { id: 'blocker-1', question: 'Help?' });
    
    const enqueued = await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' });
    expect(enqueued.outcome).toBe('accepted');
    
    const pulled = await store.pullBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'orchestrator:med', role: 'orchestrator' });
    expect(pulled).toMatchObject({ id: 'delivery-2', state: 'LEASED', attempt: 1 });
    
    const acked = await store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'orchestrator:med', role: 'orchestrator' }, pulled!.id, pulled!.leaseId!, { delivered: true });
    expect(acked.outcome).toBe('accepted');
    expect(acked.record.blockers?.[0]).toMatchObject({ resolved: true, response: 'Answer' });
  }));
});

describe('execution store dispatchReady (engine-cascade auto-assign)', () => {
  type Slot = { slotId: string; personaId: string; authorizationIdDigest: string };
  const TWO_WORKERS: Slot[] = [
    { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
    { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' },
    { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 'w2-d' }
  ];

  async function running(store: ReturnType<typeof createExecutionStore>, slots: Slot[], units: unknown[]) {
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    let record = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.setAuthorizationContext(record.id, record.stateVersion, {
      version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots
    }, 'context');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return store.registerPlan(record.id, record.stateVersion, units as any);
  }

  it('assigns each READY unit to a free worker slot, excludes orchestrator slots, and bumps once', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: [], files: ['b.txt'] }
    ]);
    const before = record.stateVersion;
    const { record: updated, assignments } = await store.dispatchReady(record.id);
    expect(assignments.map((a) => a.workUnitId).sort()).toEqual(['a', 'b']);
    expect(new Set(assignments.map((a) => a.slotId))).toEqual(new Set(['slot-1', 'slot-2']));
    expect(assignments.every((a) => a.slotId !== 'orchestrator:lead')).toBe(true);
    expect(updated.workUnits?.every((u) => u.state === 'CLAIMED' && u.attempt === 1)).toBe(true);
    expect(updated.stateVersion).toBe(before + 1); // single bump for the whole pass
  }));

  it('routes a unit to the slot whose persona matches its preferredRole before round-robin', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, [
      { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
      { slotId: 'alpha', personaId: 'alpha', authorizationIdDigest: 'a-d' },
      { slotId: 'beta', personaId: 'beta', authorizationIdDigest: 'b-d' }
    ], [
      { id: 'x', title: 'X', task: 'do x', dependencies: [], preferredRole: 'beta', files: ['x.txt'] }
    ]);
    const { assignments } = await store.dispatchReady(record.id);
    expect(assignments).toMatchObject([{ workUnitId: 'x', slotId: 'beta' }]);
  }));

  it('skips a worker slot already busy with a claimed unit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: [], files: ['b.txt'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    const { assignments } = await store.dispatchReady(record.id);
    expect(assignments).toMatchObject([{ workUnitId: 'b', slotId: 'slot-2' }]); // slot-1 busy → only slot-2 free
  }));

  it('leaves a scope-overlapping mutating unit READY instead of double-claiming a file', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['shared.txt'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: [], files: ['shared.txt'] }
    ]);
    const { record: updated, assignments } = await store.dispatchReady(record.id);
    expect(assignments).toHaveLength(1); // only the first over shared.txt claims
    const claimed = assignments[0].workUnitId;
    const other = claimed === 'a' ? 'b' : 'a';
    expect(updated.workUnits?.find((u) => u.id === other)?.state).toBe('READY');
  }));

  it('leaves extra READY units for the next cascade when workers are outnumbered', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: [], files: ['b.txt'] },
      { id: 'c', title: 'C', task: 'do c', dependencies: [], files: ['c.txt'] }
    ]);
    const { record: updated, assignments } = await store.dispatchReady(record.id);
    expect(assignments).toHaveLength(2); // two free workers
    const stillReady = (updated.workUnits ?? []).filter((u) => u.state === 'READY');
    expect(stillReady).toHaveLength(1);
  }));

  it('is a no-op that does not bump stateVersion when nothing is READY', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [] },
      { id: 'b', title: 'B', task: 'do b', dependencies: ['a'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    const before = record.stateVersion; // a CLAIMED, b PENDING → no READY unit
    const { record: updated, assignments } = await store.dispatchReady(record.id);
    expect(assignments).toHaveLength(0);
    expect(updated.stateVersion).toBe(before);
  }));

  it('deprioritizes the just-completed slot in favor of an idle peer', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      // no preferredRole → falls to round-robin, which would pick slot-1 (index 0)
      // absent the deprioritize hint; the completing slot-1 must be skipped.
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'] }
    ]);
    const { assignments } = await store.dispatchReady(record.id, { deprioritizeSlotId: 'slot-1' });
    expect(assignments).toMatchObject([{ workUnitId: 'a', slotId: 'slot-2' }]);
  }));

  it('falls back to the deprioritized slot when it is the only free worker', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'] },
      { id: 'b', title: 'B', task: 'do b', dependencies: [], files: ['b.txt'] }
    ]);
    // slot-2 busy → slot-1 (the deprioritized one) is the only free worker; it
    // must still receive the unit rather than leaving it undispatched.
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'b', 'slot-2');
    const { assignments } = await store.dispatchReady(record.id, { deprioritizeSlotId: 'slot-1' });
    expect(assignments).toMatchObject([{ workUnitId: 'a', slotId: 'slot-1' }]);
  }));

  it('honors an explicit preferredRole even when that slot is deprioritized', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], preferredRole: 'worker', files: ['a.txt'] }
    ]);
    // preferredRole 'worker' matches BOTH slots; the match scans the post-sort
    // freeSlots (deprioritized slot-1 last) so it picks slot-2 — deprioritize
    // still steers a persona-tie away from the just-completed slot.
    const { assignments } = await store.dispatchReady(record.id, { deprioritizeSlotId: 'slot-1' });
    expect(assignments).toMatchObject([{ workUnitId: 'a', slotId: 'slot-2' }]);
  }));

  it('records one idempotent shadow recommendation without changing legacy assignment', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], routing: { version: 1, requiredRole: 'worker', estimatedContextBytes: 100 } }
    ]);
    const first = await store.dispatchReady(record.id);
    expect(first.assignments).toMatchObject([{ workUnitId: 'a', slotId: 'slot-1' }]);
    expect(first.record.routingDecisions).toMatchObject([{ workUnitId: 'a', attempt: 1, policyVersion: 1 }]);
    const second = await store.dispatchReady(record.id);
    expect(second.record.routingDecisions).toHaveLength(1);
  }));

  it('enforcement selects only recommended qualified free slot and fails impossible work', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, [
      { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
      { slotId: 'alpha', personaId: 'alpha', authorizationIdDigest: 'a-d' },
      { slotId: 'beta', personaId: 'beta', authorizationIdDigest: 'b-d' }
    ], [
      { id: 'qualified', title: 'Qualified', task: 'do it', dependencies: [], files: ['a.txt'], routing: { version: 1, requiredRole: 'beta' } },
      { id: 'impossible', title: 'Impossible', task: 'do it', dependencies: [], files: ['b.txt'], routing: { version: 1, requiredRole: 'missing' } }
    ]);
    const { assignments, record: updated } = await store.dispatchReady(record.id, { enforceRouting: true });
    expect(assignments).toMatchObject([{ workUnitId: 'qualified', slotId: 'beta' }]);
    expect(updated.workUnits?.find((unit) => unit.id === 'impossible')).toMatchObject({ state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE' });
  }));

  it('enforcement recomputes free qualified slots after an earlier claim', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store, TWO_WORKERS, [
      { id: 'a', title: 'A', task: 'a', dependencies: [], files: ['a.txt'], routing: { version: 1, requiredRole: 'worker' } },
      { id: 'b', title: 'B', task: 'b', dependencies: [], files: ['b.txt'], routing: { version: 1, requiredRole: 'worker' } }
    ]);
    const { assignments, record: updated } = await store.dispatchReady(record.id, { enforceRouting: true });
    expect(updated.routingDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ workUnitId: 'a', recommendedSlotId: 'slot-1' }),
      expect.objectContaining({ workUnitId: 'b', recommendedSlotId: 'slot-2' })
    ]));
    expect(new Set(assignments.map((assignment) => assignment.slotId))).toEqual(new Set(['slot-1', 'slot-2']));
  }));
});
