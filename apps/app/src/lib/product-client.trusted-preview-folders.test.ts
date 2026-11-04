// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ apiJson: vi.fn(async () => ({ config: {} })) }));
vi.mock('./fetch-with-app-surface.js', async (orig) => ({ ...(await orig<object>()), apiJson: http.apiJson }));
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
