import { expect, it, vi } from 'vitest';
import type { ModuleHost } from './host.js';
import { runPrAction } from './prAction.js';

it.each([new Error('Offline'), 'Unavailable'])('reports rejected actions without changing the cache (%s)', async (error) => {
  const host = { call: vi.fn().mockRejectedValue(error), cache: { set: vi.fn() }, toast: vi.fn() };
  await runPrAction(host as unknown as ModuleHost, 'setPrFavorite', { url: 'https://github.com/a/b/pull/1', favorite: true });
  expect(host.toast).toHaveBeenCalledWith(expect.stringContaining(String(error instanceof Error ? error.message : error)), 'error');
  expect(host.cache.set).not.toHaveBeenCalled();
});

it('reports server-declared errors', async () => {
  const host = { call: vi.fn().mockResolvedValue({ ok: false, error: 'PR no longer tracked' }), toast: vi.fn() };
  await runPrAction(host as unknown as ModuleHost, 'markPrAsSeen', {});
  expect(host.toast).toHaveBeenCalledWith("Couldn't update PR — PR no longer tracked", 'error');
});
