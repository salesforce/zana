import { useCallback, useEffect, useRef } from 'react';
import { applicationTabId, parsePluginApplicationTab, useApplicationTabs, type PluginApplicationTab } from '../lib/application-tabs.js';
import { product } from '../lib/product-client.js';
import { usePluginAppModules } from './plugin-app-loader.js';
import { applyItemReport, usePinnedItemOverrides } from './plugin-pinned-tabs.js';

export const PIN_RESOLVE_TIMEOUT_MS = 3_000;
export const PIN_RESOLVE_MAX_IN_FLIGHT = 4;
export const PIN_RESOLVE_MIN_INTERVAL_MS = 30_000;

export interface PinResolverOptions {
  callRpc?: (pluginId: string, method: string, args: unknown) => Promise<unknown>;
  now?: () => number;
  timeoutMs?: number;
  maxInFlight?: number;
  minIntervalMs?: number;
}

export interface PinResolver {
  /** Asks the owner plugin about the item, within the bounds. A no-op when called too soon. */
  request(tab: PluginApplicationTab): void;
  /** Stops timers and drops queued and late results. */
  dispose(): void;
}

/** The `resolvePin` reply, or null when it is not `{ available: boolean, title?: string }`. */
export function parseResolvePinResult(
  tab: PluginApplicationTab,
  value: unknown
): { available: boolean; title?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { available?: unknown; title?: unknown };
  if (typeof raw.available !== 'boolean') return null;
  // A title that fails pin validation is dropped; the availability still applies.
  const title =
    raw.title !== undefined && parsePluginApplicationTab({ ...tab, title: raw.title }) ? (raw.title as string) : undefined;
  return { available: raw.available, ...(title === undefined ? {} : { title }) };
}

/**
 * Refreshes pinned tabs through the owner plugin's server `resolvePin` method
 * while its page is unmounted. Failures of any kind keep the previous state.
 */
export function createPinResolver(options: PinResolverOptions = {}): PinResolver {
  const callRpc = options.callRpc ?? ((pluginId, method, args) => product.pluginApps.callRpc(pluginId, method, args));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? PIN_RESOLVE_TIMEOUT_MS;
  const maxInFlight = options.maxInFlight ?? PIN_RESOLVE_MAX_IN_FLIGHT;
  const minIntervalMs = options.minIntervalMs ?? PIN_RESOLVE_MIN_INTERVAL_MS;
  const lastCall = new Map<string, number>();
  const queued = new Map<string, PluginApplicationTab>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let inFlight = 0;
  let disposed = false;

  const run = (tab: PluginApplicationTab) => {
    inFlight++;
    let settled = false;
    const finish = (result: unknown) => {
      if (settled) return;
      settled = true;
      timers.delete(timer);
      clearTimeout(timer);
      inFlight--;
      if (!disposed) {
        const parsed = parseResolvePinResult(tab, result);
        if (parsed) applyItemReport(tab, parsed);
        drain();
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timers.add(timer);
    let call: Promise<unknown>;
    try {
      call = Promise.resolve(callRpc(tab.pluginId, 'resolvePin', { itemKey: tab.itemKey, projectId: tab.projectId }));
    } catch {
      call = Promise.resolve(null);
    }
    void call.then(finish, () => finish(null));
  };

  const due = (id: string) => {
    const last = lastCall.get(id);
    return last === undefined || now() - last >= minIntervalMs;
  };

  function drain() {
    for (const [id, tab] of queued) {
      if (inFlight >= maxInFlight) return;
      queued.delete(id);
      if (!due(id)) continue;
      lastCall.set(id, now());
      run(tab);
    }
  }

  return {
    request(tab) {
      if (disposed) return;
      const id = applicationTabId(tab);
      if (!due(id)) return;
      queued.set(id, tab);
      drain();
    },
    dispose() {
      disposed = true;
      queued.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    }
  };
}

const pluginTabs = (tabs: ReturnType<typeof useApplicationTabs.getState>['open']) =>
  tabs.filter((tab): tab is PluginApplicationTab => tab.kind === 'plugin');

/**
 * Mount once where the tab strip lives. Refreshes every plugin tab once plugins
 * have reconciled and whenever the set of plugin tabs changes (restore), and
 * returns `resolve` for activation and hover. Everything is released on unmount.
 */
export function usePluginPinResolver(): { resolve(tab: PluginApplicationTab): void } {
  const resolver = useRef<PinResolver | null>(null);
  useEffect(() => {
    const created = createPinResolver();
    resolver.current = created;
    const sweep = () => {
      const { reconciled } = usePluginAppModules.getState();
      const tabs = pluginTabs(useApplicationTabs.getState().open);
      usePinnedItemOverrides.getState().retain(new Set(tabs.map(applicationTabId)));
      if (!reconciled) return;
      for (const tab of tabs) created.request(tab);
    };
    sweep();
    const offTabs = useApplicationTabs.subscribe(sweep);
    const offModules = usePluginAppModules.subscribe(sweep);
    return () => {
      offTabs();
      offModules();
      created.dispose();
      resolver.current = null;
    };
  }, []);
  const resolve = useCallback((tab: PluginApplicationTab) => resolver.current?.request(tab), []);
  return { resolve };
}
