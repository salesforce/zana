import { describe, expect, it } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { buildHubRows } from './installed-plugins.js';
import { filterCollectionRows, groupInstalledRows, installedIconTone, installedIconUrl } from './installed-collection.js';

function row(over: Partial<PluginAppEntry> = {}) {
  return buildHubRows([], [], [{ id: 'example', name: 'Example', description: '', icon: 'Box', enabled: true,
    provenance: 'builtin', status: 'running', appUrl: null, ...over }])[0]!;
}

describe('installed plugin collection', () => {
  it('combines status with update filters, including disabled updates and empty version strings', () => {
    const enabled = row({ id: 'on', availableVersion: '2.0' });
    const disabled = row({ id: 'off', enabled: false, availableVersion: '2.0' });
    const current = row({ id: 'current', availableVersion: '  ' });
    const rows = [enabled, disabled, current];
    expect(filterCollectionRows(rows, 'all', false)).toEqual(rows);
    expect(filterCollectionRows(rows, 'enabled', false)).toEqual([enabled, current]);
    expect(filterCollectionRows(rows, 'disabled', false)).toEqual([disabled]);
    expect(filterCollectionRows(rows, 'all', true)).toEqual([enabled, disabled]);
    expect(filterCollectionRows(rows, 'enabled', true)).toEqual([enabled]);
    expect(filterCollectionRows(rows, 'disabled', true)).toEqual([disabled]);
  });

  it('groups declared capabilities while preserving disabled and legacy rows', () => {
    const tool = row();
    const agent = row({ collection: 'coding-agents', enabled: false });
    const legacy = { module: { id: 'legacy', title: 'Legacy', icon: 'Box' }, plugin: null, entry: null };
    expect(groupInstalledRows([tool, agent, legacy])).toEqual({ tools: [tool, legacy], agents: [agent] });
    expect(groupInstalledRows([])).toEqual({ tools: [], agents: [] });
  });

  it('assigns stable palette tones without inspecting concrete plugin names', () => {
    const tones = Array.from({ length: 40 }, (_, i) => installedIconTone(`example-${i}`));
    expect(new Set(tones).size).toBe(6);
    expect(installedIconTone('example')).toBe(installedIconTone('example'));
    expect(installedIconTone('')).toBe('lavender');
  });

  it('uses encoded, same-origin asset URLs for relative branding images', () => {
    expect(installedIconUrl(row({ icon: './icons/My Logo.svg' }))).toBe('/plugins/example/assets/icons/My%20Logo.svg');
    expect(installedIconUrl(row({ id: 'safe-id', icon: 'icon.PNG' }))).toBe('/plugins/safe-id/assets/icon.PNG');
    expect(installedIconUrl({ ...row(), plugin: null })).toBeNull();
  });

  it.each(['Box', '', '../secret.svg', 'icons/../secret.svg', '/absolute.svg', 'https://example.com/a.svg',
    'data:image/svg+xml.svg', 'icons\\icon.svg', 'icons//icon.svg', '././icon.svg', 'icon.svg?token=1'])('rejects unsafe or non-image icon %s', (icon) => {
    expect(installedIconUrl(row({ icon }))).toBeNull();
  });
});
