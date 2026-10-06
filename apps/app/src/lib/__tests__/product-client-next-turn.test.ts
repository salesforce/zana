// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it('refuses browser Send now without making an HTTP request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('window', {});
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.sendNextTurn('thread', 'item')).rejects.toThrow('Send now requires the desktop app');
  expect(fetch).not.toHaveBeenCalled();
});

it('forwards Send now through the desktop bridge and returns its result', async () => {
  const result = { ok: true };
  const sendNextTurn = vi.fn().mockResolvedValue(result);
  const fetch = vi.fn();
  vi.stubGlobal('window', { cc: { threads: { sendNextTurn } } });
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.sendNextTurn('thread/one', 'item two')).resolves.toBe(result);
  expect(sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread/one', 'item two');
  expect(fetch).not.toHaveBeenCalled();
});
