// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  setMock: vi.fn()
}));

vi.mock('@/lib/settings-search/reveal', async (orig) => ({
  ...(await orig<object>()),
  useSettingsTargetReveal: () => ({ target: null, reveal: null })
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: vi.fn(async () => ({ theme: 'dark' })), set: (p: unknown) => h.setMock(p), onChanged: () => () => {} },
  pluginApps: { list: vi.fn(async () => []), onChanged: () => () => {} },
  app: { homedir: vi.fn(async () => '/home/u') },
  openers: { openIn: vi.fn(async () => undefined) }
}, peerLinks: { list: vi.fn(async () => ({ links: [] })) } }));

const { stub } = await vi.hoisted(async () => {
  const React = await import('react');
  return {
    stub: (name: string) => (props: any) => {
      h.props[name] = props;
      return React.createElement('p', null, `tab-${name}`);
    }
  };
});
vi.mock('@/views/settings/PromptsView', () => ({ PromptsTab: stub('prompts') }));
vi.mock('@/components/settings/ScopeControl', () => ({ ScopeControl: stub('scope') }));
vi.mock('@/views/settings/GlobalView', () => ({ GlobalTab: stub('global') }));
vi.mock('@/views/settings/TerminalSettingsView', () => ({ TerminalTab: stub('terminal') }));
vi.mock('@/views/settings/AgentsSettingsView', () => ({ AgentsTab: stub('agents') }));
vi.mock('@/views/settings/HarnessView', () => ({ HarnessTab: stub('harness') }));
vi.mock('@/views/settings/EditorView', () => ({ EditorTab: stub('editor') }));
vi.mock('@/views/settings/ExperimentalView', () => ({ ExperimentalTab: stub('experimental') }));
vi.mock('@/views/settings/DevelopmentView', () => ({ DevelopmentView: stub('development') }));
vi.mock('@/views/settings/AboutView', () => ({ AboutTab: stub('about') }));
vi.mock('@/views/settings/MachinesSettingsView', () => ({ MachinesTab: stub('machines') }));
vi.mock('@/views/settings/ConnectivityView', () => ({ ConnectivityTab: stub('connectivity') }));
vi.mock('@/views/settings/PhoneSettingsView', () => ({ PhoneTab: stub('phone') }));
vi.mock('@/views/settings/RemoteAccessView', () => ({ RemoteAccessView: stub('remote-access') }));
vi.mock('@/views/settings/PeersSettingsView', () => ({ PeersSettingsView: stub('peers') }));
vi.mock('@/views/settings/InboxSettingsView', () => ({ InboxSettingsTab: stub('inbox') }));
vi.mock('@/views/settings/KeyboardSettingsSection', () => ({ KeyboardSettingsSection: stub('keyboard') }));
vi.mock('@/views/settings/ComposerSettingsView', () => ({ ComposerSettingsView: stub('composer') }));
vi.mock('@/components/settings/BrowserSettingsSection', () => ({ BrowserSettingsSection: stub('browser') }));
vi.mock('@/views/settings/ProjectSettingsView', () => ({ ProjectTab: stub('project') }));
vi.mock('@/views/settings/PersonasView', () => ({ PersonasPanel: stub('personas') }));
vi.mock('@/views/settings/SquadsView', () => ({ SquadsPanel: stub('squads') }));
vi.mock('@/views/settings/UsageView', () => ({ UsagePanel: stub('usage') }));
vi.mock('./PerformanceSettingsView.js', () => ({ PerformanceSettingsView: stub('performance') }));

import { useData, useUi } from '@/store';
import type { SettingsTab } from '@/store';
import { SettingsView } from './SettingsView';

const mount = () => render(<MemoryRouter initialEntries={['/settings']}><SettingsView /></MemoryRouter>);

beforeEach(() => {
  h.props = {};
  h.setMock.mockReset();
  h.setMock.mockImplementation(async (p: object) => ({ theme: 'dark', ...p }));
});
afterEach(cleanup);

const TABS: SettingsTab[] = [
  'global', 'composer', 'keyboard', 'terminal', 'agents', 'prompts', 'harness', 'editor',
  'personas', 'squads', 'usage', 'performance', 'development', 'experimental', 'about', 'machines',
  'connectivity', 'remote-access', 'peers', 'phone', 'inbox', 'browser', 'project'
];

it.each(TABS.filter((t) => t !== 'peers'))('renders the %s tab', async (tab) => {
  useUi.setState({ settingsTab: tab, settingsAnchor: null });
  mount();
  expect(await screen.findByText(`tab-${tab}`)).toBeTruthy();
  if (tab === 'remote-access') expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  else expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  if (tab === 'project') {
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Project settings');
    expect(h.props.scope.allowGlobal).toBe(false);
  }
});

it('uses wide layout only for catalogue tabs', async () => {
  useUi.setState({ settingsTab: 'usage', settingsAnchor: null });
  const { container } = mount();
  await screen.findByText('tab-usage');
  expect(container.querySelector('.settings-inner--wide')).not.toBeNull();
  cleanup();
  useUi.setState({ settingsTab: 'about' });
  const second = mount();
  await screen.findByText('tab-about');
  expect(second.container.querySelector('.settings-inner--wide')).toBeNull();
});

it('saves Development settings as instance config in a centered page', async () => {
  useUi.setState({ settingsTab: 'development', settingsAnchor: null });
  const { container } = mount();
  await screen.findByText('tab-development');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Development');
  expect(container.querySelector('.settings-inner--wide')).toBeNull();
  expect(screen.queryByText('tab-scope')).toBeNull();
  await act(async () => { await h.props.development.onUpdate({ pluginDevelopmentEnabled: true }); });
  expect(h.setMock).toHaveBeenCalledWith({ pluginDevelopmentEnabled: true });
  expect(h.props.development.config.pluginDevelopmentEnabled).toBe(true);
  expect(screen.getByText('Saved')).toBeTruthy();
});

it('applies config patches to the store and flashes Saved', async () => {
  useUi.setState({ settingsTab: 'global', settingsAnchor: null });
  mount();
  await screen.findByText('tab-global');
  const patch: Record<string, unknown> = {
    fontSize: 15,
    terminalTheme: 'solar',
    inboxGuidanceEnabled: true,
    terminalWheelArrowsEnabled: true,
    heartbeatEnabled: true,
    goalsEnabled: true,
    cliRemoteToolProxyEnabled: true,
    followUpsEnabled: true,
    catchUpSummaryEnabled: true,
    classicSessionViewEnabled: true,
    threadTabsEnabled: false,
    dockableThreadToolsEnabled: false,
    catchUpSummaryDelaySeconds: 9,
    feedNoiseClassifierEnabled: true,
    terminalClipboardWriteEnabled: true,
    terminalCtrlVPasteEnabled: true,
    structuredQuestionsEnabled: true,
    worktreeIsolationDefault: true,
    agentListNeedsYouFromTriage: true,
    voiceInputEnabled: true,
    harnessCursorEnabled: true,
    harnessCodexEnabled: true,
    harnessPiEnabled: true,
    harnessOpenCodeEnabled: true,
    harnessGrokEnabled: true,
    harnessMastracodeEnabled: true,
    harnessAfcodeEnabled: true,
    nativeAgentDiscoveryEnabled: true,
    microVmEnabled: true,
    teamJobLaunchEnabled: true,
    composerShowCliAgent: true,
    composerShowModern: true,
    composerShowAutonomousTeam: true,
    openerHiddenTargets: ['cursor'],
    theme: 'light'
  };
  const setters = [
    'setFontSize', 'setTerminalTheme', 'setInboxGuidanceEnabled', 'setTerminalWheelArrowsEnabled',
    'setHeartbeatEnabled', 'setGoalsEnabled', 'setCliRemoteToolProxyEnabled', 'setFollowUpsEnabled',
    'setCatchUpSummaryEnabled', 'setClassicSessionViewEnabled', 'setThreadTabsEnabled', 'setDockableThreadToolsEnabled', 'setCatchUpSummaryDelaySeconds',
    'setFeedNoiseClassifierEnabled', 'setTerminalClipboardWriteEnabled', 'setTerminalCtrlVPasteEnabled',
    'setStructuredQuestionsEnabled',
    'setWorktreeIsolationDefault', 'setAgentListNeedsYouFromTriage', 'setVoiceInputEnabled',
    'setHarnessCursorEnabled', 'setHarnessCodexEnabled', 'setHarnessPiEnabled', 'setHarnessOpenCodeEnabled',
    'setHarnessGrokEnabled', 'setHarnessMastracodeEnabled', 'setHarnessAfcodeEnabled', 'setMicroVmEnabled',
    'setTeamJobLaunchEnabled', 'setComposerShowCliAgent', 'setComposerShowModern',
    'setComposerShowAutonomousTeam', 'setOpenerHiddenTargets'
  ] as const;
  const spies = setters.map((name) => {
    const fn = vi.fn();
    (useData.getState() as any)[name] = fn;
    useData.setState({ [name]: fn } as any);
    return fn;
  });
  await act(async () => { await h.props.global.onUpdate(patch); });
  expect(h.setMock).toHaveBeenCalledWith(patch);
  for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  expect(useData.getState().setThreadTabsEnabled).toHaveBeenCalledWith(false);
  expect(useData.getState().setDockableThreadToolsEnabled).toHaveBeenCalledWith(false);
  expect(useData.getState().nativeAgentDiscoveryEnabled).toBe(true);
  expect(await screen.findByText('Saved')).toBeTruthy();
  // second save re-arms the timer path
  await act(async () => { await h.props.global.onUpdate({}); });
  expect(screen.getByText('Saved')).toBeTruthy();
});

it('swallows config.set failures without flashing Saved', async () => {
  useUi.setState({ settingsTab: 'global', settingsAnchor: null });
  mount();
  await screen.findByText('tab-global');
  h.setMock.mockRejectedValueOnce(new Error('nope'));
  await act(async () => { await h.props.global.onUpdate({ fontSize: 12 }); });
  expect(screen.queryByText('Saved')).toBeNull();
});

it('rethrows a config.set failure when the caller asks for it', async () => {
  useUi.setState({ settingsTab: 'agents', settingsAnchor: null });
  mount();
  await screen.findByText('tab-agents');
  h.setMock.mockRejectedValueOnce(new Error('nope'));
  await act(async () => {
    await expect(h.props.agents.onUpdate({ fontSize: 12 }, { throwOnError: true })).rejects.toThrow('nope');
  });
  expect(screen.queryByText('Saved')).toBeNull();
});

it('clears the Saved flash after its timeout and on unmount', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    useUi.setState({ settingsTab: 'global', settingsAnchor: null });
    const { unmount } = mount();
    await screen.findByText('tab-global');
    await act(async () => { await h.props.global.onUpdate({}); });
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1700); });
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
    await act(async () => { await h.props.global.onUpdate({}); });
    unmount();
  } finally {
    vi.useRealTimers();
  }
});

it('opens project files through the homedir-resolved path', async () => {
  const { product } = await import('../../lib/product-client.js');
  useUi.setState({ settingsTab: 'project', settingsAnchor: null });
  mount();
  await screen.findByText('tab-project');
  await waitFor(() => expect(product.app.homedir).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  h.props.project.onOpen('~/a.txt');
  expect(product.openers.openIn).toHaveBeenCalledWith('cursor', '/home/u/a.txt');
  await act(async () => { h.props.project.onSaved(); });
  expect(screen.getByText('Saved')).toBeTruthy();
});
