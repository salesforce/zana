import type { HubRow } from './installed-plugins.js';

export interface PluginUpdateApi {
  pluginApps: {
    applyUpdate: (
      id: string
    ) => Promise<{ ok: true } | { ok: false; message?: string }>;
  };
}

export function pluginAvailableVersion(row: HubRow): string | null {
  const version = row.plugin?.availableVersion?.trim();
  return version ? version : null;
}

export function pluginUpdatesCheckedMessage(count: number): string {
  if (count <= 0) return 'All plugins are up to date';
  if (count === 1) return '1 plugin has an update';
  return `${count} plugins have updates`;
}

export async function applyHubPluginUpdate(row: HubRow, api: PluginUpdateApi) {
  const id = row.plugin?.id;
  if (!id || !pluginAvailableVersion(row)) {
    return {
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: 'This plugin has no available update'
    };
  }
  return api.pluginApps.applyUpdate(id);
}
