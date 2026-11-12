// R5 backstop: a MODERN worker thread reaped by the idle sweep anyway still resumes on the human answer
// (lazy resume), the delivery is acked, and the unit holds a re-armed claim lease. A failed resume
// ('uncertain') is retried by the drain within its bound, never marked delivered, and raises ONE stall notice.
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { ExecutionDeliveryDrainService } from '../execution-delivery-drain.js';

const worker = { role: 'worker' as const, slotId: 'slot-1' };
const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }], policy: { deadlineMs: 45 * 60_000 } };
const WORKER_BINDING = (executionId: string) => ({ executionId, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const,
  principalId: 'worker-1', authorizationId: 'auth-current' });

type Receipt = 'accepted' | 'uncertain' | 'rejected';

async function harness(run: (h: Awaited<ReturnType<typeof build>>) => Promise<void>, opts: { inbox?: boolean } = {}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-backstop-'));
  try { await run(await build(join(dir, 'executions.json'), opts)); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function build(filePath: string, opts: { inbox?: boolean }) {
  const clock = { now: 1_000 };
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock.now });
  const inbox = { append: vi.fn(async () => ({ id: 'inbox-1' })), appendOnce: vi.fn(async () => ({ id: 'inbox-1' })) };
  const logError = vi.fn();
  const service = new SquadExecutionService({
    store, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true, logError, ...(opts.inbox === false ? {} : { inbox }),
    resolveExactNativeRecoverySnapshots: (r: ExecutionRecord) => r.nativeRecoverySnapshots ?? [],
    now: () => clock.now, setTimer: (() => 0 as unknown as NodeJS.Timeout), clearTimer: () => undefined
  } as never);
  const started = await service.start('session-1', 'project-1', request);
  if (!started.ok) throw new Error('start failed');
  let record = (await store.get('execution-1'))!;
  record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
  record = await store.claimWork(record.id, record.stateVersion, worker, 'unit');
  await store.blockWork(record.id, record.stateVersion, worker, 'unit', { id: 'blocker', question: 'Need decision' });
  const get = async () => (await store.get('execution-1'))!;
  return { clock, store, service, inbox, logError, get };
}

/** Fake of the Modern member runtime: a reaped thread is lazily resumed by the first delivery. */
function fakeMember(script: Receipt[], reaped: boolean) {
  const state = { reaped, resumes: 0, calls: [] as Array<{ idempotencyKey: string; message: string }> };
  const deliver = async (message: string, idempotencyKey: string): Promise<Receipt> => {
    state.calls.push({ idempotencyKey, message });
    const receipt = script.shift() ?? 'accepted';
    if (receipt === 'accepted' && state.reaped) { state.reaped = false; state.resumes += 1; }
    return receipt;
  };
  return { state, deliver };
}

function drainFor(h: Awaited<ReturnType<typeof build>>, member: ReturnType<typeof fakeMember>) {
  const timers: Array<() => void> = [];
  const drain = new ExecutionDeliveryDrainService({
    pending: async () => ((await h.get()).deliveries ?? []).filter(d => d.state === 'PENDING')
      .map(d => ({ id: d.id, executionId: 'execution-1', attempt: d.attempt, manualRetryCount: d.manualRetryCount })),
    isRestful: () => true,
    reply: async (_sessionId, text, correlation) => {
      const receipt = await member.deliver(text, correlation!.idempotencyKey);
      return receipt === 'rejected' ? false : receipt === 'uncertain' ? 'uncertain' : true;
    },
    onStalled: async (_s, deliveries) => {
      for (const id of new Set(deliveries.map(d => d.executionId))) {
        await h.service.announceDeliveryStall(id, deliveries.filter(d => d.executionId === id).map(d => d.id));
      }
    },
    logError: h.logError,
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => undefined
  });
  return { drain, timers };
}

describe('reaped worker thread backstop (R5)', () => {
  it('sweep-reaped thread resumes on the answer, delivery is acked, and the unit holds a re-armed claim lease', () => harness(async (h) => {
    const member = fakeMember(['accepted'], true);
    const { drain } = drainFor(h, member);
    h.clock.now = 400_000; // long after the idle sweep released the thread
    const before = await h.get();
    expect((await h.service.resume('session-1', 'project-1', before.id, before.stateVersion, 'slot-1', 'answer')).ok).toBe(true);

    drain.observe('worker-1', 'idle');
    await vi.waitFor(() => expect(member.state.calls).toHaveLength(1));
    expect(member.state.reaped).toBe(false);
    expect(member.state.resumes).toBe(1);
    expect(member.state.calls[0].message).toContain('execution.delivery.pull');

    // The resumed worker pulls and acks.
    const binding = WORKER_BINDING(before.id);
    const pulled = await h.service.pullDelivery(binding);
    if (!pulled.ok || !pulled.value) throw new Error('missing delivery');
    h.clock.now = 410_000;
    const ack = await h.service.ackDelivery(binding, pulled.value.id, pulled.value.leaseId!, { delivered: true });
    expect(ack).toMatchObject({ ok: true, value: { resolved: true } });

    const after = await h.get();
    expect(after.deliveries![0].state).toBe('DELIVERED');
    expect(after.blockers![0].resolved).toBe(true);
    const unit = after.workUnits![0];
    expect(unit).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', claimedAt: 410_000, progressAt: 410_000, leaseExpiresAt: 410_000 + 300_000 });
    expect(unit.claimId).toEqual(expect.any(String));
    expect(h.inbox.appendOnce).not.toHaveBeenCalled();
  }));

  it("'uncertain' resume: bounded drain retries, one deduped stall notice, delivery stays PENDING and blocker open", () => harness(async (h) => {
    const member = fakeMember(['uncertain', 'uncertain', 'uncertain', 'uncertain', 'uncertain'], true);
    const { drain, timers } = drainFor(h, member);
    const before = await h.get();
    await h.service.resume('session-1', 'project-1', before.id, before.stateVersion, 'slot-1', 'answer');

    drain.observe('worker-1', 'idle');
    for (let i = 1; i <= 3; i++) { await vi.waitFor(() => expect(timers).toHaveLength(i)); timers[i - 1](); }
    await vi.waitFor(() => expect(h.inbox.appendOnce).toHaveBeenCalledTimes(1));
    expect(member.state.calls).toHaveLength(4); // 1 send + MAX_PENDING_RETRIES (3)
    expect(new Set(member.state.calls.map(c => c.idempotencyKey)).size).toBe(1);
    expect(h.inbox.appendOnce).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'execution-1', blockerId: 'blocker', dedupeKey: expect.stringMatching(/^execution-delivery-stall:execution-1:/) }));

    const after = await h.get();
    expect(after.deliveries![0].state).toBe('PENDING');
    expect(after.blockers![0].resolved).toBe(false);
    expect(after.state).toBe('BLOCKED');

    // Direct repeat of the notice is deduped by key (same input), and never marks anything delivered.
    await h.service.announceDeliveryStall('execution-1', [after.deliveries![0].id]);
    const keys = h.inbox.appendOnce.mock.calls.map(call => (call[0] as { dedupeKey: string }).dedupeKey);
    expect(new Set(keys).size).toBe(1);
    expect((await h.get()).deliveries![0].state).toBe('PENDING');
  }));
});

describe('announceDeliveryStall', () => {
  it('ignores unknown executions, unknown/non-pending deliveries, and a missing inbox', () => harness(async (h) => {
    const r = await h.get();
    await h.service.announceDeliveryStall('missing', ['x']);
    await h.service.announceDeliveryStall(r.id, ['no-such-delivery']);
    expect(h.inbox.appendOnce).not.toHaveBeenCalled();
  }));

  it('skips a terminal execution and survives inbox failure / append fallback', () => harness(async (h) => {
    const r = await h.get();
    await h.service.resume('session-1', 'project-1', r.id, r.stateVersion, 'slot-1', 'answer');
    const id = (await h.get()).deliveries![0].id;
    h.inbox.appendOnce.mockRejectedValueOnce(new Error('inbox down'));
    await h.service.announceDeliveryStall(r.id, [id]);
    expect(h.logError).toHaveBeenCalledWith(expect.stringContaining('delivery stall notice failed'), expect.any(Error));
    const cur = await h.get();
    await h.store.transition(cur.id, cur.stateVersion, 'STOPPED', 'warning', 'stop');
    h.inbox.appendOnce.mockClear();
    await h.service.announceDeliveryStall(r.id, [id]);
    expect(h.inbox.appendOnce).not.toHaveBeenCalled();
  }));

  it('does nothing without an inbox', () => harness(async (h) => {
    const r = await h.get();
    await h.service.announceDeliveryStall(r.id, ['x']);
  }, { inbox: false }));

  it('uses plain append when appendOnce is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-backstop-'));
    try {
      const h = await build(join(dir, 'executions.json'), {});
      const r = await h.get();
      await h.service.resume('session-1', 'project-1', r.id, r.stateVersion, 'slot-1', 'answer');
      const id = (await h.get()).deliveries![0].id;
      const append = vi.fn(async () => ({ id: 'i' }));
      (h.service as unknown as { deps: { inbox: unknown } }).deps.inbox = { append };
      await h.service.announceDeliveryStall(r.id, [id]);
      expect(append).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
