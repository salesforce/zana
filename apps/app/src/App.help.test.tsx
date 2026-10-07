// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { useHelp } from './components/help/HelpProvider.js';

const fixtures = vi.hoisted(() => ({
  compact: false, unread: 0, drawer: vi.fn(),
  pluginChanged: null as null | ((entries: unknown[]) => void),
  recoverCatalogs: vi.fn(), reconcilePlugins: vi.fn().mockResolvedValue(undefined),
  unsubscribePlugins: vi.fn()
}));
vi.mock('./lib/product-client.js', () => ({ product: new Proxy({}, { get: (_target, surface) => new Proxy({}, {
  get: (_target, method) => String(surface) === 'pluginApps' && String(method) === 'onChanged' ? (callback: (entries: unknown[]) => void) => {
    fixtures.pluginChanged = callback;
    return fixtures.unsubscribePlugins;
  } : String(method).startsWith('on') ? () => () => {} : async () => []
}) }) }));
vi.mock('./components/thread/pickers/thread-model-catalog.js', async importOriginal => ({
  ...await importOriginal<object>(), recoverUnavailableModelCatalogs: fixtures.recoverCatalogs
}));
vi.mock('./store.js', async importOriginal => ({ ...await importOriginal<object>(),
  useUnreadInboxCount: () => fixtures.unread, installInboxCrossWindowSync: () => () => {}
}));
vi.mock('./hooks/useRouteSync.js', () => ({ useRouteSync: () => {} }));
vi.mock('./hooks/useRouteState.js', () => ({ useRouteState: () => ({ nav: 'home', focusedProjectId: null }) }));
vi.mock('./hooks/useShellChromeState.js', () => ({ useShellChromeState: () => ({ platform: 'linux' }) }));
vi.mock('./hooks/useCompactLayout.js', () => ({ useCompactLayout: () => fixtures.compact }));
vi.mock('./hooks/useAgentCards.js', () => ({ useFavoriteCount: () => 0 }));
vi.mock('./lib/product-ws.js', () => ({ waitForProductWsOpen: async () => {} }));
vi.mock('./shortcuts.js', () => ({ installShortcuts: () => () => {} }));
vi.mock('./stores/agent-board-moves.js', () => ({ installAgentBoardMoves: () => () => {} }));
vi.mock('./components/thread/secondary-panel/useThreadOpenFileSignal.js', () => ({ installThreadOpenFileSignals: () => () => {} }));
vi.mock('./components/thread/secondary-panel/useThreadOpenTerminalSignal.js', () => ({ useCliAgentTerminalSignal: () => {} }));
vi.mock('./modules/index.js', () => { const modules: never[] = []; return { useMergedModules: () => modules }; });
vi.mock('./modules/loader.js', () => ({ initExtensionModules: async () => {}, reconcileExtensionModules: async () => {} }));
vi.mock('./plugins/plugin-app-loader.js', () => ({ initPluginApps: async () => {}, reconcilePluginApps: fixtures.reconcilePlugins }));
vi.mock('./components/MobileShellChrome.js', () => ({
  useMobileNavigation: () => ({ isCompact: fixtures.compact, drawerOpen: true, setDrawerOpen: fixtures.drawer }),
  MobileShellReporter: () => null,
  MobileNavDrawer: ({ children, shortcuts, enabled }: any) => <>{children}{enabled ? shortcuts : null}</>
}));
vi.mock('./components/Sidebar.js', () => ({ Sidebar: () => {
  const help = useHelp(), navigate = useNavigate();
  return <><button onClick={() => help.explore('sidebar')}>Explore project navigation</button>
    <output data-testid="active-hint">{help.activeSurface}</output>
    <button onClick={() => navigate('/?tab=next')}>Change page query</button></>;
} }));

// Keep the shell and its HelpProvider real while unrelated panels and modal
// hosts are absent. Their effects and full IPC behavior have Electron coverage.
const emptyComponents: Record<string, string[]> = {
  './components/history/ConversationHistoryDialog.js': ['ConversationHistoryDialog'],
  './components/MobileAgentNavigation.js': ['MobileAgentNavigation'],
  './components/SidebarTriggerOverlay.js': ['SidebarTriggerOverlay'],
  './components/MobileSettingsBack.js': ['MobileSettingsBack'],
  './components/GlobalAgentLauncher.js': ['GlobalAgentLauncher'],
  './components/listpane/SettingsPane.js': ['SettingsPane'],
  './components/listpane/ExtensionsPane.js': ['ExtensionsPane'],
  '@/views/project/ProjectView': ['ProjectView'],
  './components/TerminalSurface.js': ['TerminalSurface'],
  '@/views/SplitWorkspaceRoute': ['SplitWorkspaceRoute'],
  './components/ProjectScopedNav.js': ['ProjectScopedNav'],
  '@/views/settings/SettingsView': ['SettingsView'],
  '@/views/extensions/ExtensionsView': ['ExtensionsView'],
  '@/views/follow-ups/FollowUpsView': ['FollowUpsView'],
  '@/views/suggestions/SuggestionsView': ['SuggestionsView'],
  '@/views/project/GoalsPanel': ['GoalsPanel'],
  './components/SetupChecklist.js': ['SetupChecklistHost'],
  './plugins/PluginContentScriptsHost.js': ['PluginContentScriptsHost'],
  './plugins/PluginThemesHost.js': ['PluginThemesHost'],
  './modules/ModulePanelHost.js': ['ModulePanelHost'],
  './modules/ModuleBackgroundHost.js': ['ModuleBackgroundHost'],
  ...Object.fromEntries(['CommandPalette', 'QuickOpen', 'ResumePicker', 'SearchPanel', 'ShortcutsHelp',
    'AgentTerminalModal', 'ThreadModal', 'FavoriteAgentsDrawer', 'NotificationsDrawer', 'HostInstallDrawer',
    'Walkthrough', 'Toaster', 'PendingLaunches', 'HostDialogs', 'UpdateBanner', 'SponsorNudge',
    'WhatsNewModal', 'ExtensionConsent', 'HashNavigationScroll'].map(name => [`./components/${name}.js`, [name]]))
};
let App: typeof import('./App.js')['App'];
let store: typeof import('./store.js');
beforeAll(async () => {
  for (const [path, names] of Object.entries(emptyComponents)) {
    vi.doMock(path, () => Object.fromEntries(names.map(name => [name, ({ children }: any) => <>{children}</>])));
  }
  store = await import('./store.js');
  store.useData.setState({ init: vi.fn().mockResolvedValue(undefined), projects: [], terminals: {} });
  App = (await import('./App.js')).App;
});
afterEach(() => {
  cleanup(); localStorage.clear(); fixtures.drawer.mockClear();
  fixtures.pluginChanged = null;
  fixtures.recoverCatalogs.mockClear(); fixtures.reconcilePlugins.mockClear(); fixtures.unsubscribePlugins.mockClear();
});

it('retries unavailable model catalogs on plugin changes and ignores late pushes after unmount', async () => {
  fixtures.compact = false; fixtures.unread = 0;
  const view = render(<MemoryRouter><App /></MemoryRouter>);
  const notify = fixtures.pluginChanged!;
  expect(notify).toBeTypeOf('function');
  const entries = [{ id: 'reconnected-provider' }];
  await act(async () => { notify(entries); });
  expect(fixtures.recoverCatalogs).toHaveBeenCalledOnce();
  expect(fixtures.reconcilePlugins).toHaveBeenCalledWith(entries);
  view.unmount();
  expect(fixtures.unsubscribePlugins).toHaveBeenCalled();
  await act(async () => { notify([]); });
  expect(fixtures.recoverCatalogs).toHaveBeenCalledOnce();
  expect(fixtures.reconcilePlugins).toHaveBeenCalledOnce();
});

it('shares Help between the titlebar and navigation and clears exploration on query navigation', () => {
  fixtures.compact = false; fixtures.unread = 0;
  render(<MemoryRouter><App /></MemoryRouter>);
  const toggle = screen.getByTestId('titlebar-help-toggle');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByText('Explore project navigation'));
  expect(screen.getByTestId('active-hint').textContent).toBe('sidebar');
  fireEvent.click(screen.getByText('Change page query'));
  expect(screen.getByTestId('active-hint').textContent).toBe('');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByTestId('mobile-help-toggle')).toBeNull();
});
it.each([0, 2, 105])('shares the mobile Help state and closes navigation for %s unread notifications', unread => {
  fixtures.compact = true; fixtures.unread = unread;
  const notifications = vi.fn(); store.useUi.setState({ toggleNotificationsDrawer: notifications });
  render(<MemoryRouter><App /></MemoryRouter>);
  fireEvent.click(screen.getByTestId('mobile-help-toggle'));
  expect(screen.getByTestId('titlebar-help-toggle').getAttribute('aria-pressed')).toBe('false');
  const drawerButton = screen.getAllByRole('button', { name: unread ? `Notifications — ${unread} unread` : 'Notifications' }).find(button => button.textContent?.includes('Notifications'))!;
  fireEvent.click(drawerButton);
  expect(fixtures.drawer).toHaveBeenCalledWith(false);
  expect(notifications).toHaveBeenCalledOnce();
  if (unread) expect(drawerButton.textContent).toContain(unread > 99 ? '99+' : String(unread));
});
