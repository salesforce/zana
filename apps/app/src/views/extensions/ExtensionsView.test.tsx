// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tab: 'skills', desktop: false, pluginId: null as string | null, panel: null as string | null }));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => state.desktop }));
vi.mock('@/store', () => ({ useUi: (pick: (s: unknown) => unknown) => pick({ extensionsTab: state.tab, setExtensionsTab: vi.fn() }) }));
vi.mock('@/hooks/useRouteState', () => ({ useRouteState: () => ({ extensionsHubPluginId: state.pluginId, pluginPanelPath: state.panel }) }));
vi.mock('@/views/extensions/SkillsView', () => ({ SkillsBody: () => <div>Desktop skills catalogue</div> }));
vi.mock('@/views/extensions/McpView', () => ({ McpBody: () => <div>Desktop MCP catalogue</div> }));
vi.mock('@/views/extensions/ExtensionsHub', () => ({ ExtensionsHub: ({ tab }: { tab: string }) => <div>Plugins {tab}</div> }));
vi.mock('@/views/thread-detail/PluginPanelPaneView', () => ({ PluginPanelPaneView: () => <div>Contributed page</div> }));
import { ExtensionsView } from './ExtensionsView';
afterEach(() => { cleanup(); state.desktop = false; state.pluginId = null; state.panel = null; });

it.each(['skills', 'mcp', 'marketplace'])('shows an explicit desktop requirement for the %s catalogue on mobile/web', (tab) => {
  state.tab = tab;
  render(<ExtensionsView />);
  expect(screen.getByText(/in the Zana desktop app on your connected computer/)).toBeTruthy();
  expect(screen.queryByText(/Desktop .* catalogue/)).toBeNull();
});
it.each(['skills', 'mcp'])('retains the %s catalogue on desktop', (tab) => {
  state.desktop = true;
  state.tab = tab;
  render(<ExtensionsView />);
  expect(screen.getByText(/Desktop .* catalogue/)).toBeTruthy();
  expect(screen.queryByText(/on your connected computer/)).toBeNull();
});
it.each(['installed', 'page'])('keeps the %s plugin hub available over HTTP', (tab) => {
  state.tab = tab;
  render(<ExtensionsView />);
  expect(screen.getByText(`Plugins ${tab === 'page' ? 'installed' : tab}`)).toBeTruthy();
});
it('keeps catalogue browsing available on desktop', () => {
  state.desktop = true;
  state.tab = 'marketplace';
  render(<ExtensionsView />);
  expect(screen.getByText('Plugins marketplace')).toBeTruthy();
});
it('retains contributed plugin pages', () => {
  state.tab = 'page';
  state.pluginId = 'example';
  state.panel = 'settings';
  render(<ExtensionsView />);
  expect(screen.getByText('Contributed page')).toBeTruthy();
});
