import { useEffect, useState } from 'react';
import type { AppConfig, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { product } from './product-client.js';

/** The Settings section this gate controls. */
export const PEERS_SETTINGS_SECTION = 'peers';

/** An installed plugin "supports peers" when it is enabled and declares `zcc.peers`. */
export function pluginSupportsPeers(plugin: Pick<PluginAppEntry, 'enabled' | 'peers'>): boolean {
  return plugin.enabled === true && plugin.peers === true;
}

/** The Peers page needs BOTH the Experimental opt-in and a peer-capable plugin. */
export function isPeersSettingsVisible(
  config: Pick<AppConfig, 'peersSettingsEnabled'> | null | undefined,
  plugins: ReadonlyArray<Pick<PluginAppEntry, 'enabled' | 'peers'>> | null | undefined
): boolean {
  return config?.peersSettingsEnabled === true && (plugins ?? []).some(pluginSupportsPeers);
}

const NO_HIDDEN_SECTIONS: ReadonlySet<string> = new Set();
const PEERS_HIDDEN: ReadonlySet<string> = new Set([PEERS_SETTINGS_SECTION]);

/** Section ids Settings must hide (nav, search, deep links) given the Peers gate. */
export function hiddenSettingsSections(peersVisible: boolean): ReadonlySet<string> {
  return peersVisible ? NO_HIDDEN_SECTIONS : PEERS_HIDDEN;
}

export interface PeersVisibility {
  visible: boolean;
  /** False until both the config and the plugin list have loaded (or failed to). */
  ready: boolean;
}

/** Live gate for the Peers settings page; subscribes to config and plugin changes. */
export function usePeersSettingsVisibility(): PeersVisibility {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [plugins, setPlugins] = useState<PluginAppEntry[] | null>(null);
  const [configSettled, setConfigSettled] = useState(false);
  const [pluginsSettled, setPluginsSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    product.config.get()
      .then((next) => { if (!cancelled) setConfig(next); })
      .catch((error: unknown) => { console.warn('[peers] visibility config load failed', error); })
      .finally(() => { if (!cancelled) setConfigSettled(true); });
    product.pluginApps.list()
      .then((next) => { if (!cancelled) setPlugins(next); })
      .catch((error: unknown) => { console.warn('[peers] visibility plugin list load failed', error); })
      .finally(() => { if (!cancelled) setPluginsSettled(true); });
    const offConfig = product.config.onChanged((next) => { if (!cancelled) setConfig(next); });
    const offPlugins = product.pluginApps.onChanged((next) => { if (!cancelled) setPlugins(next); });
    return () => { cancelled = true; offConfig(); offPlugins(); };
  }, []);

  return { visible: isPeersSettingsVisible(config, plugins), ready: configSettled && pluginsSettled };
}
