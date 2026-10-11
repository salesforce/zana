import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { MobileDeviceStore } from './device-store.js';
import {
  PushTransitions,
  applyPushVerdict,
  deliverPush,
  createMobilePushRelay,
  fetchPushVerdict,
  type PushSignal
} from './push.js';
afterEach(() => {
  vi.unstubAllGlobals();
});
const event = (id: string, status: string, pending = false) => ({
  type: 'threads:updated',
  payload: { id, status, hasPendingInteraction: pending }
});
it('emits bounded transition alerts and never sends thread text', () => {
  const transitions = new PushTransitions();
  expect(transitions.observe(null)).toBeNull();
  expect(transitions.observe({ type: 'wrong' })).toBeNull();
  expect(transitions.observe(event('a', 'idle'))).toBeNull();
  expect(transitions.observe(event('a', 'running'))).toBeNull();
  expect(transitions.observe(event('a', 'idle'))).toMatchObject({ kind: 'turn-finished', title: 'Zana is ready' });
  expect(transitions.observe(event('a', 'idle'))).toBeNull();
  expect(transitions.observe(event('a', 'idle', true))).toMatchObject({ kind: 'pending-interaction', title: 'Zana needs you' });
  expect(transitions.observe(event('a', 'idle', true))).toBeNull();
  transitions.observe(event('a', 'working'));
  expect(transitions.observe(event('a', 'error'))).toMatchObject({ kind: 'thread-error', title: 'Zana needs attention' });
  for (let i = 0; i < 501; i++) transitions.observe(event(`t${i}`, 'running'));
  expect(transitions.observe(event('a', 'idle'))).toBeNull();
});
it('sends only to opted-in devices and removes invalid tokens from Expo tickets', async () => {
  const store = new MobileDeviceStore();
  const device = store.add('Phone');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] })
      )
    );
  const notice = { threadId: 'thread-1', title: 'Ready', body: 'A thread is ready.' };
  await deliverPush(notice, store, 'https://mac.example', fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(() => store.setPushToken(device.deviceId, 'bad')).toThrow();
  store.setPushToken(device.deviceId, 'ExpoPushToken[test-token]');
  expect(JSON.stringify(store.list())).not.toContain('test-token');
  await deliverPush(notice, store, 'https://mac.example', fetcher);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://exp.host/--/api/v2/push/send');
  expect(init?.redirect).toBe('error');
  expect(JSON.parse(String(init?.body))[0].data).toEqual({
    serverUrl: 'https://mac.example',
    path: '/threads/thread-1'
  });
  expect(store.pushTargets()).toEqual([]);
});
it('bounds the Expo response and contains transient delivery failures', async () => {
  const store = new MobileDeviceStore();
  const device = store.add('Phone');
  store.setPushToken(device.deviceId, 'ExpoPushToken[token]');
  const notice = { threadId: '1', title: 'Ready', body: 'Ready' };
  for (const response of [
    new Response('', { status: 500 }),
    new Response('x'.repeat(40_000)),
    new Response('not-json'),
    new Response('{}'),
    new Response(null)
  ])
    await expect(
      deliverPush(notice, store, 'https://mac.example', vi.fn().mockResolvedValue(response))
    ).resolves.toBeUndefined();
  await expect(
    deliverPush(
      notice,
      store,
      'https://mac.example',
      vi.fn().mockRejectedValue(new Error('offline'))
    )
  ).resolves.toBeUndefined();
});
it('cancels delivery during shutdown and does not start work after shutdown', async () => {
  const store = new MobileDeviceStore();
  const device = store.add('Phone');
  store.setPushToken(device.deviceId, 'ExpoPushToken[token]');
  const shutdown = new AbortController();
  const fetcher = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
  );
  const notice = { threadId: '1', title: 'Ready', body: 'Ready' };
  const delivery = deliverPush(notice, store, 'https://mac.example', fetcher, shutdown.signal);
  shutdown.abort();
  await delivery;
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  await deliverPush(notice, store, 'https://mac.example', fetcher, shutdown.signal);
  expect(fetcher).toHaveBeenCalledOnce();
});
const VERDICT_PATH = /^\/api\/v1\/threads\/([^/]+)\/notification-verdict$/;
type Verdicts = (threadId: string, kind: string) => Response | Promise<Response>;

/** A fake fetch that answers the loopback verdict lookup and records Expo sends. */
function pushFetch(verdicts: Verdicts) {
  const verdictCalls: Array<{ threadId: string; kind: string; init?: RequestInit }> = [];
  const expoBodies: Array<Array<{ title: string; body: string; data: { path: string } }>> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.host === 'exp.host') {
      expoBodies.push(JSON.parse(String(init?.body)));
      return new Response('{"data":[]}');
    }
    const match = VERDICT_PATH.exec(url.pathname);
    if (!match) throw new Error(`unexpected request ${url.href}`);
    const call = { threadId: decodeURIComponent(match[1]!), kind: url.searchParams.get('kind') ?? '', init };
    verdictCalls.push(call);
    return verdicts(call.threadId, call.kind);
  });
  return { fetcher, verdictCalls, expoBodies };
}
const verdictJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function withRelay(
  verdicts: Verdicts,
  run: (ctx: {
    send(...events: unknown[]): void;
    verdictCalls: ReturnType<typeof pushFetch>['verdictCalls'];
    expoBodies: ReturnType<typeof pushFetch>['expoBodies'];
    store: MobileDeviceStore;
    device: { deviceId: string };
    wss: WebSocketServer;
    relay: ReturnType<typeof createMobilePushRelay>;
  }) => Promise<void>
) {
  const store = new MobileDeviceStore();
  const device = store.add('Phone');
  store.setPushToken(device.deviceId, 'ExpoPushToken[token]');
  const upstream = createServer();
  const wss = new WebSocketServer({ server: upstream });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as { port: number }).port;
  const { fetcher, verdictCalls, expoBodies } = pushFetch(verdicts);
  vi.stubGlobal('fetch', fetcher);
  const relay = createMobilePushRelay(new URL(`http://127.0.0.1:${port}`), 'https://mac.example', store);
  try {
    const connection = once(wss, 'connection');
    relay.refresh();
    const [socket] = await connection;
    await run({
      send: (...events) => events.forEach((e) => socket.send(JSON.stringify(e))),
      verdictCalls,
      expoBodies,
      store,
      device,
      wss,
      relay
    });
  } finally {
    relay.close();
    relay.refresh();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
}

it('subscribes once, relays background thread transitions and releases its socket', async () => {
  const store = new MobileDeviceStore();
  const device = store.add('Phone');
  const upstream = createServer();
  const wss = new WebSocketServer({ server: upstream });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as { port: number }).port;
  const { fetcher, expoBodies, verdictCalls } = pushFetch(() =>
    verdictJson({ send: true, level: 'all', source: 'global', title: 'Fix flaky test', body: 'All tests pass now.' })
  );
  vi.stubGlobal('fetch', fetcher);
  const relay = createMobilePushRelay(
    new URL(`http://127.0.0.1:${port}`),
    'https://mac.example',
    store
  );
  try {
    relay.refresh();
    expect(wss.clients.size).toBe(0);
    store.setPushToken(device.deviceId, 'ExpoPushToken[token]');
    const connection = once(wss, 'connection');
    relay.refresh();
    relay.refresh();
    const [socket] = await connection;
    socket.send('malformed');
    socket.send(JSON.stringify(event('t', 'running')));
    socket.send(JSON.stringify(event('t', 'idle')));
    await vi.waitFor(() => expect(expoBodies).toHaveLength(1));
    // The loopback gate is asked once, for the right thread and kind, with redirects refused.
    expect(verdictCalls).toHaveLength(1);
    expect(verdictCalls[0]).toMatchObject({ threadId: 't', kind: 'turn-finished' });
    expect(verdictCalls[0]!.init?.redirect).toBe('error');
    expect(expoBodies[0]![0]).toMatchObject({
      title: 'Fix flaky test',
      body: 'All tests pass now.',
      data: { path: '/threads/t' }
    });
    expect(wss.clients.size).toBe(1);
    const closed = once(socket, 'close');
    store.setPushToken(device.deviceId, null);
    relay.refresh();
    await closed;
    expect(wss.clients.size).toBe(0);
  } finally {
    relay.close();
    relay.refresh();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});

it('stays silent for muted, input-only and vanished threads and delivers the rest in order', async () => {
  const verdicts: Verdicts = (threadId, kind) => {
    if (threadId === 'muted') return verdictJson({ send: false, level: 'muted', source: 'self', reason: 'level' });
    if (threadId === 'archived') return verdictJson({ send: false, level: 'all', source: 'global', reason: 'archived' });
    if (threadId === 'gone') return verdictJson({ error: 'unknown-thread' }, 404);
    if (threadId === 'quiet' && kind === 'turn-finished')
      return verdictJson({ send: false, level: 'input-only', source: 'self', reason: 'level' });
    return verdictJson({ send: true, level: 'all', source: 'global', title: `Thread ${threadId}`, body: kind });
  };
  await withRelay(verdicts, async ({ send, expoBodies, verdictCalls }) => {
    send(
      event('muted', 'running'), event('muted', 'idle'),
      event('archived', 'running'), event('archived', 'idle'),
      event('gone', 'running'), event('gone', 'idle'),
      event('quiet', 'running'), event('quiet', 'idle'),
      event('loud', 'running'), event('loud', 'idle')
    );
    await vi.waitFor(() => expect(expoBodies).toHaveLength(1));
    expect(verdictCalls.map((c) => c.threadId)).toEqual(['muted', 'archived', 'gone', 'quiet', 'loud']);
    expect(expoBodies[0]![0]).toMatchObject({ title: 'Thread loud', body: 'turn-finished', data: { path: '/threads/loud' } });
  });
});

it('keeps needing-input pushes flowing for an input-only thread', async () => {
  const verdicts: Verdicts = (_threadId, kind) =>
    kind === 'turn-finished'
      ? verdictJson({ send: false, level: 'input-only', source: 'self', reason: 'level' })
      : verdictJson({ send: true, level: 'input-only', source: 'self', title: 'Release prep', body: 'Ship it?' });
  await withRelay(verdicts, async ({ send, expoBodies, verdictCalls }) => {
    send(event('t', 'running'), event('t', 'idle'), event('t', 'idle', true));
    await vi.waitFor(() => expect(expoBodies).toHaveLength(1));
    expect(verdictCalls.map((c) => c.kind)).toEqual(['turn-finished', 'pending-interaction']);
    expect(expoBodies[0]![0]).toMatchObject({ title: 'Release prep', body: 'Ship it?' });
  });
});

it('falls back to the generic text when the lookup fails, and drops finished-turn pushes', async () => {
  await withRelay(
    () => new Response('boom', { status: 500 }),
    async ({ send, expoBodies, verdictCalls }) => {
      send(
        event('a', 'running'), event('a', 'idle'),
        event('b', 'running'), event('b', 'error'),
        event('c', 'idle', true)
      );
      await vi.waitFor(() => expect(expoBodies).toHaveLength(2));
      expect(verdictCalls.map((c) => c.kind)).toEqual(['turn-finished', 'thread-error', 'pending-interaction']);
      expect(expoBodies.map((batch) => batch[0])).toMatchObject([
        { title: 'Zana needs attention', body: 'Open the thread to see what happened.' },
        { title: 'Zana needs you', body: 'A thread is waiting for your input.' }
      ]);
    }
  );
});

it('uses the generic text when previews are off', async () => {
  await withRelay(
    () => verdictJson({ send: true, level: 'all', source: 'global' }),
    async ({ send, expoBodies }) => {
      send(event('a', 'running'), event('a', 'idle'));
      await vi.waitFor(() => expect(expoBodies).toHaveLength(1));
      expect(expoBodies[0]![0]).toMatchObject({ title: 'Zana is ready', body: 'A thread has finished its turn.' });
    }
  );
});

const signal = (kind: PushSignal['kind']): PushSignal => ({
  threadId: 't 1',
  kind,
  title: 'Generic title',
  body: 'Generic body'
});

describe('fetchPushVerdict', () => {
  const upstream = new URL('http://127.0.0.1:8780');

  it('asks the product server over loopback for the encoded thread and kind', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(verdictJson({ send: true, title: 'T', body: 'B' }));
    await expect(fetchPushVerdict(upstream, signal('thread-error'), fetcher)).resolves.toEqual({
      action: 'send',
      title: 'T',
      body: 'B'
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:8780/api/v1/threads/t%201/notification-verdict?kind=thread-error');
    expect(init?.redirect).toBe('error');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('maps gate answers to skip, send and unavailable', async () => {
    const answer = (response: Response | Error) => {
      const fetcher = vi.fn<typeof fetch>();
      if (response instanceof Error) fetcher.mockRejectedValue(response);
      else fetcher.mockResolvedValue(response);
      return fetchPushVerdict(upstream, signal('turn-finished'), fetcher);
    };
    await expect(answer(verdictJson({ send: false }))).resolves.toEqual({ action: 'skip' });
    await expect(answer(verdictJson({ error: 'unknown-thread' }, 404))).resolves.toEqual({ action: 'skip' });
    await expect(answer(verdictJson({ send: true }))).resolves.toEqual({ action: 'send' });
    await expect(answer(verdictJson({}, 200))).resolves.toEqual({ action: 'unavailable' });
    await expect(answer(verdictJson({ send: 'yes' }))).resolves.toEqual({ action: 'unavailable' });
    await expect(answer(new Response('not json'))).resolves.toEqual({ action: 'unavailable' });
    await expect(answer(new Response('', { status: 503 }))).resolves.toEqual({ action: 'unavailable' });
    await expect(answer(new Response(null))).resolves.toEqual({ action: 'unavailable' });
    await expect(answer(new Error('refused'))).resolves.toEqual({ action: 'unavailable' });
  });

  it('bounds the response and ignores text that is not a non-empty string', async () => {
    const oversized = new Response(JSON.stringify({ send: true, title: 'x'.repeat(40_000) }));
    await expect(fetchPushVerdict(upstream, signal('turn-finished'), vi.fn<typeof fetch>().mockResolvedValue(oversized))).resolves.toEqual({
      action: 'unavailable'
    });
    const odd = verdictJson({ send: true, title: 7, body: '   ' });
    await expect(fetchPushVerdict(upstream, signal('turn-finished'), vi.fn<typeof fetch>().mockResolvedValue(odd))).resolves.toEqual({
      action: 'send'
    });
    const long = verdictJson({ send: true, title: 't'.repeat(500), body: 'b'.repeat(900) });
    const result = await fetchPushVerdict(upstream, signal('turn-finished'), vi.fn<typeof fetch>().mockResolvedValue(long));
    expect(result).toMatchObject({ action: 'send' });
    if (result.action === 'send') {
      expect(result.title!.length).toBeLessThanOrEqual(200);
      expect(result.body!.length).toBeLessThanOrEqual(400);
    }
  });

  it('is cancelled by shutdown and times out a stalled lookup', async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })
    );
    const shutdown = new AbortController();
    const pending = fetchPushVerdict(upstream, signal('turn-finished'), hang, shutdown.signal);
    shutdown.abort();
    await expect(pending).resolves.toEqual({ action: 'unavailable' });
    expect(hang.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    // Already shut down: no request at all.
    hang.mockClear();
    await expect(fetchPushVerdict(upstream, signal('turn-finished'), hang, shutdown.signal)).resolves.toEqual({
      action: 'unavailable'
    });
    expect(hang).not.toHaveBeenCalled();
  });

  it('times out a lookup that never answers', async () => {
    vi.useFakeTimers();
    try {
      const hang = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          })
      );
      const pending = fetchPushVerdict(upstream, signal('turn-finished'), hang);
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(pending).resolves.toEqual({ action: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('applyPushVerdict', () => {
  it('turns a verdict into the push to deliver, or nothing', () => {
    expect(applyPushVerdict(signal('turn-finished'), { action: 'skip' })).toBeNull();
    expect(applyPushVerdict(signal('turn-finished'), { action: 'send', title: 'T', body: 'B' })).toEqual({
      threadId: 't 1',
      title: 'T',
      body: 'B'
    });
    // Previews off: the generic text still goes out.
    expect(applyPushVerdict(signal('turn-finished'), { action: 'send' })).toEqual({
      threadId: 't 1',
      title: 'Generic title',
      body: 'Generic body'
    });
    expect(applyPushVerdict(signal('turn-finished'), { action: 'send', title: 'Only title' })).toEqual({
      threadId: 't 1',
      title: 'Generic title',
      body: 'Generic body'
    });
  });

  it('fails closed for finished turns and open for things that need the user', () => {
    expect(applyPushVerdict(signal('turn-finished'), { action: 'unavailable' })).toBeNull();
    for (const kind of ['pending-interaction', 'thread-error'] as const)
      expect(applyPushVerdict(signal(kind), { action: 'unavailable' })).toEqual({
        threadId: 't 1',
        title: 'Generic title',
        body: 'Generic body'
      });
  });
});
