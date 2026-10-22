import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { SQUAD_PROPOSAL_LIMITS } from '@zana-ai/zcc-domain/squad-proposal';
import { createPtyReportQueue, type QueuedReport } from './pty-report-queue.js';

function setup(over: Record<string, unknown> = {}) {
  let state: AgentState | undefined = 'idle';
  let live = true;
  let lastInput: number | undefined;
  let draft = false;
  const deps = {
    reply: vi.fn(() => true),
    ptyLive: vi.fn(() => live),
    ptyState: vi.fn(() => state),
    lastInputAt: vi.fn(() => lastInput),
    draftPending: vi.fn(() => draft),
    deliverableWhenWaiting: vi.fn(() => false),
    now: () => Date.now(),
    setTimer: vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
    clearTimer: vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    ...over
  };
  const log = vi.fn();
  const queue = createPtyReportQueue(deps as never, log);
  return {
    deps, log, queue,
    setState: (s: AgentState | undefined) => { state = s; },
    setLive: (v: boolean) => { live = v; },
    setLastInput: (t: number | undefined) => { lastInput = t; },
    setDraft: (v: boolean) => { draft = v; }
  };
}

const item = (over: Partial<QueuedReport> = {}): QueuedReport => ({ text: 'report', settle: vi.fn(), ...over });
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe('createPtyReportQueue', () => {
  it('types an item at once for a live idle session with no recent input, and settles it', () => {
    const { deps, queue } = setup();
    const a = item();
    queue.enqueue('s1', a);
    expect(deps.reply).toHaveBeenCalledWith('s1', 'report');
    expect(a.settle).toHaveBeenCalledOnce();
  });

  it('delivers when waiting only for harnesses that sit in waiting at rest, and treats done as rest', () => {
    const { deps, queue, setState } = setup();
    setState('waiting');
    queue.enqueue('s1', item());
    expect(deps.reply).not.toHaveBeenCalled();
    deps.deliverableWhenWaiting.mockReturnValue(true);
    queue.flush('s1');
    expect(deps.reply).toHaveBeenCalledOnce();
    setState('done');
    queue.enqueue('s1', item({ text: 'again' }));
    expect(deps.reply).toHaveBeenCalledTimes(2);
  });

  it('keeps an item while the session is busy, and uses the state hint on flush', () => {
    const { deps, queue, setState } = setup();
    setState('busy' as AgentState);
    queue.enqueue('s1', item());
    expect(deps.reply).not.toHaveBeenCalled();
    queue.flush('s1', 'idle');
    expect(deps.reply).toHaveBeenCalledOnce();
  });

  it('waits out the quiet period with one timer, then types', () => {
    const { deps, queue, setLastInput } = setup();
    setLastInput(Date.now());
    queue.enqueue('s1', item());
    queue.enqueue('s1', item({ text: 'second' }));
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.setTimer).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SQUAD_PROPOSAL_LIMITS.ptyQuietMs);
    // One item per flush: the second waits for the next quiet period.
    expect(deps.reply).toHaveBeenCalledTimes(1);
  });

  it('drops a queued item for good (settled) when the session is gone', () => {
    const { queue, setLive } = setup();
    setLive(false);
    const a = item();
    queue.enqueue('s1', a);
    expect(a.settle).toHaveBeenCalledOnce();
  });

  it('calls onDrop instead of settle when the session is gone, and logs a throwing onDrop or settle', () => {
    const { queue, setLive, log } = setup();
    setLive(false);
    const a = item({ onDrop: vi.fn() });
    queue.enqueue('s1', a);
    expect(a.onDrop).toHaveBeenCalledOnce();
    expect(a.settle).not.toHaveBeenCalled();
    queue.enqueue('s2', item({ onDrop: () => { throw new Error('drop'); } }));
    queue.enqueue('s3', item({ settle: () => { throw new Error('settle'); } }));
    expect(log).toHaveBeenCalledWith('squad proposal report drop failed', expect.any(Error));
    expect(log).toHaveBeenCalledWith('squad proposal report settle failed', expect.any(Error));
  });

  it('keeps an item unsettled when the session refuses the text', () => {
    const { queue, log } = setup({ reply: vi.fn(() => false) });
    const a = item();
    queue.enqueue('s1', a);
    expect(a.settle).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('squad proposal report not accepted by session s1');
  });

  it('drops the oldest report over the cap, via onDrop when present', () => {
    const { queue, setState } = setup();
    setState('busy' as AgentState);
    const first = item({ onDrop: vi.fn() });
    queue.enqueue('s1', first);
    const rest = Array.from({ length: SQUAD_PROPOSAL_LIMITS.ptyQueueMax }, () => item());
    for (const r of rest) queue.enqueue('s1', r);
    expect(first.onDrop).toHaveBeenCalledOnce();
    expect(first.settle).not.toHaveBeenCalled();
    const plain = setup();
    plain.setState('busy' as AgentState);
    const oldest = item();
    plain.queue.enqueue('s1', oldest);
    for (let i = 0; i < SQUAD_PROPOSAL_LIMITS.ptyQueueMax; i += 1) plain.queue.enqueue('s1', item());
    expect(oldest.settle).toHaveBeenCalledOnce();
  });

  it('forget drops the queue for good and clears the timer', () => {
    const { deps, queue, setLastInput } = setup();
    setLastInput(Date.now());
    const a = item();
    queue.enqueue('s1', a);
    queue.forget('s1');
    expect(deps.clearTimer).toHaveBeenCalledOnce();
    expect(a.settle).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SQUAD_PROPOSAL_LIMITS.ptyQuietMs);
    expect(deps.reply).not.toHaveBeenCalled();
  });

  it('logs a timer that cannot be cleared', () => {
    const { queue, log, setLastInput } = setup({ clearTimer: vi.fn(() => { throw new Error('nope'); }) });
    setLastInput(Date.now());
    queue.enqueue('s1', item());
    queue.forget('s1');
    expect(log).toHaveBeenCalledWith('squad proposal timer clear failed for s1', expect.any(Error));
  });

  it('logs a failing flush and carries on', () => {
    const { queue, log } = setup({ ptyLive: vi.fn(() => { throw new Error('boom'); }) });
    queue.enqueue('s1', item());
    expect(log).toHaveBeenCalledWith('squad proposal flush failed for s1', expect.any(Error));
  });

  describe('stillWanted recheck', () => {
    it('types the item when it is still wanted', async () => {
      const { deps, queue } = setup();
      const a = item({ stillWanted: vi.fn(async () => true) });
      queue.enqueue('s1', a);
      await tick();
      expect(deps.reply).toHaveBeenCalledWith('s1', 'report');
      expect(a.settle).toHaveBeenCalledOnce();
    });

    it('drops an unwanted item for good, settled, without typing it', async () => {
      const { deps, queue } = setup();
      const a = item({ stillWanted: vi.fn(async () => false), onDrop: vi.fn() });
      queue.enqueue('s1', a);
      await tick();
      expect(deps.reply).not.toHaveBeenCalled();
      expect(a.settle).toHaveBeenCalledOnce();
      expect(a.onDrop).not.toHaveBeenCalled();
    });

    it('still types when the check throws, and logs it', async () => {
      const { deps, queue, log } = setup();
      queue.enqueue('s1', item({ stillWanted: async () => { throw new Error('store down'); } }));
      await tick();
      expect(deps.reply).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('squad proposal report recheck failed for s1', expect.any(Error));
    });

    it('keeps the item unsettled (onDrop) when the session went away during the check', async () => {
      const { queue, setLive } = setup();
      let release!: (v: boolean) => void;
      const a = item({ stillWanted: () => new Promise<boolean>((resolve) => { release = resolve; }), onDrop: vi.fn() });
      queue.enqueue('s1', a);
      setLive(false);
      await tick();
      release(true);
      await tick();
      expect(a.onDrop).toHaveBeenCalledOnce();
      expect(a.settle).not.toHaveBeenCalled();
    });

    it('leaves a refused reply unsettled after the check', async () => {
      const { queue } = setup({ reply: vi.fn(() => false) });
      const a = item({ stillWanted: async () => true });
      queue.enqueue('s1', a);
      await tick();
      expect(a.settle).not.toHaveBeenCalled();
    });

    it('serializes: nothing else is typed while one check is in flight, then the next follows', async () => {
      const { deps, queue } = setup();
      let release!: (v: boolean) => void;
      const first = item({ text: 'one', stillWanted: () => new Promise<boolean>((resolve) => { release = resolve; }) });
      const second = item({ text: 'two' });
      queue.enqueue('s1', first);
      queue.enqueue('s1', second);
      queue.flush('s1');
      expect(deps.reply).not.toHaveBeenCalled();
      await tick();
      release(true);
      await tick();
      expect(deps.reply.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['one', 'two']);
    });

    it('logs a settle that throws after the check', async () => {
      const { queue, log } = setup();
      queue.enqueue('s1', item({ stillWanted: async () => false, settle: () => { throw new Error('x'); } }));
      await tick();
      expect(log).toHaveBeenCalledWith('squad proposal report settle failed', expect.any(Error));
    });

    it('logs a throwing reply after the check', async () => {
      const { queue, log } = setup({ reply: vi.fn(() => { throw new Error('pty'); }) });
      queue.enqueue('s1', item({ stillWanted: async () => true }));
      await tick();
      expect(log).toHaveBeenCalledWith('squad proposal flush failed for s1', expect.any(Error));
    });
  });

  describe('re-check timer', () => {
    const RECHECK = 5_000;

    it('holds while a fresh draft is pending, never typing over it, and delivers once it clears', () => {
      const { deps, queue, setDraft, setLastInput } = setup();
      setDraft(true);
      setLastInput(Date.now());
      queue.enqueue('s1', item());
      expect(deps.reply).not.toHaveBeenCalled();
      vi.advanceTimersByTime(RECHECK * 3);
      expect(deps.reply).not.toHaveBeenCalled();
      expect(deps.setTimer).toHaveBeenCalledTimes(4);
      setDraft(false);
      vi.advanceTimersByTime(SQUAD_PROPOSAL_LIMITS.ptyQuietMs);
      expect(deps.reply).toHaveBeenCalledOnce();
      expect(deps.reply).toHaveBeenCalledWith('s1', 'report');
    });

    it('delivers over a stale draft flag, logs it, and stops polling', () => {
      const { deps, queue, log, setDraft, setLastInput } = setup();
      setDraft(true);
      setLastInput(Date.now() - 10 * 60_000 - 1);
      queue.enqueue('s1', item());
      expect(deps.reply).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('squad proposal delivering over a stale draft flag for s1');
      vi.advanceTimersByTime(RECHECK * 10);
      expect(deps.setTimer).not.toHaveBeenCalled();
    });

    it('stops re-checking a held draft once it goes stale', () => {
      const { deps, queue, log, setDraft, setLastInput } = setup();
      setDraft(true);
      setLastInput(Date.now() - 10 * 60_000 + RECHECK);
      queue.enqueue('s1', item());
      expect(deps.reply).not.toHaveBeenCalled();
      vi.advanceTimersByTime(RECHECK);
      expect(deps.reply).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('squad proposal delivering over a stale draft flag for s1');
      const timers = deps.setTimer.mock.calls.length;
      vi.advanceTimersByTime(RECHECK * 10);
      expect(deps.setTimer).toHaveBeenCalledTimes(timers);
    });

    it('delivers a busy session without a status edge once it is idle, via the timer', () => {
      const { deps, queue, setState } = setup();
      setState('busy' as AgentState);
      queue.enqueue('s1', item());
      expect(deps.setTimer).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(RECHECK);
      expect(deps.reply).not.toHaveBeenCalled();
      setState('idle');
      vi.advanceTimersByTime(RECHECK);
      expect(deps.reply).toHaveBeenCalledOnce();
    });

    it('keeps a single timer per session across repeated flushes', () => {
      const { deps, queue, setState } = setup();
      setState('busy' as AgentState);
      queue.enqueue('s1', item());
      queue.flush('s1');
      queue.flush('s1');
      expect(deps.setTimer).toHaveBeenCalledOnce();
    });

    it('delivers when only non-key input is recent (the keystroke clock is old)', () => {
      const { deps, queue, setLastInput } = setup();
      setLastInput(Date.now() - SQUAD_PROPOSAL_LIMITS.ptyQuietMs - 1);
      queue.enqueue('s1', item());
      expect(deps.reply).toHaveBeenCalledOnce();
    });

    it('stops re-checking when the session exits', () => {
      const { deps, queue, setState, setLive } = setup();
      setState('busy' as AgentState);
      const a = item();
      queue.enqueue('s1', a);
      setLive(false);
      vi.advanceTimersByTime(RECHECK);
      expect(a.settle).toHaveBeenCalledOnce();
      expect(deps.setTimer).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(RECHECK * 3);
      expect(deps.setTimer).toHaveBeenCalledOnce();
    });

    it('clears the timer on forget and on dispose', () => {
      const first = setup();
      first.setDraft(true);
      first.setLastInput(Date.now());
      first.queue.enqueue('s1', item());
      first.queue.forget('s1');
      expect(first.deps.clearTimer).toHaveBeenCalledOnce();
      first.setDraft(false);
      vi.advanceTimersByTime(RECHECK);
      expect(first.deps.reply).not.toHaveBeenCalled();

      const second = setup();
      second.setState('busy' as AgentState);
      second.queue.enqueue('s1', item());
      second.queue.dispose();
      expect(second.deps.clearTimer).toHaveBeenCalledOnce();
      second.setState('idle');
      vi.advanceTimersByTime(RECHECK);
      expect(second.deps.reply).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('drops queues and timers without settling, so boot replay re-delivers', () => {
      const { deps, queue, setLastInput } = setup();
      setLastInput(Date.now());
      const a = item({ onDrop: vi.fn() });
      queue.enqueue('s1', a);
      queue.dispose();
      expect(deps.clearTimer).toHaveBeenCalledOnce();
      expect(a.settle).not.toHaveBeenCalled();
      expect(a.onDrop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(SQUAD_PROPOSAL_LIMITS.ptyQuietMs);
      expect(deps.reply).not.toHaveBeenCalled();
      queue.enqueue('s1', item());
      expect(deps.reply).not.toHaveBeenCalled();
    });

    it('clears the checking set: a check finishing after dispose neither types nor settles', async () => {
      const { deps, queue } = setup();
      let release!: (v: boolean) => void;
      const a = item({ stillWanted: () => new Promise<boolean>((resolve) => { release = resolve; }) });
      queue.enqueue('s1', a);
      queue.dispose();
      await tick();
      release(true);
      await tick();
      expect(deps.reply).not.toHaveBeenCalled();
      expect(a.settle).not.toHaveBeenCalled();
    });
  });
});
