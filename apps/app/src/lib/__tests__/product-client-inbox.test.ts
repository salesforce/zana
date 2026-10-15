// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { cc?: unknown }).cc;
});

function stubSocket() {
  const socket = { addEventListener: vi.fn(), close: vi.fn(), readyState: 1, send: vi.fn() };
  vi.stubGlobal('WebSocket', Object.assign(function () { return socket; }, { OPEN: 1 }));
  return (type: string, payload: unknown) => {
    for (const [event, handler] of socket.addEventListener.mock.calls) {
      if (event === 'message') handler({ data: JSON.stringify({ type, payload }) });
    }
  };
}

function stubDesktopInbox() {
  const listeners: Record<string, Set<(value: unknown) => void>> = {};
  const on = (name: string) => vi.fn((cb: (value: unknown) => void) => {
    (listeners[name] ??= new Set()).add(cb);
    return () => listeners[name]!.delete(cb);
  });
  const inbox = {
    history: vi.fn(async () => ({ entries: [], hasMore: false })),
    onAppended: on('appended'),
    onRemoved: on('removed'),
    onUpdated: on('updated'),
    onPruned: on('pruned')
  };
  (window as { cc?: unknown }).cc = { inbox };
  const emit = (name: string, value: unknown) => { for (const cb of listeners[name] ?? []) cb(value); };
  return { inbox, emit, listeners };
}

it('delivers desktop inbox pushes from both Electron main and the product server', () => {
  const server = stubSocket();
  const { emit } = stubDesktopInbox();
  const appended = vi.fn(), removed = vi.fn(), updated = vi.fn(), pruned = vi.fn();
  const stops = [
    product.inbox.onAppended(appended),
    product.inbox.onRemoved(removed),
    product.inbox.onUpdated(updated),
    product.inbox.onPruned(pruned)
  ];

  emit('appended', { id: 'main-entry' });
  server('inbox:appended', { id: 'server-entry' });
  emit('removed', 'a'); server('inbox:removed', 'b');
  emit('updated', { id: 'c' }); server('inbox:updated', { id: 'd' });
  emit('pruned', ['e']); server('inbox:pruned', ['f']);

  expect(appended.mock.calls).toEqual([[{ id: 'main-entry' }], [{ id: 'server-entry' }]]);
  expect(removed.mock.calls).toEqual([['a'], ['b']]);
  expect(updated.mock.calls).toEqual([[{ id: 'c' }], [{ id: 'd' }]]);
  expect(pruned.mock.calls).toEqual([[['e']], [['f']]]);
  for (const stop of stops) stop();
});

it('keeps desktop inbox reads on IPC and releases both subscriptions', async () => {
  const server = stubSocket();
  const { inbox, emit, listeners } = stubDesktopInbox();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  await product.inbox.history({ limit: 100 });
  expect(inbox.history).toHaveBeenCalledWith({ limit: 100 });
  expect(fetch).not.toHaveBeenCalled();

  const appended = vi.fn();
  const stop = product.inbox.onAppended(appended);
  stop();
  expect(listeners.appended?.size).toBe(0);
  emit('appended', { id: 'late-main' });
  server('inbox:appended', { id: 'late-server' });
  expect(appended).not.toHaveBeenCalled();
});
