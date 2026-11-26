import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Worker-reported failure of a claim that never started: retried through the shared kickoff budget, then blocked.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-no-start-retry-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }] };
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unitInput = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'], routing: { version: 1 as const, requiredRole: 'engineer' } };
const worker = (slotId: string) => ({ executionId: 'execution-1', projectId: 'project-1', slotId, role: 'worker' as const });

function build(filePath: string, clock: { t: number }, slots: string[], enforce = true, extra: Record<string, unknown> = { noStartRetryPauseMs: 0 }) {
  const now = () => clock.t;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const workers = slots.map((slotId) => ({ slotId, personaId: 'engineer' }));
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...workers.map((w) => ({ ...w, authorizationIdDigest: `${w.slotId}-d` }))
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: workers.map((w) => ({ slotId: w.slotId, sessionId: `session-${w.slotId}`, projectId: 'project-1' })) }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    resolveTeamModelSnapshots: () => workers.map((w) => ({ ...w, provider: 'anthropic', model: 'm' })),
    replyToSession, now, inbox: { append: vi.fn(async () => undefined) }, logError: vi.fn(),
    claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => enforce,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    ...extra
  } as never);
  return { service, store };
}

async function start(service: SquadExecutionService) {
  const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unitInput] } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
}

const unitOf = async (store: ReturnType<typeof build>['store']) => (await store.get('execution-1'))!.workUnits![0];

describe('no-start retry of worker-reported failures', () => {
  it('re-homes a never-started failure onto a fresh seat and charges the shared kickoff budget', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store } = build(filePath, clock, ['engineer:0', 'engineer:1']);
    await start(service);
    const out = await service.failWork(worker('engineer:0'), 'a', 'worker could not start at 2026-01-01T10:00:00Z', 'UNKNOWN');
    expect(out.ok).toBe(true);
    const unit = await unitOf(store);
    expect(unit.state).toBe('CLAIMED');
    expect(unit.assignedSlotId).toBe('engineer:1');
    expect(unit.failureCode).toBeUndefined();
    expect(unit.noProgressSlots?.[0]).toMatchObject({ slotId: 'engineer:0', turned: false });
    expect(unit.history.some((h) => h.action === 'released' && h.detail?.includes('worker reported no-start failure'))).toBe(true);
  }));

  it('retries the only seat once, then blocks to a human naming the reason', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store } = build(filePath, clock, ['engineer:0']);
    await start(service);
    await service.failWork(worker('engineer:0'), 'a', 'boot failure 1', 'WORK_FAILED');
    expect(await unitOf(store)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'engineer:0', kickoffFailures: 1 });
    await service.failWork(worker('engineer:0'), 'a', 'different failure here', 'TRANSIENT');
    await service.failWork(worker('engineer:0'), 'a', 'yet another failure text', 'RESOURCE_EXHAUSTED');
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits![0].state).toBe('BLOCKED');
    expect(record.workUnits![0].kickoffFailures).toBeLessThanOrEqual(KICKOFF_FAILURE_BLOCK_THRESHOLD);
    expect(record.blockers!.find((b) => b.workUnitId === 'a')).toMatchObject({ audience: 'human', resolved: false });
    expect(record.blockers![0].question).toContain('engineer:0');
  }));

  it('stops retrying when the normalized failure text repeats (timestamps and numbers stripped)', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store } = build(filePath, clock, ['engineer:0', 'engineer:1']);
    await start(service);
    await service.failWork(worker('engineer:0'), 'a', 'spawn failed at 2026-01-01T10:00:00Z pid 41', 'UNKNOWN');
    expect((await unitOf(store)).assignedSlotId).toBe('engineer:1');
    await service.failWork(worker('engineer:1'), 'a', 'spawn failed at 2026-02-02T11:11:11Z pid 977', 'UNKNOWN');
    const unit = await unitOf(store);
    expect(unit.state).toBe('FAILED');
    expect(unit.failure).toContain('No-start retry of work unit a: A failed (same failure as the previous attempt)');
    expect(unit.failure).toContain('spawn failed at 2026-02-02');
  }));

  it.each(['SEMANTIC_CONFLICT', 'POLICY_ESCALATION', 'VALIDATION_FAILED', 'PERMISSION_DENIED', 'STALLED'] as const)('does not retry %s', async (code) => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store } = build(filePath, clock, ['engineer:0', 'engineer:1']);
    await start(service);
    await service.failWork(worker('engineer:0'), 'a', 'nope', code);
    expect(await unitOf(store)).toMatchObject({ state: 'FAILED', failureCode: code });
  }));

  it('does not retry a claim that started (a turn was reported)', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store } = build(filePath, clock, ['engineer:0', 'engineer:1']);
    await start(service);
    const claimed = await unitOf(store);
    await store.heartbeatWork('execution-1', (await store.get('execution-1'))!.stateVersion, worker('engineer:0'), 'a', { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration!, turnCount: 2 });
    await service.failWork(worker('engineer:0'), 'a', 'broke midway', 'UNKNOWN');
    expect(await unitOf(store)).toMatchObject({ state: 'FAILED', failureCode: 'UNKNOWN' });
  }));

  it('does not retry with structured evidence, a stale claim fence, or when recovery enforcement is off', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const off = build(`${filePath}-off`, clock, ['engineer:0', 'engineer:1'], false);
    await start(off.service);
    await off.service.failWork(worker('engineer:0'), 'a', 'x', 'UNKNOWN');
    expect((await unitOf(off.store)).state).toBe('FAILED');

    const { service, store } = build(filePath, clock, ['engineer:0', 'engineer:1']);
    await start(service);
    const claimed = await unitOf(store);
    const stale = await service.failWork(worker('engineer:0'), 'a', 'x', 'UNKNOWN', { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration! + 5 });
    expect(stale.ok).toBe(false);
    expect((await unitOf(store)).state).toBe('CLAIMED');
    // a failure from a different seat than the assignee is not recovered here
    const wrong = await service.failWork(worker('engineer:1'), 'a', 'x', 'UNKNOWN');
    expect(wrong.ok).toBe(false);
    expect((await unitOf(store)).assignedSlotId).toBe('engineer:0');
  }));
});

describe('no-start retry pause', () => {
  function fakeTimers() {
    const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    return {
      timers,
      setTimer: ((fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t as never; }),
      clearTimer: ((t: { cleared: boolean }) => { t.cleared = true; }) as never
    };
  }
  const flush = async () => { for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  it('waits the bounded 30s pause before reclaiming, then retries', async () => fixture(async (filePath) => {
    const t = fakeTimers();
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1'], true, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    await start(service);
    const pending = service.failWork(worker('engineer:0'), 'a', 'boot failure', 'UNKNOWN');
    await flush();
    const pause = t.timers.find((timer) => timer.ms === 30_000)!;
    expect(pause).toBeDefined();
    expect((await unitOf(store)).assignedSlotId).toBe('engineer:0');
    pause.fn();
    expect((await pending).ok).toBe(true);
    expect((await unitOf(store)).assignedSlotId).toBe('engineer:1');
  }));

  it('caps an oversized configured pause at 30s', async () => fixture(async (filePath) => {
    const t = fakeTimers();
    const { service } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1'], true, { setTimer: t.setTimer, clearTimer: t.clearTimer, noStartRetryPauseMs: 10 * 60_000 });
    await start(service);
    const pending = service.failWork(worker('engineer:0'), 'a', 'boot failure', 'UNKNOWN');
    await flush();
    expect(t.timers.some((timer) => timer.ms === 30_000)).toBe(true);
    t.timers.find((timer) => timer.ms === 30_000)!.fn();
    await pending;
  }));

  it('releases the pause timer on dispose and fails the unit normally', async () => fixture(async (filePath) => {
    const t = fakeTimers();
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1'], true, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    await start(service);
    const pending = service.failWork(worker('engineer:0'), 'a', 'boot failure', 'UNKNOWN');
    await flush();
    service.dispose();
    await pending;
    expect(t.timers.find((timer) => timer.ms === 30_000)!.cleared).toBe(true);
    expect((await unitOf(store)).state).toBe('FAILED');
  }));

  it('does not pause or retry once disposed', async () => fixture(async (filePath) => {
    const t = fakeTimers();
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1'], true, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    await start(service);
    service.dispose();
    await service.failWork(worker('engineer:0'), 'a', 'boot failure', 'UNKNOWN');
    expect(t.timers.filter((timer) => timer.ms === 30_000)).toHaveLength(0);
    expect((await unitOf(store)).state).toBe('FAILED');
  }));

  it('abandons the retry when the claim changed during the pause', async () => fixture(async (filePath) => {
    const t = fakeTimers();
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1'], true, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    await start(service);
    const claimed = await unitOf(store);
    const pending = service.failWork(worker('engineer:0'), 'a', 'boot failure', 'UNKNOWN');
    await flush();
    await store.heartbeatWork('execution-1', (await store.get('execution-1'))!.stateVersion, worker('engineer:0'), 'a', { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration!, turnCount: 1 });
    t.timers.find((timer) => timer.ms === 30_000)!.fn();
    await pending;
    expect((await unitOf(store)).state).toBe('FAILED');
  }));

  it('names the unit as id: title when the retry budget is spent and the retry failed again', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store } = build(filePath, clock, ['engineer:0', 'engineer:1']);
    await start(service);
    await service.failWork(worker('engineer:0'), 'a', 'boot failure one', 'UNKNOWN');
    const unit = await unitOf(store);
    expect(unit.history.some((h) => h.detail?.includes('no-start failure'))).toBe(true);
    await service.failWork(worker(unit.assignedSlotId!), 'a', 'boot failure one', 'UNKNOWN');
    expect((await unitOf(store)).failure).toMatch(/^No-start retry of work unit a: A failed/);
  }));
});

