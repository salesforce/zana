import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import {
  COORDINATOR_WAKE_CONFIRM_MS,
  CoordinatorWakeConfirmations,
  isWakeConsumptionState,
  type CoordinatorWakeConfirmation
} from '../coordinator-wake-confirmation.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-wake-confirm-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }]
};

interface Harness {
  service: SquadExecutionService;
  store: ReturnType<typeof createExecutionStore>;
  reply: ReturnType<typeof vi.fn>;
  setState(state: AgentState | undefined): void;
  setCoordinator(sessionId: string): void;
  /** Fire the oldest pending consumption-window timer. */
  expire(): void;
  windows(): number;
  confirmation: CoordinatorWakeConfirmation & { current: boolean; onUnconsumed: ReturnType<typeof vi.fn> };
}

async function harness(filePath: string, over: { confirms?: boolean; reply?: () => boolean } = {}): Promise<Harness> {
  let state: AgentState | undefined = 'idle';
  let coordinator = 'coordinator';
  const windows: Array<() => void> = [];
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const reply = vi.fn(over.reply ?? (() => true));
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' }
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: coordinator, workers: [] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: reply,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    getAgentState: () => state as AgentState,
    confirmsWakeConsumption: () => over.confirms ?? true,
    setTimer: (fn, ms) => {
      if (ms === COORDINATOR_WAKE_CONFIRM_MS) windows.push(fn);
      return { unref() { return this; } } as unknown as NodeJS.Timeout;
    },
    clearTimer: () => {}
  });
  await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
  const confirmation = {
    current: true,
    isCurrent: async () => confirmation.current,
    onUnconsumed: vi.fn(async () => undefined)
  };
  return {
    service, store, reply, confirmation,
    setState: (next) => { state = next; },
    setCoordinator: (next) => { coordinator = next; },
    expire: () => windows.shift()!(),
    windows: () => windows.length
  };
}

const wakes = async (h: Harness) => (await h.store.get('execution-1'))?.coordinatorWakes ?? [];
const correctionCalls = (h: Harness) => h.reply.mock.calls.filter((call) => call[1] === 'write the corrected plan').length;

describe('confirmation-required coordinator wakes', () => {
  it('stays queued after the write and is acknowledged once the coordinator leaves idle', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    expect(h.reply).toHaveBeenCalledWith('coordinator', 'write the corrected plan');
    expect(await wakes(h)).toHaveLength(1);

    // Further idle edges and reconcile polls never re-type an in-flight wake.
    await h.service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    await h.service.drainPendingCoordinatorWakes();
    expect(correctionCalls(h)).toBe(1);

    h.service.observeCoordinatorState('other-session', 'working');
    h.service.observeCoordinatorState('coordinator', 'idle');
    expect(await wakes(h)).toHaveLength(1);
    h.service.observeCoordinatorState('coordinator', 'working');
    await vi.waitFor(async () => expect(await wakes(h)).toEqual([]));

    // The window elapsing after consumption is inert: no redelivery, no escalation.
    h.expire();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(correctionCalls(h)).toBe(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('redelivers a lost wake exactly once, then drops it and escalates', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    expect(h.windows()).toBe(1);

    h.expire();
    await vi.waitFor(() => expect(correctionCalls(h)).toBe(2));
    await vi.waitFor(() => expect(h.windows()).toBe(1));
    expect(await wakes(h)).toHaveLength(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();

    h.expire();
    await vi.waitFor(() => expect(h.confirmation.onUnconsumed).toHaveBeenCalledTimes(1));
    expect(await wakes(h)).toEqual([]);
    expect(h.windows()).toBe(0);
    // Dropped: a later idle edge never types the stale correction again.
    await h.service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(correctionCalls(h)).toBe(2);
  }));

  it('does not escalate when the redelivery is consumed', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    h.expire();
    await vi.waitFor(() => expect(correctionCalls(h)).toBe(2));
    h.service.observeCoordinatorState('coordinator', 'blocked');
    await vi.waitFor(async () => expect(await wakes(h)).toEqual([]));
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('treats a missed working edge seen at expiry as consumption', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    h.setState('working');
    h.expire();
    await vi.waitFor(async () => expect(await wakes(h)).toEqual([]));
    expect(correctionCalls(h)).toBe(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('never redelivers once the caller fence is gone (cancel / approve / superseded offer)', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    h.confirmation.current = false;
    h.expire();
    await vi.waitFor(async () => expect(await wakes(h)).toEqual([]));
    expect(correctionCalls(h)).toBe(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('never redelivers to a different coordinator generation', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    h.setCoordinator('coordinator-2');
    h.expire();
    await vi.waitFor(async () => expect(await wakes(h)).toEqual([]));
    expect(h.reply).not.toHaveBeenCalledWith('coordinator-2', expect.anything());
    expect(correctionCalls(h)).toBe(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('never redelivers after the execution is terminal', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    await h.service.stopForPlanCorrection('execution-1');
    h.expire();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(correctionCalls(h)).toBe(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('escalates without redelivering when the coordinator is no longer verifiably idle', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    h.setState('unknown');
    h.expire();
    await vi.waitFor(() => expect(h.confirmation.onUnconsumed).toHaveBeenCalledTimes(1));
    expect(correctionCalls(h)).toBe(1);
    expect(await wakes(h)).toEqual([]);
  }));

  it('escalates when the redelivery write itself fails', async () => fixture(async (filePath) => {
    let live = true;
    const h = await harness(filePath, { reply: () => live });
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    live = false;
    h.expire();
    await vi.waitFor(() => expect(h.confirmation.onUnconsumed).toHaveBeenCalledTimes(1));
    expect(await wakes(h)).toEqual([]);
  }));

  it('forgets quietly when the wake was acknowledged elsewhere before the window', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    await h.store.acknowledgeCoordinatorWake('execution-1', (await wakes(h))[0]!.id);
    h.expire();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(correctionCalls(h)).toBe(1);
    expect(h.confirmation.onUnconsumed).not.toHaveBeenCalled();
  }));

  it('gives the delivery back when the first write fails, then confirms on the next idle edge', async () => fixture(async (filePath) => {
    let live = false;
    const h = await harness(filePath, { reply: () => live });
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    expect(h.windows()).toBe(0);
    live = true;
    await h.service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(h.windows()).toBe(1);
    expect(await wakes(h)).toHaveLength(1);
  }));

  it('falls back to acknowledge-on-write for a coordinator without a status feed', async () => fixture(async (filePath) => {
    const h = await harness(filePath, { confirms: false });
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    expect(correctionCalls(h)).toBe(1);
    expect(await wakes(h)).toEqual([]);
    expect(h.windows()).toBe(0);
  }));

  it('holds wakes behind an unconfirmed head and does not dedupe distinct corrections', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    h.setState('working');
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'your corrected plan is still invalid', h.confirmation);
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    expect((await wakes(h)).map((wake) => wake.message)).toEqual(['write the corrected plan', 'your corrected plan is still invalid']);

    h.setState('idle');
    await h.service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(h.reply.mock.calls.map((call) => call[1])).toEqual(['write the corrected plan']);
    h.setState('working');
    h.service.observeCoordinatorState('coordinator', 'working');
    await vi.waitFor(async () => expect(await wakes(h)).toHaveLength(1));
    h.setState('idle');
    await h.service.drainCoordinatorWake('project-1', 'execution-1', 'coordinator');
    expect(h.reply.mock.calls.map((call) => call[1])).toEqual(['write the corrected plan', 'your corrected plan is still invalid']);
  }));

  it('logs and survives a failed acknowledgement or expiry read', async () => fixture(async (filePath) => {
    const h = await harness(filePath);
    const logError = vi.fn();
    (h.service as unknown as { deps: { logError: typeof logError } }).deps.logError = logError;
    await h.service.wakeCoordinatorForPlanCorrection('execution-1', 'write the corrected plan', h.confirmation);
    const ack = h.store.acknowledgeCoordinatorWake;
    const getInProject = h.store.getInProject;
    h.store.getInProject = async () => { throw new Error('read failed'); };
    h.expire();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining('wake confirmation failed'), expect.any(Error)));
    h.store.getInProject = getInProject;
    h.store.acknowledgeCoordinatorWake = async () => { throw new Error('ack failed'); };
    h.service.observeCoordinatorState('coordinator', 'working');
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining('wake ack failed'), expect.any(Error)));
    h.store.acknowledgeCoordinatorWake = ack;
  }));
});

describe('CoordinatorWakeConfirmations', () => {
  const confirmation: CoordinatorWakeConfirmation = { isCurrent: async () => true, onUnconsumed: () => {} };

  it('bounds deliveries, ignores stale timers and clears on dispose', () => {
    const fired: Array<() => void> = [];
    const cleared: unknown[] = [];
    const onExpire = vi.fn();
    const ledger = new CoordinatorWakeConfirmations({
      setTimer: (fn) => { fired.push(fn); return { id: fired.length } as unknown as NodeJS.Timeout; },
      clearTimer: (timer) => { cleared.push(timer); },
      onExpire,
      windowMs: 5
    });
    ledger.register('w1', 'p', 'e', confirmation);
    const entry = ledger.get('w1')!;
    ledger.register('w1', 'p', 'e', { ...confirmation });
    expect(ledger.get('w1')).toBe(entry);

    expect(ledger.beginDelivery(entry, 's', 1)).toBe(true);
    ledger.abortDelivery(entry);
    ledger.abortDelivery(entry);
    expect(entry.deliveries).toBe(0);
    expect(ledger.beginDelivery(entry, 's', 1)).toBe(true);
    expect(ledger.beginDelivery(entry, 's', 1)).toBe(true);
    expect(ledger.beginDelivery(entry, 's', 1)).toBe(false);

    ledger.arm(entry);
    ledger.arm(entry); // re-arm clears the previous window
    expect(cleared).toHaveLength(1);
    fired[0]!(); // superseded timer: inert
    expect(onExpire).not.toHaveBeenCalled();
    fired[1]!();
    expect(onExpire).toHaveBeenCalledWith(entry);

    expect(ledger.consumedBy('s', 'idle')).toEqual([]);
    expect(ledger.consumedBy('s', 'working')).toEqual([entry]);
    expect(ledger.consumedBy('x', 'working')).toEqual([]);

    ledger.arm(entry);
    ledger.dispose();
    expect(ledger.get('w1')).toBeUndefined();
    const stale = { ...entry };
    ledger.arm(stale);
    ledger.forget(stale);
    expect(ledger.beginDelivery(stale, 's', 1)).toBe(false);
  });

  it('forget clears an armed window and an expired-after-forget timer is inert', () => {
    const fired: Array<() => void> = [];
    const onExpire = vi.fn();
    const ledger = new CoordinatorWakeConfirmations({
      setTimer: (fn) => { fired.push(fn); return {} as NodeJS.Timeout; },
      clearTimer: () => {},
      onExpire
    });
    ledger.register('w', 'p', 'e', confirmation);
    const entry = ledger.get('w')!;
    ledger.arm(entry);
    ledger.forget(entry);
    fired[0]!();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('classifies consumption states', () => {
    expect(isWakeConsumptionState('working')).toBe(true);
    expect(isWakeConsumptionState('blocked')).toBe(true);
    for (const state of ['idle', 'done', 'waiting', 'unknown', undefined] as const) expect(isWakeConsumptionState(state)).toBe(false);
  });
});
