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
    reply: vi.fn(() => true),
    ptyLive: vi.fn(() => true),
    ptyState: vi.fn(() => state),
    lastInputAt: vi.fn(() => lastInput),
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

  it('logs a throwing delivery dep and still marks reported', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => { throw new Error('boom'); }) });
    await expect(notifier.onTerminal(record())).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('delivery failed'), expect.any(Error));
    expect(deps.markReported).toHaveBeenCalledOnce();
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

  it('logs a failed queue and still marks reported', async () => {
    const { deps, notifier } = setup({ queueThreadTurn: vi.fn(async () => ({ ok: false, reason: 'deferred_queue_full' })) }, threadRecord);
    await notifier.onTerminal(threadRecord());
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('deferred_queue_full'));
    expect(deps.markReported).toHaveBeenCalledOnce();
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
    expect(deps.reply).toHaveBeenCalledOnce();
    expect(deps.reply).toHaveBeenCalledWith('s1', expect.stringContaining('is waiting for an answer in the Inbox: "Which file?"'));
    await notifier.onHumanBlocker(record(), { id: 'b2', question: 'Another?' } as never);
    expect(deps.reply).toHaveBeenCalledTimes(2);
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.markReported).not.toHaveBeenCalled();
  });

  it('forgets an execution\'s blockers once its terminal report is handled', async () => {
    const { deps, notifier } = setup();
    await notifier.onHumanBlocker(record({ state: 'RUNNING' as never }), blocker);
    await notifier.onTerminal(record());
    await notifier.onHumanBlocker(record({ state: 'RUNNING' as never }), blocker);
    expect(deps.reply.mock.calls.filter((call) => String((call as unknown[])[1]).includes('Which file?'))).toHaveLength(2);
  });

  it('bounds how many executions it remembers blockers for', async () => {
    const { deps, notifier } = setup();
    for (let i = 0; i <= 256; i++) await notifier.onHumanBlocker(record({ id: `e${i}` }), blocker);
    expect(deps.reply).toHaveBeenCalledTimes(257);
    // The oldest execution was forgotten; the newest is still remembered.
    await notifier.onHumanBlocker(record({ id: 'e0' }), blocker);
    await notifier.onHumanBlocker(record({ id: 'e256' }), blocker);
    expect(deps.reply).toHaveBeenCalledTimes(258);
  });

  it('never throws', async () => {
    const { deps, notifier } = setup({ ptyLive: vi.fn(() => { throw new Error('x'); }) });
    await expect(notifier.onHumanBlocker(record(), blocker)).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('blocker report failed'), expect.any(Error));
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

  it('treats a throwing liveness check as not live and still posts the Inbox result', async () => {
    const thr = record({ proposal: { id: 'r', proposerKind: 'thread', proposerId: 't1' } as never });
    const { deps, notifier } = setup({ listUnreported: vi.fn(async () => [thr]), threadLive: vi.fn(async () => { throw new Error('timeout'); }) }, () => thr);
    await notifier.replayUnreported();
    expect(deps.queueThreadTurn).not.toHaveBeenCalled();
    expect(deps.appendInbox).toHaveBeenCalledOnce();
    expect(deps.markReported).toHaveBeenCalledWith('e1', 1);
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
    // A throwing liveness probe is logged and treated as not live; the record is still reported.
    expect(bad.deps.log).toHaveBeenCalledWith(expect.stringContaining('replay liveness check failed for e1'), expect.any(Error));
    expect(bad.deps.markReported).toHaveBeenCalledWith('e1', 1);
  });
});

describe('logging safety', () => {
  it('survives a throwing logger', async () => {
    const { notifier } = setup({ log: vi.fn(() => { throw new Error('log'); }), getRecord: vi.fn(async () => { throw new Error('x'); }) });
    await expect(notifier.onTerminal(record())).resolves.toBeUndefined();
  });
});
