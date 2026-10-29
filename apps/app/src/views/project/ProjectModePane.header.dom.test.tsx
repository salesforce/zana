/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';

const state = vi.hoisted(() => ({
  tabs: [] as PluginProjectTabRegistration[],
  modules: [] as Array<{ id: string; title: string }>,
  desktop: false,
  open: [] as Array<{ pluginId: string; tabId: string; projectId: string }>,
  tabBarProps: [] as Array<{ projectId?: string }>
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/store', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: [{ id: 'p', name: 'Project', path: '/project' }], terminals: {}, gitStatus: {} }),
  useUi: (select: (state: unknown) => unknown) => select({ selectedTabId: {} }),
  visibleTerminals: () => []
}));
vi.mock('@/modules', () => ({ useProjectTabModules: () => state.modules }));
vi.mock('@/components/TabBar', () => ({ TabBar: (props: { projectId?: string }) => { state.tabBarProps.push(props); return null; } }));
vi.mock('@/components/agentCardActions', () => ({ cliAgentRestartConfirm: () => '' }));
vi.mock('@/components/FindBar', () => ({ FindBar: () => null }));
vi.mock('@/views/agents/AgentsBoard', () => ({ AgentsBoard: () => null }));
vi.mock('@/views/project/ProjectExtensionTab', () => ({ ProjectExtensionTab: ({ moduleId }: { moduleId: string }) => <section aria-label="Module tab">{moduleId}</section> }));
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
  state.modules = [];
});
function open(header?: 'custom', detachable?: boolean, statusbar?: 'hidden') {
  state.tabs = [{ id: 'tools', pluginId: 'example', generation: 1, label: 'Tools', header, detachable, statusbar,
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
  expect(view.container.querySelector('.statusbar')?.textContent).toContain('/project');
  const header = view.container.querySelector('.project-topbar')!;
  expect(header.textContent).toContain('Tools');
  expect(header.contains(screen.getByRole('button', { name: 'Close pane' }))).toBe(true);
  expect(screen.getByRole('region', { name: 'Plugin toolbar' }).textContent).toBe('p');
});
it('omits the project footer only for a tab that explicitly hides it', () => {
  const view = open('custom', false, 'hidden');
  expect(view.container.querySelector('.statusbar')).toBeNull();
  expect(screen.getByRole('region', { name: 'Plugin toolbar' })).toBeTruthy();
  view.rerender(<ProjectModePane projectId="p" mode="agents" paneId="pane" />);
  expect(view.container.querySelector('.statusbar')?.textContent).toContain('/project');
  view.rerender(<ProjectModePane projectId="p" mode="tools" paneId="pane" />);
  expect(view.container.querySelector('.statusbar')).toBeNull();
});
it('keeps the footer hidden on the opted-in tab detached placeholder', () => {
  state.desktop = true;
  state.open = [{ pluginId: 'example', tabId: 'tools', projectId: 'p' }];
  const view = open('custom', true, 'hidden');
  expect(screen.getByTestId('plugin-tab-detached')).toBeTruthy();
  expect(view.container.querySelector('.statusbar')).toBeNull();
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
it('gives a built-in module tab the same host side panel as plugin tabs', () => {
  state.tabs = [];
  state.modules = [{ id: 'notes', title: 'Notes' }];
  const view = render(<ProjectModePane projectId="p" mode="notes" paneId="pane" />);
  const layout = view.container.querySelector('[data-testid="plugin-panel-host-layout"]')!;
  expect(layout).toBeTruthy();
  expect(layout.contains(screen.getByRole('region', { name: 'Module tab' }))).toBe(true);
  expect(screen.getByRole('region', { name: 'Module tab' }).textContent).toBe('notes');
});
it('tells the terminal tab strip which project it belongs to, so Archive can word its History promise', () => {
  state.tabs = [];
  state.tabBarProps = [];
  render(<ProjectModePane projectId="p" mode="terminals" paneId="pane" />);
  expect(state.tabBarProps.at(-1)?.projectId).toBe('p');
});
