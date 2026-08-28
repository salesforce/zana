import { describe, expect, it, vi } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import {
  reportPluginEnabledFailure,
  setHubRowEnabled,
  type PluginEnabledApi
} from './plugin-row-enabled.js';
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

function api(over: Partial<PluginEnabledApi> = {}): PluginEnabledApi {
  return {
    pluginApps: { setEnabled: vi.fn(async () => ({ ok: true as const, value: true as const })) },
    extensions: { setEnabled: vi.fn(async () => ({ ok: true as const, value: true as const })) },
    ...over
  };
}

describe('setHubRowEnabled', () => {
  it('toggles a PluginService snapshot through pluginApps', async () => {
    const host = api();
    await expect(setHubRowEnabled(row({ plugin: plugin('docs') }), false, host)).resolves.toEqual({
      ok: true,
      value: true
    });
    expect(host.pluginApps.setEnabled).toHaveBeenCalledWith('docs', false);
    expect(host.extensions.setEnabled).not.toHaveBeenCalled();
  });

  it('toggles a disk extension through extensions', async () => {
    const host = api();
    await setHubRowEnabled(row({ entry: entry('local-1') }), true, host);
    expect(host.extensions.setEnabled).toHaveBeenCalledWith('local-1', true);
    expect(host.pluginApps.setEnabled).not.toHaveBeenCalled();
  });

  it('prefers the plugin snapshot when both records exist', async () => {
    const host = api();
    await setHubRowEnabled(row({ plugin: plugin('docs'), entry: entry('docs') }), false, host);
    expect(host.pluginApps.setEnabled).toHaveBeenCalledWith('docs', false);
    expect(host.extensions.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects a display-only row with no enable API', async () => {
    await expect(setHubRowEnabled(row(), false, api())).resolves.toMatchObject({
      ok: false,
      code: 'UNAVAILABLE'
    });
  });
});

describe('reportPluginEnabledFailure', () => {
  it('toasts the server message when enable/disable fails', () => {
    const toast = vi.fn();
    reportPluginEnabledFailure({ ok: false, message: 'content-type must be application/json' }, toast);
    expect(toast).toHaveBeenCalledWith('content-type must be application/json', 'error');
  });

  it('stays quiet on success', () => {
    const toast = vi.fn();
    reportPluginEnabledFailure({ ok: true }, toast);
    expect(toast).not.toHaveBeenCalled();
  });

  it('uses a fallback message when the failure has none', () => {
    const toast = vi.fn();
    reportPluginEnabledFailure({ ok: false }, toast);
    expect(toast).toHaveBeenCalledWith('Failed to update plugin', 'error');
  });
});
