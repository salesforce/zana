// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ apiJson: vi.fn(async () => ({ descriptors: {}, values: {} })) }));
vi.mock('./fetch-with-app-surface.js', async (orig) => ({ ...(await orig<object>()), apiJson: http.apiJson }));
import { pluginRecovery, product } from './product-client';

beforeEach(() => { http.apiJson.mockClear(); });

it('uses core recovery routes even when the desktop plugin bridge is broken', async () => {
  window.cc = { pluginApps: { reload: () => { throw new Error('broken'); } } } as never;
  await pluginRecovery.status();
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/recovery');
  await pluginRecovery.start();
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/hard-reload', { method: 'POST', body: '{}' });
  delete (window as { cc?: unknown }).cc;
});

it('asks the settings route to omit secrets only when requested', async () => {
  await product.pluginApps.getSettings('p/1', { omitSecrets: true });
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/p%2F1/settings?secrets=omit');
  await product.pluginApps.getSettings('p/1', { omitSecrets: false });
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/p%2F1/settings');
  await product.pluginApps.getSettings('p/1');
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/p%2F1/settings');
});

it('applies every plugin update through the product route and preserves its result', async () => {
  const result = { ok: true, value: { updated: ['plugin-1'], failed: [] } };
  http.apiJson.mockResolvedValueOnce(result as never);
  await expect(product.pluginApps.applyAllUpdates()).resolves.toEqual(result);
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/update-all', { method: 'POST', body: '{}' });
});

it.each([new Error('server unavailable'), 'network unavailable'])('reports bulk update transport failures: %s', async error => {
  http.apiJson.mockRejectedValueOnce(error);
  await expect(product.pluginApps.applyAllUpdates()).resolves.toEqual({ ok: false, code: 'WRITE_FAILED', message: error instanceof Error ? error.message : error });
});

it('stops a thread\'s background tasks, targeting item ids only when given', async () => {
  await product.threads.stopBackground('t/1', ['a', 'b']);
  expect(http.apiJson).toHaveBeenLastCalledWith('/threads/t%2F1/background/stop', { method: 'POST', body: '{"itemIds":["a","b"]}' });
  await product.threads.stopBackground('t/1');
  expect(http.apiJson).toHaveBeenLastCalledWith('/threads/t%2F1/background/stop', { method: 'POST', body: '{}' });
});

it('sends a find-in-thread query to the conversation outline only when given', async () => {
  await product.threads.conversationOutline('t/1');
  expect(http.apiJson).toHaveBeenLastCalledWith('/threads/t%2F1/conversation-outline');
  await product.threads.conversationOutline('t/1', 'a&b c');
  expect(http.apiJson).toHaveBeenLastCalledWith('/threads/t%2F1/conversation-outline?q=a%26b%20c');
});

it('explains that native folder recovery requires the desktop app', async () => {
  await expect(product.pluginApps.repair('example', 'locate')).resolves.toMatchObject({ ok: false, code: 'DESKTOP_REQUIRED' });
  expect(http.apiJson).not.toHaveBeenCalled();
});
