import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, EXECUTION_RECOVERY_TTL_MS } from '../execution/store.js';
import { MAX_TEAM_INITIAL_TASK_BYTES } from '../launch/team-lifecycle-store.js';

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

describe('execution store', () => {
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

  it('fails active delivery when blocker resolves through retry and rejects stale ack', async () => fixture(async (filePath) => {
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
    record = await store.retryWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'retry');
    expect(record.deliveries?.find((delivery) => delivery.blockerId === 'blocker-retry')).toMatchObject({ state: 'FAILED', lastError: 'blocker resolved by work retry' });
    await expect(store.ackBlockerDelivery({ executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' }, leased!.id, leased!.leaseId!, { delivered: true })).rejects.toThrow('delivery is no longer active');
  }));

  it('fails active delivery when blocker resolves through alternate response path', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionStore({ filePath, id: () => id++ === 0 ? 'execution-1' : `id-${id}` });
    let record = (await store.claim(request())).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Queued answer' })).record;
    record = await store.respondToBlocker(record.id, record.stateVersion, 'blocker-1', 'Direct answer');
    record = await store.resumeBlocker(record.id, record.stateVersion, 'blocker-1');
    expect(record.blockers?.[0]).toMatchObject({ resolved: true, response: 'Direct answer' });
    expect(record.deliveries?.[0]).toMatchObject({ state: 'FAILED', lastError: 'blocker resolved through alternate path' });
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

  it('durably blocks, responds, and resumes exact work and slot with version fencing', async () => fixture(async (filePath) => {
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
    await expect(store.respondToBlocker(blocked.id, record.stateVersion, 'blocker-1', 'A')).rejects.toThrow('stale execution state');
    const responded = await store.respondToBlocker(blocked.id, blocked.stateVersion, 'blocker-1', 'A');
    expect(responded.blockers?.[0]).toMatchObject({ response: 'A', resolved: false });
    const resumed = await store.resumeBlocker(responded.id, responded.stateVersion, 'blocker-1');
    expect(resumed).toMatchObject({ state: 'RUNNING', blockers: [{ resolved: true }], workUnits: [{ state: 'CLAIMED', assignedSlotId: 'slot-1' }] });
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
    const claim = await store.claim({ ...request(), resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model', reasoning: 'high' }] });
    expect(claim).toMatchObject({ record: { resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model', reasoning: 'high' }] } });
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
