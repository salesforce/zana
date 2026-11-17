import { expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
vi.mock('@/lib/product-client', () => ({ product: {} }));
import { createInstalledPluginStore } from './installed-plugin-store';

function source<T>(rows: T[] = []) {
  let changed: (rows: T[]) => void = () => {};
  const off = vi.fn();
  return { list: vi.fn(async () => rows), onChanged: vi.fn((listener: typeof changed) => { changed = listener; return off; }), emit: (next: T[]) => changed(next), off };
}
const app = (over: Partial<PluginAppEntry> = {}) => ({ id: 'sample', enabled: true, hasSettings: true, ...over } as PluginAppEntry);
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it('shares metadata requests, preserves discovery through reload, and removes disabled/uninstalled rows', async () => {
  const extensions = source(); const plugins = source([app()]);
  const store = createInstalledPluginStore(extensions, plugins);
  const first = store.subscribe(vi.fn()); const second = store.subscribe(vi.fn());
  await flush();
  expect(plugins.list).toHaveBeenCalledTimes(1); expect(store.getSnapshot().loading).toBe(false);
  plugins.emit([app({ hasSettings: undefined, status: 'degraded' })]);
  expect(store.getSnapshot().plugins[0].hasSettings).toBe(true);
  plugins.emit([app({ hasSettings: false })]); expect(store.getSnapshot().plugins[0].hasSettings).toBe(false);
  plugins.emit([app({ hasSettings: undefined, enabled: false })]); expect(store.getSnapshot().plugins[0].hasSettings).toBeUndefined();
  plugins.emit([]); expect(store.getSnapshot().plugins).toEqual([]);
  first(); expect(plugins.off).not.toHaveBeenCalled(); second();
  expect(plugins.off).toHaveBeenCalledOnce(); expect(extensions.off).toHaveBeenCalledOnce();
});

it('ignores stale list responses after an event or disposal and supports retry after failure', async () => {
  const extensions = source(); const plugins = source<PluginAppEntry>();
  let resolve!: (rows: PluginAppEntry[]) => void;
  plugins.list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const store = createInstalledPluginStore(extensions, plugins); const off = store.subscribe(vi.fn());
  plugins.emit([app({ name: 'New' })]); resolve([app({ name: 'Old' })]); await flush();
  expect(store.getSnapshot().plugins[0].name).toBe('New');
  plugins.list.mockRejectedValueOnce(new Error('Offline')); store.retry(); await flush();
  expect(store.getSnapshot().error).toContain('Could not load');
  plugins.list.mockResolvedValueOnce([app()]); store.retry(); await flush();
  expect(store.getSnapshot().error).toBe('');
  extensions.emit([]); off(); plugins.emit([app({ name: 'Stale' })]);
  expect(store.getSnapshot().plugins[0].name).not.toBe('Stale');
  store.retry(); expect(plugins.list).toHaveBeenCalledTimes(3);
});

it('drops pending results from an earlier subscription', async () => {
  const extensions = source(); const plugins = source<PluginAppEntry>();
  let resolve!: (rows: PluginAppEntry[]) => void;
  plugins.list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const store = createInstalledPluginStore(extensions, plugins); const off = store.subscribe(vi.fn()); off();
  resolve([app()]); await flush(); expect(store.getSnapshot().plugins).toEqual([]);
});
