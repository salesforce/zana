// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zanaLogo from '../../assets/zana-favicon.svg';
const api = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), changed: vi.fn(), json: vi.fn(), off: vi.fn(), list: vi.fn(), add: vi.fn(), refresh: vi.fn(),
  plugins: vi.fn(), appsChanged: vi.fn(), navigate: vi.fn(), ui: vi.fn(), desktop: true, scoped: false, configLoaded: true,
  packs: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: api.get, set: api.set, onChanged: api.changed },
  marketplaces: { list: api.list, add: api.add, refresh: api.refresh },
  pluginApps: { list: api.plugins, onChanged: api.appsChanged }
} }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.json }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => api.desktop }));
vi.mock('../../lib/windowScope.js', () => ({ isScopedWindow: () => api.scoped }));
vi.mock('../../lib/app-navigate.js', () => ({ appNavigate: api.navigate }));
vi.mock('../../store.js', () => ({ useData: (fn: (s: object) => unknown) => fn({ configLoaded: api.configLoaded }), useUi: { setState: api.ui } }));
vi.mock('../../views/extensions/PluginPacksCollection.js', () => ({ PluginPacksCollection: (props: {
  marketplaceSource: string; footerTarget?: HTMLElement | null; onInstalled: (value: object) => void; onReviewChange: (open: boolean) => void
}) => { api.packs(props); const action = <button onClick={() => props.onInstalled({ identity: { packId: 'starter' }, members: [
  { pluginId: 'tool', selected: true, status: 'installed' }, { pluginId: 'optional', selected: false, status: 'skipped' }
] })}>Install fixture bundle</button>; return props.footerTarget ? createPortal(action, props.footerTarget) : action; } }));
import { Onboarding, OnboardingHost, OnboardingSettingsAction } from './Onboarding.js';
import { useOnboarding } from './onboarding-store.js';
const profile = { id: 'employees', organization: 'Example', question: 'Are you an Example employee?', prerequisite: 'Connect to the VPN and sign in to Git.', marketplaceSource: 'path:/fixture' };
const progress = { version: 1 as const, profileId: profile.id, audience: 'organization' as const, step: 'marketplace' as const };
beforeEach(() => {
  vi.resetAllMocks(); api.desktop = true; api.scoped = false; api.configLoaded = true;
  api.set.mockImplementation(async patch => patch); api.get.mockResolvedValue({}); api.changed.mockReturnValue(api.off);
  api.json.mockResolvedValue({ profile }); api.list.mockResolvedValue([]); api.add.mockResolvedValue({ source: 'path:/fixture', lastError: null });
  api.refresh.mockResolvedValue({ source: 'path:/fixture', lastError: null }); api.plugins.mockResolvedValue([]); api.appsChanged.mockReturnValue(api.off);
  useOnboarding.setState({ loaded: true, profile, progress: undefined, open: true, error: null });
});
afterEach(cleanup);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
it('keeps the welcome screen focused on the audience choice and one skip action', () => {
  render(<Onboarding profile={profile} />);
  const logo = screen.getByRole('img', { name: 'Zana logo' });
  expect(logo.getAttribute('src')).toBe(zanaLogo);
  expect(logo.getAttribute('width')).toBe('40');
  expect(logo.getAttribute('height')).toBe('40');
  expect(screen.getAllByRole('button', { name: 'Skip for now' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Change setup choice' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Finish later' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Yes, set up Example tools' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'No, continue with general setup' })).toBeTruthy();
});
it('saves completion before opening the installed tools collection', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'connections', pluginIds: ['tool'] } });
  api.plugins.mockResolvedValue([{ id: 'tool', name: 'Tool', status: 'running' }]);
  render(<Onboarding profile={profile} />);
  await screen.findByText('Tool');
  click('Open Example tools');
  await waitFor(() => expect(api.navigate).toHaveBeenCalledWith('/extensions/plugins'));
  expect(useOnboarding.getState().progress).toMatchObject({ step: 'complete', pluginIds: ['tool'] });
  expect(useOnboarding.getState().open).toBe(false);
});
it('keeps the final action recoverable if saving completion fails', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'connections', pluginIds: [] } });
  api.set.mockRejectedValueOnce(new Error('Disk full'));
  render(<Onboarding profile={profile} />);
  await screen.findByText('Manage your installed tools from Plugins.');
  click('Open Example tools');
  await screen.findByText('Disk full');
  expect(api.navigate).not.toHaveBeenCalled();
  expect(useOnboarding.getState().open).toBe(true);
  expect(useOnboarding.getState().progress?.step).toBe('connections');
  click('Open Example tools');
  await waitFor(() => expect(api.navigate).toHaveBeenCalledWith('/extensions/plugins'));
});
it('waits for plugin status before offering the final action', async () => {
  let finish!: (rows: object[]) => void;
  api.plugins.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  useOnboarding.setState({ progress: { ...progress, step: 'connections' } });
  render(<Onboarding profile={profile} />);
  const button = screen.getByRole('button', { name: 'Open Example tools' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await act(async () => { finish([]); });
  expect(button.disabled).toBe(false);
});
it('does not navigate after a completion save resolves for an unmounted wizard', async () => {
  let finish!: (config: object) => void;
  useOnboarding.setState({ progress: { ...progress, step: 'connections' } });
  const view = render(<Onboarding profile={profile} />);
  await screen.findByText('Manage your installed tools from Plugins.');
  api.set.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  click('Open Example tools');
  view.unmount();
  await act(async () => { finish({ onboarding: { ...progress, step: 'complete' } }); });
  expect(api.navigate).not.toHaveBeenCalled();
});
it('saves the non-employee choice without touching the internal marketplace', async () => {
  render(<Onboarding profile={profile} />); click('No, continue with general setup');
  await screen.findByRole('heading', { name: 'Find your tools' });
  expect(api.set).toHaveBeenCalledWith(expect.objectContaining({ onboarding: expect.objectContaining({ audience: 'general', step: 'complete' }) }));
  expect(api.list).not.toHaveBeenCalled(); expect(api.add).not.toHaveBeenCalled();
  click('Continue to Zana'); await waitFor(() => expect(useOnboarding.getState().open).toBe(false));
});
it.each(['Configure coding agents', 'Browse plugins'])('opens general setup action %s', async name => {
  render(<Onboarding profile={profile} />); click('No, continue with general setup');
  await screen.findByRole('heading', { name: 'Find your tools' }); click(name);
  expect(api.navigate).toHaveBeenCalledWith(name === 'Browse plugins' ? '/extensions/plugins/browse' : '/settings/agents');
  expect(useOnboarding.getState().open).toBe(false);
});
it('shows the VPN prerequisite before checking access, then filters bundles to the returned source', async () => {
  render(<Onboarding profile={profile} />); click('Yes, set up Example tools');
  await screen.findByText(profile.prerequisite); expect(api.list).not.toHaveBeenCalled();
  click('Check access and continue'); await screen.findByRole('button', { name: 'Install fixture bundle' });
  expect(api.add).toHaveBeenCalledWith(profile.marketplaceSource);
  expect(api.packs.mock.calls.at(-1)![0]).toMatchObject({ marketplaceSource: 'path:/fixture', presentation: 'onboarding', onBusyChange: expect.any(Function) });
  click('Back to access check'); await screen.findByRole('heading', { name: 'Connect the internal marketplace' });
});
it('keeps access and bundle navigation in one footer outside the scrolling content', async () => {
  useOnboarding.setState({ progress });
  render(<Onboarding profile={profile} />);
  const dialog = screen.getByRole('dialog');
  const footer = dialog.querySelector('footer')!;
  expect(within(footer).getByRole('button', { name: 'Check access and continue' })).toBeTruthy();
  click('Check access and continue');
  await waitFor(() => expect(within(footer).getByRole('button', { name: 'Install fixture bundle' })).toBeTruthy());
  expect(within(footer).getByRole('button', { name: 'Back to access check' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change setup choice' })).toBeNull();
  expect(dialog.querySelector('.onboarding-body button')).toBeNull();
  click('Back to access check');
  await screen.findByRole('heading', { name: 'Connect the internal marketplace' });
  expect(within(footer).queryByRole('button', { name: 'Install fixture bundle' })).toBeNull();
  click('Change setup choice'); await screen.findByText(profile.question);
});
it('refreshes an existing marketplace and keeps failure retryable without advancing progress', async () => {
  useOnboarding.setState({ progress }); api.list.mockResolvedValue([{ source: profile.marketplaceSource }]);
  api.refresh.mockRejectedValueOnce(new Error('Corporate access unavailable'));
  render(<Onboarding profile={profile} />); click('Check access and continue');
  expect((await screen.findByRole('alert')).textContent).toContain('Corporate access unavailable');
  expect(api.add).not.toHaveBeenCalled(); expect(api.set).not.toHaveBeenCalled();
  click('Retry access check'); await screen.findByRole('button', { name: 'Install fixture bundle' });
  expect(api.refresh).toHaveBeenCalledTimes(2);
});
it('treats a returned refresh error as failed access, even if a cached catalogue exists', async () => {
  useOnboarding.setState({ progress }); api.add.mockResolvedValue({ source: profile.marketplaceSource, lastError: 'Offline' });
  render(<Onboarding profile={profile} />); click('Check access and continue');
  await screen.findByText('Offline'); expect(screen.queryByRole('button', { name: 'Install fixture bundle' })).toBeNull();
});
it('keeps the prompt open when saving the employee choice fails', async () => {
  api.set.mockRejectedValueOnce(new Error('Disk full'));
  render(<Onboarding profile={profile} />); click('Yes, set up Example tools');
  await screen.findByText('Disk full'); expect(screen.getByText(profile.question)).toBeTruthy();
  click('Yes, set up Example tools'); await screen.findByText(profile.prerequisite);
});
it('saves skipped progress on Escape and restores the opener', async () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const view = render(<Onboarding profile={profile} />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(useOnboarding.getState().open).toBe(false));
  expect(api.set).toHaveBeenCalledWith(expect.objectContaining({ onboarding: expect.objectContaining({ audience: 'undecided', step: 'welcome' }) }));
  view.unmount(); expect(document.activeElement).toBe(opener); opener.remove();
});
it('resumes saved employee progress and lets the user change their choice without removing plugins', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles', marketplaceSource: profile.marketplaceSource } });
  render(<Onboarding profile={profile} />); await screen.findByRole('button', { name: 'Install fixture bundle' });
  click('Back to access check'); await screen.findByRole('heading', { name: 'Connect the internal marketplace' });
  click('Change setup choice'); await screen.findByText(profile.question);
  expect(useOnboarding.getState().progress).toEqual({ version: 1, profileId: profile.id, audience: 'undecided', step: 'welcome' });
});
it('keeps only installed selected members for a resumable connection checklist', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles', marketplaceSource: profile.marketplaceSource } });
  api.plugins.mockResolvedValue([{ id: 'tool', name: 'Example tool', status: 'needs-configuration' }]);
  render(<Onboarding profile={profile} />); click('Install fixture bundle');
  await screen.findByText('Example tool'); expect(screen.getByText('Needs configuration')).toBeTruthy();
  expect(useOnboarding.getState().progress).toMatchObject({ step: 'connections', pluginIds: ['tool'], packId: 'starter' });
  click('Open plugin settings'); expect(api.navigate).toHaveBeenCalledWith(expect.stringContaining('/tool?view=installed#plugin-configure'));
  expect(useOnboarding.getState().progress?.step).toBe('connections');
});
it.each([
  ['running', 'Installed — review account and environment setup'], ['disabled', 'Disabled — enable in Plugins'],
  ['degraded', 'Needs attention — open Plugins'], ['missing', 'Unavailable — check Plugins']
])('reports %s honestly without claiming the user is signed in', async (status, copy) => {
  useOnboarding.setState({ progress: { ...progress, step: 'complete', pluginIds: ['tool'] } });
  api.plugins.mockResolvedValue(status === 'missing' ? [] : [{ id: 'tool', name: 'Tool', status }]);
  render(<Onboarding profile={profile} />); await screen.findByText(copy);
  click('Done'); await waitFor(() => expect(useOnboarding.getState().open).toBe(false));
  expect(useOnboarding.getState().progress?.step).toBe('complete');
});
it('reports status-read failures and supports an empty completed collection', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'connections', pluginIds: [] } });
  api.plugins.mockRejectedValueOnce(new Error('Offline'));
  const view = render(<Onboarding profile={profile} />);
  await screen.findByRole('alert'); await screen.findByText('Manage your installed tools from Plugins.');
  api.plugins.mockResolvedValue([]);
  await act(async () => { api.appsChanged.mock.calls[0]![0](); });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  view.unmount(); expect(api.off).toHaveBeenCalledOnce();
});
it('does not advance an unmounted wizard after an access check resolves late', async () => {
  let finish!: (value: object[]) => void;
  api.list.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  useOnboarding.setState({ progress }); const view = render(<Onboarding profile={profile} />);
  click('Check access and continue'); view.unmount();
  await act(async () => { finish([]); });
  expect(api.set).not.toHaveBeenCalled();
});
it('suspends its focus trap while the existing pack review owns the screen', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles' } });
  render(<Onboarding profile={profile} />);
  act(() => api.packs.mock.calls.at(-1)![0].onReviewChange(true));
  expect((screen.getByRole('dialog', { hidden: true }).parentElement as HTMLElement).style.display).toBe('none');
  act(() => api.packs.mock.calls.at(-1)![0].onReviewChange(false));
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it('loads the primary desktop prompt and clears competing first-run surfaces', async () => {
  useOnboarding.setState({ open: false, profile: null }); render(<OnboardingHost />);
  await screen.findByText(profile.question); expect(api.ui).toHaveBeenCalledWith({ walkthroughOpen: false, setupOpen: false });
});
it.each(['web', 'scoped', 'not-ready'])('does not auto-open for %s', async kind => {
  api.desktop = kind !== 'web'; api.scoped = kind === 'scoped'; api.configLoaded = kind !== 'not-ready';
  const view = render(<OnboardingHost />); expect(api.get).not.toHaveBeenCalled();
  expect(view.container.textContent).toBe('');
});
it('offers resume/configure actions in Settings and hides them outside the primary desktop', () => {
  useOnboarding.setState({ open: false, progress });
  const view = render(<OnboardingSettingsAction />); click('Resume setup'); expect(useOnboarding.getState().open).toBe(true);
  act(() => useOnboarding.setState({ progress: { ...progress, step: 'complete' } }));
  expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy();
  api.desktop = false; view.rerender(<OnboardingSettingsAction />); expect(view.container.textContent).toBe('');
});
it('retries failed profile loading from Settings', async () => {
  useOnboarding.setState({ open: false, profile: null, error: 'Could not load setup.' });
  render(<OnboardingSettingsAction />); click('Configure');
  await waitFor(() => expect(useOnboarding.getState().open).toBe(true)); expect(api.json).toHaveBeenCalledOnce();
});
it('hides Settings setup when the host disables the profile', () => {
  useOnboarding.setState({ profile: null }); const view = render(<OnboardingSettingsAction />);
  expect(view.container.textContent).toBe('');
});

it.each([true, false])('persists the completed bundle before opening settings from review: %s', async completed => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles' } });
  render(<Onboarding profile={profile} />);
  const props = api.packs.mock.calls.at(-1)![0];
  await act(async () => props.onOpenPlugin('tool', completed ? { identity: { packId: 'starter' }, members: [
    { pluginId: 'tool', selected: true, status: 'installed' }, { pluginId: 'optional', selected: false, status: 'skipped' }
  ] } : null));
  if (completed) expect(api.set).toHaveBeenCalledWith(expect.objectContaining({ onboarding: expect.objectContaining({ step: 'connections', pluginIds: ['tool'] }) }));
  else expect(api.set).not.toHaveBeenCalled();
  expect(useOnboarding.getState().open).toBe(false);
  expect(api.navigate).toHaveBeenCalledWith(expect.stringContaining('/tool?view=installed#plugin-configure'));
});
it('keeps setup recoverable if saving the review-to-settings transition fails', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles' } }); api.set.mockRejectedValueOnce(new Error('Disk full'));
  render(<Onboarding profile={profile} />);
  await act(async () => api.packs.mock.calls.at(-1)![0].onOpenPlugin('tool', { identity: { packId: 'starter' }, members: [] }));
  await screen.findByText('Disk full'); expect(api.navigate).not.toHaveBeenCalled();
  expect(useOnboarding.getState().open).toBe(true);
});

it('keeps parent navigation and Escape locked while the inline bundle is installing', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles' } });
  render(<Onboarding profile={profile} />);
  act(() => api.packs.mock.calls.at(-1)![0].onBusyChange(true));
  expect((screen.getByRole('button', { name: 'Skip for now' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Back to access check' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Change setup choice' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useOnboarding.getState().open).toBe(true);
  act(() => api.packs.mock.calls.at(-1)![0].onBusyChange(false));
  click('Skip for now');
  await waitFor(() => expect(useOnboarding.getState().open).toBe(false));
});
it('propagates a failed checklist save to the inline bundle so it can retry continuation', async () => {
  useOnboarding.setState({ progress: { ...progress, step: 'bundles' } });
  api.set.mockRejectedValueOnce(new Error('Disk full'));
  render(<Onboarding profile={profile} />);
  const installed = api.packs.mock.calls.at(-1)![0].onInstalled;
  const installation = { identity: { packId: 'starter' }, members: [{ pluginId: 'tool', selected: true, status: 'installed' }] };
  await expect(installed(installation)).rejects.toThrow('Disk full');
  expect(useOnboarding.getState().progress?.step).toBe('bundles');
  await act(async () => { await installed(installation); });
  await screen.findByRole('heading', { name: 'Finish connecting your tools' });
});
it('uses the access checklist with browser Git sign-in when the profile configures it', async () => {
  const withAuth = { ...profile, gitAuth: { host: 'git.example.test', method: 'gh-device' as const } };
  useOnboarding.setState({ profile: withAuth, progress });
  api.json.mockImplementation(async (path: string) => path === '/onboarding/git/status'
    ? { status: { host: 'git.example.test', reachable: true, cli: 'available', signedIn: 'yes', login: 'ada' } } : { profile: withAuth });
  render(<Onboarding profile={withAuth} />);
  expect(screen.getByText('Corporate network (VPN)')).toBeTruthy();
  const footer = document.querySelector('.onboarding-footer') as HTMLElement;
  fireEvent.click(within(footer).getByRole('button', { name: 'Check access and continue' }));
  await screen.findByRole('button', { name: 'Install fixture bundle' });
  expect(api.add).toHaveBeenCalledWith('path:/fixture');
  click('Back to access check');
  await screen.findByText('Corporate network (VPN)');
});
