import { hostSettingsPanelOf, rowEnabled, type HubRow } from '@/views/extensions/installed-plugins';
import { useMemo, useSyncExternalStore } from 'react';
import { useMergedModules } from '@/modules';
import { buildHubRows } from '@/views/extensions/installed-plugins';
import { listSettingsSections, subscribePluginSlots } from './plugin-slots';
import { useInstalledPlugins } from './installed-plugin-store';

/** Registry entries can belong to settings-only plugins without an AppModule. */
export function configurablePluginRows(rows: HubRow[], sections: readonly { pluginId: string }[]): HubRow[] {
  const custom = new Set(sections.map(section => section.pluginId));
  return rows.filter(row => rowEnabled(row) && !row.entry?.needsConsent && (
    row.plugin?.hasSettings || custom.has(row.module.id) || hostSettingsPanelOf(row)
  ));
}

export function usePluginSettingsIndex() {
  const installed = useInstalledPlugins();
  const modules = useMergedModules();
  const sections = useSyncExternalStore(subscribePluginSlots, listSettingsSections, listSettingsSections);
  const rows = useMemo(() => buildHubRows(modules, installed.entries, installed.plugins), [modules, installed.entries, installed.plugins]);
  const configurable = useMemo(() => configurablePluginRows(rows, sections), [rows, sections]);
  return { ...installed, rows, configurable, sections };
}
