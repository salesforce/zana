import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { MobileDeviceStore } from './device-store.js';
import { PushTransitions, deliverPush, createMobilePushRelay } from './push.js';
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
  expect(transitions.observe(event('a', 'idle'))?.title).toBe('Zana is ready');
  expect(transitions.observe(event('a', 'idle'))).toBeNull();
  expect(transitions.observe(event('a', 'idle', true))?.title).toBe('Zana needs you');
  expect(transitions.observe(event('a', 'idle', true))).toBeNull();
  transitions.observe(event('a', 'working'));
  expect(transitions.observe(event('a', 'error'))?.title).toBe('Zana needs attention');
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
it('subscribes once, relays background thread transitions and releases its socket', async () => {
  const store = new MobileDeviceStore();
  const device = store.add('Phone');
  const upstream = createServer();
  const wss = new WebSocketServer({ server: upstream });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as { port: number }).port;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[]}'));
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
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
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
