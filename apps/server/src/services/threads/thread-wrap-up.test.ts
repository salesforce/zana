import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deferredText,
  disposeThreadWrapUps,
  ThreadWrapUpRegistry,
  threadWrapUps,
  WRAP_UP_SETTLE_MS,
  WRAP_UP_TIMEOUT_MS,
  type ThreadWrapUpHost
} from './thread-wrap-up.js';
import type { SessionCloseNote, SummarizeForCloseResult } from '../followups/close-summary.js';

const thread = { id: 't1', projectId: 'p1', hostId: 'h1', title: ' Build it ' };
const INSTRUCTIONS = 'Wrap up.\n1. Do it.';
const note = (over: Partial<SessionCloseNote> = {}): SessionCloseNote => ({ body: '## Did\n- a', unfinished: false, asksUser: false, ...over });

function make(over: Partial<ThreadWrapUpHost> = {}) {
  const listeners = new Set<(payload: unknown) => void>();
  const order: string[] = [];
  const state = {
    status: 'idle',
    pending: false,
    messages: [] as Array<{ seq: number; role: 'user' | 'assistant'; text: string }>,
    // The thread's send queue, as `listDeferredThreadMessages` reports it.
    queue: [] as Array<{ id: string; text?: string; status: string }>
  };
  const host = {
    instructions: () => INSTRUCTIONS,
    hasPendingInteraction: vi.fn(() => state.pending),
    hostOnline: vi.fn(() => true),
    getStatus: vi.fn(() => state.status),
    // Like 'queue-if-active': a busy thread queues the message, an idle one sends it straight away.
    send: vi.fn(async (_id: string, text: string) => {
      order.push('send');
      if (state.status === 'active' || state.status === 'starting') state.queue.push({ id: 'ours', text: text.trim(), status: 'queued' });
    }),
    subscribe: vi.fn((l: (payload: unknown) => void) => {
      order.push('subscribe');
      listeners.add(l);
      return () => { listeners.delete(l); };
    }),
    messages: vi.fn(() => state.messages),
    digest: vi.fn(() => 'digest'),
    summarizeForClose: vi.fn(async (): Promise<SummarizeForCloseResult> => ({ ok: true, title: 'Build it', note: note() })),
    recordClose: vi.fn(async () => undefined),
    recordKeptOpen: vi.fn(async () => undefined),
    recordLastTurn: vi.fn(async () => ({ summarized: 1 })),
    queuedSends: vi.fn(() => state.queue.map((row) => ({ ...row }))),
    dropQueuedSend: vi.fn((_t: string, id: string) => { state.queue = state.queue.filter((row) => row.id !== id); }),
    isOpen: vi.fn(() => true),
    archive: vi.fn(async () => true),
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (h: NodeJS.Timeout) => clearTimeout(h),
    log: vi.fn(),
    ...over
  } satisfies ThreadWrapUpHost;
  const registry = new ThreadWrapUpRegistry(host);
  const emit = (view: Record<string, unknown>) => {
    state.status = (view.status as string) ?? state.status;
    for (const l of [...listeners]) l({ id: 't1', ...view });
  };
  return { host, registry, emit, state, listeners, order };
}

/** Run a wrap-up to the point where the thread is active, then rested for the settle time. */
async function rest(h: ReturnType<typeof make>) {
  expect(await h.registry.request(thread)).toBe('wrapping-up');
  h.emit({ status: 'active' });
  h.emit({ status: 'idle' });
  await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ThreadWrapUpRegistry', () => {
  it('subscribes before it sends the instructions once, line breaks kept', async () => {
    const h = make();
    expect(await h.registry.request(thread)).toBe('wrapping-up');
    expect(h.order).toEqual(['subscribe', 'send']);
    expect(h.host.send).toHaveBeenCalledWith('t1', INSTRUCTIONS);
    expect(h.registry.isWrappingUp('t1')).toBe(true);
    expect(await h.registry.request(thread)).toBe('wrapping-up');
    expect(h.host.send).toHaveBeenCalledTimes(1);
    expect(h.host.subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the thread open with an inbox note when it already waits on the user', async () => {
    const h = make();
    h.state.pending = true;
    expect(await h.registry.request(thread)).toBe('kept-open');
    expect(h.host.send).not.toHaveBeenCalled();
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'asks-you', undefined);
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to today\'s close when the host is offline or the send throws', async () => {
    const offline = make({ hostOnline: () => false });
    expect(await offline.registry.request(thread)).toBe('fallback');
    expect(offline.host.send).not.toHaveBeenCalled();
    expect(offline.host.subscribe).not.toHaveBeenCalled();
    const throwing = make({ send: vi.fn(async () => { throw new Error('queue full'); }) });
    expect(await throwing.registry.request(thread)).toBe('fallback');
    expect(throwing.host.log).toHaveBeenCalledWith(expect.stringContaining('could not start: queue full'));
    const plain = make({ send: vi.fn(async () => { throw 'nope'; }) });
    expect(await plain.registry.request(thread)).toBe('fallback');
    for (const h of [offline, throwing, plain]) {
      expect(h.registry.isWrappingUp('t1')).toBe(false);
      expect(h.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('ignores an active edge seen before the send, and waits for the thread to leave a busy state first', async () => {
    const h = make();
    h.state.status = 'active';
    await h.registry.request(thread);
    h.emit({ status: 'active' }); // still the earlier turn
    h.emit({ status: 'idle' }); // the queued wrap-up message is sent after this
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    h.state.queue = []; // the drain sent our row
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
  });

  it('summarises after a 5 s rest, records wrapped and archives', async () => {
    const h = make();
    await rest(h);
    expect(h.host.summarizeForClose).toHaveBeenCalledWith('p1', 't1', { digest: 'digest', title: 'Build it' });
    expect(h.host.recordClose).toHaveBeenCalledWith('p1', 't1', 'Build it', note(), 'wrapped');
    expect(h.host.archive).toHaveBeenCalledWith('t1');
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not finish when the rest is shorter than the settle time', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS - 1000);
    h.emit({ status: 'active' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    h.emit({ status: 'idle' });
    h.emit({ status: 'idle' }); // a repeat event keeps the same wait
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
  });

  it('re-checks the status when the rest timer fires', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    h.state.status = 'active'; // flipped without an event
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    h.state.status = 'idle';
    h.state.pending = true;
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    h.state.pending = false;
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the thread open, with a note and no archive, when a question stays pending for 5 s', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.pending = true;
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'asks-you', note());
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a pending interaction that is answered within the settle time or is gone when the timer fires', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.pending = true;
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(1000);
    h.state.pending = false;
    h.emit({ status: 'active', hasPendingInteraction: false });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(1000);
    h.state.pending = false; // answered without an event
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
  });

  it('records the block without a note when the summary fails', async () => {
    const h = make({ summarizeForClose: vi.fn(async () => ({ ok: false, reason: 'summary-failed' }) as const) });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.pending = true;
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'asks-you', undefined);
  });

  it('keeps the thread open when the summary says the agent asks the user', async () => {
    const h = make({ summarizeForClose: vi.fn(async () => ({ ok: true, title: 'Build it', note: note({ asksUser: true }) }) as const) });
    await rest(h);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'asks-you', note({ asksUser: true }));
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.host.recordClose).not.toHaveBeenCalled();
  });

  it('still leaves a record from the last assistant message, then archives, when the summary fails', async () => {
    const h = make({ summarizeForClose: vi.fn(async () => { throw new Error('llm down'); }) });
    h.state.messages = [
      { seq: 1, role: 'assistant', text: 'earlier' },
      { seq: 2, role: 'assistant', text: '  The full last message, not a preview.  ' },
      { seq: 3, role: 'user', text: 'ignored' }
    ];
    await rest(h);
    expect(h.host.recordLastTurn).toHaveBeenCalledWith('p1', 't1', 'Build it', 'The full last message, not a preview.');
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.host.archive).toHaveBeenCalledWith('t1');
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('summary failed: llm down'));
  });

  it('writes a one-line note when the summary failed and the last-turn record wrote nothing', async () => {
    const failed = () => vi.fn(async () => ({ ok: false, reason: 'empty' }) as const);
    const noPaper = make({ summarizeForClose: failed(), recordLastTurn: vi.fn(async () => ({ summarized: 0 })) });
    noPaper.state.messages = [{ seq: 1, role: 'assistant', text: 'something' }];
    await rest(noPaper);
    expect(noPaper.host.recordClose).toHaveBeenCalledWith(
      'p1', 't1', 'Build it',
      { body: 'The summary could not be written.', unfinished: false, asksUser: false },
      'wrapped'
    );
    expect(noPaper.host.archive).toHaveBeenCalledWith('t1');
    const noText = make({ summarizeForClose: failed() });
    await rest(noText);
    expect(noText.host.recordLastTurn).not.toHaveBeenCalled();
    expect(noText.host.recordClose).toHaveBeenCalledTimes(1);
    expect(noText.host.archive).toHaveBeenCalledWith('t1');
  });

  it('logs and releases everything when recording or archiving throws', async () => {
    const h = make({ archive: vi.fn(async () => { throw new Error('locked'); }) });
    await rest(h);
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('close failed: locked'));
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    const k = make({ recordKeptOpen: vi.fn(async () => { throw new Error('disk'); }) });
    k.state.pending = true;
    await k.registry.request(thread);
    expect(k.host.log).toHaveBeenCalledWith(expect.stringContaining('record failed: disk'));
    expect(k.registry.isWrappingUp('t1')).toBe(false);
    const plain = make({ archive: vi.fn(async () => { throw 'x'; }) });
    await rest(plain);
    expect(plain.host.log).toHaveBeenCalledWith(expect.stringContaining('close failed: x'));
  });

  it('stops without a record or archive when the user writes in the thread after the wrap-up message', async () => {
    const h = make();
    h.state.messages = [{ seq: 4, role: 'assistant', text: 'earlier' }];
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.messages = [
      { seq: 4, role: 'assistant', text: 'earlier' },
      { seq: 5, role: 'user', text: INSTRUCTIONS },
      { seq: 6, role: 'assistant', text: 'summary' },
      { seq: 7, role: 'user', text: 'actually, one more thing' }
    ];
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
  });

  it('does not depend on the stored wrap-up text: one user message after the send is the wrap-up itself', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.messages = [{ seq: 1, role: 'user', text: '  Wrap up.\r\n1. Do it.  ' }];
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
    expect(h.host.archive).toHaveBeenCalledWith('t1');
  });

  it('writes no record and does not archive when the user writes while the summary is being made', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({ summarizeForClose: vi.fn(async () => { await gate; return { ok: true, title: 'Build it', note: note() } as const; }) });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.messages = [{ seq: 1, role: 'user', text: INSTRUCTIONS }]; // the wrap-up message, stored once sent
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).toHaveBeenCalledTimes(1);
    h.state.messages = [...h.state.messages, { seq: 2, role: 'user', text: 'one more thing' }];
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
  });

  it('writes nothing when the thread is busy again or asks something when the summary returns', async () => {
    for (const change of [(h: ReturnType<typeof make>) => { h.state.status = 'active'; }, (h: ReturnType<typeof make>) => { h.state.pending = true; }]) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const h = make({ summarizeForClose: vi.fn(async () => { await gate; return { ok: true, title: 'Build it', note: note() } as const; }) });
      await h.registry.request(thread);
      h.emit({ status: 'active' });
      h.emit({ status: 'idle' });
      await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
      change(h);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.host.recordClose).not.toHaveBeenCalled();
      expect(h.host.archive).not.toHaveBeenCalled();
    }
  });

  it('does not archive when the user writes between the record and the archive', async () => {
    const h = make();
    h.host.recordClose.mockImplementation(async () => {
      h.state.messages = [...h.state.messages, { seq: 2, role: 'user', text: 'wait' }];
    });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.messages = [{ seq: 1, role: 'user', text: INSTRUCTIONS }];
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
    expect(h.host.archive).not.toHaveBeenCalled();
  });

  it('records and archives nothing when the registry is disposed while the summary is being made', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({ summarizeForClose: vi.fn(async () => { await gate; return { ok: true, title: 'Build it', note: note() } as const; }) });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    h.registry.dispose();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
  });

  it('ends silently when someone else archives the thread, or it is gone at the timeout', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active', archivedAt: 123 });
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();

    const gone = make();
    await gone.registry.request(thread);
    gone.host.getStatus.mockReturnValue(undefined as never);
    gone.host.isOpen.mockReturnValue(false); // the store no longer has the thread
    await vi.advanceTimersByTimeAsync(WRAP_UP_TIMEOUT_MS);
    expect(gone.host.recordKeptOpen).not.toHaveBeenCalled();
    expect(gone.registry.isWrappingUp('t1')).toBe(false);
  });

  it('records a turn error once the wrap-up turn has begun, and keeps the thread open', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.emit({ status: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'turn-error', undefined);
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an error left over from the earlier turn before the wrap-up begins', async () => {
    const h = make();
    h.state.status = 'error';
    await h.registry.request(thread);
    h.emit({ status: 'error' }); // the update the send itself emits
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(true);
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
    expect(h.host.archive).toHaveBeenCalledWith('t1');
  });

  it('keeps the thread open after 15 minutes, with no summary', async () => {
    const h = make();
    await h.registry.request(thread);
    await vi.advanceTimersByTimeAsync(WRAP_UP_TIMEOUT_MS);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'timeout', undefined);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its own queued wrap-up message when the job ends before it was sent, never a person\'s identical one', async () => {
    const h = make();
    h.state.status = 'active';
    await h.registry.request(thread);
    // A person queues the same text behind ours: it is theirs, by id.
    h.state.queue.push({ id: 'person', text: INSTRUCTIONS.trim(), status: 'queued' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_TIMEOUT_MS);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'timeout', undefined);
    expect(h.host.dropQueuedSend).toHaveBeenCalledTimes(1);
    expect(h.host.dropQueuedSend).toHaveBeenCalledWith('t1', 'ours');
    expect(h.state.queue).toEqual([{ id: 'person', text: INSTRUCTIONS.trim(), status: 'queued' }]);
  });
  it('leaves the queue alone once the wrap-up turn began or while it is being sent, and logs a failed removal', async () => {
    const h = make();
    await rest(h); // sent straight away: nothing of ours queued
    expect(h.host.dropQueuedSend).not.toHaveBeenCalled();
    const sending = make();
    sending.state.status = 'active';
    await sending.registry.request(thread);
    sending.state.queue[0].status = 'dispatching';
    sending.registry.dispose();
    expect(sending.host.dropQueuedSend).not.toHaveBeenCalled();
    const bad = make({ dropQueuedSend: vi.fn(() => { throw new Error('gone'); }) });
    bad.state.status = 'active';
    await bad.registry.request(thread);
    await vi.advanceTimersByTimeAsync(WRAP_UP_TIMEOUT_MS);
    expect(bad.host.log).toHaveBeenCalledWith(expect.stringContaining('could not drop the queued wrap-up: gone'));
    const plain = make({ dropQueuedSend: vi.fn(() => { throw 'x'; }) });
    plain.state.status = 'active';
    await plain.registry.request(thread);
    await vi.advanceTimersByTimeAsync(WRAP_UP_TIMEOUT_MS);
    expect(plain.host.log).toHaveBeenCalledWith(expect.stringContaining('could not drop the queued wrap-up: x'));
  });
  it('falls back to today\'s close and leaves no job when a collaborator throws while starting', async () => {
    const pendingThrows = make({ hasPendingInteraction: vi.fn(() => { throw new Error('db locked'); }) });
    expect(await pendingThrows.registry.request(thread)).toBe('fallback');
    expect(pendingThrows.registry.isWrappingUp('t1')).toBe(false);
    expect(pendingThrows.host.log).toHaveBeenCalledWith(expect.stringContaining('could not start: db locked'));
    const timerThrows = make({ setTimer: (() => { throw new Error('no timers'); }) as never });
    expect(await timerThrows.registry.request(thread)).toBe('fallback');
    expect(timerThrows.registry.isWrappingUp('t1')).toBe(false);
    expect(timerThrows.listeners.size).toBe(0);
    const subscribeThrows = make({ subscribe: vi.fn(() => { throw 'plain'; }) });
    expect(await subscribeThrows.registry.request(thread)).toBe('fallback');
    expect(subscribeThrows.registry.isWrappingUp('t1')).toBe(false);
    // A second request is not swallowed by a stuck job.
    expect(await subscribeThrows.registry.request(thread)).toBe('fallback');
  });

  it('falls back when creating the job itself throws', async () => {
    const h = make({ instructions: () => { throw new Error('config unreadable'); } });
    expect(await h.registry.request(thread)).toBe('fallback');
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('request failed: config unreadable'));
    const plain = make({ instructions: () => { throw 'x'; } });
    expect(await plain.registry.request(thread)).toBe('fallback');
  });

  it('ignores other threads\' updates and junk payloads, and a throwing collaborator never escapes the listener', async () => {
    const h = make({ hasPendingInteraction: vi.fn(() => false) });
    await h.registry.request(thread);
    const [listener] = [...h.listeners];
    expect(() => listener(null)).not.toThrow();
    expect(() => listener({ id: 'other', status: 'error' })).not.toThrow();
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    h.host.getStatus = vi.fn(() => { throw new Error('boom'); });
    h.host.setTimer = (() => { throw new Error('no timers'); }) as never;
    expect(() => listener({ id: 't1', status: 'active' })).not.toThrow();
    expect(() => listener({ id: 't1', status: 'idle' })).not.toThrow();
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('listener failed: no timers'));
    h.registry.dispose();
  });

  it('logs a non-Error listener failure', async () => {
    const h = make();
    await h.registry.request(thread);
    h.host.setTimer = (() => { throw 'plain'; }) as never;
    const [listener] = [...h.listeners];
    listener({ id: 't1', status: 'active' });
    listener({ id: 't1', status: 'idle' });
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('listener failed: plain'));
    h.registry.dispose();
  });

  it('dispose releases every subscription and timer', async () => {
    const h = make();
    await h.registry.request(thread);
    await h.registry.request({ ...thread, id: 't2' });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.registry.dispose();
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    h.registry.dispose();
  });

  it('uses a placeholder title for an untitled thread', async () => {
    const h = make();
    h.state.pending = true;
    await h.registry.request({ ...thread, title: null });
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Untitled agent', 'asks-you', undefined);
  });
});

describe('ThreadWrapUpRegistry review round 2 (F14-F16, F18)', () => {
  it('drops the queued wrap-up and closes the way today does when the turn it waits behind fails', async () => {
    const h = make();
    h.state.status = 'active';
    h.state.messages = [{ seq: 1, role: 'user', text: 'go' }, { seq: 2, role: 'assistant', text: ' The full last answer. ' }];
    expect(await h.registry.request(thread)).toBe('wrapping-up');
    expect(h.state.queue).toEqual([{ id: 'ours', text: INSTRUCTIONS.trim(), status: 'queued' }]);
    h.emit({ status: 'error' }); // the earlier turn ended in an error; the queue never drains
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.dropQueuedSend).toHaveBeenCalledWith('t1', 'ours');
    expect(h.host.recordLastTurn).toHaveBeenCalledWith('p1', 't1', 'Build it', 'The full last answer.');
    expect(h.host.archive).toHaveBeenCalledWith('t1');
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('archives without a record when the failed earlier turn left no assistant text, and logs a failed archive', async () => {
    const h = make({ archive: vi.fn(async () => { throw new Error('db gone'); }) });
    h.state.status = 'active';
    await h.registry.request(thread);
    h.emit({ status: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordLastTurn).not.toHaveBeenCalled();
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('close after the earlier error failed: db gone'));
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    const plain = make({ archive: vi.fn(async () => { throw 'x'; }) });
    plain.state.status = 'active';
    await plain.registry.request(thread);
    plain.emit({ status: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(plain.host.log).toHaveBeenCalledWith(expect.stringContaining('close after the earlier error failed: x'));
  });

  it('ends the job, logged, when a re-check throws after the summary (never stuck)', async () => {
    let calls = 0;
    const h = make({
      messages: vi.fn(() => {
        calls += 1;
        if (calls > 2) throw new Error('db locked'); // start and the pre-summary check pass, the late re-check throws
        return [];
      })
    });
    await rest(h);
    expect(h.host.summarizeForClose).toHaveBeenCalledTimes(1);
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('close failed: db locked'));
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const plain = make({ getStatus: vi.fn(() => { throw 'x'; }) });
    plain.host.getStatus.mockReturnValueOnce('idle'); // start reads the status once before the send
    expect(await plain.registry.request(thread)).toBe('wrapping-up');
    // The read right after the send failed: logged, and still reported as wrapping up, never a fallback.
    expect(plain.host.log).toHaveBeenCalledWith(expect.stringContaining('could not re-read after the send: x'));
    plain.emit({ status: 'active' });
    plain.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(plain.host.log).toHaveBeenCalledWith(expect.stringContaining('close failed: x'));
    expect(plain.registry.isWrappingUp('t1')).toBe(false);
  });

  it('writes no question note when the question is answered while the summary runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({
      summarizeForClose: vi.fn(async (): Promise<SummarizeForCloseResult> => { await gate; return { ok: true, title: 'Build it', note: note() }; })
    });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.pending = true;
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).toHaveBeenCalledTimes(1);
    h.state.pending = false; // the person answered
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(h.listeners.size).toBe(0);
  });

  it('ends the job, logged, when the question re-check throws', async () => {
    let calls = 0;
    const h = make({
      hasPendingInteraction: vi.fn(() => {
        calls += 1;
        if (calls === 1) return false; // start
        if (calls === 2) return true; // the block timer
        throw new Error('db locked');
      })
    });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.log).toHaveBeenCalledWith(expect.stringContaining('could not record the question: db locked'));
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    const plain = make({ hasPendingInteraction: vi.fn(() => { throw 'x'; }) });
    plain.host.hasPendingInteraction.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await plain.registry.request(thread);
    plain.emit({ status: 'active' });
    plain.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(plain.host.log).toHaveBeenCalledWith(expect.stringContaining('could not record the question: x'));
  });

  it('gives a request that joins a starting job the first answer, and wrapping-up when the first falls back', async () => {
    let releaseKeep!: () => void;
    const keepGate = new Promise<void>((resolve) => { releaseKeep = resolve; });
    const kept = make({ recordKeptOpen: vi.fn(async () => { await keepGate; }) });
    kept.state.pending = true;
    const first = kept.registry.request(thread);
    const joiner = kept.registry.request(thread);
    releaseKeep();
    expect(await first).toBe('kept-open');
    expect(await joiner).toBe('kept-open');
    expect(kept.host.recordKeptOpen).toHaveBeenCalledTimes(1);

    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    const failing = make({ send: vi.fn(async () => { await sendGate; throw new Error('queue full'); }) });
    const firstFail = failing.registry.request(thread);
    const joinFail = failing.registry.request(thread);
    releaseSend();
    expect(await firstFail).toBe('fallback'); // the first caller runs today's close
    expect(await joinFail).toBe('wrapping-up'); // the joiner must not run it a second time
    expect(failing.host.send).toHaveBeenCalledTimes(1);
    expect(failing.registry.isWrappingUp('t1')).toBe(false);
  });
});

describe('ThreadWrapUpRegistry ownership (Geoff review on #545)', () => {
  it('falls back to today\'s close when other messages are queued ahead of the wrap-up', async () => {
    const h = make();
    h.state.queue = [{ id: 'earlier', text: 'one more thing', status: 'queued' }];
    expect(await h.registry.request(thread)).toBe('fallback');
    expect(h.host.send).not.toHaveBeenCalled();
    expect(h.host.subscribe).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
  });
  it('counts only the turn its own queued message started, in the real order (dispatching, active, removed)', async () => {
    const h = make();
    h.state.status = 'active';
    await h.registry.request(thread);
    h.emit({ status: 'active' }); // still the earlier turn: our row is queued
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    h.state.queue[0].status = 'dispatching'; // the drain takes our row
    h.emit({ status: 'active' });
    h.state.queue = []; // sent and deleted
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.recordClose).toHaveBeenCalledTimes(1);
    expect(h.host.archive).toHaveBeenCalledWith('t1');
  });

  it('records a turn error at once when the drained wrap-up fails while its row is being sent', async () => {
    const h = make();
    h.state.status = 'active';
    await h.registry.request(thread);
    h.emit({ status: 'idle' }); // the earlier turn ended; the drain starts on our row
    h.state.queue[0].status = 'dispatching';
    h.emit({ status: 'active' });
    h.emit({ status: 'error' }); // the send failed
    h.state.queue[0].status = 'failed';
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'turn-error', undefined);
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records a turn error when the drained wrap-up fails before any active update arrives', async () => {
    const h = make();
    h.state.status = 'active';
    await h.registry.request(thread);
    h.emit({ status: 'idle' });
    h.state.queue[0].status = 'failed';
    h.emit({ status: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordKeptOpen).toHaveBeenCalledWith('p1', 't1', 'Build it', 'turn-error', undefined);
  });

  it('does not archive while a person\'s message is still queued in the thread', async () => {
    const h = make();
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.queue.push({ id: 'person', text: 'and also this', status: 'queued' }); // held: paused, editing or send-later
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    expect(h.host.summarizeForClose).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(true); // still watching
    h.registry.dispose();
  });

  it('does not archive when a person queues a message while the summary runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({
      summarizeForClose: vi.fn(async (): Promise<SummarizeForCloseResult> => { await gate; return { ok: true, title: 'Build it', note: note() }; })
    });
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    h.state.queue.push({ id: 'person', text: 'wait', status: 'queued' });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
  });
  it('writes nothing and does not archive when the thread is archived while the summary runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({
      summarizeForClose: vi.fn(async (): Promise<SummarizeForCloseResult> => { await gate; return { ok: true, title: 'Build it', note: note() }; })
    });
    expect(await h.registry.request(thread)).toBe('wrapping-up');
    h.emit({ status: 'active' });
    h.emit({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    h.host.isOpen.mockReturnValue(false); // archived by the person, outside this job
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordClose).not.toHaveBeenCalled();
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
  });

  it('writes no question note for a thread archived while its question summary runs, nor a timeout note for an archived one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({
      summarizeForClose: vi.fn(async (): Promise<SummarizeForCloseResult> => { await gate; return { ok: true, title: 'Build it', note: note() }; })
    });
    h.state.pending = false;
    await h.registry.request(thread);
    h.emit({ status: 'active' });
    h.state.pending = true;
    h.emit({ status: 'active', hasPendingInteraction: true });
    await vi.advanceTimersByTimeAsync(WRAP_UP_SETTLE_MS);
    h.host.isOpen.mockReturnValue(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordKeptOpen).not.toHaveBeenCalled();
    const t = make();
    await t.registry.request(thread);
    t.host.isOpen.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(WRAP_UP_TIMEOUT_MS);
    expect(t.host.recordKeptOpen).not.toHaveBeenCalled();
    expect(t.registry.isWrappingUp('t1')).toBe(false);
  });

  it('does not close after the earlier error when the person wrote, the thread is busy, asking, archived or has more queued', async () => {
    for (const change of ['wrote', 'busy', 'asking', 'archived', 'queued'] as const) {
      const h = make();
      h.state.status = 'active';
      h.state.messages = [{ seq: 1, role: 'assistant', text: 'Earlier answer.' }];
      await h.registry.request(thread);
      if (change === 'wrote') h.state.messages = [...h.state.messages, { seq: 2, role: 'user', text: 'one more thing' }];
      if (change === 'asking') h.state.pending = true;
      if (change === 'archived') h.host.isOpen.mockReturnValue(false);
      if (change === 'busy') h.host.getStatus.mockReturnValue('active');
      if (change === 'queued') h.state.queue.push({ id: 'person', text: 'later', status: 'queued' });
      h.emit({ status: 'error' });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.host.recordLastTurn).not.toHaveBeenCalled();
      expect(h.host.archive).not.toHaveBeenCalled();
      expect(h.registry.isWrappingUp('t1')).toBe(false);
    }
  });
  it('does not archive after the earlier error when the person writes while the last-turn record is written', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = make({ recordLastTurn: vi.fn(async () => { await gate; return { summarized: 1 }; }) });
    h.state.status = 'active';
    h.state.messages = [{ seq: 1, role: 'assistant', text: 'Earlier answer.' }];
    await h.registry.request(thread);
    h.emit({ status: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.recordLastTurn).toHaveBeenCalledTimes(1);
    h.state.messages = [...h.state.messages, { seq: 2, role: 'user', text: 'wait' }];
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.archive).not.toHaveBeenCalled();
    expect(h.registry.isWrappingUp('t1')).toBe(false);
  });
});

describe('threadWrapUps', () => {
  it('builds one registry per ctx, wired to the live services, and disposes it with the ctx', async () => {
    const unsubscribe = vi.fn();
    const ctx = {
      config: { getConfig: () => ({ closeWrapUpInstructions: 'Be brief' }) },
      pendingInteractions: { hasPendingThreadInteraction: () => false },
      hostHub: { connectedHostIds: () => [] as string[] },
      hub: { subscribe: vi.fn(() => unsubscribe) }
    } as never;
    const registry = threadWrapUps(ctx);
    expect(threadWrapUps(ctx)).toBe(registry);
    // Host not connected: the request falls back without touching the thread store.
    expect(await registry.request(thread)).toBe('fallback');
    disposeThreadWrapUps(ctx);
    expect(threadWrapUps(ctx)).not.toBe(registry);
    disposeThreadWrapUps({} as never);
  });
});

describe('deferredText', () => {
  const row = (payload: unknown) => ({ id: 'q1', threadId: 't1', kind: 'send', payload: typeof payload === 'string' ? payload : JSON.stringify(payload) }) as never;

  it('reads the text parts of a queued send, trimmed and joined', () => {
    expect(deferredText(row({ kind: 'send', mode: 'queue-if-active', input: [{ type: 'text', text: ' Wrap up. ', mentions: [] }, { type: 'image' }, { type: 'text', text: 'Then stop.' }] }))).toBe('Wrap up. \nThen stop.');
  });

  it('is undefined for anything that is not a plain list of parts', () => {
    expect(deferredText(row({ kind: 'send', mode: 'queue-if-active', input: 'text' }))).toBeUndefined();
    expect(deferredText(row({ kind: 'other' }))).toBeUndefined();
    expect(deferredText(row('{not json'))).toBeUndefined();
  });
});
