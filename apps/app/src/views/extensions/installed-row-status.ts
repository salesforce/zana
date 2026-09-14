import type { HubRow } from './installed-plugins.js';
import { rowEnabled } from './installed-plugins.js';

export type InstalledRuntimeTone = 'error' | 'warning' | 'muted';

export interface InstalledRuntimeStatus {
  label: string;
  tone: InstalledRuntimeTone;
  detail?: string;
}

export function installedRuntimeStatus(row: HubRow): InstalledRuntimeStatus | null {
  if (row.module.loadError) {
    return { label: 'Failed', tone: 'error', detail: row.module.loadError };
  }
  if (row.entry?.error === 'version-mismatch') {
    return { label: 'Incompatible', tone: 'error' };
  }
  const plugin = row.plugin;
  if (!plugin || !plugin.enabled || plugin.status === 'disabled') return null;
  if (plugin.status === 'degraded') {
    return {
      label: 'Degraded',
      tone: 'warning',
      detail: plugin.statusDetail ?? undefined
    };
  }
  if (plugin.status === 'needs-configuration') {
    return {
      label: 'Needs configuration',
      tone: 'warning',
      detail: plugin.statusDetail ?? undefined
    };
  }
  return null;
}

export function installedNotRunning(row: HubRow): boolean {
  if (!rowEnabled(row) || !row.plugin) return false;
  return row.plugin.status !== 'running';
}
