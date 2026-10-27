import { beforeEach, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ apiJson: vi.fn(async () => []) }));
vi.mock('./fetch-with-app-surface.js', async orig => ({ ...(await orig<object>()), apiJson: http.apiJson }));
vi.mock('./app-surface.js', () => ({ hasDesktopBridge: () => false }));
import { product } from './product-client.js';
beforeEach(() => http.apiJson.mockClear());
it('uses product HTTP for all pack actions without renderer-supplied install sources', async () => {
  const identity = { marketplaceSource: 'path:/catalog', packId: 'starter' };
  await product.pluginPacks.list(); expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-packs');
  await product.pluginPacks.listInstalled(); expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-packs/installed');
  await product.pluginPacks.plan(identity);
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-packs/plan', { method: 'POST', body: JSON.stringify(identity) });
  const request = { identity, planId: 'review', pluginIds: ['notes'] };
  await product.pluginPacks.install(request);
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-packs/install', { method: 'POST', body: JSON.stringify(request) });
  await product.pluginPacks.forget(identity);
  expect(http.apiJson).toHaveBeenLastCalledWith('/plugin-packs/forget', { method: 'POST', body: JSON.stringify(identity) });
});
