/**
 * Renderer side of plugin deep links. Main validates a link and pushes
 * `{ pluginId, route, payload }`; this module opens the plugin's view, then
 * hands the payload to the handler the plugin registered for the route. A link
 * never acts on its own: the plugin must confirm before doing anything.
 *
 * A link whose handler is not registered yet (the plugin view is still mounting)
 * waits in a small bounded queue and is delivered, in order, on registration.
 */
import type { DeepLinkConfig, DeepLinkDelivery } from '@zana-ai/zcc-desktop-contract';
import type { ZccDeepLinkOpenResult, ZccDeepLinks } from '@zana-ai/zcc-plugin-sdk/app';
import { appNavigate } from '../lib/app-navigate.js';
import { useUi } from '../store.js';
import { hrefForPluginNavPanel, hrefForPluginProjectTab } from './plugin-nav-href.js';
import { getPluginRegistrationSets, listNavPanels, listProjectTabs, subscribePluginSlots } from './plugin-slots.js';

/** Links waiting for a handler: oldest dropped past this. */
export const DEEP_LINK_QUEUE_LIMIT = 16;
/** How long a link waits for its handler to register. */
export const DEEP_LINK_QUEUE_TTL_MS = 60_000;
/** How long to wait for a plugin to finish loading before calling it not installed. */
export const DEEP_LINK_PLUGIN_WAIT_MS = 8_000;

const PLUGIN_ID = /^[a-z0-9-]+$/;
const ROUTE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

interface Queued {
  delivery: DeepLinkDelivery;
  expiresAt: number;
}

type Handler = (payload: string | null) => void;

const handlers = new Map<string, Set<Handler>>();
let queue: Queued[] = [];
let config: DeepLinkConfig | null = null;

const keyOf = (pluginId: string, route: string) => `${pluginId}\n${route}`;

function isDelivery(value: unknown): value is DeepLinkDelivery {
  if (!value || typeof value !== 'object') return false;
  const { pluginId, route, payload } = value as Record<string, unknown>;
  return (
    typeof pluginId === 'string' &&
    PLUGIN_ID.test(pluginId) &&
    typeof route === 'string' &&
    ROUTE.test(route) &&
    (payload === null || typeof payload === 'string')
  );
}

function runHandler(handler: Handler, payload: string | null): void {
  try {
    handler(payload);
  } catch (error) {
    console.error('[deep-link] plugin handler failed', error);
  }
}

function pruneQueue(now: number): void {
  queue = queue.filter((entry) => entry.expiresAt > now);
  while (queue.length > DEEP_LINK_QUEUE_LIMIT) queue.shift();
}

/** Hand a link to the plugin's handlers now, or park it until one registers. */
export function deliverDeepLink(delivery: DeepLinkDelivery, now: number = Date.now()): void {
  const set = handlers.get(keyOf(delivery.pluginId, delivery.route));
  if (set && set.size > 0) {
    for (const handler of [...set]) runHandler(handler, delivery.payload);
    return;
  }
  queue.push({ delivery, expiresAt: now + DEEP_LINK_QUEUE_TTL_MS });
  pruneQueue(now);
}

/** Register a handler for one plugin's route; queued links for it are delivered first, in order. */
export function onPluginDeepLink(pluginId: string, route: string, handler: Handler, now: number = Date.now()): () => void {
  const key = keyOf(pluginId, route);
  const set = handlers.get(key) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(key, set);
  pruneQueue(now);
  const ready = queue.filter((entry) => entry.delivery.pluginId === pluginId && entry.delivery.route === route);
  queue = queue.filter((entry) => !ready.includes(entry));
  for (const entry of ready) runHandler(handler, entry.delivery.payload);
  return () => {
    set.delete(handler);
    if (set.size === 0 && handlers.get(key) === set) handlers.delete(key);
  };
}

function pluginIsLoaded(pluginId: string): boolean {
  return getPluginRegistrationSets().some((set) => set.pluginId === pluginId);
}

/** Open the plugin's view: its first nav panel, else its project tab for the focused project. */
function openPluginView(pluginId: string): void {
  const panel = listNavPanels().find((row) => row.pluginId === pluginId);
  if (panel) {
    appNavigate(hrefForPluginNavPanel(pluginId, panel.path ?? panel.id));
    return;
  }
  const hasTab = listProjectTabs().some((row) => row.pluginId === pluginId);
  const projectId = useUi.getState().selectedProjectId;
  if (hasTab && projectId) appNavigate(hrefForPluginProjectTab(pluginId, projectId));
}

/** Resolve once the plugin has registered, or false after the wait. */
function whenPluginLoaded(pluginId: string, timeoutMs: number): Promise<boolean> {
  if (pluginIsLoaded(pluginId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      off();
      resolve(loaded);
    };
    const off = subscribePluginSlots(() => {
      if (pluginIsLoaded(pluginId)) finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Route one delivery from main: unknown or not-installed plugins get a toast and
 * nothing else; otherwise open the plugin's view and deliver the payload.
 */
export async function routeDeepLink(
  delivery: unknown,
  options: { pluginWaitMs?: number } = {}
): Promise<'delivered' | 'unknown-plugin' | 'invalid'> {
  if (!isDelivery(delivery)) return 'invalid';
  const loaded = await whenPluginLoaded(delivery.pluginId, options.pluginWaitMs ?? DEEP_LINK_PLUGIN_WAIT_MS);
  if (!loaded) {
    useUi.getState().pushToast("That link is for a plugin that isn't installed.", 'error');
    return 'unknown-plugin';
  }
  openPluginView(delivery.pluginId);
  deliverDeepLink(delivery);
  return 'delivered';
}

/** `base()` for plugins: null until main answers, and outside the desktop app. */
export function getDeepLinkBase(): string | null {
  return config?.base ?? null;
}

/** Validate and route a pasted link through main; the renderer never trusts its own check. */
export async function openDeepLink(raw: string): Promise<ZccDeepLinkOpenResult> {
  const api = typeof window === 'undefined' ? undefined : window.cc?.deepLinks;
  if (!api || typeof raw !== 'string') return { ok: false, reason: 'unavailable' };
  try {
    return await api.open(raw);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** The `useZccDeepLinks` value for one plugin. */
export function deepLinksFor(pluginId: string): ZccDeepLinks {
  return {
    base: getDeepLinkBase,
    on: (route, handler) => {
      if (typeof route !== 'string' || !ROUTE.test(route) || typeof handler !== 'function') return () => undefined;
      return onPluginDeepLink(pluginId, route, handler);
    },
    open: openDeepLink
  };
}

/**
 * Subscribe to main's pushes and fetch the link base. Call once at renderer
 * init. Returns the unsubscribe; a no-op outside the desktop app.
 */
export function installDeepLinkBridge(): () => void {
  const api = typeof window === 'undefined' ? undefined : window.cc?.deepLinks;
  if (!api) return () => undefined;
  let active = true;
  void api
    .config()
    .then((next) => {
      if (active && next && (next.base === null || typeof next.base === 'string')) config = next;
    })
    .catch((error: unknown) => { console.warn('[deep-links] config load failed; links stay hidden', error); });
  const off = api.onLink((delivery) => {
    void routeDeepLink(delivery);
  });
  return () => {
    active = false;
    off();
  };
}

/** Test seam: forget every handler, queued link, and cached config. */
export function resetDeepLinksForTests(): void {
  handlers.clear();
  queue = [];
  config = null;
}
