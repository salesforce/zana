import { beforeEach, expect, it, vi } from 'vitest';
import type { PluginApplicationTab } from '../application-tabs.js';

const h = vi.hoisted(() => ({ panels: [] as Array<{ pluginId: string; id: string; path?: string; placement?: string }> }));
vi.mock('../../plugins/plugin-slots.js', () => ({
  listNavPanels: () => h.panels,
  listProjectTabs: () => [],
  projectTabView: () => ''
}));
import { pluginTabPath } from '../plugin-tab-route.js';

const tab = (itemKey: string, extra: Partial<PluginApplicationTab> = {}): PluginApplicationTab => ({
  kind: 'plugin',
  pluginId: 'test-plugin',
  pageId: 'docs',
  itemKey,
  title: 'Item',
  projectId: 'p',
  ...extra
});

beforeEach(() => {
  h.panels = [{ pluginId: 'test-plugin', id: 'docs' }];
});

it('opens the page at the encoded item key, using the panel id when there is no path', () => {
  expect(pluginTabPath(tab('doc-1'))).toBe('/plugins/test-plugin/docs/doc-1');
});

it('uses the panel path when it differs from the id and keeps separators inside the key', () => {
  h.panels = [{ pluginId: 'test-plugin', id: 'docs', path: 'library' }];
  expect(pluginTabPath(tab('a/b c'))).toBe('/plugins/test-plugin/library/a%252Fb%2520c');
});

it('routes extension-hub pages through the hub', () => {
  h.panels = [{ pluginId: 'test-plugin', id: 'docs', placement: 'extensions' }];
  expect(pluginTabPath(tab('x'))).toBe('/extensions/pages/test-plugin/docs/x');
});

it('has no route when the page is not registered for that plugin', () => {
  h.panels = [{ pluginId: 'other', id: 'docs' }, { pluginId: 'test-plugin', id: 'other' }];
  expect(pluginTabPath(tab('x'))).toBeNull();
});
