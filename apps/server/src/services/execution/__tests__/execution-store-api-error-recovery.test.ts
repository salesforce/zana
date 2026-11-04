import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, formatRecoveryClock, isWorkerRecoveryActive, isWorkerRecoveryLive, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON, WorkUnitRecoveryGuardError, type ExecutionWorkUnit, type RecordWorkerRecoveryInput } from '../store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-api-error-'));
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

async function running(store: Store, slotIds: string[], title = 'Unit') {
  let record = (await store.claim(request())).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...slotIds.map((slotId) => ({ slotId, personaId: 'worker', authorizationIdDigest: slotId }))
    ]
  }, 'authorization-digest');
  return store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title, task: 'Work', dependencies: [], readOnly: true }]);
}

async function claimAndReclaim(store: Store, executionId: string, slotId: string) {
  let record = await store.get(executionId);
  record = await store.claimWork(executionId, record!.stateVersion, { role: 'worker', slotId }, 'unit');
  const claim = record.workUnits![0];
  return store.reclaimExpiredClaims(executionId, [{ workUnitId: 'unit', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
}

describe('today (characterization)', () => {
  it('silently reclaims a never-turned claim into READY with no-progress evidence', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const start = await running(store, ['slot-1']);
    const record = await claimAndReclaim(store, start.id, 'slot-1');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', kickoffFailures: 1 });
    expect(record.workUnits![0].noProgressSlots).toEqual([
      expect.objectContaining({ slotId: 'slot-1', executionAttempt: record.attempt, reason: NO_PROGRESS_CLAIM_REASON.SILENT })
    ]);
    expect(record.workUnits![0].apiErrorRecovery).toBeUndefined();
  }));

  it('reassignKickoffToFreshSlot moves a churned unit to an untried slot', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, ['slot-1', 'slot-2']);
    for (let i = 0; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) record = await claimAndReclaim(store, record.id, 'slot-1');
    record = await store.reassignKickoffToFreshSlot(record.id, 'unit');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', assignedSlotId: 'slot-2' });
  }));

  it('blockKickoffFailure on the last slot blocks with the exact question', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, ['slot-1']);
    record = await claimAndReclaim(store, record.id, 'slot-1');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.workUnits![0].state).toBe('BLOCKED');
    expect(record.blockers).toEqual([expect.objectContaining({
      id: `no-progress:${record.attempt}:unit:${record.workUnits![0].attempt}`,
      workUnitId: 'unit', audience: 'human', resolved: false,
      question: 'Work unit unit (Unit) made no progress on every eligible worker slot; its worker never started a turn. Check the worker terminal, then retry the unit or restart the run.'
    })]);
  }));
});

async function claimed(store: Store, slotId = 'slot-1', slots = ['slot-1', 'slot-2'], title = 'Unit') {
  let record = await running(store, slots, title);
  record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId }, 'unit');
  const unit = record.workUnits![0];
  const input = (overrides: Partial<RecordWorkerRecoveryInput> = {}): RecordWorkerRecoveryInput => ({
    workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, slotId,
    step: 'waiting', errorKind: 'overloaded', errorText: 'API Error 529', severity: 'warning', summary: 'Worker hit an API error', ...overrides
  });
  return { record, unit, input };
}

describe('recordWorkerRecovery', () => {
  it('rejects a wrong claim id, generation, slot, or a unit that is not CLAIMED', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store);
    for (const bad of [{ claimId: 'other' }, { claimGeneration: 99 }, { slotId: 'slot-2' }]) {
      await expect(store.recordWorkerRecovery(record.id, input(bad))).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    }
    await expect(store.recordWorkerRecovery('missing', input())).rejects.toThrow('execution not found');
    await expect(store.recordWorkerRecovery(record.id, input({ step: 'bogus' as never }))).rejects.toThrow('invalid worker recovery step');
    const after = await claimAndReclaim(store, record.id, 'slot-1');
    await expect(store.recordWorkerRecovery(record.id, input())).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    expect(after.workUnits![0].apiErrorRecovery).toBeUndefined();
  }));

  it('starts a new object, then updates it, bounding steps and text, with exactly one progress event', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    const { record, input } = await claimed(store);
    const before = (await store.events('session-1', 'project-1', record.id)).events.length;
    let next = await store.recordWorkerRecovery(record.id, input({ errorKind: 'k'.repeat(100), errorText: 'e'.repeat(900), deadlineAt: 5_000, detail: 'd'.repeat(400) }));
    let recovery = next.workUnits![0].apiErrorRecovery!;
    expect(recovery).toMatchObject({ step: 'waiting', startedAt: 1_000, updatedAt: 1_000, deadlineAt: 5_000, slotId: 'slot-1', executionAttempt: next.attempt });
    expect(recovery.errorKind).toHaveLength(64);
    expect(recovery.errorText).toHaveLength(500);
    expect(recovery.steps[0].detail).toHaveLength(300);
    const events = (await store.events('session-1', 'project-1', record.id)).events;
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({ eventType: 'progress', slotId: 'slot-1', severity: 'warning', summary: 'Worker hit an API error', detail: 'd'.repeat(300) });
    expect(next.stateVersion).toBe(record.stateVersion + 1);

    now = 2_000;
    for (let i = 0; i < 10; i++) {
      now += 1;
      next = await store.recordWorkerRecovery(record.id, input({ step: 'nudged', errorKind: '', errorText: '', detail: '', severity: 'info' }));
    }
    recovery = next.workUnits![0].apiErrorRecovery!;
    expect(recovery).toMatchObject({ step: 'nudged', startedAt: 1_000, updatedAt: 2_010, deadlineAt: 5_000 });
    expect(recovery.errorKind).toHaveLength(64); // empty strings do not overwrite
    expect(recovery.steps).toHaveLength(8);
    expect(recovery.steps.every((entry) => entry.detail === undefined || entry.detail.length > 0)).toBe(true);
    expect((await store.events('session-1', 'project-1', record.id)).events.at(-1)?.detail).toBeUndefined();
  }));

  it('omits empty optional strings and survives a reload from the same file', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store);
    const next = await store.recordWorkerRecovery(record.id, input({ errorKind: '', errorText: '', detail: '' }));
    expect(next.workUnits![0].apiErrorRecovery).not.toHaveProperty('errorKind');
    expect(next.workUnits![0].apiErrorRecovery).not.toHaveProperty('errorText');
    await store.recordWorkerRecovery(record.id, input({ step: 'restarted', detail: 'restart ok' }));
    const reloaded = createExecutionStore({ filePath, id: () => 'other', now: () => 1_000 });
    const loaded = await reloaded.get(record.id);
    expect(loaded?.workUnits![0].apiErrorRecovery).toMatchObject({ step: 'restarted', steps: [{ step: 'waiting' }, { step: 'restarted', detail: 'restart ok' }] });
    expect((await reloaded.events('session-1', 'project-1', record.id)).events.at(-1)).toMatchObject({ eventType: 'progress', detail: 'restart ok' });
  }));

  it('starts a fresh object for a newer claim and goes inactive after a reclaim or new claim', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store);
    let next = await store.recordWorkerRecovery(record.id, input());
    expect(isWorkerRecoveryActive(next.workUnits![0])).toBe(true);
    for (const step of ['nudged', 'restarted'] as const) {
      next = await store.recordWorkerRecovery(record.id, input({ step }));
      expect(isWorkerRecoveryActive(next.workUnits![0])).toBe(true);
    }
    for (const step of ['resumed', 'restart-failed', 'exhausted'] as const) {
      next = await store.recordWorkerRecovery(record.id, input({ step }));
      expect(isWorkerRecoveryActive(next.workUnits![0])).toBe(false);
    }
    const stale = next.workUnits![0].apiErrorRecovery!;
    next = await claimAndReclaim(store, record.id, 'slot-1');
    expect(isWorkerRecoveryActive(next.workUnits![0])).toBe(false);
    expect(next.workUnits![0].apiErrorRecovery).toEqual(stale); // kept as evidence
    next = await store.claimWork(next.id, next.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
    expect(isWorkerRecoveryActive(next.workUnits![0])).toBe(false);
    const unit = next.workUnits![0];
    next = await store.recordWorkerRecovery(next.id, { ...input({ step: 'waiting' }), claimId: unit.claimId!, claimGeneration: unit.claimGeneration! });
    expect(next.workUnits![0].apiErrorRecovery).toMatchObject({ claimId: unit.claimId, startedAt: 1_000, steps: [{ step: 'waiting' }] });
    expect(isWorkerRecoveryActive(next.workUnits![0])).toBe(true);
    expect(isWorkerRecoveryActive({ ...next.workUnits![0], state: 'READY' } as ExecutionWorkUnit)).toBe(false);
  }));

  it('is live only while active and before its deadline', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store);
    let next = await store.recordWorkerRecovery(record.id, input());
    expect(isWorkerRecoveryLive(next.workUnits![0], 1_000)).toBe(false); // no deadline recorded
    next = await store.recordWorkerRecovery(record.id, input({ step: 'nudged', deadlineAt: 5_000 }));
    expect(isWorkerRecoveryLive(next.workUnits![0], 4_999)).toBe(true);
    expect(isWorkerRecoveryLive(next.workUnits![0], 5_000)).toBe(false);
    next = await store.recordWorkerRecovery(record.id, input({ step: 'restart-failed' }));
    expect(isWorkerRecoveryLive(next.workUnits![0], 1_000)).toBe(false); // blockable, but no longer live
  }));

  it('is cleared by retryWork', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store);
    await store.recordWorkerRecovery(record.id, input());
    let next = await store.blockKickoffFailure(record.id, 'unit', { claimId: record.workUnits![0].claimId!, claimGeneration: record.workUnits![0].claimGeneration! });
    expect(next.workUnits![0].apiErrorRecovery?.step).toBe('exhausted');
    next = await store.retryWork(next.id, next.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'unit');
    expect(next.workUnits![0].apiErrorRecovery).toBeUndefined();
  }));
});

describe('blockKickoffFailure with recovery evidence', () => {
  it('adds the earlier-recovery sentence only when the unit has recovery for this attempt', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store, 'slot-1', ['slot-1']);
    await store.recordWorkerRecovery(record.id, input({ errorKind: 'overloaded', errorText: 'x'.repeat(400) }));
    await store.recordWorkerRecovery(record.id, input({ step: 'nudged', errorKind: '', errorText: '' }));
    let next = await claimAndReclaim(store, record.id, 'slot-1');
    next = await store.blockKickoffFailure(next.id, 'unit');
    const question = next.blockers![0].question;
    expect(question).toContain(' Earlier, Zana tried to recover slot-1 after an API error: waiting, nudged. Last error: overloaded: ');
    expect(question).toContain(` ${'x'.repeat(300)}. Check the worker terminal`);
    expect(question).not.toContain('x'.repeat(301));
    expect(next.workUnits![0].history.at(-1)?.detail).toBe('kickoff delivery produced no worker turn');
  }));

  it('keeps the question byte-identical without recovery', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    let record = await running(store, ['slot-1']);
    record = await claimAndReclaim(store, record.id, 'slot-1');
    record = await store.blockKickoffFailure(record.id, 'unit');
    expect(record.blockers![0].question).toBe('Work unit unit (Unit) made no progress on every eligible worker slot; its worker never started a turn. Check the worker terminal, then retry the unit or restart the run.');
  }));

  it('blocks an unrecovered API error with the dedicated question and guards the fence', async () => fixture(async (filePath) => {
    let now = new Date(2026, 9, 23, 9, 5).getTime();
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    const { record, unit, input } = await claimed(store);
    const fence = { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
    await expect(store.blockKickoffFailure(record.id, 'unit', fence)).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError); // no recovery yet
    await store.recordWorkerRecovery(record.id, input());
    await expect(store.blockKickoffFailure(record.id, 'unit', { ...fence, claimGeneration: 99 })).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    await store.recordWorkerRecovery(record.id, input({ step: 'nudged' }));
    now = new Date(2026, 9, 23, 9, 10).getTime();
    await store.recordWorkerRecovery(record.id, input({ step: 'restarted' }));
    const next = await store.blockKickoffFailure(record.id, 'unit', fence);
    const blocker = next.blockers![0];
    expect(blocker.id).toBe(`no-progress:${next.attempt}:unit:${next.workUnits![0].attempt}`);
    expect(blocker.question).toBe('Work unit `unit` (Unit) stopped after an API error on slot-1 and did not recover. Zana nudged it at 09:05 and restarted its session at 09:10. Last error: overloaded: API Error 529. Check the worker terminal, then retry the unit or restart the run.');
    expect(next.workUnits![0]).toMatchObject({ state: 'BLOCKED' });
    expect(next.workUnits![0].apiErrorRecovery?.step).toBe('exhausted');
    expect(next.workUnits![0].history.at(-1)?.detail).toBe('stopped after an API error');
    expect(next.state).toBe('BLOCKED');
    await expect(store.blockKickoffFailure(record.id, 'unit', fence)).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
  }));

  it('refuses to block a recovery that already resumed', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, unit, input } = await claimed(store);
    const fence = { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
    await store.recordWorkerRecovery(record.id, input({ step: 'nudged' }));
    await store.recordWorkerRecovery(record.id, input({ step: 'resumed' }));
    await expect(store.blockKickoffFailure(record.id, 'unit', fence)).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    expect((await store.get(record.id))!.workUnits![0].state).toBe('CLAIMED');
  }));

  it('names a restart that could not be done', async () => fixture(async (filePath) => {
    const now = new Date(2026, 9, 23, 9, 5).getTime();
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => now });
    const { record, unit, input } = await claimed(store);
    await store.recordWorkerRecovery(record.id, input({ step: 'nudged' }));
    await store.recordWorkerRecovery(record.id, input({ step: 'restart-failed' }));
    const next = await store.blockKickoffFailure(record.id, 'unit', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! });
    expect(next.blockers![0].question).toContain('Zana nudged it at 09:05 and could not restart its session at 09:05.');
  }));

  it('keeps an over-long summary and question within the stored limits instead of failing the persist', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, unit, input } = await claimed(store, 'slot-1', ['slot-1', 'slot-2'], 'T'.repeat(2_000));
    const longSummary = `Could not restart engineer slot-1: ${'x'.repeat(3_000)}`;
    await store.recordWorkerRecovery(record.id, input({ summary: longSummary }));
    const events = (await store.events('session-1', 'project-1', record.id)).events;
    expect(events.at(-1)!.summary).toBe(longSummary.slice(0, 2_048));
    const blocked = await store.blockKickoffFailure(record.id, 'unit', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! });
    expect(blocked.workUnits![0].state).toBe('BLOCKED');
    expect(blocked.blockers![0].question.length).toBe(2_048);
    // Both survive a reload from the same file.
    const reloaded = createExecutionStore({ filePath, id: () => 'other', now: () => 1_000 });
    expect((await reloaded.get(record.id))?.blockers?.[0].question.length).toBe(2_048);
  }));

  it('says the error is not temporary when nothing was retried', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, unit, input } = await claimed(store);
    await store.recordWorkerRecovery(record.id, input({ errorKind: undefined, errorText: undefined }));
    const next = await store.blockKickoffFailure(record.id, 'unit', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! });
    expect(next.blockers![0].question).toContain('Zana did not retry it because this kind of error is not temporary. Last error: unknown: no details.');
    expect(formatRecoveryClock(1_000)).toMatch(/^\d{2}:\d{2}$/);
  }));
});

describe('older versions', () => {
  it('a frozen copy of the previous validWorkUnit accepts a unit carrying apiErrorRecovery', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const { record, input } = await claimed(store);
    const next = await store.recordWorkerRecovery(record.id, input());
    expect(frozenValidWorkUnit(next.workUnits![0])).toBe(true);
    expect(next.workUnits![0].apiErrorRecovery).toBeDefined();
  }));
});

// Verbatim copy of validWorkUnit from upstream/main before this feature (deps inlined), proving an old build still loads the record.
const MAX = 2_048;
const validString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX;
const nonNeg = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0;
function frozenValidWorkUnit(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<ExecutionWorkUnit>;
  return validString(unit.id) && validString(unit.title)
    && typeof unit.task === 'string' && unit.task.length > 0
    && Array.isArray(unit.dependencies) && unit.dependencies.every(validString)
    && (unit.state === 'PENDING' || unit.state === 'READY' || unit.state === 'CLAIMED' || unit.state === 'BLOCKED' || unit.state === 'COMPLETED' || unit.state === 'FAILED' || unit.state === 'SKIPPED')
    && (unit.assignedSlotId === undefined || validString(unit.assignedSlotId)) && Number.isInteger(unit.attempt) && (unit.attempt ?? -1) >= 0
    && (unit.claimGeneration === undefined || nonNeg(unit.claimGeneration))
    && (unit.claimId === undefined || validString(unit.claimId))
    && (unit.kickoffFailures === undefined || nonNeg(unit.kickoffFailures))
    && (unit.failure === undefined || validString(unit.failure)) && (unit.result === undefined || validString(unit.result))
    && Array.isArray(unit.history);
}
