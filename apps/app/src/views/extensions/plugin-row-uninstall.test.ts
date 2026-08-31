import { describe, expect, it, vi } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { uninstallHubRow, type PluginUninstallApi } from './plugin-row-uninstall.js';
import type { HubRow } from './installed-plugins.js';

function row(over: Partial<HubRow> = {}): HubRow {
  const module: AppModule = { id: 'docs', title: 'Docs', icon: 'Library' };
  return { module, entry: null, plugin: null, ...over };
}

function plugin(id = 'docs'): PluginAppEntry {
  return {
    id,
    name: id,
    description: '',
    icon: 'Puzzle',
    enabled: true,
    provenance: 'builtin',
    status: 'running',
    appUrl: null
  };
}

function entry(id = 'docs'): ExtensionEntry {
  return {
    id,
    enabled: true,
    loaded: true,
    consented: true,
    needsConsent: null,
    path: `/ext/${id}`
  } as ExtensionEntry;
}

function api(over: Partial<PluginUninstallApi> = {}): PluginUninstallApi {
  return {
    pluginApps: { remove: vi.fn(async () => ({ ok: true as const, value: true as const })) },
    extensions: { uninstall: vi.fn(async () => ({ ok: true as const, value: true as const })) },
    ...over
  };
}

describe('uninstallHubRow', () => {
  it('removes a PluginService plugin even when no disk entry exists', async () => {
    const host = api();
    await expect(uninstallHubRow(row({ plugin: plugin('docs') }), host)).resolves.toEqual({
      ok: true,
      value: true
    });
    expect(host.pluginApps.remove).toHaveBeenCalledWith('docs');
    expect(host.extensions.uninstall).not.toHaveBeenCalled();
  });

  it('uninstalls a leftover disk extension when there is no plugin snapshot', async () => {
    const host = api();
    await uninstallHubRow(row({ entry: entry('sample-ext') }), host);
    expect(host.extensions.uninstall).toHaveBeenCalledWith('sample-ext');
    expect(host.pluginApps.remove).not.toHaveBeenCalled();
  });

  it('removes both layers when a plugin and a leftover sidecar share an id', async () => {
    const host = api();
    await uninstallHubRow(row({ plugin: plugin('sample-ext'), entry: entry('sample-ext') }), host);
    expect(host.pluginApps.remove).toHaveBeenCalledWith('sample-ext');
    expect(host.extensions.uninstall).toHaveBeenCalledWith('sample-ext');
  });

  it('treats a missing leftover sidecar as success after the plugin is gone', async () => {
    const host = api({
      extensions: {
        uninstall: vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND', message: 'not found' }))
      }
    });
    await expect(
      uninstallHubRow(row({ plugin: plugin('docs'), entry: entry('docs') }), host)
    ).resolves.toEqual({ ok: true, value: true });
  });

  it('rejects a display-only row with no uninstall API', async () => {
    await expect(uninstallHubRow(row(), api())).resolves.toMatchObject({
      ok: false,
      code: 'UNAVAILABLE'
    });
  });
});
