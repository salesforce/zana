import { describe, expect, it, vi } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import type { HubRow } from './installed-plugins.js';
import {
  applyHubPluginUpdate,
  pluginAvailableVersion,
  pluginUpdatesCheckedMessage
} from './plugin-row-update.js';

function row(over: Partial<PluginAppEntry> = {}): HubRow {
  const plugin: PluginAppEntry = {
    id: 'docs',
    name: 'Docs',
    description: '',
    icon: 'Puzzle',
    enabled: true,
    provenance: 'catalog',
    status: 'running',
    appUrl: null,
    ...over
  };
  const module: AppModule = { id: plugin.id, title: plugin.name, icon: plugin.icon };
  return { module, entry: null, plugin };
}

describe('pluginAvailableVersion', () => {
  it('returns the catalog version when present', () => {
    expect(pluginAvailableVersion(row({ availableVersion: '1.4.0' }))).toBe('1.4.0');
    expect(pluginAvailableVersion(row())).toBeNull();
    expect(pluginAvailableVersion({ module: { id: 'x', title: 'X', icon: 'Puzzle' }, entry: null, plugin: null })).toBeNull();
  });
});

describe('pluginUpdatesCheckedMessage', () => {
  it('names the count', () => {
    expect(pluginUpdatesCheckedMessage(0)).toBe('All plugins are up to date');
    expect(pluginUpdatesCheckedMessage(1)).toBe('1 plugin has an update');
    expect(pluginUpdatesCheckedMessage(3)).toBe('3 plugins have updates');
  });
});

describe('applyHubPluginUpdate', () => {
  it('applies through pluginApps when a version is waiting', async () => {
    const applyUpdate = vi.fn(async () => ({ ok: true as const, value: true as const }));
    await expect(
      applyHubPluginUpdate(row({ availableVersion: '2.0.0' }), { pluginApps: { applyUpdate } })
    ).resolves.toEqual({ ok: true, value: true });
    expect(applyUpdate).toHaveBeenCalledWith('docs');
  });

  it('refuses a row with no available update', async () => {
    const applyUpdate = vi.fn(async () => ({ ok: true as const, value: true as const }));
    await expect(applyHubPluginUpdate(row(), { pluginApps: { applyUpdate } })).resolves.toMatchObject({
      ok: false,
      code: 'UNAVAILABLE'
    });
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
