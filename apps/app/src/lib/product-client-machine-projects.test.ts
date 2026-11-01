// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn() }));
vi.mock('./fetch-with-app-surface.js', async original => ({ ...await original<object>(), apiJson: h.api, fetchWithAppSurface: h.fetch }));
import { product } from './product-client.js';
afterEach(() => { vi.resetAllMocks(); delete (window as any).cc; });
it('uses the server default clone destination without a desktop bridge or selected machine', async () => {
  delete (window as any).cc;
  h.api.mockResolvedValueOnce({ path: '/server/checkouts' });
  expect(await product.projects.cloneRoot()).toBe('/server/checkouts');
  expect(h.api).toHaveBeenCalledWith('/projects/clone-root');
});

it('uses HTTP and forwards the selected machine for clones and destination previews', async () => {
  const localRoot = vi.fn().mockResolvedValue('/local'), localAdd = vi.fn();
  (window as any).cc = { projects: { cloneRoot: localRoot, add: localAdd } };
  h.api.mockResolvedValueOnce({ path: '/remote/checkouts' });
  expect(await product.projects.cloneRoot('remote')).toBe('/remote/checkouts');
  expect(h.api).toHaveBeenCalledWith('/projects/clone-root?hostId=remote');
  expect(localRoot).not.toHaveBeenCalled();
  expect(await product.projects.cloneRoot()).toBe('/local');
  h.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, project: { id: 'p', hostId: 'remote' } }) });
  expect(await product.projects.clone({ url: 'owner/repo', hostId: 'remote' })).toEqual({ ok: true, project: { id: 'p', hostId: 'remote' } });
  expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ url: 'owner/repo', hostId: 'remote' });
  h.api.mockResolvedValueOnce({ project: { id: 'canonical' } });
  expect(await product.projects.add('/remote/alias', { hostId: 'remote' })).toEqual({ ok: true, value: { id: 'canonical' } });
  expect(localAdd).not.toHaveBeenCalled();
});
it('retains clone failures and handles unavailable destination previews', async () => {
  h.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'clone_target_exists', message: 'Folder exists', path: '/remote/repo' }) });
  expect(await product.projects.clone({ url: 'owner/repo', hostId: 'remote' })).toEqual({ ok: false, code: 'DEST_EXISTS', message: 'Folder exists', path: '/remote/repo' });
  h.api.mockRejectedValueOnce(new Error('offline'));
  expect(await product.projects.cloneRoot('remote')).toBe('');
});
