import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PTY_INTERACTION_MAX_SESSIONS, PtyInteractionStore } from './pty-interactions.js';

const ask = (store: PtyInteractionStore, over: Partial<Parameters<PtyInteractionStore['request']>[0]> = {}) =>
  store.request({ pluginId: 'p', sessionId: 's1', rendererId: 'form', title: 'Confirm', payload: { a: 1 }, timeoutMs: 60_000, ...over });

describe('PtyInteractionStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup() {
    const changes: Array<{ sessionId: string; projectId: string }> = [];
    const store = new PtyInteractionStore({ onChanged: (c) => changes.push(c) });
    store.noteSession({ sessionId: 's1', projectId: 'proj' });
    return { store, changes };
  }

  it('refuses to accept a response after the deadline even if the timer has not fired', async () => {
    const { store } = setup();
    const pending = ask(store);
    const id = store.list('s1')[0]!.id;
    const dueAt = store.list('s1')[0]!.expiresAt;
    vi.setSystemTime(dueAt + 1);
    expect(() => store.respond({ sessionId: 's1', interactionId: id, value: 1, actor: 'human' })).toThrow('expired');
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled', reason: 'timeout' });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('cancels immediately for an unusable timeout %s without registering an entry', async (timeoutMs) => {
    const { store } = setup();
    await expect(ask(store, { timeoutMs })).resolves.toMatchObject({ outcome: 'cancelled', reason: 'timeout' });
    expect(store.list('s1')).toEqual([]);
  });

  it('rejects a session main never reported', () => {
    const store = new PtyInteractionStore();
    expect(() => ask(store)).toThrow('PTY session is not live');
  });

  it('lists the open request under main-asserted identity and resolves it with the proven actor', async () => {
    const { store, changes } = setup();
    const pending = ask(store, { requireHuman: true });
    const [view] = store.list('s1');
    expect(view).toMatchObject({ sessionId: 's1', projectId: 'proj', origin: { pluginId: 'p', rendererId: 'form' }, payload: { title: 'Confirm', requireHuman: true } });
    expect(store.list('other')).toEqual([]);
    store.respond({ sessionId: 's1', interactionId: view!.id, value: { ok: true }, actor: 'human' });
    await expect(pending).resolves.toEqual({ outcome: 'submitted', value: { ok: true }, actor: 'human' });
    expect(store.list('s1')).toEqual([]);
    expect(changes.length).toBe(2);
  });

  it('refuses a human-required answer without human proof and keeps it open', async () => {
    const { store } = setup();
    const pending = ask(store, { requireHuman: true });
    const id = store.list('s1')[0]!.id;
    for (const actor of ['agent', 'unknown', 'cli', undefined] as const) {
      expect(() => store.respond({ sessionId: 's1', interactionId: id, value: 1, actor })).toThrow('Human proof required');
    }
    expect(store.list('s1')).toHaveLength(1);
    store.cancel({ sessionId: 's1', interactionId: id, reason: 'user' });
    await expect(pending).resolves.toEqual({ outcome: 'cancelled', reason: 'user' });
  });

  it('accepts an unproven answer when human is not required, recording the actor', async () => {
    const { store } = setup();
    const pending = ask(store);
    store.respond({ sessionId: 's1', interactionId: store.list('s1')[0]!.id, value: 'x', actor: 'agent' });
    await expect(pending).resolves.toMatchObject({ outcome: 'submitted', actor: 'agent' });
  });

  it('treats another session or an unknown id as not found, and an oversized answer as invalid', () => {
    const { store } = setup();
    store.noteSession({ sessionId: 's2', projectId: 'proj' });
    void ask(store);
    const id = store.list('s1')[0]!.id;
    expect(() => store.respond({ sessionId: 's2', interactionId: id, value: 1 })).toThrow('not found');
    expect(() => store.cancel({ sessionId: 's1', interactionId: 'nope', reason: 'user' })).toThrow('not found');
    expect(() => store.respond({ sessionId: 's1', interactionId: id, value: 'x'.repeat(70 * 1024) })).toThrow('64 KiB');
    expect(store.list('s1')).toHaveLength(1);
  });

  it('allows one open request per session and none after it settles twice', async () => {
    const { store } = setup();
    const first = ask(store);
    expect(() => ask(store)).toThrow('already awaiting');
    const id = store.list('s1')[0]!.id;
    store.cancel({ sessionId: 's1', interactionId: id, reason: 'user' });
    await first;
    expect(() => store.cancel({ sessionId: 's1', interactionId: id, reason: 'user' })).toThrow('not found');
    const second = ask(store);
    store.endSession('s1');
    await expect(second).resolves.toEqual({ outcome: 'cancelled', reason: 'thread-stopped' });
  });

  it('times out, honours abort, and cancels when the session ends or the plugin is disposed', async () => {
    const { store } = setup();
    const timed = ask(store, { timeoutMs: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(timed).resolves.toEqual({ outcome: 'cancelled', reason: 'timeout' });

    const controller = new AbortController();
    const aborted = ask(store, { signal: controller.signal });
    controller.abort();
    await expect(aborted).resolves.toEqual({ outcome: 'cancelled', reason: 'request-aborted' });
    await expect(ask(store, { signal: controller.signal })).resolves.toEqual({ outcome: 'cancelled', reason: 'request-aborted' });
    expect(store.list('s1')).toEqual([]);

    const disposedPlugin = ask(store, { pluginId: 'gone' });
    store.interruptForPlugin('keep');
    expect(store.list('s1')).toHaveLength(1);
    store.interruptForPlugin('gone');
    await expect(disposedPlugin).resolves.toEqual({ outcome: 'cancelled', reason: 'plugin-disposed' });

    const last = ask(store);
    store.dispose();
    await expect(last).resolves.toEqual({ outcome: 'cancelled', reason: 'server-restarted' });
    expect(store.hasSession('s1')).toBe(false);
  });

  it('keeps first-seen identity and survives a throwing change listener', async () => {
    const store = new PtyInteractionStore({ onChanged: () => { throw new Error('boom'); } });
    store.noteSession({ sessionId: 's1', projectId: 'first' });
    store.noteSession({ sessionId: 's1', projectId: 'second' });
    const pending = ask(store);
    expect(store.list('s1')[0]!.projectId).toBe('first');
    store.endSession('s1');
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' });
  });

  it('bounds remembered sessions, forgetting idle ones first and never one that is waiting', () => {
    const store = new PtyInteractionStore();
    store.noteSession({ sessionId: 'waiting', projectId: 'p' });
    void ask(store, { sessionId: 'waiting' });
    for (let i = 0; i < PTY_INTERACTION_MAX_SESSIONS + 5; i++) store.noteSession({ sessionId: `x${i}`, projectId: 'p' });
    expect(store.hasSession('waiting')).toBe(true);
    expect(store.hasSession(`x${PTY_INTERACTION_MAX_SESSIONS + 4}`)).toBe(true);
    expect(store.hasSession('x0')).toBe(false);
  });
});
