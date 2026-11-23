import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  row: { id: 't1', projectId: 'p', title: 'My thread', status: 'error', archivedAt: null } as Record<string, unknown> | null,
  send: vi.fn(async () => ({}))
}));
vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: () => h.row }));
vi.mock('../threads/conversation-lifecycle.js', () => ({ sendConversationTurn: h.send }));

import { apiErrorFromProviderError, createThreadApiErrorResume, disposeThreadApiErrorResume, startThreadApiErrorResume } from './thread-api-error-resume.js';

const RULE = { id: 'r1', match: 'overloaded', matchMode: 'contains', message: 'continue', delaySeconds: 5, enabled: true };

function setup(config: Record<string, unknown> | undefined = { enabled: true, rules: [RULE], maxPerWindow: 3, windowMinutes: 15 }) {
  const listeners = new Set<(e: unknown) => void>();
  const ctx = {
    db: {},
    config: { getConfig: () => ({ apiErrorResume: config }) },
    inbox: { append: vi.fn(async () => ({})) },
    hub: {
      subscribe: (_type: string, fn: (e: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); }
    }
  };
  const log = vi.fn();
  const resume = createThreadApiErrorResume(ctx as never, { log });
  const emit = (type: string, payload: unknown = {}, threadId = 't1') => listeners.forEach((l) => l({ threadId, type, payload }));
  /** A host row filed under its legacy name, whose payload carries the canonical type. */
  const emitLegacy = (rowType: string, payload: Record<string, unknown>) => listeners.forEach((l) => l({ threadId: 't1', type: rowType, payload }));
  const fail = (info: unknown = { category: 'overloaded' }, extra: Record<string, unknown> = {}) => {
    emit('provider/error', { message: 'Server is overloaded', errorInfo: info, ...extra });
    emit('turn/completed', { status: 'failed', scope: { kind: 'turn', turnId: 'x' } });
  };
  return { ctx, log, resume, emit, emitLegacy, fail, listeners };
}

describe('apiErrorFromProviderError', () => {
  it('maps a temporary category to a shared kind with the message and detail', () => {
    expect(apiErrorFromProviderError({ message: 'boom', detail: 'more', errorInfo: { category: 'internal' } }))
      .toEqual({ error: 'server_error', text: 'boom more' });
    expect(apiErrorFromProviderError({ message: 'x', errorInfo: { category: 'overloaded' } })?.error).toBe('overloaded');
    expect(apiErrorFromProviderError({ message: 'x', errorInfo: { category: 'unknown' } })?.error).toBe('unknown');
  });

  it.each(['unauthorized', 'billing', 'rate-limit', 'bad-request', 'context-window-exceeded'])('does not resume %s', (category) => {
    expect(apiErrorFromProviderError({ message: 'x', errorInfo: { category } })).toBeNull();
  });

  it('ignores an error the provider is still retrying, and malformed input', () => {
    expect(apiErrorFromProviderError({ message: 'x', willRetry: true, errorInfo: { category: 'overloaded' } })).toBeNull();
    expect(apiErrorFromProviderError({ message: 'x' })).toBeNull();
    expect(apiErrorFromProviderError(null)).toBeNull();
    expect(apiErrorFromProviderError('nope')).toBeNull();
  });
});

describe('createThreadApiErrorResume', () => {
  beforeEach(() => { vi.useFakeTimers(); h.send.mockClear(); h.row = { id: 't1', projectId: 'p', title: 'My thread', status: 'error', archivedAt: null }; });
  afterEach(() => { vi.useRealTimers(); });

  it('sends the rule message as a new turn after the delay', async () => {
    const { fail } = setup();
    fail();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]).toEqual([expect.anything(), 't1', [{ type: 'text', text: 'continue', mentions: [] }], 'auto', undefined, { origin: 'system' }]);
  });

  it('reads a turn whose rows are filed under legacy names, by the payload type', async () => {
    const { emitLegacy } = setup();
    emitLegacy('turn.failed', { type: 'provider/error', message: 'Provider error', detail: 'Server is overloaded', willRetry: false, errorInfo: { category: 'overloaded' } });
    emitLegacy('turn.completed', { type: 'turn/completed', status: 'failed' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the feature is off or no rule matches', async () => {
    const off = setup({ enabled: false, rules: [RULE], maxPerWindow: 3, windowMinutes: 15 });
    off.fail();
    await vi.advanceTimersByTimeAsync(10_000);
    const noMatch = setup({ enabled: true, rules: [{ ...RULE, match: 'other' }], maxPerWindow: 3, windowMinutes: 15 });
    noMatch.fail();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('ignores a failed turn with no temporary provider error (auth, rate limit, none)', async () => {
    const { fail, emit } = setup();
    fail({ category: 'unauthorized' });
    fail({ category: 'rate-limit' });
    emit('turn/completed', { status: 'failed' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('ignores a turn that completed ok or a failed tool scope', async () => {
    const { emit } = setup();
    emit('provider/error', { message: 'Server is overloaded', errorInfo: { category: 'overloaded' } });
    emit('turn/completed', { status: 'completed' });
    emit('turn/completed', { status: 'failed', scope: { kind: 'tool' } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('stands down when the user sends a turn during the wait', async () => {
    const { fail, emit, log } = setup();
    fail();
    emit('client/turn/requested');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('user typed'));
  });

  it('stands down when a new turn starts, the thread is working, or Stop is pressed', async () => {
    const a = setup();
    a.fail();
    a.emit('turn/started');
    const b = setup();
    b.emit('provider/error', { message: 'Server is overloaded', errorInfo: { category: 'overloaded' } });
    b.emit('turn/completed', { status: 'failed' });
    h.row = { ...(h.row as object), status: 'active' };
    await vi.advanceTimersByTimeAsync(5000);
    h.row = { ...(h.row as object), status: 'error' };
    const c = setup();
    c.fail();
    c.emit('system/thread/interrupted');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('does not count its own send as the user typing, so the cap still applies', async () => {
    const { fail, emit } = setup({ enabled: true, rules: [RULE], maxPerWindow: 2, windowMinutes: 15 });
    for (let i = 0; i < 3; i++) {
      fail();
      await vi.advanceTimersByTimeAsync(5000);
      emit('turn/started'); // the resumed turn begins
    }
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('mutes its own send so the turn request it creates is not the user typing', async () => {
    let resolveSend: () => void = () => undefined;
    h.send.mockImplementationOnce(() => new Promise((r) => { resolveSend = () => r({}); }));
    const { fail, emit, service } = (() => { const s = setup(); return { ...s, service: s.resume.service }; })();
    fail();
    await vi.advanceTimersByTimeAsync(5000);
    emit('client/turn/requested'); // created by our own send while it is in flight
    resolveSend();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.restedOnApiError('t1')).toBe(true);
  });

  it('logs and survives a failed send', async () => {
    h.send.mockRejectedValueOnce(new Error('thread busy'));
    const { fail, log } = setup();
    fail();
    await vi.advanceTimersByTimeAsync(5000);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('send failed: thread busy'));
  });

  it('skips a gone or archived thread', async () => {
    const { fail } = setup();
    fail();
    h.row = null;
    await vi.advanceTimersByTimeAsync(5000);
    h.row = { id: 't1', projectId: 'p', title: null, status: 'error', archivedAt: 5 };
    fail();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('pushes an inbox note when the cap is reached', async () => {
    const { fail, ctx, emit } = setup({ enabled: true, rules: [RULE], maxPerWindow: 1, windowMinutes: 15 });
    fail();
    await vi.advanceTimersByTimeAsync(5000);
    emit('turn/started');
    fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.inbox.append).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', subject: 'Resume stopped — Thread'.replace('Thread', 'My thread') }));
  });

  it('ignores malformed hub events and stops listening once disposed', async () => {
    const { resume, emit, listeners, fail } = setup();
    listeners.forEach((l) => { l(null); l({}); l({ threadId: 1, type: 'x' }); l({ threadId: 't1', type: 'unrelated' }); });
    resume.dispose();
    expect(listeners.size).toBe(0);
    fail();
    emit('turn/started');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('caps the threads it tracks', () => {
    const { emit } = setup();
    for (let i = 0; i < 600; i++) emit('client/turn/requested', {}, `t${i}`);
    expect(() => emit('client/turn/requested', {}, 't-last')).not.toThrow();
  });
});

describe('startThreadApiErrorResume', () => {
  it('starts one watcher per context and disposes it', () => {
    const subscribe = vi.fn(() => vi.fn());
    const ctx = { db: {}, config: { getConfig: () => ({}) }, inbox: { append: vi.fn() }, hub: { subscribe } };
    startThreadApiErrorResume(ctx as never);
    startThreadApiErrorResume(ctx as never);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const unsubscribe = subscribe.mock.results[0].value as ReturnType<typeof vi.fn>;
    disposeThreadApiErrorResume(ctx as never);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    disposeThreadApiErrorResume(ctx as never); // second dispose is a no-op
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
