import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { packRpcArgs } from '../../lib/rpc.js';
import type { PluginPanelCache, PluginPanelHost, ProjectInfo } from './host.js';

const cacheStore = new Map<string, unknown>();
let projectsCache: ProjectInfo[] = [];
let badgeRefresh: (() => void) | undefined;

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
  projectsCache = [];
  void callPluginRpc(pluginId, 'listProjects')
    .then((list) => {
      if (Array.isArray(list)) projectsCache = list as ProjectInfo[];
    })
    .catch(() => {
      /* panel tick will retry via listProjects() length */
    });

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
    listProjects: () => projectsCache,
    openExternal: openSafeExternal,
    pushInbox: async (input) => {
      if (!input.projectId) return { id: '' };
      return (await callPluginRpc(pluginId, 'pushInbox', input)) as { id: string };
    }
  };
}
