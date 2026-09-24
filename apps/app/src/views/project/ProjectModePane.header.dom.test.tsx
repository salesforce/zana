/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';

const state = vi.hoisted(() => ({ tabs: [] as PluginProjectTabRegistration[] }));
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
vi.mock('@/views/thread-detail/SplitPaneHeaderActions', () => ({
  SplitPaneHeaderActions: () => <button>Close pane</button>
}));
import { ProjectModePane } from './ProjectModePane.js';

afterEach(cleanup);
function open(header?: 'custom') {
  state.tabs = [{ id: 'tools', pluginId: 'example', generation: 1, label: 'Tools', header,
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
