import { useSyncExternalStore } from 'react';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { product } from '@/lib/product-client';

interface Source<T> {
  list(): Promise<T[]>;
  onChanged(listener: (rows: T[]) => void): () => void;
}

/** Shared metadata only. Settings values belong to the selected page. */
export function createInstalledPluginStore(extensions: Source<ExtensionEntry>, plugins: Source<PluginAppEntry>) {
  let state = { entries: [] as ExtensionEntry[], plugins: [] as PluginAppEntry[], loading: true, error: '' };
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const start = () => {
    let active = true;
    let extVersion = 0;
    let appVersion = 0;
    const setPlugins = (next: PluginAppEntry[]) => {
      const previous = new Map(state.plugins.map(row => [row.id, row]));
      publish({ plugins: next.map(row => row.enabled && row.hasSettings === undefined && previous.get(row.id)?.hasSettings
        ? { ...row, hasSettings: true } : row) });
    };
    const offExt = extensions.onChanged(rows => { extVersion++; if (active) publish({ entries: rows }); });
    const offApps = plugins.onChanged(rows => { appVersion++; if (active) setPlugins(rows); });
    publish({ loading: true, error: '' });
    void Promise.allSettled([
      extensions.list().then(rows => { if (active && extVersion === 0) publish({ entries: rows }); }),
      plugins.list().then(rows => { if (active && appVersion === 0) setPlugins(rows); })
    ]).then(results => {
      if (!active) return;
      publish({ loading: false, error: results.some(result => result.status === 'rejected') ? 'Could not load installed plugins.' : '' });
    });
    return () => { active = false; offExt(); offApps(); };
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) stop = start();
      return () => { listeners.delete(listener); if (listeners.size === 0) { stop?.(); stop = undefined; } };
    },
    retry() { stop?.(); stop = listeners.size ? start() : undefined; }
  };
}

const installedPlugins = createInstalledPluginStore(product.extensions, product.pluginApps);
export function useInstalledPlugins() {
  return useSyncExternalStore(installedPlugins.subscribe, installedPlugins.getSnapshot, installedPlugins.getSnapshot);
}
export const retryInstalledPlugins = installedPlugins.retry;
