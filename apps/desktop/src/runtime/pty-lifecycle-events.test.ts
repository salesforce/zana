import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyLifecycleEventMainRequest } from '@zana-ai/zcc-contracts/runtime';
import { createNativeToolPolicyVerifier } from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import {
  createPtyLifecycleEmitter,
  productRoutePtyLifecycleSink,
  type PtyLifecycleEmitterDeps,
  type PtyLifecycleSession
} from './pty-lifecycle-events.js';

const session = (id = 's1', over: Partial<PtyLifecycleSession> = {}): PtyLifecycleSession =>
  ({ id, projectId: 'p1', profile: 'claude', status: 'running', ...over });

function harness(over: Partial<PtyLifecycleEmitterDeps> & { sink?: (r: PtyLifecycleEventMainRequest) => Promise<unknown> } = {}) {
  const sent: PtyLifecycleEventMainRequest[] = [];
  const log = vi.fn();
  const sink = over.sink ?? (async (request: PtyLifecycleEventMainRequest) => { sent.push(request); return { delivered: true }; });
  const emitter = createPtyLifecycleEmitter({
    supervised: () => sink, productRoute: () => null, log, ...over
  });
  const flush = () => vi.waitFor(() => expect(emitter.pending()).toBe(0));
  return { emitter, sent, log, flush };
}
const kinds = (sent: PtyLifecycleEventMainRequest[]) => sent.map((request) => request.kind);

describe('createPtyLifecycleEmitter', () => {
  it('reports creation once however often the session record changes', async () => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session());
    emitter.observe(session());
    emitter.observe(session('s1', { title: 'renamed' } as never));
    await flush();
    expect(sent).toEqual([{ kind: 'created', sessionId: 's1', projectId: 'p1', profile: 'claude' }]);
  });

  it('maps turn callbacks to active and idle, silent on repeats', async () => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session());
    emitter.turnStarted('s1', 'p1');
    emitter.turnStarted('s1', 'p1');
    emitter.turnFinished('s1', 'p1');
    emitter.turnFinished('s1', 'p1');
    emitter.turnStarted('s1', 'p1');
    await flush();
    expect(kinds(sent)).toEqual(['created', 'active', 'idle', 'active']);
  });

  it('delivers in order and carries a bound thread id', async () => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session('s2', { threadId: 't2' }));
    emitter.turnFinished('s2', 'p1');
    await flush();
    expect(sent.map((request) => [request.kind, request.threadId])).toEqual([['created', 't2'], ['idle', 't2']]);
  });

  it('ignores callbacks naming another project, an unknown session, or an exited one', async () => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session());
    emitter.turnStarted('s1', 'other-project');
    emitter.turnFinished('s1', 'other-project');
    emitter.turnStarted('unknown', 'p1');
    emitter.turnFinished('unknown', 'p1');
    emitter.exited('s1', 0);
    emitter.turnStarted('s1', 'p1');
    await flush();
    expect(kinds(sent)).toEqual(['created', 'deleted']);
  });

  it('never emits for an already exited session record, nor re-creates after exit', async () => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session('dead', { status: 'exited' }));
    emitter.observe(session());
    emitter.exited('s1', 0);
    emitter.observe(session());
    await flush();
    expect(kinds(sent)).toEqual(['created', 'deleted']);
    expect(emitter.trackedCount()).toBe(0);
  });

  it('reports a non-zero exit as failed then deleted, with the cause', async () => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session());
    emitter.exited('s1', 3, null);
    await flush();
    expect(sent.slice(1)).toEqual([
      { kind: 'failed', sessionId: 's1', projectId: 'p1', profile: 'claude', error: 'exited with code 3' },
      { kind: 'deleted', sessionId: 's1', projectId: 'p1', profile: 'claude' }
    ]);
  });

  it.each([[0, null], [137, 9], [undefined, null], [null, 15]])('reports only deleted for exit %s / signal %s', async (code, signal) => {
    const { emitter, sent, flush } = harness();
    emitter.observe(session());
    emitter.exited('s1', code as never, signal as never);
    await flush();
    expect(kinds(sent)).toEqual(['created', 'deleted']);
  });

  it('ignores the exit of a session it never saw', async () => {
    const { emitter, sent } = harness();
    emitter.exited('ghost', 1);
    expect(emitter.pending()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('bounds the tombstones of exited sessions', async () => {
    const { emitter, flush } = harness({ maxTracked: 5000 });
    for (let i = 0; i < 600; i += 1) { emitter.observe(session(`s${i}`)); emitter.exited(`s${i}`, 0); }
    await flush();
    // The oldest tombstone aged out, so a late record of it would count as new; the newest is still remembered.
    emitter.observe(session('s599'));
    expect(emitter.trackedCount()).toBe(0);
    emitter.observe(session('s0'));
    expect(emitter.trackedCount()).toBe(1);
  });

  it('returns before delivery: the caller never waits on the sink', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sink = vi.fn(async () => { await gate; });
    const { emitter, flush } = harness({ sink });
    emitter.observe(session());
    expect(sink).not.toHaveBeenCalled();
    release();
    await flush();
    expect(sink).toHaveBeenCalledOnce();
  });

  it('drops the oldest events past the queue bound and says so', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sent: string[] = [];
    const sink = async (request: PtyLifecycleEventMainRequest) => { await gate; sent.push(`${request.sessionId}:${request.kind}`); };
    const { emitter, log, flush } = harness({ sink, maxQueue: 3 });
    for (let i = 0; i < 6; i += 1) emitter.observe(session(`s${i}`));
    expect(emitter.pending()).toBeLessThanOrEqual(3);
    release();
    await flush();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.at(-1)).toBe('s5:created');
    expect(sent).not.toContain('s0:created');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dropped 1'));
  });

  it('refuses to track past the cap', async () => {
    const { emitter, sent, log, flush } = harness({ maxTracked: 1 });
    emitter.observe(session('a'));
    emitter.observe(session('b'));
    await flush();
    expect(sent.map((request) => request.sessionId)).toEqual(['a']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('tracking is full'));
  });

  it('logs and keeps delivering after a sink failure', async () => {
    const sink = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ delivered: true });
    const { emitter, log, flush } = harness({ sink });
    emitter.observe(session('a'));
    emitter.observe(session('b'));
    await flush();
    await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('failed: Error: boom'));
  });

  it('drops with a log when no channel exists', async () => {
    const { emitter, log, flush } = harness({ supervised: () => null, productRoute: () => null });
    emitter.observe(session());
    await flush();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('no plugin channel')));
  });

  it('falls back to the product route when no supervisor runs', async () => {
    const route = vi.fn(async () => ({ delivered: true }));
    const { emitter, flush } = harness({ supervised: () => null, productRoute: () => route });
    emitter.observe(session());
    await flush();
    await vi.waitFor(() => expect(route).toHaveBeenCalledOnce());
  });

  describe('timeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('gives up on a stuck delivery and moves on', async () => {
      const sink = vi.fn()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValue({ delivered: true });
      const { emitter, log } = harness({ sink, timeoutMs: 1000 });
      emitter.observe(session('a'));
      emitter.observe(session('b'));
      await vi.advanceTimersByTimeAsync(1001);
      await vi.advanceTimersByTimeAsync(0);
      expect(sink).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('timed out after 1000 ms'));
    });
  });

  it('dispose drops what is queued and stops further events', async () => {
    const { emitter, sent } = harness();
    emitter.observe(session());
    emitter.dispose();
    emitter.observe(session('s2'));
    emitter.exited('s1', 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(emitter.pending()).toBe(0);
    expect(emitter.trackedCount()).toBe(0);
  });
});

describe('productRoutePtyLifecycleSink', () => {
  const credential = 'c'.repeat(64);
  const request = { kind: 'idle', sessionId: 's1', projectId: 'p1', profile: 'claude' } as const;

  it('posts the request signed with the product credential', async () => {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ delivered: true }), { status: 200 }));
    const sink = productRoutePtyLifecycleSink({ serverUrl: () => 'http://127.0.0.1:1', credential: () => credential, fetch: fetch as never });
    await expect(sink(request)).resolves.toEqual({ delivered: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.pathname).toBe('/api/v1/pty-lifecycle-event');
    const body = String(init.body);
    expect(JSON.parse(body)).toEqual(request);
    expect(createNativeToolPolicyVerifier(credential)((init.headers as Record<string, string>)['x-zcc-native-tool-policy-proof']!, body)).toBe(true);
  });

  it('throws on a non-ok response', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 403 }));
    const sink = productRoutePtyLifecycleSink({ serverUrl: () => 'http://127.0.0.1:1', credential: () => credential, fetch: fetch as never });
    await expect(sink(request)).rejects.toThrow('HTTP 403');
  });
});
