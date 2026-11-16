import { expect, it, vi } from 'vitest';
import type { HubRow } from '@/views/extensions/installed-plugins';
vi.mock('@/modules', () => ({}));
vi.mock('./installed-plugin-store', () => ({}));
import { configurablePluginRows } from './plugin-settings-index';

it('discovers declarative, settings-only, and legacy contributions, excluding disabled and unconsented code', () => {
  const row = (id: string, over: Partial<HubRow> = {}): HubRow => ({ module: { id, title: id, icon: 'Puzzle' }, entry: null, plugin: { id, enabled: true } as never, ...over });
  const rows = [row('declared', { plugin: { id: 'declared', enabled: true, hasSettings: true } as never }), row('custom'),
    row('legacy', { module: { id: 'legacy', title: 'Legacy', icon: 'Puzzle', settingsPanel: () => null } }),
    row('fallback', { module: { id: 'fallback', title: 'Fallback', icon: 'Puzzle', placement: 'settings', panel: () => null } }),
    row('off', { plugin: { enabled: false, hasSettings: true } as never }),
    row('consent', { entry: { enabled: true, needsConsent: true } as never }), row('none')];
  expect(configurablePluginRows(rows, [{ pluginId: 'custom' }, { pluginId: 'off' }, { pluginId: 'consent' }]).map(item => item.module.id))
    .toEqual(['declared', 'custom', 'legacy', 'fallback']);
});
