import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import { createSquadProposalNotifier, type SquadProposalNotifierDeps } from './notifier.js';

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'e1', projectId: 'p1', jobTitle: 'Ship it', state: 'COMPLETED', attempt: 1, createdAt: 0, updatedAt: 60_000,
    finalSummary: 'Done.', request: { version: 1, slots: [] }, workUnits: [],
    proposal: { id: 'prop', proposerKind: 'pty', proposerId: 's1' },
    ...over
  } as unknown as ExecutionRecord;
}

function setup(over: Partial<SquadProposalNotifierDeps> = {}, current: () => ExecutionRecord | undefined = () => record()) {
  let state: AgentState | undefined = 'idle';
  let lastInput: number | undefined = Date.now() - 120_000;
  const deps = {
    getRecord: vi.fn(async () => current()),
    markReported: vi.fn(async () => undefined),
    listUnreported: vi.fn(async () => [] as ExecutionRecord[]),
    markBlockerReported: vi.fn(async () => undefined),
    listUnreportedBlockers: vi.fn(async () => [] as ExecutionRecord[]),
    reply: vi.fn(() => true),
    ptyLive: vi.fn(() => true),
    ptyState: vi.fn(() => state),
    lastInputAt: vi.fn(() => lastInput),
    draftPending: vi.fn(() => false),
    deliverableWhenWaiting: vi.fn(() => false),
    threadLive: vi.fn(async () => true),
    queueThreadTurn: vi.fn(async () => ({ ok: true })),
    appendInbox: vi.fn(async () => undefined),
    pathExists: vi.fn(() => true),
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log: vi.fn(),
    ...over
  } satisfies SquadProposalNotifierDeps;
  const notifier = createSquadProposalNotifier(deps);
  // Boot as the app does (replay marks the notifier ready), unless the test drives replay itself.
  if (!over.listUnreported) { void notifier.replayUnreported(); deps.listUnreported.mockClear(); }
  return {
    deps, notifier,
    setState: (s: AgentState | undefined) => { state = s; },
    setLastInput: (t: number | undefined) => { lastInput = t; }
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe('onTerminal', () => {
  it('ignores a record without a proposal, a non-terminal one and an already reported attempt', async () => {
    const { deps, notifier } = setup();
    await notifier.onTerminal(record({ proposal: undefined }));
    await notifier.onTerminal(record({ state: 'RUNNING' as never }));
    await notifier.onTerminal(record({ proposalNoticeVersion: 1 }));
    expect(deps.getRecord).not.toHaveBeenCalled();
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('ignores a record that was reported or lost its proposal by the time it is re-read', async () => {
    const { deps, notifier } = setup({}, () => record({ proposalNoticeVersion: 1 }));
    await notifier.onTerminal(record());
    expect(deps.appendInbox).not.toHaveBeenCalled();
    const other = setup({}, () => record({ proposal: undefined }));
    await other.notifier.onTerminal(record());
    expect(other.deps.markReported).not.toHaveBeenCalled();
  });

  it('posts one Inbox entry, replies to an idle quiet session and marks reported', async () => {
    const { deps, notifier } = setup();
    await notifier.onTerminal(record());
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', subject: 'Squad completed: Ship it', executionId: 'e1', dedupeKey: 'squad-proposal-result:e1:1', report: true,
      squadNotice: 'proposal-result',
      comments: expect.stringContaining('[Squad report] "Ship it" completed')
    }));
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('[Squad report]'));
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('waits while worktree terminal effects are still pending, then reports once they are applied', async () => {
    const pending = record({ stateVersion: 7, squadWorktree: { path: '/wt', branch: 'sq' } } as never);
    const { deps, notifier } = setup({}, () => pending);
    // Team teardown still pending: the handler applied nothing and passed no outcome.
    await notifier.onTerminal(pending);
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.markReported).not.toHaveBeenCalled();
    // The last session's exit applies the effects and passes the outcome.
    await notifier.onTerminal(pending, { worktree: 'kept' });
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('worktree kept at /wt'));
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('works the outcome out from the record when effects were applied earlier', async () => {
    const applied = record({
      stateVersion: 7, terminalWorktreeEffectsStateVersion: 7,
      squadWorktree: { path: '/wt', branch: 'sq', baseBranch: 'main' }, request: { version: 1, slots: [], onComplete: 'merge' } as never
    } as never);
    const gone = setup({ pathExists: vi.fn(() => false) }, () => applied);
    await gone.notifier.onTerminal(applied);
    // Never inferred as merged from a missing path: only the handler's own result says "merged".
    expect(gone.deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('its worktree was already removed'));
    expect(gone.deps.reply).not.toHaveBeenCalledWith('s1', expect.stringContaining('merged'));
    const kept = setup({ pathExists: vi.fn(() => true) }, () => applied);
    await kept.notifier.onTerminal(applied);
    expect(kept.deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('worktree kept at /wt'));
    const leave = record({ stateVersion: 2, terminalWorktreeEffectsStateVersion: 2, squadWorktree: { path: '/wt', branch: 'sq' } } as never);
    const missing = setup({ pathExists: vi.fn(() => false) }, () => leave);
    await missing.notifier.onTerminal(leave);
    expect(missing.deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('its worktree was already removed'));
  });

  it('stays silent before boot replay and leaves the run unreported for it', async () => {
    const deps = setup().deps;
    const early = createSquadProposalNotifier({ ...deps, listUnreported: vi.fn(async () => [record()]) });
    await early.onTerminal(record());
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.markReported).not.toHaveBeenCalled();
    await early.replayUnreported();
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it.each([['FAILED', 'failed'], ['STOPPED', 'stopped']])('titles a %s run', async (state, word) => {
    const { deps, notifier } = setup({}, () => record({ state: state as never }));
    await notifier.onTerminal(record({ state: state as never }));
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: `Squad ${word}: Ship it` }));
  });

  it('reports the worktree outcome the handler passed', async () => {
    const merged = record({ squadWorktree: { path: '/wt', branch: 'sq', baseBranch: 'main' }, request: { version: 1, slots: [], onComplete: 'merge' } as never });
    const { deps, notifier } = setup({ pathExists: vi.fn(() => true) }, () => merged);
    await notifier.onTerminal(merged, { worktree: 'merged' });
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('Branch sq merged into main'));
    expect(deps.pathExists).not.toHaveBeenCalled();
  });

  it('de-duplicates concurrent calls for the same attempt', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, notifier } = setup({ markReported: vi.fn(async () => { await gate; }) });
    const first = notifier.onTerminal(record());
    const second = notifier.onTerminal(record());
    await vi.advanceTimersByTimeAsync(0);
    release();
    await Promise.all([first, second]);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledOnce();
  });

  it('allows a retry after a failed markReported', async () => {
    const markReported = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const { deps, notifier } = setup({ markReported });
    await notifier.onTerminal(record());
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('report failed for e1'), expect.any(Error));
    await notifier.onTerminal(record());
    expect(markReported).toHaveBeenCalledTimes(2);
  });

  it('still delivers when the Inbox entry fails, but leaves the run unreported for boot replay', async () => {
    const { deps, notifier } = setup({ appendInbox: vi.fn(async () => { throw new Error('inbox down'); }) });
    await notifier.onTerminal(record());
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('result entry failed'), expect.any(Error));
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.markReported).not.toHaveBeenCalled();
    // Claimed in this process: a second terminal call does not type the report again.
    await notifier.onTerminal(record());
    expect(deps.reply).toHaveBeenCalledOnce();
  });

  it('marks a run whose proposer is gone only once its Inbox result is written', async () => {
    const appendInbox = vi.fn().mockRejectedValueOnce(new Error('inbox down')).mockResolvedValue(undefined);
    const failing = setup({ appendInbox, listUnreported: vi.fn(async () => [record()]), ptyLive: vi.fn(() => false) });
    await failing.notifier.replayUnreported();
    expect(failing.deps.markReported).not.toHaveBeenCalled();
    // The next boot retries both.
    const next = createSquadProposalNotifier(failing.deps);
    await next.replayUnreported();
    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(failing.deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('falls back to the passed record when the re-read finds nothing', async () => {
    const { deps, notifier } = setup({}, () => undefined);
    await notifier.onTerminal(record());
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('drops the report but still marks reported when the session is gone', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false) });
    await notifier.onTerminal(record());
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('logs a throwing delivery dep and leaves the run unmarked for boot replay', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => { throw new Error('boom'); }) });
    await expect(notifier.onTerminal(record())).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('delivery failed'), expect.any(Error));
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('never throws even when getRecord throws', async () => {
    const { deps, notifier } = setup({ getRecord: vi.fn(async () => { throw new Error('x'); }) });
    await expect(notifier.onTerminal(record())).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalled();
  });
});

describe('PTY delivery gating', () => {
  it.each(['working', 'unknown', 'waiting', 'blocked'] as AgentState[])('treats %s as busy', async (busy) => {
    const ctx = setup();
    ctx.setState(busy);
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    // A queued report is only marked once it is typed, so an exit before then replays it at boot.
    expect(ctx.deps.markReported).not.toHaveBeenCalled();
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('leaves a queued report unmarked when the app shuts down before it is typed', async () => {
    const ctx = setup();
    ctx.setState('working');
    await ctx.notifier.onTerminal(record());
    ctx.notifier.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    expect(ctx.deps.markReported).not.toHaveBeenCalled();
  });

  it('delivers from waiting when the harness rests there', async () => {
    const ctx = setup({ deliverableWhenWaiting: vi.fn(() => true) });
    ctx.setState('waiting');
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
  });

  it('delivers from done', async () => {
    const ctx = setup();
    ctx.setState('done');
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
  });

  it('queues while busy and delivers one item per idle edge', async () => {
    const ctx = setup();
    ctx.setState('working');
    await ctx.notifier.onTerminal(record({ id: 'e1' }));
    await ctx.notifier.onTerminal(record({ id: 'e2' }));
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    ctx.notifier.onState('s1', 'working');
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).toHaveBeenCalledTimes(1);
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).toHaveBeenCalledTimes(2);
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the 30 s quiet gate and delivers from the re-check timer', async () => {
    const ctx = setup();
    ctx.setLastInput(Date.now() - 10_000);
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await ctx.notifier.onTerminal(record({ id: 'e2' }));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
  });

  it('re-arms the quiet timer if the user typed again', async () => {
    const ctx = setup();
    ctx.setLastInput(Date.now() - 10_000);
    await ctx.notifier.onTerminal(record());
    ctx.setLastInput(Date.now() + 15_000);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
  });

  it('delivers when the session never received input', async () => {
    const ctx = setup();
    ctx.setLastInput(undefined);
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
  });

  it('caps the queue at 10 and drops the oldest', async () => {
    const ctx = setup();
    ctx.setState('working');
    const all = Array.from({ length: 12 }, (_, i) => record({ id: `e${i}`, jobTitle: `T${i}` }));
    ctx.deps.getRecord.mockImplementation(async (id: string) => all.find((r) => r.id === id));
    for (const r of all) await ctx.notifier.onTerminal(r);
    ctx.setState('idle');
    for (let i = 0; i < 12; i++) ctx.notifier.onState('s1', 'idle');
    const texts = ctx.deps.reply.mock.calls.map((call) => (call as unknown as [string, string])[1]);
    expect(texts).toHaveLength(10);
    expect(texts[0]).toContain('"T2"');
    expect(texts[9]).toContain('"T11"');
  });

  it('logs a session that refuses the reply', async () => {
    const ctx = setup({ reply: vi.fn(() => false) });
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.log).toHaveBeenCalledWith(expect.stringContaining('not accepted by session s1'));
  });

  it('drops the queue when the session dies before an idle edge', async () => {
    const live = { v: true };
    const ctx = setup({ ptyLive: vi.fn(() => live.v) });
    ctx.setState('working');
    await ctx.notifier.onTerminal(record());
    live.v = false;
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    live.v = true;
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    // Dropped for good with the session: the Inbox result stands, so the run is marked.
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.deps.markReported).toHaveBeenCalledOnce();
  });

  it('survives a throwing dep during a flush and keeps the report queued', async () => {
    const lastInputAt = vi.fn((): number | undefined => { throw new Error('boom'); });
    const ctx = setup({ lastInputAt });
    await ctx.notifier.onTerminal(record());
    expect(ctx.deps.log).toHaveBeenCalledWith(expect.stringContaining('flush failed'), expect.any(Error));
    expect(ctx.deps.markReported).not.toHaveBeenCalled();
    lastInputAt.mockReturnValue(undefined);
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).toHaveBeenCalledOnce();
  });
});

describe('forget and dispose', () => {
  it('forget clears the queue and its timer', async () => {
    const ctx = setup();
    ctx.setLastInput(Date.now() - 1_000);
    await ctx.notifier.onTerminal(record());
    expect(vi.getTimerCount()).toBe(1);
    expect(ctx.deps.markReported).not.toHaveBeenCalled();
    ctx.notifier.forget('s1');
    expect(vi.getTimerCount()).toBe(0);
    ctx.notifier.onState('s1', 'idle');
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.deps.markReported).toHaveBeenCalledOnce();
  });

  it('forget ignores an unknown session and logs a failing clearTimer', async () => {
    const ctx = setup({ clearTimer: vi.fn(() => { throw new Error('boom'); }) });
    ctx.notifier.forget('nope');
    ctx.setLastInput(Date.now() - 1_000);
    await ctx.notifier.onTerminal(record());
    ctx.notifier.forget('s1');
    expect(ctx.deps.log).toHaveBeenCalledWith(expect.stringContaining('timer clear failed'), expect.any(Error));
  });

  it('dispose clears every timer and ignores later events', async () => {
    const ctx = setup();
    ctx.setLastInput(Date.now() - 1_000);
    const second = record({ id: 'e2', proposal: { id: 'q', proposerKind: 'pty', proposerId: 's2' } as never });
    ctx.deps.getRecord.mockImplementation(async (id: string) => (id === 'e2' ? second : record()));
    await ctx.notifier.onTerminal(record());
    await ctx.notifier.onTerminal(second);
    expect(vi.getTimerCount()).toBe(2);
    ctx.notifier.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await ctx.notifier.onTerminal(record({ id: 'e3' }));
    await ctx.notifier.onHumanBlocker(record(), { id: 'b', question: 'q' } as never);
    ctx.notifier.onState('s1', 'idle');
    await ctx.notifier.replayUnreported();
    expect(ctx.deps.reply).not.toHaveBeenCalled();
    expect(ctx.deps.appendInbox).toHaveBeenCalledTimes(2);
  });
});

describe('thread proposer', () => {
  const threadRecord = () => record({ proposal: { id: 'prop', proposerKind: 'thread', proposerId: 't1' } });

  it('queues a turn into the thread with the project id', async () => {
    const { deps, notifier } = setup({}, threadRecord);
    await notifier.onTerminal(threadRecord());
    expect(deps.queueThreadTurn).toHaveBeenCalledWith('t1', 'p1', expect.stringContaining('[Squad report]'));
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('logs a failed queue and leaves the run unmarked for boot replay', async () => {
    const { deps, notifier } = setup({ queueThreadTurn: vi.fn(async () => ({ ok: false, reason: 'deferred_queue_full' })) }, threadRecord);
    await notifier.onTerminal(threadRecord());
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('deferred_queue_full'));
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('logs a failure without a reason', async () => {
    const { deps, notifier } = setup({ queueThreadTurn: vi.fn(async () => ({ ok: false })) }, threadRecord);
    await notifier.onTerminal(threadRecord());
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('unknown'));
  });

  it('skips a thread that is no longer live', async () => {
    const { deps, notifier } = setup({ threadLive: vi.fn(async () => false) }, threadRecord);
    await notifier.onTerminal(threadRecord());
    expect(deps.queueThreadTurn).not.toHaveBeenCalled();
    expect(deps.markReported).toHaveBeenCalledOnce();
  });
});

describe('onHumanBlocker', () => {
  const blocker = { id: 'b1', question: 'Which file?' } as never;

  it('ignores records without a proposal', async () => {
    const { deps, notifier } = setup();
    await notifier.onHumanBlocker(record({ proposal: undefined }), blocker);
    expect(deps.reply).not.toHaveBeenCalled();
  });

  it('delivers once per blocker id, with no Inbox entry', async () => {
    const { deps, notifier } = setup();
    await notifier.onHumanBlocker(record(), blocker);
    await notifier.onHumanBlocker(record(), blocker);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('is waiting for an answer in the Inbox: "Which file?"'));
    await notifier.onHumanBlocker(record(), { id: 'b2', question: 'Another?' } as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledTimes(2);
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('forgets an execution\'s blockers once its terminal report is handled', async () => {
    const { deps, notifier } = setup();
    await notifier.onHumanBlocker(record({ state: 'RUNNING' as never }), blocker);
    await vi.advanceTimersByTimeAsync(0);
    await notifier.onTerminal(record());
    await vi.advanceTimersByTimeAsync(0);
    await notifier.onHumanBlocker(record({ state: 'RUNNING' as never }), blocker);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply.mock.calls.filter((call) => String((call as unknown[])[1]).includes('Which file?'))).toHaveLength(2);
  });

  it('bounds how many executions it remembers blockers for', async () => {
    const { deps, notifier } = setup();
    for (let i = 0; i <= 256; i++) { await notifier.onHumanBlocker(record({ id: `e${i}` }), blocker); await vi.advanceTimersByTimeAsync(0); }
    expect(deps.reply).toHaveBeenCalledTimes(257);
    // The oldest execution was forgotten; the newest is still remembered.
    await notifier.onHumanBlocker(record({ id: 'e0' }), blocker);
    await notifier.onHumanBlocker(record({ id: 'e256' }), blocker);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledTimes(258);
  });

  it('never throws', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => { throw new Error('x'); }) });
    await expect(notifier.onHumanBlocker(record(), blocker)).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('blocker report failed'), expect.any(Error));
  });
});

describe('blocker report survives a restart', () => {
  const owner = (over: Partial<ExecutionRecord> = {}) => record({
    state: 'BLOCKED' as never, proposal: undefined, reportTo: { kind: 'pty', id: 's1', role: 'owner' }, ...over
  });
  const blocker = { id: 'b1', question: 'Which file?', resolved: false };

  it('marks a blocker reported once it is delivered', async () => {
    const { deps, notifier } = setup({}, owner);
    await notifier.onHumanBlocker(owner(), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('does not send a blocker the record says was already reported', async () => {
    const { deps, notifier } = setup({}, owner);
    await notifier.onHumanBlocker(owner({ reportedBlockerIds: ['b1'] }), blocker as never);
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('boot replay sends an unreported open human blocker and skips coordinator and resolved ones', async () => {
    const live = owner({ blockers: [blocker, { ...blocker, id: 'b2', audience: 'coordinator' }, { ...blocker, id: 'b3', resolved: true }] as never });
    const { deps, notifier } = setup({ listUnreportedBlockers: vi.fn(async () => [live]) }, () => live);
    await notifier.replayUnreported();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(String((deps.reply.mock.calls[0] as unknown[])[1])).toContain('blocker b1');
    expect(deps.markBlockerReported).toHaveBeenCalledOnce();
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
    // Replaying again in the same process does not send it twice.
    await notifier.replayUnreported();
    expect(deps.reply).toHaveBeenCalledOnce();
  });

  it('does not mark a blocker when a liveness check throws, a thread turn is not queued or the PTY refuses the text', async () => {
    const throwing = setup({ ptyLive: vi.fn(() => { throw new Error('boom'); }) }, owner);
    await throwing.notifier.onHumanBlocker(owner(), blocker as never);
    const refused = setup({ reply: vi.fn(() => false) }, owner);
    await refused.notifier.onHumanBlocker(owner(), blocker as never);
    const thread = setup({ queueThreadTurn: vi.fn(async () => ({ ok: false, reason: 'timeout' })) }, owner);
    await thread.notifier.onHumanBlocker(owner({ reportTo: { kind: 'thread', id: 't1', role: 'owner' } }), blocker as never);
    const threadThrows = setup({ threadLive: vi.fn(async () => { throw new Error('down'); }) }, owner);
    await threadThrows.notifier.onHumanBlocker(owner({ reportTo: { kind: 'thread', id: 't1', role: 'owner' } }), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    for (const { deps } of [throwing, refused, thread, threadThrows]) expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('does not mark an owner blocker whose conversation is gone, and re-sends it once the target moves', async () => {
    let live = false;
    let current = owner();
    const { deps, notifier } = setup({ ptyLive: vi.fn((id: string) => live || id === 'new') }, () => current);
    await notifier.onHumanBlocker(owner(), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
    // resume_binding moved the target: the service offers the blocker again.
    current = owner({ reportTo: { kind: 'pty', id: 'new', role: 'owner' } });
    await notifier.onHumanBlocker(current, blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledWith('new', expect.stringContaining('blocker b1'));
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('does not mark an owner blocker queued for a PTY that disappears before the text is typed', async () => {
    let live = true;
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => live) }, owner);
    deps.lastInputAt.mockReturnValue(Date.now());
    await notifier.onHumanBlocker(owner(), blocker as never);
    live = false;
    notifier.forget('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('drops a queued blocker report that was resolved before it is typed', async () => {
    let resolved = false;
    const { deps, notifier } = setup({}, () => owner({ blockers: [{ ...blocker, resolved }] as never }));
    deps.lastInputAt.mockReturnValue(Date.now());
    await notifier.onHumanBlocker(owner(), blocker as never);
    resolved = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('re-offers a queued blocker report to the current target when resume_binding moved it while it waited', async () => {
    let current = owner({ blockers: [blocker] as never });
    const { deps, notifier } = setup({}, () => current);
    const typedAt = Date.now();
    deps.lastInputAt.mockImplementation((id: string) => (id === 's1' ? typedAt : undefined));
    await notifier.onHumanBlocker(owner(), blocker as never);
    expect(deps.reply).not.toHaveBeenCalled();
    // The owner target moves to a fresh session; the old PTY stays live and quiet time passes.
    current = owner({ reportTo: { kind: 'pty', id: 'new', role: 'owner' }, blockers: [blocker] as never });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.reply).not.toHaveBeenCalledWith('s1', expect.anything());
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.reply).toHaveBeenCalledWith('new', expect.stringContaining('blocker b1'));
    expect(deps.markBlockerReported).toHaveBeenCalledOnce();
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('does not mark the blocker reported for the old target when it moved and the new one is gone', async () => {
    let current = owner({ blockers: [blocker] as never });
    const { deps, notifier } = setup({ ptyLive: vi.fn((id: string) => id === 's1') }, () => current);
    deps.lastInputAt.mockReturnValue(Date.now());
    await notifier.onHumanBlocker(owner(), blocker as never);
    current = owner({ reportTo: { kind: 'pty', id: 'new', role: 'owner' }, blockers: [blocker] as never });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('boot replay skips a record without its own reportTo (written before report-back)', async () => {
    const legacy = owner({ reportTo: undefined, proposal: { id: 'p', proposerKind: 'pty', proposerId: 's1' } as never, blockers: [blocker] as never });
    const { deps, notifier } = setup({ listUnreportedBlockers: vi.fn(async () => [legacy]) }, () => legacy);
    await notifier.replayUnreported();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('marks a blocker whose conversation is gone, for a PTY and for a thread, when the target is a proposer', async () => {
    const prop = (over: Partial<ExecutionRecord> = {}) => owner({ reportTo: { kind: 'pty', id: 's1', role: 'proposer' }, ...over });
    const pty = setup({ ptyLive: vi.fn(() => false) }, prop);
    await pty.notifier.onHumanBlocker(prop(), blocker as never);
    const thread = setup({ threadLive: vi.fn(async () => false) }, prop);
    await thread.notifier.onHumanBlocker(prop({ reportTo: { kind: 'thread', id: 't1', role: 'proposer' } }), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(pty.deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
    expect(thread.deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('leaves a blocker raised before boot replay to the replay, neither sent nor marked', async () => {
    const live = owner({ blockers: [blocker] as never });
    // Giving listUnreported keeps setup() from booting the notifier, so it is not ready yet.
    const { deps, notifier } = setup({ listUnreported: vi.fn(async () => []), listUnreportedBlockers: vi.fn(async () => [live]) }, () => live);
    await notifier.onHumanBlocker(live, blocker as never);
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
    await notifier.replayUnreported();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('a failing mark or list is logged and never throws', async () => {
    const live = owner({ blockers: [blocker] as never });
    const failing = setup({ markBlockerReported: vi.fn(async () => { throw new Error('disk'); }), listUnreportedBlockers: vi.fn(async () => [live]) }, () => live);
    await failing.notifier.replayUnreported();
    await vi.advanceTimersByTimeAsync(0);
    expect(failing.deps.log).toHaveBeenCalledWith(expect.stringContaining('blocker mark failed'), expect.any(Error));
    const noList = setup({ listUnreportedBlockers: vi.fn(async () => { throw new Error('x'); }) });
    await expect(noList.notifier.replayUnreported()).resolves.toBeUndefined();
    expect(noList.deps.log).toHaveBeenCalledWith(expect.stringContaining('blocker replay list failed'), expect.any(Error));
  });

  it('a blocker whose delivery throws is logged by the replay loop', async () => {
    const live = owner({ blockers: [blocker] as never });
    const { deps, notifier } = setup({ listUnreportedBlockers: vi.fn(async () => [live]), ptyLive: vi.fn(() => { throw new Error('boom'); }) }, () => live);
    await notifier.replayUnreported();
    expect(deps.log).toHaveBeenCalled();
  });
});

describe('replayUnreported', () => {
  it('delivers to a live proposer; for gone ones still posts the Inbox result, then marks reported', async () => {
    const live = record({ id: 'live' });
    const gone = record({ id: 'gone', proposal: { id: 'q', proposerKind: 'pty', proposerId: 's-gone' } as never });
    const thread = record({ id: 'thr', proposal: { id: 'r', proposerKind: 'thread', proposerId: 't-gone' } as never });
    const byId: Record<string, ExecutionRecord> = { live, gone, thr: thread };
    const { deps, notifier } = setup({
      listUnreported: vi.fn(async () => [live, gone, thread, record({ id: 'bare', proposal: undefined })]),
      ptyLive: vi.fn((id: string) => id === 's1'),
      threadLive: vi.fn(async () => false),
      getRecord: vi.fn(async (id: string) => byId[id])
    });
    await notifier.replayUnreported();
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.queueThreadTurn).not.toHaveBeenCalled();
    // The user keeps the outcome in the Inbox even when the conversation is gone.
    expect(deps.appendInbox).toHaveBeenCalledTimes(3);
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'squad-proposal-result:gone:1' }));
    expect(deps.markReported).toHaveBeenCalledWith('live', 1);
    expect(deps.markReported).toHaveBeenCalledWith('gone', 1);
    expect(deps.markReported).toHaveBeenCalledWith('thr', 1);
    expect(deps.markReported).toHaveBeenCalledTimes(3);
  });

  it('leaves a run unreported when the boot liveness check throws (it is not the same as gone)', async () => {
    const thr = record({ proposal: { id: 'r', proposerKind: 'thread', proposerId: 't1' } as never });
    const { deps, notifier } = setup({ listUnreported: vi.fn(async () => [thr]), threadLive: vi.fn(async () => { throw new Error('timeout'); }) }, () => thr);
    await notifier.replayUnreported();
    expect(deps.queueThreadTurn).not.toHaveBeenCalled();
    expect(deps.appendInbox).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('leaves a run whose worktree effects are still pending for the handler to report', async () => {
    const pending = record({ stateVersion: 4, squadWorktree: { path: '/wt', branch: 'sq' } } as never);
    const { deps, notifier } = setup({ listUnreported: vi.fn(async () => [pending]) }, () => pending);
    await notifier.replayUnreported();
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('replays to a live thread', async () => {
    const thr = record({ proposal: { id: 'r', proposerKind: 'thread', proposerId: 't1' } as never });
    const { deps, notifier } = setup({ listUnreported: vi.fn(async () => [thr]) }, () => thr);
    await notifier.replayUnreported();
    expect(deps.queueThreadTurn).toHaveBeenCalledOnce();
  });

  it('survives a failing list and a failing record', async () => {
    const failing = setup({ listUnreported: vi.fn(async () => { throw new Error('x'); }) });
    await expect(failing.notifier.replayUnreported()).resolves.toBeUndefined();
    expect(failing.deps.log).toHaveBeenCalledWith(expect.stringContaining('replay list failed'), expect.any(Error));
    const bad = setup({ listUnreported: vi.fn(async () => [record()]), ptyLive: vi.fn(() => { throw new Error('y'); }) });
    await expect(bad.notifier.replayUnreported()).resolves.toBeUndefined();
    // A throwing liveness probe is logged and the record is left for the next boot.
    expect(bad.deps.log).toHaveBeenCalledWith(expect.stringContaining('replay liveness check failed for e1'), expect.any(Error));
    expect(bad.deps.markReported).not.toHaveBeenCalled();
  });
});

describe('logging safety', () => {
  it('survives a throwing logger', async () => {
    const { notifier } = setup({ log: vi.fn(() => { throw new Error('log'); }), getRecord: vi.fn(async () => { throw new Error('x'); }) });
    await expect(notifier.onTerminal(record())).resolves.toBeUndefined();
  });
});

describe('owner report target (agent-owned execution.start)', () => {
  const ownerPty = () => record({ proposal: undefined, reportTo: { kind: 'pty', id: 's1', role: 'owner' } } as never);
  const ownerThread = () => record({ proposal: undefined, reportTo: { kind: 'thread', id: 't1', role: 'owner' } } as never);

  it('types the terminal report into the owner PTY and marks it reported, with no Inbox result entry', async () => {
    const { deps, notifier } = setup({}, ownerPty);
    await notifier.onTerminal(ownerPty());
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('[Squad report] "Ship it" completed'));
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('Tell the user what it did; execution.snapshot has the details.'));
    expect(deps.appendInbox).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('tells the owner how to answer a human blocker itself', async () => {
    const { deps, notifier } = setup({}, ownerPty);
    await notifier.onHumanBlocker(ownerPty(), { id: 'b1', question: 'Which file?' } as never);
    await vi.advanceTimersByTimeAsync(0);
    const text = String((deps.reply.mock.calls[0] as unknown[])[1]);
    expect(text).toContain('is waiting for an answer: "Which file?" (execution e1, blocker b1). You own this run: answer with execution.respond');
    expect(text).not.toContain('do not answer it yourself');
  });

  it('queues the report into an owner Modern thread', async () => {
    const { deps, notifier } = setup({}, ownerThread);
    await notifier.onTerminal(ownerThread());
    expect(deps.queueThreadTurn).toHaveBeenCalledWith('t1', 'p1', expect.stringContaining('[Squad report]'));
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });

  it('prefers reportTo over the legacy proposal and honours the new reported mark', async () => {
    const both = record({ reportTo: { kind: 'pty', id: 's9', role: 'proposer' } } as never);
    const { deps, notifier } = setup({}, () => both);
    await notifier.onTerminal(both);
    expect(deps.reply).toHaveBeenCalledWith('s9', expect.any(String));
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    const done = setup({}, () => record({ reportNoticeVersion: 1 } as never));
    await done.notifier.onTerminal(record({ reportNoticeVersion: 1 } as never));
    expect(done.deps.getRecord).not.toHaveBeenCalled();
  });

  it('logs an owner thread that could not take the report, and leaves the run unmarked for boot replay', async () => {
    const { deps, notifier } = setup({ queueThreadTurn: vi.fn(async () => ({ ok: false, reason: 'deferred_queue_full' })) }, ownerThread);
    await notifier.onTerminal(ownerThread());
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('deferred_queue_full'));
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('replays an unreported owner run once, to its live owner', async () => {
    let owned = ownerPty();
    const markReported = vi.fn(async () => { owned = { ...owned, reportNoticeVersion: 1 }; });
    const { deps, notifier } = setup({ listUnreported: vi.fn(async () => [owned]), markReported }, () => owned);
    await notifier.replayUnreported();
    await notifier.onTerminal(owned);
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });
});

describe('Inbox fallback when the report target is gone', () => {
  const ownerPty = () => record({ proposal: undefined, reportTo: { kind: 'pty', id: 's1', role: 'owner' } } as never);
  const ownerThread = () => record({ proposal: undefined, reportTo: { kind: 'thread', id: 't1', role: 'owner' } } as never);
  const proposerPty = (over: Partial<ExecutionRecord> = {}) => record({ proposal: undefined, reportTo: { kind: 'pty', id: 's1', role: 'proposer' }, ...over } as never);
  const blocker = { id: 'b1', question: 'Which file?' };

  it('posts the owner report to the Inbox when its PTY is gone, then marks it reported', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false) }, ownerPty);
    await notifier.onTerminal(ownerPty());
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', executionId: 'e1', comments: expect.stringContaining('[Squad report] "Ship it" completed'),
      dedupeKey: 'squad-proposal-result:e1:1', report: true
    }));
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('posts the owner report to the Inbox when its thread is gone', async () => {
    const { deps, notifier } = setup({ threadLive: vi.fn(async () => false) }, ownerThread);
    await notifier.onTerminal(ownerThread());
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.queueThreadTurn).not.toHaveBeenCalled();
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('posts the owner report at boot replay when the owner is confirmed gone', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false), listUnreported: vi.fn(async () => [ownerPty()]) }, ownerPty);
    await notifier.replayUnreported();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('posts when the owner PTY disappears while its report waits to be typed', async () => {
    const { deps, notifier, setState } = setup({}, ownerPty);
    setState('running');
    await notifier.onTerminal(ownerPty());
    expect(deps.appendInbox).not.toHaveBeenCalled();
    notifier.forget('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('does not post for a delivered owner report', async () => {
    const { deps, notifier } = setup({}, ownerPty);
    await notifier.onTerminal(ownerPty());
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });

  it('does not post for transient failures: failed liveness check or refused thread turn', async () => {
    const throwing = setup({ threadLive: vi.fn(async () => { throw new Error('down'); }) }, ownerThread);
    await throwing.notifier.onTerminal(ownerThread());
    const refused = setup({ queueThreadTurn: vi.fn(async () => ({ ok: false, reason: 'busy' })) }, ownerThread);
    await refused.notifier.onTerminal(ownerThread());
    await vi.advanceTimersByTimeAsync(0);
    for (const { deps } of [throwing, refused]) {
      expect(deps.appendInbox).not.toHaveBeenCalled();
      expect(deps.markReported).not.toHaveBeenCalled();
    }
  });

  it('logs a failing Inbox push for a gone owner, leaves the run unmarked and does not throw', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false), appendInbox: vi.fn(async () => { throw new Error('inbox down'); }) }, ownerPty);
    await expect(notifier.onTerminal(ownerPty())).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('result entry failed'), expect.any(Error));
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('retries a gone owner report on a later report once a failed Inbox push released it', async () => {
    const appendInbox = vi.fn().mockRejectedValueOnce(new Error('inbox down')).mockResolvedValue(undefined);
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false), appendInbox }, ownerPty);
    await notifier.onTerminal(ownerPty());
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markReported).not.toHaveBeenCalled();
    await notifier.onTerminal(ownerPty());
    await vi.advanceTimersByTimeAsync(0);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('retries a gone proposer blocker on a later offer once a failed Inbox push released it', async () => {
    const appendInbox = vi.fn().mockRejectedValueOnce(new Error('inbox down')).mockResolvedValue(undefined);
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false), appendInbox }, proposerPty);
    await notifier.onHumanBlocker(proposerPty(), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
    await notifier.onHumanBlocker(proposerPty(), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('does not double-post a proposer report when its session is gone', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false) }, proposerPty);
    await notifier.onTerminal(proposerPty());
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('posts a gone owner blocker to the Inbox without marking it, so a returning owner still gets it', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false) }, ownerPty);
    await notifier.onHumanBlocker(ownerPty(), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', executionId: 'e1', subject: 'Squad needs an answer: Ship it',
      comments: expect.stringContaining('Which file?'), dedupeKey: 'squad-proposal-blocker:e1:b1'
    }));
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('posts a gone proposer blocker to the Inbox, then marks it', async () => {
    const { deps, notifier } = setup({ threadLive: vi.fn(async () => false) }, proposerPty);
    await notifier.onHumanBlocker(proposerPty({ reportTo: { kind: 'thread', id: 't1', role: 'proposer' } } as never), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markBlockerReported).toHaveBeenCalledWith('e1', 'b1');
  });

  it('leaves a gone proposer blocker unmarked and logs when the Inbox push fails', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => false), appendInbox: vi.fn(async () => { throw new Error('inbox down'); }) }, proposerPty);
    await expect(notifier.onHumanBlocker(proposerPty(), blocker as never)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('blocker entry failed'), expect.any(Error));
    expect(deps.markBlockerReported).not.toHaveBeenCalled();
  });

  it('does not post a blocker that was delivered', async () => {
    const { deps, notifier } = setup({}, ownerPty);
    await notifier.onHumanBlocker(ownerPty(), blocker as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });
});

describe('local Composer runs (no reportTo, no proposal)', () => {
  const local = (over: Partial<ExecutionRecord> = {}) =>
    record({ proposal: undefined, callerPrincipalId: 'interactive:local', ...over } as never);

  it.each([['COMPLETED', 'completed'], ['FAILED', 'failed'], ['STOPPED', 'stopped']])('posts one Inbox result for %s', async (state, word) => {
    const rec = local({ state: state as never });
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({
      subject: `Squad ${word}: Ship it`, executionId: 'e1', dedupeKey: 'squad-local-result:e1:1', report: true, squadNotice: 'proposal-result'
    }));
    expect(deps.markReported).not.toHaveBeenCalled();
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.queueThreadTurn).not.toHaveBeenCalled();
  });

  it('does not double-report the same attempt, in flight or after', async () => {
    const rec = local();
    const { deps, notifier } = setup({}, () => rec);
    await Promise.all([notifier.onTerminal(rec), notifier.onTerminal(rec)]);
    await notifier.onTerminal(rec);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
  });

  it('marks a durable local run reported after the Inbox post, once', async () => {
    const rec = local({ localReport: true } as never);
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec);
    await notifier.onTerminal(rec);
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
  });

  it('does not mark when the Inbox post fails, and a mark failure is logged only', async () => {
    const rec = local({ localReport: true } as never);
    const failing = setup({ appendInbox: vi.fn(async () => { throw new Error('inbox down'); }) }, () => rec);
    await failing.notifier.onTerminal(rec);
    expect(failing.deps.markReported).not.toHaveBeenCalled();
    const markFails = setup({ markReported: vi.fn(async () => { throw new Error('store down'); }) }, () => rec);
    await markFails.notifier.onTerminal(rec);
    expect(markFails.deps.appendInbox).toHaveBeenCalledOnce();
    expect(markFails.deps.log).toHaveBeenCalledWith(expect.stringContaining('mark failed'), expect.any(Error));
  });

  it('replays an unmarked durable local run after restart, then not once marked', async () => {
    const rec = local({ localReport: true } as never);
    const listUnreported = vi.fn(async () => [rec]);
    const { deps, notifier } = setup({ listUnreported }, () => rec);
    await notifier.onTerminal(rec);
    expect(deps.appendInbox).not.toHaveBeenCalled();
    await notifier.replayUnreported();
    await notifier.replayUnreported();
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
    // Next boot: the store lists nothing, and a marked record handed in directly is skipped.
    const marked = local({ localReport: true, reportNoticeVersion: 1 } as never);
    const next = setup({ listUnreported: vi.fn(async () => [marked]) }, () => marked);
    await next.notifier.replayUnreported();
    await next.notifier.onTerminal(marked);
    expect(next.deps.appendInbox).not.toHaveBeenCalled();
    expect(next.deps.markReported).not.toHaveBeenCalled();
  });

  it('replay ignores target-less records that are not durable local runs and tolerates a failing list', async () => {
    const legacy = local();
    const a = setup({ listUnreported: vi.fn(async () => [legacy]) });
    await a.notifier.replayUnreported();
    expect(a.deps.appendInbox).not.toHaveBeenCalled();
    const b = setup({ listUnreported: vi.fn(async () => { throw new Error('boom'); }) });
    await b.notifier.replayUnreported();
    expect(b.deps.log).toHaveBeenCalled();
  });

  it('never reports a plan-correction stop, other principals or non-terminal runs', async () => {
    const { deps, notifier } = setup({}, () => local());
    await notifier.onTerminal(local({ state: 'STOPPED' as never, timeoutReason: 'plan-correction-cancelled' }));
    await notifier.onTerminal(local({ callerPrincipalId: 'pty:abc' }));
    await notifier.onTerminal(local({ state: 'RUNNING' as never }));
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });

  it('waits while worktree terminal effects are pending, then reports with the outcome', async () => {
    const pending = local({ stateVersion: 4, squadWorktree: { path: '/wt', branch: 'sq', baseBranch: 'main' } } as never);
    const { deps, notifier } = setup({}, () => pending);
    await notifier.onTerminal(pending);
    expect(deps.appendInbox).not.toHaveBeenCalled();
    await notifier.onTerminal(pending, { worktree: 'merged' });
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad completed: Ship it', comments: expect.stringContaining('merged') }));
  });

  it('does not call a retained worktree a completion', async () => {
    const rec = local({ squadWorktree: { path: '/wt', branch: 'sq', baseBranch: 'main' } } as never);
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec, { worktree: 'kept' });
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad ended, worktree kept: Ship it' }));
  });

  it('calls a user-owned project-root target completed, not kept', async () => {
    const rec = local({ squadWorktree: { path: '/proj', branch: 'main', ownership: 'user', targetKind: 'project-root' } } as never);
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec, { worktree: 'kept' });
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad completed: Ship it' }));
  });

  it('calls a user-owned linked worktree target completed', async () => {
    const rec = local({ squadWorktree: { path: '/linked', branch: 'feat', ownership: 'user', targetKind: 'linked-worktree' } } as never);
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec, { worktree: 'kept' });
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad completed: Ship it' }));
  });

  it('keeps the worktree-kept wording for a retained managed worktree', async () => {
    const rec = local({ squadWorktree: { path: '/wt', branch: 'sq', baseBranch: 'main', ownership: 'managed' } } as never);
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec, { worktree: 'kept' });
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad ended, worktree kept: Ship it' }));
  });

  it('calls a run with no worktree completed', async () => {
    const rec = local();
    const { deps, notifier } = setup({}, () => rec);
    await notifier.onTerminal(rec);
    expect(deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad completed: Ship it' }));
  });

  it('retries after a failed post, and ignores a record re-read as another attempt', async () => {
    const rec = local();
    const appendInbox = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const { deps, notifier } = setup({ appendInbox }, () => rec);
    await notifier.onTerminal(rec);
    await notifier.onTerminal(rec);
    expect(deps.appendInbox).toHaveBeenCalledTimes(2);
    const other = setup({}, () => local({ attempt: 2 }));
    await other.notifier.onTerminal(local());
    expect(other.deps.appendInbox).not.toHaveBeenCalled();
  });

  it('does nothing after dispose, and a reportTo run keeps the normal path', async () => {
    const d = setup({}, () => local());
    d.notifier.dispose();
    await d.notifier.onTerminal(local());
    expect(d.deps.appendInbox).not.toHaveBeenCalled();
    const owned = setup({}, () => record());
    await owned.notifier.onTerminal(record());
    expect(owned.deps.appendInbox).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'squad-proposal-result:e1:1' }));
    expect(owned.deps.markReported).toHaveBeenCalledWith('e1', 1);
  });
});
