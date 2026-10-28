// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { useHelp } from './components/help/HelpProvider.js';

const fixtures = vi.hoisted(() => ({
  compact: false, unread: 0, drawer: vi.fn(),
  pluginChanged: null as null | ((entries: unknown[]) => void),
  navigateFromMain: null as null | ((path: string) => void),
  menuEvent: null as null | ((event: string) => void),
  recoverCatalogs: vi.fn(), recoverStale: vi.fn(), recoverAfterWake: vi.fn(), offWake: vi.fn(),
  onWake: null as null | (() => void), reconcilePlugins: vi.fn().mockResolvedValue(undefined),
  unsubscribePlugins: vi.fn()
}));
vi.mock('./lib/product-client.js', () => ({ product: new Proxy({}, { get: (_target, surface) => new Proxy({}, {
  get: (_target, method) => String(surface) === 'pluginApps' && String(method) === 'onChanged' ? (callback: (entries: unknown[]) => void) => {
    fixtures.pluginChanged = callback;
    return fixtures.unsubscribePlugins;
  } : String(surface) === 'terminals' && String(method) === 'onWake' ? (callback: () => void) => {
    fixtures.onWake = callback;
    return fixtures.offWake;
  } : String(surface) === 'app' && String(method) === 'onMenuEvent' ? (callback: (event: string) => void) => {
    fixtures.menuEvent = callback;
    return () => {};
  } : String(surface) === 'windows' && String(method) === 'onNavigate' ? (callback: (path: string) => void) => {
    fixtures.navigateFromMain = callback;
    return () => {};
  } : String(method).startsWith('on') ? () => () => {} : async () => []
}) }) }));
vi.mock('./components/thread/pickers/thread-model-catalog.js', async importOriginal => ({
  ...await importOriginal<object>(), recoverUnavailableModelCatalogs: fixtures.recoverCatalogs,
  recoverStaleModelCatalogs: fixtures.recoverStale, recoverModelCatalogsAfterWake: fixtures.recoverAfterWake
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
vi.mock('./components/ThreadModal.js', () => ({ ThreadModal: () => <div data-testid="thread-modal-shell" /> }));
vi.mock('./modules/index.js', () => { const modules: never[] = []; return { useMergedModules: () => modules }; });
vi.mock('./modules/loader.js', () => ({ initExtensionModules: async () => {}, reconcileExtensionModules: async () => {} }));
vi.mock('./plugins/plugin-app-loader.js', () => ({ initPluginApps: async () => {}, reconcilePluginApps: fixtures.reconcilePlugins }));
vi.mock('./components/MobileShellChrome.js', () => ({
  useMobileNavigation: () => ({ isCompact: fixtures.compact, drawerOpen: true, setDrawerOpen: fixtures.drawer }),
  MobileShellReporter: () => null,
  MobileNavDrawer: ({ children, shortcuts, enabled }: any) => <>{children}{enabled ? shortcuts : null}</>
}));
vi.mock('./components/Sidebar.js', () => ({ Sidebar: () => {
  const help = useHelp(), navigate = useNavigate(), location = useLocation();
  return <><button onClick={() => help.explore('sidebar')}>Explore project navigation</button>
    <output data-testid="location">{location.pathname + location.search}</output>
    <output data-testid="active-hint">{help.activeSurface}</output>
    <button onClick={() => navigate('/?tab=next')}>Change page query</button></>;
} }));

// Keep the shell and its HelpProvider real while unrelated panels and modal
// hosts are absent. Their effects and full IPC behavior have Electron coverage.
const emptyComponents: Record<string, string[]> = {
  './components/SessionMoveDialog.js': ['SessionMoveDialog'],
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
  ...Object.fromEntries(['CommandPalette', 'QuickOpen', 'ResumePicker', 'SearchPanel',
    'AgentTerminalModal', 'FavoriteAgentsDrawer', 'NotificationsDrawer', 'HostInstallDrawer',
    'Walkthrough', 'Toaster', 'PendingLaunches', 'HostDialogs', 'UpdateBanner', 'SponsorNudge',
    'WhatsNewModal', 'ExtensionConsent', 'HashNavigationScroll'].map(name => [`./components/${name}.js`, [name]]))
};
let App: typeof import('./App.js')['App'];
let store: typeof import('./store.js');
beforeAll(async () => {
  for (const [path, names] of Object.entries(emptyComponents)) {
    vi.doMock(path, () => Object.fromEntries(names.map(name => [name, ({ children }: any) => <>{children}</>])));
  }
  vi.doMock('./components/TitlebarThreadTabs.js', () => ({ TitlebarThreadTabs: () => <div data-testid="thread-tabs-shell" /> }));
  vi.doMock('./components/ShortcutsHelp.js', () => ({
    ShortcutsHelp: ({ ctrlVPasteEnabled }: { ctrlVPasteEnabled?: boolean }) => <div data-testid="shortcuts-help">{String(ctrlVPasteEnabled)}</div>
  }));
  store = await import('./store.js');
  store.useData.setState({ init: vi.fn().mockResolvedValue(undefined), projects: [], terminals: {} });
  App = (await import('./App.js')).App;
});
afterEach(() => {
  cleanup(); localStorage.clear(); fixtures.drawer.mockClear();
  fixtures.pluginChanged = null;
  fixtures.recoverCatalogs.mockClear(); fixtures.recoverStale.mockClear(); fixtures.recoverAfterWake.mockClear(); fixtures.offWake.mockClear(); fixtures.reconcilePlugins.mockClear(); fixtures.unsubscribePlugins.mockClear();
});

it('keeps a project focus until the project list has loaded, then drops a removed one', () => {
  const original = store.useUi.getState();
  store.useData.setState({ projects: [], configLoaded: false });
  store.useUi.setState({ focusedProjectId: 'p-removed' });
  try {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(store.useUi.getState().focusedProjectId).toBe('p-removed');
    act(() => store.useData.setState({ configLoaded: true }));
    expect(store.useUi.getState().focusedProjectId).toBeNull();
  } finally {
    store.useUi.setState({ focusedProjectId: original.focusedProjectId, nav: original.nav });
    store.useData.setState({ configLoaded: false });
  }
});

it('switches titlebar navigation live and retains compact chrome', () => {
  fixtures.compact = false;
  store.useData.setState({ threadTabsEnabled: true });
  const view = render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByTestId('thread-tabs-shell')).toBeTruthy();
  act(() => store.useData.setState({ threadTabsEnabled: false }));
  expect(screen.queryByTestId('thread-tabs-shell')).toBeNull();
  act(() => store.useData.setState({ threadTabsEnabled: true }));
  expect(screen.getByTestId('thread-tabs-shell')).toBeTruthy();
  fixtures.compact = true;
  view.rerender(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.queryByTestId('thread-tabs-shell')).toBeNull();
  fixtures.compact = false;
});

it('promotes an existing thread inspector when thread tabs are enabled', async () => {
  fixtures.compact = false;
  const original = store.useUi.getState();
  store.useData.setState({ threadTabsEnabled: false, classicSessionViewEnabled: false });
  store.useUi.setState({ nav: 'agents', focusedProjectId: null, threadModal: { threadId: 'tabs-probe' } });
  const view = render(<MemoryRouter initialEntries={['/agents']}><App /></MemoryRouter>);
  try {
    expect(screen.getByTestId('thread-modal-shell')).toBeTruthy();
    await act(async () => store.useData.setState({ threadTabsEnabled: true }));
    expect(screen.queryByTestId('thread-modal-shell')).toBeNull();
    expect(store.useUi.getState().threadModal).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/threads/tabs-probe');
  } finally {
    view.unmount();
    store.useUi.setState(original);
    store.useData.setState({ threadTabsEnabled: true });
  }
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

it('native menu items reach the same store actions as their shortcuts', async () => {
  const actions = { toggleSettings: vi.fn(), setNav: vi.fn(), setPaletteOpen: vi.fn(), setShortcutsOpen: vi.fn() };
  const original = store.useUi.getState();
  store.useUi.setState({ ...actions, selectedProjectId: null, nav: 'home', shortcutsOpen: false });
  const view = render(<MemoryRouter><App /></MemoryRouter>);
  try {
    act(() => {
      for (const event of ['app:openSettings', 'app:toggleInbox', 'app:openPalette', 'app:openShortcuts',
        'app:toggleProjectView', 'app:newClaudeTab', 'app:reopenTab', 'app:closeTab']) fixtures.menuEvent!(event);
    });
    // Settings… shares ⌘,'s toggle, so drilled in it opens Project settings too.
    expect(actions.toggleSettings).toHaveBeenCalledOnce();
    expect(actions.setNav).toHaveBeenCalledWith('inbox');
    expect(actions.setPaletteOpen).toHaveBeenCalledWith(true);
    expect(actions.setShortcutsOpen).toHaveBeenCalledWith(true);
  } finally {
    view.unmount();
    store.useUi.setState(original);
  }
});

it('recovers model catalogs when the window becomes visible or the machine wakes', async () => {
  fixtures.compact = false; fixtures.unread = 0;
  const view = render(<MemoryRouter><App /></MemoryRouter>);
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  try {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixtures.recoverStale).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixtures.recoverStale).toHaveBeenCalledOnce();
    expect(fixtures.onWake).toBe(fixtures.recoverAfterWake);
    view.unmount();
    expect(fixtures.offWake).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixtures.recoverStale).toHaveBeenCalledOnce();
  } finally {
    visibility.mockRestore();
  }
});

it('passes the live "Ctrl+V pastes" setting to the shortcuts help', () => {
  fixtures.compact = false; fixtures.unread = 0;
  store.useUi.setState({ shortcutsOpen: true });
  store.useData.setState({ terminalCtrlVPasteEnabled: false });
  try {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByTestId('shortcuts-help').textContent).toBe('false');
    act(() => { store.useData.setState({ terminalCtrlVPasteEnabled: true }); });
    expect(screen.getByTestId('shortcuts-help').textContent).toBe('true');
  } finally {
    store.useUi.setState({ shortcutsOpen: false });
  }
});

it('follows links that a plugin view window routes to the main window', async () => {
  fixtures.compact = false; fixtures.unread = 0;
  render(<MemoryRouter><App /></MemoryRouter>);
  await act(async () => { fixtures.navigateFromMain!('/settings?tab=plugins'); });
  expect(screen.getByTestId('location').textContent).toBe('/settings?tab=plugins');
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
