import type { PluginAppEntry, PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
import { listSettingsSections } from '../../../plugins/plugin-slots.js';
import { product } from '../../product-client.js';
import { getPluginDetailRoutePath } from '../../route-paths.js';
import { warnSettingsSearchOnce } from '../diagnostics';
import { notifySettingsSearchSourcesChanged, registerSettingsSearchProvider } from '../registry';
import type { SettingsSearchEntry, SettingsSearchProvider } from '../types';

// Plugin-defined settings (`zcc.settings.define`) live on each plugin's hub
// Configure page (guard tests keep them there), so results deep-link there.
// Nothing here names a plugin: ids, names and descriptors all come from the
// running plugin list (Rule 6). SECRET values are dropped by the server
// (`?secrets=omit`) so they never reach the renderer for search; the local
// filter below is defence in depth, applied before caching.

export const PLUGIN_CONFIGURE_HASH = '#plugin-configure';
/** Query param naming the field (by descriptor key: unique and stable, unlike labels) the hub should flash and focus. */
export const PLUGIN_SETTING_PARAM = 'setting';
export const PLUGIN_VALUES_TTL_MS = 30_000;
const FETCH_CONCURRENCY = 4;

type Descriptor = PluginSettingsSnapshot['descriptors'][string];
type StoredValue = PluginSettingsSnapshot['values'][string];

export interface PluginSettingsApi {
  list(): Promise<PluginAppEntry[]>;
  getSettings(pluginId: string, options?: { omitSecrets?: boolean }): Promise<PluginSettingsSnapshot>;
}

/** An entry plus the route a result must open (the plugin page, not /settings). */
export type DeepLinkedSettingsEntry = SettingsSearchEntry & { href: string };

interface CachedPlugin {
  name: string;
  descriptors: Record<string, Descriptor>;
  /** Non-secret values only. */
  values: Record<string, StoredValue>;
  fetchedAt: number;
}

let cache = new Map<string, CachedPlugin>();
let inflight: Promise<void> | null = null;

/** Test hook: forget everything fetched this session. */
export function resetPluginSettingsCache(): void {
  cache = new Map();
  inflight = null;
}

/**
 * The INSTALLED plugin page (`view=installed`): that is where the Configure
 * block lives. Without it the route opens the marketplace Browse detail, which
 * only knows catalogue entries, so a local plugin showed "Plugin not found".
 */
export function pluginConfigureHref(pluginId: string, params: Record<string, string> = {}): string {
  const path = getPluginDetailRoutePath(pluginId, { view: 'installed' });
  const [pathname, query = ''] = path.split('?');
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) search.set(key, value);
  const qs = search.toString();
  return `${pathname}${qs ? `?${qs}` : ''}${PLUGIN_CONFIGURE_HASH}`;
}

export function pluginSettingHref(pluginId: string, settingKey: string): string {
  return pluginConfigureHref(pluginId, { [PLUGIN_SETTING_PARAM]: settingKey });
}

function nonSecretValues(snap: PluginSettingsSnapshot): Record<string, StoredValue> {
  const out: Record<string, StoredValue> = {};
  for (const [key, descriptor] of Object.entries(snap.descriptors)) {
    if (descriptor.secret === true) continue;
    out[key] = snap.values[key];
  }
  return out;
}

async function inBatches<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += FETCH_CONCURRENCY) {
    await Promise.all(items.slice(i, i + FETCH_CONCURRENCY).map(work));
  }
}

/**
 * Fetch descriptors for every enabled plugin (once per session) and refresh the
 * non-secret values when older than the TTL. Plugins that are no longer enabled
 * (disabled or uninstalled) are evicted. Safe to call on every search-box focus:
 * concurrent calls share one request. Failures leave the cache as-is and never
 * throw.
 */
export function prefetchPluginSettings(
  api: PluginSettingsApi = product.pluginApps,
  now: () => number = Date.now
): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    let apps: PluginAppEntry[];
    try {
      apps = (await api.list()).filter((app) => app.enabled);
    } catch (error) {
      warnSettingsSearchOnce('plugins:list', 'listing plugins failed; plugin settings stay as last fetched', error);
      return;
    }
    let changed = false;
    const enabled = new Set(apps.map((app) => app.id));
    for (const id of [...cache.keys()]) {
      if (!enabled.has(id)) {
        cache.delete(id);
        changed = true;
      }
    }
    await inBatches(apps, async (app) => {
      const prior = cache.get(app.id);
      if (prior && now() - prior.fetchedAt < PLUGIN_VALUES_TTL_MS) return;
      try {
        const snap = await api.getSettings(app.id, { omitSecrets: true });
        if (Object.keys(snap.descriptors).length === 0 && !prior) return;
        cache.set(app.id, {
          name: app.name,
          descriptors: snap.descriptors,
          values: nonSecretValues(snap),
          fetchedAt: now()
        });
        changed = true;
      } catch (error) {
        // One broken plugin never blanks the rest.
        warnSettingsSearchOnce(`plugins:settings:${app.id}`, `reading settings of plugin "${app.id}" failed; its settings are not searchable`, error);
      }
    });
    if (changed) notifySettingsSearchSourcesChanged();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function formatValue(descriptor: Descriptor, value: StoredValue): string | undefined {
  if (descriptor.secret === true || value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const text = String(value);
  return text.length > 0 ? text : undefined;
}

function sectionLabel(name: string): string {
  return `Plugins › ${name}`;
}

/** Runtime provider: cached descriptors plus live `settingsSection` slot registrations. */
export const pluginSettingsSearchProvider: SettingsSearchProvider = () => {
  const out: DeepLinkedSettingsEntry[] = [];
  for (const [pluginId, plugin] of cache) {
    for (const [key, descriptor] of Object.entries(plugin.descriptors)) {
      const entry: DeepLinkedSettingsEntry = {
        id: `plugin.${pluginId}.${key}`,
        section: sectionLabel(plugin.name),
        label: descriptor.label,
        kind: 'setting',
        keywords: [plugin.name, 'plugin setting'],
        href: pluginSettingHref(pluginId, key)
      };
      if (descriptor.description) entry.help = descriptor.description;
      if (descriptor.options?.length) entry.options = descriptor.options;
      if (descriptor.secret !== true) {
        const text = formatValue(descriptor, plugin.values[key]);
        if (text !== undefined) entry.value = () => text;
      }
      out.push(entry);
    }
  }
  for (const section of listSettingsSections()) {
    const name = cache.get(section.pluginId)?.name ?? section.pluginId;
    if (!section.title && !section.description) continue;
    out.push({
      id: `plugin.${section.pluginId}.section.${section.id}`,
      section: sectionLabel(name),
      label: section.title ?? name,
      help: section.description,
      kind: 'setting',
      keywords: [name, 'plugin settings'],
      href: pluginConfigureHref(section.pluginId)
    });
  }
  return out;
};

/**
 * Register the provider. `prefetch` is meant for the first focus of a search
 * surface (rail or palette); when it brings new data it bumps the sources
 * version so the corpus rebuilds. Dispose on shutdown (Rule 3).
 */
export function registerPluginSettingsProvider(api: PluginSettingsApi = product.pluginApps): {
  prefetch: () => Promise<void>;
  dispose: () => void;
} {
  const off = registerSettingsSearchProvider(pluginSettingsSearchProvider);
  return {
    prefetch: () => prefetchPluginSettings(api),
    dispose: off
  };
}
