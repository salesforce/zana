import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_API_ERROR_RECOVERY_DEFAULTS, WorkerApiErrorRecovery, type WorkerApiErrorRecoveryDeps } from '../worker-api-error-recovery.js';
import { WorkUnitRecoveryGuardError, type WorkerApiErrorRecovery as Durable } from '../store.js';

const T = WORKER_API_ERROR_RECOVERY_DEFAULTS;
const COHORT = { executionId: 'e1', slotId: 'slot-1' };
const TEMP = { error: 'rate_limit', text: '429', retryable: true };
const CLAIM2 = { workUnitId: 'u1', claimId: 'c2', claimGeneration: 2 };

function setup(over: Partial<WorkerApiErrorRecoveryDeps> = {}) {
  const state = {
    claim: { workUnitId: 'u1', claimId: 'c1', claimGeneration: 1 } as { workUnitId: string; claimId: string; claimGeneration: number } | undefined,
    agent: 'idle' as string | undefined,
    steps: [] as Durable['steps'],
    restart: { ok: true } as { ok: true } | { ok: false; reason: string; message?: string },
    onRestart: undefined as (() => void) | undefined
  };
  const calls: string[] = [];
  const records: Array<{ step: string; summary: string; deadlineAt?: number }> = [];
  const deps: WorkerApiErrorRecoveryDeps = {
    enabled: () => true,
    findClaim: async () => state.claim,
    getRecovery: () => state.steps.length && state.claim
      ? { claimId: state.claim.claimId, claimGeneration: state.claim.claimGeneration, slotId: 'slot-1', executionAttempt: 1, step: 'waiting', startedAt: 0, updatedAt: 0, steps: state.steps }
      : undefined,
    record: async (_id, input) => {
      calls.push(`record:${input.step}`);
      records.push({ step: input.step, summary: input.summary, deadlineAt: input.deadlineAt });
      state.steps.push({ step: input.step, at: Date.now() });
    },
    getAgentState: () => state.agent,
    nudge: async (_s, text) => { calls.push('nudge'); expect(text).toContain('`u1`'); },
    restart: async () => { calls.push('restart'); state.onRestart?.(); return state.restart; },
    redeliver: async () => { calls.push('redeliver'); return true; },
    blockToHuman: async () => { calls.push('block'); },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    log: vi.fn(),
    ...over
  };
  const engine = new WorkerApiErrorRecovery(deps);
  return { engine, state, calls, records, deps };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('WorkerApiErrorRecovery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('nudges after the delay and records resumed when a turn starts', async () => {
    const { engine, calls, records } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    expect(records[0].summary).toBe('Engineer slot-1 stopped on a temporary API error (rate_limit); Zana will nudge it in 30 s');
    expect(records[0].deadlineAt).toBe(Date.now() + T.nudgeDelayMs + T.nudgeTurnMs + T.restartDelayMs + T.restartTurnMs + 60000);
    await advance(T.nudgeDelayMs);
    expect(calls).toEqual(['record:waiting', 'nudge', 'record:nudged']);
    engine.onTurnStarted('s1', 'idle');
    await advance(0);
    expect(calls.at(-1)).toBe('record:resumed');
    await advance(T.nudgeTurnMs + T.restartDelayMs);
    expect(calls).not.toContain('restart');
  });

  it('restarts on a second temporary stop after a nudge that started a turn', async () => {
    const { engine, calls, records } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    engine.onTurnStarted('s1', 'idle');
    await advance(0);
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    expect(records.at(-1)?.summary).toBe('Engineer slot-1 stopped on another temporary API error (rate_limit); Zana will restart it in 60 s');
    expect(records.at(-1)?.deadlineAt).toBe(Date.now() + T.restartDelayMs + T.restartTurnMs + 60000);
    await advance(T.restartDelayMs);
    expect(calls.slice(-3)).toEqual(['restart', 'redeliver', 'record:restarted']);
    // The relaunch took time, so the lease deadline restarts from the restart itself.
    expect(records.at(-1)).toMatchObject({ step: 'restarted', deadlineAt: Date.now() + T.restartTurnMs + 60000 });
  });

  it('ignores a turn start whose prior state is working', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    engine.onTurnStarted('s1', 'working');
    await advance(T.nudgeDelayMs);
    expect(calls).toEqual(['record:waiting', 'nudge', 'record:nudged']);
  });

  it('restarts when the nudge starts no turn, then resumes', async () => {
    const { engine, calls, records } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(calls).toEqual(['record:waiting', 'nudge', 'record:nudged', 'restart', 'redeliver', 'record:restarted']);
    expect(records.at(-1)?.summary).toBe('Restarted engineer slot-1 after an API error and delivered work unit u1 again');
    engine.onTurnStarted('s1', 'idle');
    await advance(0);
    expect(calls.at(-1)).toBe('record:resumed');
    await advance(T.restartTurnMs);
    expect(calls).not.toContain('block');
  });

  it('restarts after the delay when a second temporary error follows the nudge', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.restartDelayMs);
    expect(calls.filter((c) => c === 'restart')).toHaveLength(1);
    expect(calls.filter((c) => c === 'nudge')).toHaveLength(1);
  });

  it('asks the user for an error after the restart', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    expect(calls.slice(-2)).toEqual(['record:waiting', 'block']);
    await advance(T.restartTurnMs);
    expect(calls.filter((c) => c === 'block')).toHaveLength(1);
  });

  it('blocks when the restart fails and the fence still holds', async () => {
    const { engine, calls, state, records } = setup();
    state.restart = { ok: false, reason: 'no-capability' };
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(calls.slice(-2)).toEqual(['record:restart-failed', 'block']);
    expect(records.at(-1)?.summary).toBe('Could not restart engineer slot-1: no-capability');
  });

  it('stops quietly when the restart fails and the fence changed', async () => {
    const { engine, calls, state } = setup();
    state.restart = { ok: false, reason: 'gone', message: 'session gone' };
    state.onRestart = () => { state.claim = CLAIM2; };
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(calls.at(-1)).toBe('record:restart-failed');
    expect(calls).not.toContain('block');
  });

  it('blocks when the redelivered assignment starts no turn', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs + T.restartTurnMs);
    expect(calls.at(-1)).toBe('block');
  });

  it('blocks a permanent error at once without a nudge', async () => {
    const { engine, calls, records } = setup();
    await engine.onApiErrorStop('s1', COHORT, { error: 'billing_error', text: 'x', retryable: false });
    expect(calls).toEqual(['record:waiting', 'block']);
    expect(records[0].summary).toBe('Engineer slot-1 stopped on an API error Zana does not retry (billing_error)');
    await advance(T.nudgeDelayMs);
    expect(calls).toEqual(['record:waiting', 'block']);
  });

  it('does nothing when disabled or without a claim', async () => {
    const off = setup({ enabled: () => false });
    await off.engine.onApiErrorStop('s1', COHORT, TEMP);
    const none = setup();
    none.state.claim = undefined;
    await none.engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs * 10);
    expect(off.calls).toEqual([]);
    expect(none.calls).toEqual([]);
  });

  it('treats an absent retryable as temporary', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, { error: 'unknown', text: '' });
    await advance(T.nudgeDelayMs);
    expect(calls).toContain('nudge');
  });

  it('records a working engineer as resumed instead of nudging it', async () => {
    const { engine, calls, state } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    state.agent = 'working';
    await advance(T.nudgeDelayMs + T.nudgeTurnMs + T.restartDelayMs);
    // A visibly working engineer has recovered: it is recorded as resumed, never nudged, restarted or blocked.
    expect(calls).toEqual(['record:waiting', 'record:resumed']);
  });

  it('resumes without a nudge when a turn started before the nudge time', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    engine.onTurnStarted('s1', 'waiting');
    await advance(T.nudgeDelayMs * 2);
    expect(calls).toEqual(['record:waiting', 'record:resumed']);
  });

  it('applies a turn that starts while the nudge is in flight', async () => {
    let release!: () => void;
    const { engine, calls } = setup({ nudge: () => new Promise<void>((r) => { release = r; }) });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    engine.onTurnStarted('s1', 'idle');
    release();
    await advance(0);
    expect(calls).toEqual(['record:waiting', 'record:nudged', 'record:resumed']);
  });

  it.each([
    ['nudge', T.nudgeDelayMs],
    ['restart after the nudge', T.nudgeDelayMs + T.nudgeTurnMs],
    ['block after the redelivery', T.nudgeDelayMs + T.nudgeTurnMs + T.restartTurnMs]
  ])('stops when the claim fence changed before the %s timer', async (_name, delay) => {
    const { engine, calls, state } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(delay - 1);
    const before = calls.length;
    state.claim = CLAIM2;
    await advance(T.restartTurnMs * 3);
    expect(calls).not.toContain('block');
    expect(calls.slice(before)).toEqual([]);
  });

  it('stops quietly when a record call reports the claim moved on', async () => {
    const { engine, calls } = setup({ record: async () => { throw new WorkUnitRecoveryGuardError('moved'); } });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs * 5);
    expect(calls).toEqual([]);
  });

  it('keeps the session through a restart in flight on forget, but drops it otherwise', async () => {
    let finish!: (r: { ok: true }) => void;
    const { engine, calls } = setup({ restart: () => new Promise((r) => { finish = r; }) });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    engine.forget('s1');
    finish({ ok: true });
    await advance(0);
    expect(calls).toContain('record:restarted');

    const other = setup();
    await other.engine.onApiErrorStop('s2', COHORT, TEMP);
    other.engine.forget('s2');
    await advance(T.nudgeDelayMs);
    expect(other.calls).toEqual(['record:waiting']);
  });

  it('dispose clears every timer', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    engine.dispose();
    await advance(T.nudgeDelayMs * 10);
    expect(calls).toEqual(['record:waiting']);
  });

  it('logs and never throws when a dependency throws', async () => {
    const log = vi.fn();
    const boom = setup({ findClaim: async () => { throw new Error('x'); }, log });
    await expect(boom.engine.onApiErrorStop('s1', COHORT, TEMP)).resolves.toBeUndefined();
    const nudgeBoom = setup({ nudge: async () => { throw new Error('n'); }, log });
    await nudgeBoom.engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    expect(log).toHaveBeenCalledTimes(2);
    expect(() => nudgeBoom.engine.onTurnStarted('s1', 'idle')).not.toThrow();
    expect(() => nudgeBoom.engine.forget('zzz')).not.toThrow();
  });

  it('restarts a worker that was not nudged (no live terminal) without waiting for the nudge turn', async () => {
    const { engine, calls } = setup({ nudge: async () => { calls0.push('nudge'); return false; } });
    const calls0: string[] = [];
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    await advance(1);
    expect(calls0).toEqual(['nudge']);
    expect(calls).toContain('restart');
    expect(calls).not.toContain('record:nudged');
  });

  it('treats a rejected nudge like an unreachable terminal', async () => {
    const log = vi.fn();
    const { engine, calls } = setup({ nudge: async () => { throw new Error('pty gone'); }, log });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + 1);
    expect(calls).toContain('restart');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('nudge failed'), expect.any(Error));
  });

  it('blocks and says so when the redelivery is refused after a restart', async () => {
    const { engine, calls, records } = setup({ redeliver: async () => false });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(calls.slice(-3)).toEqual(['restart', 'record:restart-failed', 'block']);
    expect(calls).not.toContain('record:restarted');
    expect(records.at(-1)?.summary).toBe('Restarted engineer slot-1 but could not deliver work unit u1 again');
  });

  it('treats a rejected redelivery and a rejected restart as failures that ask the user', async () => {
    const log = vi.fn();
    const redeliver = setup({ redeliver: async () => { throw new Error('inject'); }, log });
    await redeliver.engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(redeliver.calls.slice(-2)).toEqual(['record:restart-failed', 'block']);
    const restart = setup({ restart: async () => { throw new Error('spawn'); }, log });
    await restart.engine.onApiErrorStop('s2', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(restart.calls.slice(-2)).toEqual(['record:restart-failed', 'block']);
    expect(restart.records.at(-1)?.summary).toBe('Could not restart engineer slot-1: spawn');
  });

  it('does not restart an engineer that started working before the restart rung', async () => {
    const { engine, calls, state } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    state.agent = 'working'; // the nudge turn began but its hook was missed
    await advance(T.nudgeTurnMs);
    expect(calls).not.toContain('restart');
    expect(calls.at(-1)).toBe('record:resumed');
  });

  it('counts a turn that starts while the restart rung checks the fence as resumed, not a blocker', async () => {
    const { engine, calls, state, deps } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(calls.at(-1)).toBe('record:restarted');
    const find = deps.findClaim;
    deps.findClaim = async (...args) => { engine.onTurnStarted('s1', 'idle'); return find(...args); };
    await advance(T.restartTurnMs);
    expect(calls).not.toContain('block');
    expect(calls.at(-1)).toBe('record:resumed');
    expect(state.claim).toBeDefined();
  });

  it('does not block a restarted engineer that is working when the restart-turn timer fires', async () => {
    const { engine, calls, state } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    state.agent = 'working';
    await advance(T.restartTurnMs);
    expect(calls).not.toContain('block');
    expect(calls.at(-1)).toBe('record:resumed');
  });

  it('accepts the first turn of a restarted session even though its prior state is unknown', async () => {
    const { engine, calls } = setup();
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    engine.onTurnStarted('s1', 'unknown'); // before a restart: ignored
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    engine.onTurnStarted('s1', 'unknown');
    await advance(0);
    expect(calls.at(-1)).toBe('record:resumed');
  });

  it('applies a turn that starts while the stop itself is being recorded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { engine, calls } = setup({
      record: async (_id, input) => { if (input.step === 'waiting') await gate; calls.push(`record:${input.step}`); }
    });
    const stop = engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(0);
    engine.onTurnStarted('s1', 'idle');
    release();
    await stop;
    await advance(T.nudgeDelayMs * 3);
    expect(calls).toEqual(['record:waiting', 'record:resumed']);
  });

  // CodeNod #509: a stale nudge continuation must not drop the session a second stop installed.
  it('restarts when the nudged turn fails again before the nudge call returns', async () => {
    let release!: () => void;
    const nudges: string[] = [];
    const { engine, calls, records } = setup({ nudge: () => { nudges.push('nudge'); return new Promise<void>((r) => { release = r; }); } });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    engine.onTurnStarted('s1', 'idle'); // the nudged turn starts...
    await engine.onApiErrorStop('s1', COHORT, TEMP); // ...and fails while the nudge call is still awaited
    release();
    await advance(0);
    expect(calls).toEqual(['record:waiting', 'record:nudged', 'record:waiting']);
    expect(records.at(-1)?.summary).toBe('Engineer slot-1 stopped on another temporary API error (rate_limit); Zana will restart it in 60 s');
    await advance(T.restartDelayMs);
    expect(calls.slice(-3)).toEqual(['restart', 'redeliver', 'record:restarted']);
    expect(nudges).toHaveLength(1);
    expect(calls).not.toContain('record:resumed');
  });

  it('records the nudge once when the nudged turn fails while that nudge is being recorded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = setup();
    const record = h.deps.record;
    h.deps.record = async (id, input) => { if (input.step === 'nudged') await gate; return record(id, input); };
    await h.engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    h.engine.onTurnStarted('s1', 'idle');
    await h.engine.onApiErrorStop('s1', COHORT, TEMP);
    release();
    await advance(0);
    expect(h.calls).toEqual(['record:waiting', 'nudge', 'record:waiting', 'record:nudged']);
    await advance(T.restartDelayMs);
    expect(h.calls.filter((c) => c === 'record:nudged')).toHaveLength(1);
    expect(h.calls).toContain('restart');
    expect(h.calls).not.toContain('record:resumed');
  });

  it('asks the user when the restarted session fails again before the restart is recorded', async () => {
    let deliver!: (value: boolean) => void;
    const { engine, calls, records } = setup({ redeliver: () => new Promise<boolean>((r) => { deliver = r; }) });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs + T.nudgeTurnMs);
    expect(calls.at(-1)).toBe('restart'); // the redelivery is still in flight
    engine.onTurnStarted('s1', 'unknown');
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    expect(calls.slice(-3)).toEqual(['record:restarted', 'record:waiting', 'block']);
    expect(records.at(-2)?.summary).toBe('Restarted engineer slot-1 after an API error');
    deliver(true);
    await advance(T.restartTurnMs * 2);
    expect(calls.filter((c) => c === 'record:restarted')).toHaveLength(1);
    expect(calls.filter((c) => c === 'block')).toHaveLength(1);
  });

  it('stops when recording the in-flight nudge reports the claim moved on', async () => {
    let release!: () => void;
    const h = setup({ nudge: () => new Promise<void>((r) => { release = r; }) });
    await h.engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    const record = h.deps.record;
    h.deps.record = async (id, input) => { if (input.step === 'nudged') throw new WorkUnitRecoveryGuardError('moved'); return record(id, input); };
    await h.engine.onApiErrorStop('s1', COHORT, TEMP);
    release();
    await advance(T.restartDelayMs * 3);
    expect(h.calls).toEqual(['record:waiting']);
  });

  it('records nothing for a nudge whose session exited meanwhile', async () => {
    let release!: () => void;
    const { engine, calls } = setup({ nudge: () => new Promise<void>((r) => { release = r; }) });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    await advance(T.nudgeDelayMs);
    engine.forget('s1');
    release();
    await advance(T.nudgeTurnMs + T.restartDelayMs);
    expect(calls).toEqual(['record:waiting']);
  });

  // CodeNod #509: an unreadable agent state at the nudge rung used to drop the recovery silently.
  it.each([['unavailable', undefined], ['unknown', 'unknown']])('restarts instead of nudging when the agent state is %s, and logs why', async (label, agentState) => {
    const log = vi.fn();
    const { engine, calls, state } = setup({ log });
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    state.agent = agentState;
    await advance(T.nudgeDelayMs + 1);
    expect(calls).toEqual(['record:waiting', 'restart', 'redeliver', 'record:restarted']);
    expect(log).toHaveBeenCalledWith(`Worker API-error recovery did not nudge s1 (state ${label}); restarting it instead`);
  });

  it('asks the user when an engineer in an unreadable state cannot be restarted either', async () => {
    const { engine, calls, state, records } = setup();
    state.restart = { ok: false, reason: 'not-found' };
    await engine.onApiErrorStop('s1', COHORT, TEMP);
    state.agent = undefined;
    await advance(T.nudgeDelayMs + 1);
    expect(calls).toEqual(['record:waiting', 'restart', 'record:restart-failed', 'block']);
    expect(records.at(-1)?.summary).toBe('Could not restart engineer slot-1: not-found');
  });
});
