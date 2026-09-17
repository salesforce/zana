import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { packRpcArgs } from '../../lib/rpc.js';
import type { PluginPanelCache, PluginPanelHost, ProjectInfo } from './host.js';

const cacheStore = new Map<string, unknown>();
let badgeRefresh: (() => void) | undefined;
export const PROJECT_REFRESH_MS = 5_000;

export function setBadgeRefresh(fn: (() => void) | undefined): void {
  badgeRefresh = fn;
}

export function sharedPanelCache(): PluginPanelCache {
  return {
    get: <T>(key: string) => cacheStore.get(key) as T | undefined,
    set: (key, value) => {
      cacheStore.set(key, value);
    },
    delete: (key) => {
      cacheStore.delete(key);
    },
    refreshBadge: () => badgeRefresh?.()
  };
}

function runtimeToast(message: string, kind?: 'info' | 'error'): void {
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: { toast?: (m: string, k?: 'info' | 'error') => void } })
    .__ZCC_PLUGIN_RUNTIME__;
  runtime?.toast?.(message, kind);
}

export function openSafeExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
    if (typeof window === 'undefined') return;
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  } catch {
    /* ignore malformed URLs */
  }
}

export function createPluginPanelHost(pluginId: string): PluginPanelHost {
  let projectsCache: ProjectInfo[] = [];
  let refreshingProjects = false;
  let nextProjectRefresh = 0;
  // The panel reads this snapshot frequently. Refresh on demand with one
  // in-flight request and a time floor; no timer outlives the panel's host.
  const refreshProjects = async () => {
    if (refreshingProjects || Date.now() < nextProjectRefresh) return;
    refreshingProjects = true;
    try {
      const list = await callPluginRpc(pluginId, 'listProjects');
      if (Array.isArray(list)) projectsCache = list as ProjectInfo[];
    } catch {
      // Preserve the last good list and retry on a later panel read.
    } finally {
      nextProjectRefresh = Date.now() + PROJECT_REFRESH_MS;
      refreshingProjects = false;
    }
  };
  void refreshProjects();

  return {
    call: <T = unknown>(method: string, ...args: unknown[]) =>
      callPluginRpc(pluginId, method, packRpcArgs(args)) as Promise<T>,
    storage: {
      get: <T>(key: string) => callPluginRpc(pluginId, 'storageGet', key) as Promise<T | undefined>,
      set: async (key, value) => {
        await callPluginRpc(pluginId, 'storageSet', { key, value });
      }
    },
    cache: sharedPanelCache(),
    toast: runtimeToast,
    listProjects: () => {
      void refreshProjects();
      return projectsCache;
    },
    openExternal: openSafeExternal,
    pushInbox: async (input) => {
      if (!input.projectId) return { id: '' };
      return (await callPluginRpc(pluginId, 'pushInbox', input)) as { id: string };
    }
  };
}
