import type { HubRow } from './installed-plugins.js';

export interface PluginUninstallApi {
  pluginApps: {
    remove: (
      id: string
    ) => Promise<{ ok: true } | { ok: false; code?: string; message?: string }>;
  };
  extensions: {
    uninstall: (
      id: string
    ) => Promise<{ ok: true } | { ok: false; code?: string; message?: string }>;
  };
}

function alreadyGone(
  res: { ok: true } | { ok: false; code?: string; message?: string }
): boolean {
  if (res.ok) return false;
  return res.code === 'NOT_FOUND' || /not found|unknown/i.test(res.message ?? '');
}

export async function uninstallHubRow(row: HubRow, api: PluginUninstallApi) {
  if (!row.plugin && !row.entry) {
    return {
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: 'This plugin cannot be uninstalled'
    };
  }
  if (row.plugin) {
    const removed = await api.pluginApps.remove(row.plugin.id);
    if (!removed.ok) return removed;
  }
  if (row.entry) {
    const leftover = await api.extensions.uninstall(row.entry.id);
    if (!leftover.ok && !alreadyGone(leftover)) return leftover;
  }
  return { ok: true as const, value: true as const };
}
