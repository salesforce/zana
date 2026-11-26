// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ apiJson: vi.fn(async () => ({ config: {} })) }));
vi.mock('./fetch-with-app-surface.js', async (orig) => ({ ...(await orig<object>()), apiJson: http.apiJson }));
vi.mock('./shared-product.js', async (orig) => ({ ...(await orig<object>()), sharedProductFamily: (_family: string, fallback: object = {}) => fallback }));
import { product } from './product-client';

afterEach(() => {
  http.apiJson.mockClear();
  delete (window as { cc?: unknown }).cc;
});

it('rejects removing a trusted folder without the desktop bridge instead of faking success', async () => {
  await expect(product.config.removeTrustedPreviewFolder('/a')).rejects.toThrow(/only be changed in the desktop app/);
  expect(http.apiJson).not.toHaveBeenCalled();
});

it('refuses adding a trusted folder without the desktop chooser', async () => {
  await expect(product.config.addTrustedPreviewFolder()).resolves.toEqual({
    config: null,
    error: 'Trusted preview folders can only be changed in the desktop app.'
  });
  expect(http.apiJson).not.toHaveBeenCalled();
});

it('dismissWorkerExit appends the id over HTTP and skips the write when already dismissed', async () => {
  http.apiJson.mockResolvedValueOnce({ config: { dismissedWorkerExits: ['a'] } }).mockResolvedValueOnce({ config: { dismissedWorkerExits: ['a', 'b'] } });
  await expect(product.config.dismissWorkerExit('b')).resolves.toEqual({ dismissedWorkerExits: ['a', 'b'] });
  expect(http.apiJson).toHaveBeenLastCalledWith('/config', { method: 'PATCH', body: JSON.stringify({ dismissedWorkerExits: ['a', 'b'] }) });
  http.apiJson.mockResolvedValueOnce({ config: {} }).mockResolvedValueOnce({ config: {} });
  await product.config.dismissWorkerExit('c');
  expect(http.apiJson).toHaveBeenLastCalledWith('/config', { method: 'PATCH', body: JSON.stringify({ dismissedWorkerExits: ['c'] }) });
  http.apiJson.mockResolvedValueOnce({ config: { dismissedWorkerExits: ['d'] } }).mockResolvedValueOnce({ config: {} });
  await product.config.dismissWorkerExit('d');
  expect(http.apiJson).toHaveBeenLastCalledWith('/config', { method: 'PATCH', body: JSON.stringify({ dismissedWorkerExits: ['d'] }) });
});

it('lists persona load warnings, tolerating a missing array, and refuses worker restart over HTTP', async () => {
  const warning = { file: 'a.md', source: 'user', reason: 'bad' };
  http.apiJson.mockResolvedValueOnce({ warnings: [warning] });
  await expect(product.personas.loadWarnings()).resolves.toEqual([warning]);
  expect(http.apiJson).toHaveBeenLastCalledWith('/personas');
  http.apiJson.mockResolvedValueOnce({});
  await expect(product.personas.loadWarnings()).resolves.toEqual([]);
  await expect(product.terminals.restartSquadWorker('w1')).rejects.toThrow(/requires the desktop app/);
});
