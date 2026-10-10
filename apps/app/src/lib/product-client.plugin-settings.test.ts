// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ apiJson: vi.fn(async () => ({ descriptors: {}, values: {} })) }));
vi.mock('./fetch-with-app-surface.js', async (orig) => ({ ...(await orig<object>()), apiJson: http.apiJson }));
import { product } from './product-client';

beforeEach(() => { http.apiJson.mockClear(); });

it('asks the settings route to omit secrets only when requested', async () => {
  await product.pluginApps.getSettings('p/1', { omitSecrets: true });
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/p%2F1/settings?secrets=omit');
  await product.pluginApps.getSettings('p/1', { omitSecrets: false });
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/p%2F1/settings');
  await product.pluginApps.getSettings('p/1');
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-apps/p%2F1/settings');
});

it('stops a thread\'s background tasks, targeting item ids only when given', async () => {
  await product.threads.stopBackground('t/1', ['a', 'b']);
  expect(http.apiJson).toHaveBeenLastCalledWith('/threads/t%2F1/background/stop', { method: 'POST', body: '{"itemIds":["a","b"]}' });
  await product.threads.stopBackground('t/1');
  expect(http.apiJson).toHaveBeenLastCalledWith('/threads/t%2F1/background/stop', { method: 'POST', body: '{}' });
});
