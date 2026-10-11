// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it('reads and sets a thread notification level over HTTP', async () => {
  const level = { level: 'inherit', effective: 'all', source: 'default' };
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(level))
    .mockResolvedValueOnce(Response.json({ ...level, level: 'muted', effective: 'muted', source: 'thread' }));
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.notificationLevel('thread/one')).resolves.toEqual(level);
  await expect(product.threads.setNotificationLevel('thread/one', 'muted')).resolves.toMatchObject({ level: 'muted' });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/threads/thread%2Fone/notification-level');
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/threads/thread%2Fone/notification-level');
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ level: 'muted' });
});

it('surfaces a refused notification level with its HTTP status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    Response.json({ error: 'invalid-notification-level', message: 'Unknown level' }, { status: 400 })
  ));
  await expect(product.threads.setNotificationLevel('thread', 'loud')).rejects.toMatchObject({ status: 400 });
});
