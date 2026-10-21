/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';

const h = vi.hoisted(() => ({
  nav: 'example', path: '/legacy', pluginPanel: false,
  modules: [] as AppModule[],
  create: vi.fn(() => ({ id: 'host' })), dispose: vi.fn(), clear: vi.fn()
}));
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useLocation: () => ({ pathname: h.path })
}));
vi.mock('../store.js', () => ({ useUi: (select: (s: unknown) => unknown) => select({ nav: h.nav }) }));
vi.mock('./index.js', () => ({ useMergedModules: () => h.modules }));
vi.mock('./host.js', () => ({
  createModuleHost: h.create,
  createMountScopedHost: (host: unknown) => ({ host, dispose: h.dispose }),
  clearModuleCache: h.clear
}));
vi.mock('../hooks/useRouteState.js', () => ({ useRouteState: () => ({ nav: h.nav }) }));
vi.mock('../plugins/PluginNavPanelHost.js', () => ({ useHasPluginNavPanel: () => h.pluginPanel }));
vi.mock('../plugins/plugin-slots.js', () => ({ listNavPanels: () => [] }));
vi.mock('../plugins/PluginSlotBoundary.js', () => ({ PluginSlotBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('../views/thread-detail/PluginPanelHostLayout.js', () => ({
  PluginPanelHostLayout: ({ pluginId, panelPath, children }: { pluginId: string; panelPath: string; children: ReactNode }) =>
    <section data-testid="shared-host" data-owner={`${pluginId}/${panelPath}`}>{children}</section>
}));
import { AppModulePanel, evictHost, getHost, ModulePanelHost } from './ModulePanelHost.js';

beforeEach(() => {
  h.nav = 'example'; h.path = '/legacy'; h.pluginPanel = false;
  h.modules = [{ id: 'example', title: 'Example', panel: () => <div>Legacy content</div> } as AppModule];
  evictHost('example'); vi.clearAllMocks();
});
afterEach(cleanup);

it('hosts a legacy global panel in the shared side panel and disposes its mount', () => {
  const view = render(<ModulePanelHost />);
  expect(screen.getByTestId('shared-host').dataset.owner).toBe('example/example');
  expect(screen.getByText('Legacy content')).toBeTruthy();
  expect(h.create).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(h.dispose).toHaveBeenCalledTimes(1);
});
it('leaves split-workspace and registered nav panels to their own shared host', () => {
  h.path = '/plugins/example/main';
  const view = render(<ModulePanelHost />);
  expect(view.container.childElementCount).toBe(0);
  h.path = '/legacy'; h.pluginPanel = true;
  view.rerender(<ModulePanelHost />);
  expect(view.container.childElementCount).toBe(0);
});
it('renders nothing for a missing legacy module', () => {
  h.modules = [];
  expect(render(<ModulePanelHost />).container.childElementCount).toBe(0);
});
it('keeps the no-view explanation inside the shared host', () => {
  h.modules = [{ id: 'example', title: 'Example' } as AppModule];
  render(<ModulePanelHost />);
  expect(screen.getByTestId('shared-host').textContent).toContain('Example has no view of its own.');
});
it('renders a compiled pane without nesting a second host', () => {
  const view = render(<AppModulePanel moduleId="example" />);
  expect(screen.getByText('Legacy content')).toBeTruthy();
  expect(screen.queryByTestId('shared-host')).toBeNull();
  view.rerender(<AppModulePanel moduleId="missing" />);
  expect(view.container.childElementCount).toBe(0);
});
it('reuses cached module hosts until eviction', () => {
  const host = getHost('example');
  expect(getHost('example')).toBe(host);
  expect(h.create).toHaveBeenCalledTimes(1);
  evictHost('example');
  expect(h.clear).toHaveBeenCalledWith('example');
  getHost('example');
  expect(h.create).toHaveBeenCalledTimes(2);
});
