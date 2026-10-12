/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';

const state = vi.hoisted(() => ({
  tabs: [] as PluginProjectTabRegistration[],
  desktop: false,
  open: [] as Array<{ pluginId: string; tabId: string; projectId: string }>
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/store', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: [{ id: 'p', name: 'Project', path: '/project' }], terminals: {}, gitStatus: {} }),
  useUi: (select: (state: unknown) => unknown) => select({ selectedTabId: {} }),
  visibleTerminals: () => []
}));
vi.mock('@/modules', () => ({ useProjectTabModules: () => [] }));
vi.mock('@/components/TabBar', () => ({ TabBar: () => null }));
vi.mock('@/components/agentCardActions', () => ({ cliAgentRestartConfirm: () => '' }));
vi.mock('@/components/FindBar', () => ({ FindBar: () => null }));
vi.mock('@/views/agents/AgentsBoard', () => ({ AgentsBoard: () => null }));
vi.mock('@/views/project/ProjectExtensionTab', () => ({ ProjectExtensionTab: () => null }));
vi.mock('@/plugins/PluginSlotBoundary', () => ({ PluginSlotBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/plugins/ProjectStatusbarItems', () => ({ ProjectStatusbarItems: () => null }));
vi.mock('@/plugins/plugin-slots', () => ({
  listProjectTabs: () => state.tabs,
  subscribePluginSlots: () => () => {},
  projectTabView: (tab: PluginProjectTabRegistration) => tab.id
}));
vi.mock('@/lib/app-surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-surface')>()),
  hasDesktopBridge: () => state.desktop
}));
vi.mock('@/plugins/plugin-view-windows', async (importOriginal) => ({
  isPluginViewOpen: (await importOriginal<typeof import('@/plugins/plugin-view-windows')>()).isPluginViewOpen,
  usePluginViewWindows: () => state.open,
  openPluginViewWindow: vi.fn(async () => true),
  closePluginViewWindow: vi.fn(async () => true)
}));
vi.mock('@/views/thread-detail/SplitPaneHeaderActions', () => ({
  SplitPaneHeaderActions: () => <button>Close pane</button>
}));
import { ProjectModePane } from './ProjectModePane.js';

afterEach(() => {
  cleanup();
  state.desktop = false;
  state.open = [];
});
function open(header?: 'custom', detachable?: boolean) {
  state.tabs = [{ id: 'tools', pluginId: 'example', generation: 1, label: 'Tools', header, detachable,
    component: ({ projectId, headerActions }) => <section aria-label="Plugin toolbar">{projectId}{headerActions}</section> }];
  return render(<ProjectModePane projectId="p" mode="tools" paneId="pane" />);
}
it('lets a plugin own its toolbar while retaining the host split controls', () => {
  const view = open('custom');
  expect(view.container.querySelector('.project-topbar')).toBeNull();
  expect(screen.getByRole('region', { name: 'Plugin toolbar' }).contains(screen.getByRole('button', { name: 'Close pane' }))).toBe(true);
});
it('keeps the existing host title and split controls for default project tabs', () => {
  const view = open();
  const header = view.container.querySelector('.project-topbar')!;
  expect(header.textContent).toContain('Tools');
  expect(header.contains(screen.getByRole('button', { name: 'Close pane' }))).toBe(true);
  expect(screen.getByRole('region', { name: 'Plugin toolbar' }).textContent).toBe('p');
});
it('offers a detachable tab its own window from the host title row', () => {
  state.desktop = true;
  const view = open(undefined, true);
  const header = view.container.querySelector('.project-topbar')!;
  expect(header.contains(screen.getByRole('button', { name: 'Open Tools in a new window' }))).toBe(true);
});
it('gives a custom-header detachable tab the window button with the host actions', () => {
  state.desktop = true;
  open('custom', true);
  const toolbar = screen.getByRole('region', { name: 'Plugin toolbar' });
  expect(toolbar.contains(screen.getByRole('button', { name: 'Open Tools in a new window' }))).toBe(true);
  expect(toolbar.contains(screen.getByRole('button', { name: 'Close pane' }))).toBe(true);
});
it('never offers a window for tabs that did not opt in', () => {
  state.desktop = true;
  open();
  expect(screen.queryByRole('button', { name: 'Open Tools in a new window' })).toBeNull();
});
it('shows a placeholder, not the tab, while the tab is open in its own window', () => {
  state.desktop = true;
  state.open = [{ pluginId: 'example', tabId: 'tools', projectId: 'p' }];
  const view = open('custom', true);
  expect(screen.queryByRole('region', { name: 'Plugin toolbar' })).toBeNull();
  expect(screen.getByTestId('plugin-tab-detached').textContent).toContain('Tools is open in its own window');
  const header = view.container.querySelector('.project-topbar')!;
  expect(header.contains(screen.getByRole('button', { name: 'Close pane' }))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Open Tools in a new window' })).toBeNull();
});
