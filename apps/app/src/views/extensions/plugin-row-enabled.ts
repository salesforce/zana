import type { HubRow } from './installed-plugins.js';

export interface PluginEnabledApi {
  pluginApps: {
    setEnabled: (
      id: string,
      enabled: boolean
    ) => Promise<{ ok: true } | { ok: false; message?: string }>;
  };
  extensions: {
    setEnabled: (
      id: string,
      enabled: boolean
    ) => Promise<{ ok: true } | { ok: false; message?: string }>;
  };
}

export function reportPluginEnabledFailure(
  res: { ok: true } | { ok: false; message?: string },
  toast: (message: string, kind?: 'info' | 'error') => void
): void {
  if (!res.ok) toast(res.message || 'Failed to update plugin', 'error');
}

export async function setHubRowEnabled(
  row: HubRow,
  enabled: boolean,
  api: PluginEnabledApi
) {
  if (row.plugin) return api.pluginApps.setEnabled(row.plugin.id, enabled);
  if (row.entry) return api.extensions.setEnabled(row.entry.id, enabled);
  return {
    ok: false as const,
    code: 'UNAVAILABLE' as const,
    message: 'This plugin cannot be toggled'
  };
}
