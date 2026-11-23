// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyOnboardingSteps, type OnboardingProgress } from '@zana-ai/zcc-domain/onboarding';

const api = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), changed: vi.fn(), json: vi.fn(), off: vi.fn(), list: vi.fn(), add: vi.fn(), refresh: vi.fn(), verify: vi.fn(),
  prefetch: vi.fn(), navigate: vi.fn(), toast: vi.fn(), setView: vi.fn(), packs: vi.fn(), desktop: true, scoped: false,
  catalog: { byProvider: {} as Record<string, unknown>, inflight: new Set<string>() }
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: api.get, set: api.set, onChanged: api.changed },
  marketplaces: { list: api.list, add: api.add, refresh: api.refresh },
  harness: { verify: api.verify }
} }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.json }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => api.desktop }));
vi.mock('../../lib/windowScope.js', () => ({ isScopedWindow: () => api.scoped }));
vi.mock('../../lib/app-navigate.js', () => ({ appNavigate: api.navigate }));
vi.mock('../../store.js', async () => {
  const { create } = await import('zustand');
  const useUi = create<{ pushToast: typeof api.toast }>(() => ({ pushToast: api.toast }));
  const useData = create(() => ({ configLoaded: true }));
  return { useUi, useData };
});
vi.mock('../../lib/basic-ui.js', async () => {
  const { create } = await import('zustand');
  const view = create<{ mode: 'basic' | 'advanced' }>(() => ({ mode: 'basic' }));
  return {
    BASIC_UI_SESSION_KEY: 'zcc.interface-view.v1',
    basicView: view,
    useBasicUi: () => view(s => s.mode) === 'basic',
    setBasicUiMode: (mode: 'basic' | 'advanced') => { api.setView(mode); view.setState({ mode }); },
    isBasicUiRouteSupported: (path: string) => !path.startsWith('/settings')
  };
});
vi.mock('../thread/pickers/thread-model-catalog.js', () => ({ getThreadModelCatalog: () => api.catalog, subscribeThreadModelCatalog: () => () => undefined, prefetchThreadModelCatalog: api.prefetch }));
vi.mock('./GitAccessChecklist.js', () => ({ GitAccessChecklist: ({ connect, footerTarget }: { connect: () => Promise<void>; footerTarget: HTMLElement | null }) => <>
  <button onClick={() => { connect().catch(() => undefined); }}>Fake connect</button>
  {footerTarget ? createPortal(<button>Footer action</button>, footerTarget) : null}
</> }));
vi.mock('../../views/extensions/PluginPacksCollection.js', () => ({ PluginPacksCollection: (props: {
  marketplaceSource: string; onInstalled: (value: object) => void;
  onOpenPlugin: (id: string) => void
}) => { api.packs(props); return <>
  <button onClick={() => props.onInstalled({ identity: { packId: 'starter' }, members: [
    { pluginId: 'tool', selected: true, status: 'installed' }, { pluginId: 'optional', selected: false, status: 'skipped' }] })}>Install fixture bundle</button>
  <button onClick={() => props.onOpenPlugin('tool')}>Open fixture plugin</button></>; } }));
import { OnboardingHost, OnboardingSettingsAction, startPendingSetupInBasic } from './Onboarding.js';
import { OnboardingCompanion } from './OnboardingCompanion.js';
import { OnboardingResumePill } from './OnboardingResumePill.js';
import { AdvancedCoachmark } from './AdvancedCoachmark.js';
import { useOnboarding } from './onboarding-store.js';
import { useUi } from '../../store.js';
import * as basicUi from '../../lib/basic-ui.js';
const view = (basicUi as unknown as { basicView: { getState(): { mode: string }; setState(v: { mode: 'basic' | 'advanced' }): void } }).basicView;

const profile = { id: 'employees', organization: 'Example', question: 'Are you an Example employee?', prerequisite: 'Connect to the VPN and sign in to Git.', marketplaceSource: 'path:/fixture' };
const gitProfile = { ...profile, gitAuth: { host: 'git.example.com', method: 'gh-device' as const } };
const verifyRows = [
  { family: 'claude', label: 'Claude Code', binary: 'claude', enabled: true, alwaysEnabled: true, installed: true, version: 'v3.4.1', installHint: 'npm i -g claude' },
  { family: 'codex', label: 'Codex', binary: 'codex', enabled: true, alwaysEnabled: false, installed: true, version: 'v0.98', installHint: 'npm i -g codex' },
  { family: 'cursor', label: 'Cursor', binary: 'cursor-agent', enabled: false, alwaysEnabled: false, installed: false, installHint: 'curl cursor.sh | sh' }
];
const progressOf = (patch: Partial<OnboardingProgress> & { steps?: Partial<OnboardingProgress['steps']> } = {}): OnboardingProgress =>
  ({ version: 2, audience: 'undecided', ...patch, steps: { ...emptyOnboardingSteps(), ...patch.steps } }) as OnboardingProgress;
const setStore = (patch: Partial<ReturnType<typeof useOnboarding.getState>> = {}) =>
  useOnboarding.setState({ loaded: true, open: true, profile: null, progress: undefined, identityHint: { match: false }, error: null, ...patch });
const step = (id: string) => document.querySelector(`[data-step="${id}"]`) as HTMLElement;
const savedProgress = () => useOnboarding.getState().progress!;
const pickAgent = (name: RegExp) => fireEvent.click(screen.getByRole('radio', { name }));
const click = (name: string | RegExp, within_: HTMLElement | Document = document.body) => fireEvent.click(within(within_ as HTMLElement).getByRole('button', { name }));

beforeEach(() => {
  vi.resetAllMocks();
  api.desktop = true; api.scoped = false; api.catalog = { byProvider: {}, inflight: new Set() };
  api.set.mockImplementation(async patch => patch); api.get.mockResolvedValue({}); api.changed.mockReturnValue(api.off);
  api.json.mockImplementation(async (path: string) => path.includes('identity') ? { hint: { match: false } } : { profile: null });
  api.verify.mockResolvedValue(verifyRows);
  api.list.mockResolvedValue([]); api.add.mockResolvedValue({ source: 'path:/fixture', lastError: null });
  api.refresh.mockResolvedValue({ source: 'path:/fixture', lastError: null });
  useUi.setState({ pushToast: api.toast }); view.setState({ mode: 'basic' }); sessionStorage.clear();
  setStore();
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete document.body.dataset.onboardingCompanion; });

describe('non-blocking companion', () => {
  it('is a complementary region with no backdrop, dialog or focus trap, and the app stays usable', async () => {
    render(<><textarea aria-label="Composer" /><OnboardingCompanion profile={null} /></>);
    const region = screen.getByRole('complementary', { name: 'Set up Zana' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(region.getAttribute('aria-modal')).toBeNull();
    expect(document.querySelector('.onboarding-backdrop')).toBeNull();
    expect(document.body.dataset.onboardingCompanion).toBe('open');
    const composer = screen.getByLabelText('Composer') as HTMLTextAreaElement;
    composer.focus();
    fireEvent.change(composer, { target: { value: 'hello' } });
    expect(document.activeElement).toBe(composer);
    expect(composer.value).toBe('hello');
    expect(screen.getByText('Nothing is installed or signed in without your click')).toBeTruthy();
    await screen.findByText('Claude Code');
  });

  it('minimizes on Escape, restores from the pill, and releases the reserved space', async () => {
    setStore({ progress: progressOf() });
    render(<><OnboardingCompanion profile={null} /><OnboardingResumePill /></>);
    const region = screen.getByRole('complementary', { name: 'Set up Zana' });
    fireEvent.keyDown(region, { key: 'Escape' });
    await waitFor(() => expect(savedProgress().minimized).toBe(true));
    expect(region.className).toContain('min');
    expect(document.body.dataset.onboardingCompanion).toBeUndefined();
    const pill = await screen.findByRole('button', { name: /Finish setting up, 0 of 3 done/ });
    expect(pill.textContent).toContain('Agent · Bundle · Tour');
    fireEvent.click(pill);
    await waitFor(() => expect(savedProgress().minimized).toBe(false));
    expect(document.body.dataset.onboardingCompanion).toBe('open');
    expect(screen.queryByRole('button', { name: /Finish setting up/ })).toBeNull();
  });

  it('tucks into the sidebar pill when the user types in the app, but not inside the card', async () => {
    setStore({ progress: progressOf() });
    render(<><textarea aria-label="Composer" /><input type="checkbox" aria-label="Toggle" /><OnboardingCompanion profile={null} /></>);
    const region = screen.getByRole('complementary', { name: 'Set up Zana' });
    const inner = document.createElement('input'); region.appendChild(inner);
    fireEvent.input(inner, { target: { value: 'x' } });
    fireEvent.input(screen.getByLabelText('Toggle'));
    expect(region.className).not.toContain('min');
    const composer = screen.getByLabelText('Composer') as HTMLTextAreaElement;
    composer.focus();
    fireEvent.input(composer, { target: { value: 'h' } });
    await waitFor(() => expect(savedProgress().minimized).toBe(true));
    expect(api.toast).toHaveBeenCalledWith('Setup is waiting in the sidebar', 'info');
    expect(document.activeElement).toBe(composer);
  });

  it('"Finish later" minimizes with a toast; a failing save keeps the panel open', async () => {
    render(<OnboardingCompanion profile={null} />);
    click('Finish later');
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Setup saved. Resume it from the sidebar', 'info'));
    api.set.mockRejectedValueOnce(new Error('Disk full'));
    cleanup(); setStore({ progress: progressOf() });
    render(<OnboardingCompanion profile={null} />);
    click('Minimize');
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Could not minimize setup: Disk full', 'error'));
    expect(savedProgress().minimized).toBeFalsy();
  });

  it('keeps a minimized pill hidden once everything is settled', () => {
    setStore({ progress: progressOf({ minimized: true, steps: { harness: 'done', workplace: 'skipped', bundle: 'done', advanced: 'done' } }) });
    render(<OnboardingResumePill />);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup(); api.desktop = false; setStore({ progress: progressOf({ minimized: true }) });
    render(<OnboardingResumePill />);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup(); api.desktop = true; api.scoped = true;
    render(<OnboardingResumePill />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('harness step', () => {
  it('orders ready agents, then needs sign-in, then not installed', async () => {
    api.catalog = { byProvider: { codex: { models: [], modelLoadError: 'auth_required', lastAttemptAt: 1 } }, inflight: new Set() };
    api.verify.mockResolvedValue([
      { ...verifyRows[2] }, { ...verifyRows[1] }, { ...verifyRows[0] }]);
    render(<OnboardingCompanion profile={null} />);
    await screen.findByText('Codex');
    const names = Array.from(document.querySelectorAll('.onb-hc-name')).map(el => el.textContent);
    expect(names).toEqual(['Claude Code', 'Codex', 'Cursor']);
  });

  it('puts ready agents before ones whose sign-in is still unknown', async () => {
    api.catalog = { byProvider: {}, inflight: new Set() };
    api.verify.mockResolvedValue([{ ...verifyRows[1] }, { ...verifyRows[0] }]);
    render(<OnboardingCompanion profile={null} />);
    await screen.findByText('Codex');
    const names = Array.from(document.querySelectorAll('.onb-hc-name')).map(el => el.textContent);
    expect(names).toEqual(['Claude Code', 'Codex']);
  });

  it('stops checking sign-in after a timeout and offers settings', async () => {
    api.catalog = { byProvider: {}, inflight: new Set() };
    api.prefetch.mockRejectedValue(new Error('catalog down'));
    render(<OnboardingCompanion profile={null} />);
    const codex = (await screen.findByText('Codex')).closest('li') as HTMLElement;
    expect(codex.textContent).toContain('checking sign-in');
    expect(api.prefetch).toHaveBeenCalled();
    await waitFor(() => expect(codex.textContent).toContain('Installed · sign-in unknown'), { timeout: 9000 });
    expect(codex.textContent).not.toContain('checking');
    expect(screen.queryByRole('button', { name: 'Open settings for Codex' })).toBeNull();
    pickAgent(/Codex/);
    click('Open settings for Codex');
    expect(api.navigate).toHaveBeenCalledWith('/settings/harness');
  }, 15000);

  it('survives a prefetch that throws synchronously', async () => {
    api.catalog = { byProvider: {}, inflight: new Set() };
    api.prefetch.mockImplementation(() => { throw new Error('boom'); });
    render(<OnboardingCompanion profile={null} />);
    expect(await screen.findByText('Codex')).toBeTruthy();
  });

  it('shows installed, sign-in and missing states from verify and login status', async () => {
    api.catalog = { byProvider: { codex: { models: [], modelLoadError: 'auth_required', lastAttemptAt: 1 } }, inflight: new Set() };
    render(<OnboardingCompanion profile={null} />);
    const codex = (await screen.findByText('Codex')).closest('li') as HTMLElement;
    expect(codex.textContent).toContain('Installed · needs sign-in · v0.98');
    expect(within(codex).getByText(/codex login/)).toBeTruthy();
    const claude = screen.getByText('Claude Code').closest('li') as HTMLElement;
    expect(claude.textContent).toContain('Installed · v3.4.1');
    expect(within(claude).getByRole('radio').getAttribute('aria-checked')).toBe('true');
    const cursor = screen.getByText('Cursor').closest('li') as HTMLElement;
    expect(cursor.textContent).toContain('Not installed');
    expect(cursor.closest('ul')?.hidden).toBe(true);
    click('Show 1 not installed');
    expect(cursor.closest('ul')?.hidden).toBe(false);
    click('Install guide', cursor);
    expect(within(cursor).getByText('curl cursor.sh | sh')).toBeTruthy();
    click('Install guide', cursor);
    expect(within(cursor).queryByText('curl cursor.sh | sh')).toBeNull();
    click('Sign in to Codex');
    expect(api.navigate).toHaveBeenCalledWith('/settings/harness');
  });

  it('reflects other login states', async () => {
    api.catalog = { byProvider: { codex: { models: [{ id: 'm' }], lastAttemptAt: 1 }, cursor: { models: [], lastAttemptAt: 1 } }, inflight: new Set() };
    api.verify.mockResolvedValue(verifyRows.map(row => ({ ...row, installed: true })));
    render(<OnboardingCompanion profile={null} />);
    const codex = (await screen.findByText('Codex')).closest('li') as HTMLElement;
    expect(codex.textContent).toMatch(/Installed · (signed in|sign-in unknown)/);
    api.catalog = { byProvider: {}, inflight: new Set() };
  });

  it('selecting a card only selects; "Continue with …" saves the default and advances', async () => {
    api.get.mockResolvedValue({ defaultHarness: 'claude' });
    render(<OnboardingCompanion profile={null} />);
    await screen.findByText('Codex');
    expect(screen.getByRole('radio', { name: /Claude Code/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: /Continue with Claude Code/ })).toBeTruthy();
    pickAgent(/Codex/);
    expect(screen.getByRole('radio', { name: /Codex/ }).getAttribute('aria-checked')).toBe('true');
    expect(api.set).not.toHaveBeenCalledWith({ defaultHarness: 'codex' });
    click(/Continue with Codex/);
    await waitFor(() => expect(api.set).toHaveBeenCalledWith({ defaultHarness: 'codex' }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Codex will run your threads', 'info'));
    expect(savedProgress().steps.harness).toBe('done');
    expect(savedProgress().steps.workplace).toBe('skipped');
    expect(step('harness').className).toContain('done');
    expect(step('bundle').className).toContain('open');
  });

  it('surfaces a failed default change and a failed verify with a retry', async () => {
    api.set.mockRejectedValueOnce(new Error('nope'));
    render(<OnboardingCompanion profile={null} />);
    await screen.findByText('Codex');
    pickAgent(/Codex/);
    click(/Continue with Codex/);
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Could not set the default agent: nope', 'error'));
    expect(savedProgress()?.steps.harness ?? 'todo').toBe('todo');
    cleanup();
    api.verify.mockRejectedValueOnce(new Error('daemon down'));
    render(<OnboardingCompanion profile={null} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('daemon down');
    expect(screen.queryByRole('button', { name: /^Continue with / })).toBeNull();
    click('Retry');
    await screen.findByText('Codex');
  });

  it('moves the selection with arrow keys and keeps an unchanged default without re-saving', async () => {
    api.get.mockResolvedValue({ defaultHarness: 'claude' });
    api.verify.mockResolvedValue(verifyRows.map(row => ({ ...row, installed: true })));
    render(<OnboardingCompanion profile={null} />);
    const claude = await screen.findByRole('radio', { name: /Claude Code/ });
    fireEvent.keyDown(claude, { key: 'ArrowDown' });
    const second = screen.getAllByRole('radio')[1]!;
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(claude.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(claude, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('radio').at(-1)!.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(claude, { key: 'Enter' });
    fireEvent.keyDown(screen.getAllByRole('radio').at(-1)!, { key: 'ArrowRight' });
    click(/Continue with Claude Code/);
    await waitFor(() => expect(savedProgress().steps.harness).toBe('done'));
    expect(api.set).not.toHaveBeenCalledWith({ defaultHarness: 'claude' });
  });

  it('with no installed agent, shows the install list open and only lets the user skip', async () => {
    api.verify.mockResolvedValue(verifyRows.map(row => ({ ...row, installed: false })));
    render(<OnboardingCompanion profile={null} />);
    expect(await screen.findByText(/No coding agent is installed yet/)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('list', { name: 'Not installed' }).hidden).toBe(false);
    expect((screen.getByRole('button', { name: 'Select an installed agent' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('suggests a ready agent when the saved default is not installed, and Skip records a skipped step', async () => {
    api.get.mockResolvedValue({ defaultHarness: 'cursor' });
    render(<OnboardingCompanion profile={null} />);
    await screen.findByText('Codex');
    expect(screen.getByRole('radio', { name: /Claude Code/ }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('button', { name: /Continue with Claude Code/ }) as HTMLButtonElement).disabled).toBe(false);
    click('Skip for now');
    await waitFor(() => expect(savedProgress().steps.harness).toBe('skipped'));
    expect(step('harness').textContent).toContain('Skipped · resume');
  });

  it('can reopen a skipped step and a failing save keeps it actionable', async () => {
    render(<OnboardingCompanion profile={null} />);
    await screen.findByText('Codex');
    api.set.mockRejectedValueOnce(new Error('Disk full'));
    click('Skip for now');
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Could not save setup progress: Disk full', 'error'));
    expect(savedProgress()?.steps.harness ?? 'todo').toBe('todo');
    expect(step('harness').className).toContain('open');
    click(/Confirm your coding agent/);
    expect(step('harness').className).not.toContain('open');
  });
});

describe('workplace step', () => {
  const open = async (p = profile, progress = progressOf({ steps: { harness: 'done' } })) => {
    setStore({ profile: p, progress, identityHint: undefined });
    render(<OnboardingCompanion profile={p} />);
    return step('workplace');
  };

  it('shows the identity hint and a Yes/No choice; No skips the step', async () => {
    api.json.mockImplementation(async () => ({ hint: { match: true, email: 'alex@example.com' } }));
    const row = await open();
    await waitFor(() => expect(row.textContent).toContain('It looks like you work at Example'));
    expect(row.textContent).toContain('alex@example.com');
    click(/No, or not now/, row);
    await waitFor(() => expect(savedProgress().audience).toBe('general'));
    click('Continue', row);
    await waitFor(() => expect(savedProgress().steps.workplace).toBe('skipped'));
    expect(api.json).toHaveBeenCalledWith('/onboarding/identity-hint');
  });

  it('falls back to the profile question when no identity matches', async () => {
    const row = await open();
    await waitFor(() => expect(api.json).toHaveBeenCalled());
    expect(row.textContent).toContain('Are you an Example employee?');
    expect(row.textContent).not.toContain('It looks like');
    click('Skip', row);
    await waitFor(() => expect(savedProgress().steps.workplace).toBe('skipped'));
  });

  it('Yes connects the marketplace, saves the source and marks the step done', async () => {
    const row = await open(gitProfile);
    click(/Yes, I’m an employee/, row);
    await waitFor(() => expect(savedProgress().audience).toBe('organization'));
    expect(within(row).getByRole('button', { name: 'Footer action' })).toBeTruthy();
    click('Fake connect', row);
    await waitFor(() => expect(savedProgress().steps.workplace).toBe('done'));
    expect(savedProgress().marketplaceSource).toBe('path:/fixture');
    expect(api.toast).toHaveBeenCalledWith('Example marketplace connected', 'info');
    expect(api.add).toHaveBeenCalledWith('path:/fixture');
    click(/Example tools/);
    api.toast.mockClear();
    click('Continue', step('workplace'));
    await waitFor(() => expect(step('bundle').className).toContain('open'));
    expect(api.toast).not.toHaveBeenCalled();
  });

  it('refreshes an existing marketplace row', async () => {
    api.list.mockResolvedValue([{ source: 'path:/fixture' }]);
    const row = await open(gitProfile);
    click(/Yes, I’m an employee/, row);
    click('Fake connect', row);
    await waitFor(() => expect(api.refresh).toHaveBeenCalledWith('path:/fixture'));
  });

  it('keeps connecting in the background after "Continue, finish in background"', async () => {
    const row = await open(gitProfile);
    click(/Yes, I’m an employee/, row);
    click('Continue, finish in background', row);
    await waitFor(() => expect(savedProgress().steps.workplace).toBe('background'));
    expect(api.toast).toHaveBeenCalledWith('Marketplace keeps connecting in the background', 'info');
    expect(row.textContent).toContain('Running…');
    expect(step('bundle').className).toContain('open');
    // The checklist stays mounted (hidden) so its work can finish.
    const hidden = within(row).getByRole('button', { name: 'Fake connect', hidden: true });
    expect((hidden.closest('.onb-bd') as HTMLElement).hidden).toBe(true);
    fireEvent.click(hidden);
    await waitFor(() => expect(savedProgress().steps.workplace).toBe('done'));
    expect(step('bundle').className).toContain('open');
  });

  it('without a gitAuth block it checks access directly and explains failures', async () => {
    api.add.mockResolvedValueOnce({ source: 'path:/fixture', lastError: 'VPN required' });
    const row = await open();
    click(/Yes, I’m an employee/, row);
    expect(row.textContent).toContain('Connect to the VPN and sign in to Git.');
    click('Check access and continue', row);
    const alert = await within(row).findByRole('alert');
    expect(alert.textContent).toContain('VPN required');
    click('Retry access check', row);
    await waitFor(() => expect(savedProgress().steps.workplace).toBe('done'));
  });

  it('restores the previous audience choice', async () => {
    const row = await open(gitProfile, progressOf({ audience: 'organization', steps: { harness: 'done' } }));
    expect(within(row).getByRole('button', { name: 'Fake connect' })).toBeTruthy();
    cleanup();
    const again = await open(gitProfile, progressOf({ audience: 'general', steps: { harness: 'done' } }));
    expect(within(again).getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});

describe('bundle step', () => {
  it('organization members install from the connected marketplace', async () => {
    const progress = progressOf({ audience: 'organization', marketplaceSource: 'path:/fixture', steps: { harness: 'done', workplace: 'done' } });
    setStore({ profile, progress });
    render(<OnboardingCompanion profile={profile} />);
    const row = step('bundle');
    expect(api.packs).toHaveBeenCalledWith(expect.objectContaining({ marketplaceSource: 'path:/fixture' }));
    click('Open fixture plugin', row);
    expect(api.navigate).toHaveBeenCalledWith('/settings/plugins/tool');
    click('Install fixture bundle', row);
    await waitFor(() => expect(savedProgress().steps.bundle).toBe('done'));
    expect(savedProgress()).toMatchObject({ packId: 'starter', pluginIds: ['tool'] });
    expect(api.toast).toHaveBeenCalledWith('Installed 1 plugin. Each asks for its own sign-in in Plugin settings', 'info');
  });

  it('waits for a still-connecting marketplace and lets the user skip', async () => {
    const progress = progressOf({ audience: 'organization', steps: { harness: 'done', workplace: 'background' } });
    setStore({ profile, progress });
    render(<OnboardingCompanion profile={profile} />);
    click(/Pick a starter bundle/);
    const row = step('bundle');
    expect(row.textContent).toContain('still connecting in the background');
    expect(api.packs).not.toHaveBeenCalled();
    click('Skip', row);
    await waitFor(() => expect(savedProgress().steps.bundle).toBe('skipped'));
  });

  it('general users get Browse plugins', async () => {
    setStore({ progress: progressOf({ steps: { harness: 'done' } }) });
    render(<OnboardingCompanion profile={null} />);
    click('Browse plugins');
    expect(api.navigate).toHaveBeenCalledWith('/extensions/plugins/browse');
    await waitFor(() => expect(savedProgress().steps.bundle).toBe('done'));
  });
});

describe('advanced step and coachmark', () => {
  const anchor = () => {
    const el = document.createElement('div');
    el.className = 'basic-ui-mode-switch';
    el.getBoundingClientRect = () => ({ left: 500, top: 4, width: 160, height: 28, right: 660, bottom: 32, x: 500, y: 4, toJSON: () => ({}) });
    document.body.append(el);
    return el;
  };
  const toAdvanced = () => setStore({ progress: progressOf({ steps: { harness: 'done', workplace: 'skipped', bundle: 'done' } }) });
  afterEach(() => document.querySelectorAll('.basic-ui-mode-switch').forEach(el => el.remove()));
  const spotlight = () => document.body.dataset.onboardingSpotlight;

  it('anchors the coachmark to the title-bar switch and highlights it', async () => {
    anchor(); toAdvanced();
    render(<OnboardingCompanion profile={null} />);
    const coach = await screen.findByRole('region', { name: 'Basic and Advanced' });
    expect(coach.style.left).toBe('430px');
    expect(coach.style.top).toBe('44px');
    expect(spotlight()).toBe('interface-mode');
    act(() => { window.dispatchEvent(new Event('resize')); });
    click('Got it', coach);
    await waitFor(() => expect(savedProgress().steps.advanced).toBe('done'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Basic and Advanced' })).toBeNull());
    expect(spotlight()).toBeUndefined();
  });

  it('Escape closes the coachmark first; "Show me where" reopens it', async () => {
    anchor(); toAdvanced();
    render(<OnboardingCompanion profile={null} />);
    await screen.findByRole('region', { name: 'Basic and Advanced' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(savedProgress().steps.advanced).toBe('done'));
  });

  it('a skipped Advanced step can be revisited; "Show me where" toggles the coachmark', async () => {
    anchor();
    setStore({ progress: progressOf({ steps: { harness: 'done', workplace: 'skipped', advanced: 'skipped' } }) });
    render(<OnboardingCompanion profile={null} />);
    click(/Meet Advanced/);
    const coach = await screen.findByRole('region', { name: 'Basic and Advanced' });
    expect(coach).toBeTruthy();
    click('Show me where');
    expect((screen.getByRole('button', { name: 'Show me where' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    click('I’ll stay in Basic');
    await waitFor(() => expect(savedProgress().steps.advanced).toBe('skipped'));
  });

  it('switching to Advanced anywhere completes the step', async () => {
    anchor(); toAdvanced();
    render(<OnboardingCompanion profile={null} />);
    const coach = await screen.findByRole('region', { name: 'Basic and Advanced' });
    click('Switch to Advanced', coach);
    await waitFor(() => expect(savedProgress().steps.advanced).toBe('done'));
    expect(view.getState().mode).toBe('advanced');
  });

  it('"Try Advanced" switches mode; an Advanced user sees the matching copy', async () => {
    toAdvanced();
    render(<OnboardingCompanion profile={null} />);
    click('Try Advanced');
    await waitFor(() => expect(view.getState().mode).toBe('advanced'));
    await waitFor(() => expect(savedProgress().steps.advanced).toBe('done'));
    click(/Meet Advanced/);
    expect(step('advanced').textContent).toContain('You’re in Advanced');
    click('Done');
  });

  it('renders no coachmark when the switch is not mounted, and clamps near the window edge', () => {
    const { unmount } = render(<AdvancedCoachmark onGotIt={vi.fn()} onSwitch={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
    unmount();
    const el = anchor();
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 20, height: 20, right: 20, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    render(<AdvancedCoachmark onGotIt={vi.fn()} onSwitch={vi.fn()} />);
    expect(screen.getByRole('region').style.left).toBe('8px');
  });

  it('hides the coachmark while minimized', () => {
    anchor();
    setStore({ progress: progressOf({ minimized: true, steps: { harness: 'done', workplace: 'skipped', bundle: 'done' } }) });
    render(<OnboardingCompanion profile={null} />);
    expect(screen.queryByRole('region', { name: 'Basic and Advanced' })).toBeNull();
    expect(spotlight()).toBeUndefined();
  });
});

describe('completion', () => {
  it('celebrates, auto-minimizes and closes without a distribution profile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setStore({ progress: progressOf({ steps: { harness: 'done', bundle: 'done' } }) });
    render(<OnboardingCompanion profile={null} />);
    click('I’ll stay in Basic');
    await waitFor(() => expect(screen.getByText('All set. Welcome to Zana')).toBeTruthy());
    expect(savedProgress().completedAt).toBeTruthy();
    expect(savedProgress().steps.workplace).toBe('skipped');
    expect(api.toast).toHaveBeenCalledWith('Setup complete. Welcome to Zana', 'info');
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(useOnboarding.getState().open).toBe(false);
  });

  it('a completed setup reopens as a calm summary that closes', async () => {
    setStore({ progress: progressOf({ completedAt: new Date().toISOString(), steps: { harness: 'done', workplace: 'skipped', bundle: 'done', advanced: 'done' } }) });
    render(<OnboardingCompanion profile={null} />);
    expect(screen.getByText('Setup complete')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Finish later' })).toBeNull();
    click('Close');
    expect(useOnboarding.getState().open).toBe(false);
  });

  it('completes when advanced mode was already active at launch', async () => {
    view.setState({ mode: 'advanced' });
    setStore({ progress: progressOf({ steps: { harness: 'done', workplace: 'skipped', bundle: 'done' } }) });
    render(<OnboardingCompanion profile={null} />);
    await waitFor(() => expect(savedProgress().steps.advanced).toBe('done'));
  });
});

describe('host and settings entry', () => {
  it('loads setup once config is ready, shows the companion and clears competing prompts', async () => {
    api.json.mockImplementation(async (path: string) => path.includes('identity') ? { hint: { match: false } } : { profile });
    useOnboarding.setState({ loaded: false, open: false, profile: null, progress: undefined });
    render(<OnboardingHost />);
    await screen.findByRole('complementary', { name: 'Set up Zana' });
    expect(useOnboarding.getState().profile).toMatchObject({ id: 'employees' });
    expect(screen.getByText('Example tools')).toBeTruthy();
  });

  it('opens without a profile for a fresh install', async () => {
    useOnboarding.setState({ loaded: false, open: false });
    render(<OnboardingHost />);
    await screen.findByRole('complementary', { name: 'Set up Zana' });
    expect(screen.queryByText(/Example tools/)).toBeNull();
    expect(step('workplace')).toBeNull();
  });

  it('stays out of scoped windows and non-desktop surfaces', () => {
    api.scoped = true;
    render(<OnboardingHost />);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(useOnboarding.getState().loaded).toBe(true);
    cleanup(); api.scoped = false; api.desktop = false;
    render(<OnboardingHost />);
    expect(screen.queryByRole('complementary')).toBeNull();
    cleanup();
    render(<OnboardingSettingsAction />);
    expect(screen.queryByText('Set up Zana')).toBeNull();
  });

  it('Settings reopens setup with the right label', async () => {
    setStore({ open: false });
    render(<OnboardingSettingsAction />);
    click('Configure');
    expect(useOnboarding.getState().open).toBe(true);
    cleanup();
    setStore({ open: false, progress: progressOf({ minimized: true }) });
    render(<OnboardingSettingsAction />);
    click('Resume setup');
    expect(useOnboarding.getState().open).toBe(true);
    await waitFor(() => expect(savedProgress().minimized).toBe(false));
  });

  it('retries a failed load from Settings and stays closed if it still fails', async () => {
    setStore({ open: false, error: 'Could not load setup. Try again from Settings.' });
    api.json.mockRejectedValue(new Error('offline'));
    render(<OnboardingSettingsAction />);
    click('Configure');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy());
    expect(useOnboarding.getState().open).toBe(false);
    api.json.mockImplementation(async (path: string) => path.includes('identity') ? { hint: { match: false } } : { profile: null });
    click('Configure');
    await waitFor(() => expect(useOnboarding.getState().open).toBe(true));
  });
});

describe('first run starts in Basic', () => {
  beforeEach(() => { view.setState({ mode: 'advanced' }); });

  it('switches a fresh window to Basic while setup is pending', () => {
    setStore({ progress: undefined });
    expect(startPendingSetupInBasic('/')).toBe(true);
    expect(api.setView).toHaveBeenCalledWith('basic');
  });

  it.each([
    ['setup is closed', () => setStore({ open: false })],
    ['setup is complete', () => setStore({ progress: progressOf({ completedAt: '2026-11-23T00:00:00Z' }) })],
    ['Meet Advanced was handled', () => setStore({ progress: progressOf({ steps: { advanced: 'skipped' } }) })],
    ['this session already picked a view', () => { setStore(); sessionStorage.setItem('zcc.interface-view.v1', '{"mode":"advanced"}'); }]
  ])('keeps the current view when %s', (_label, arrange) => {
    arrange();
    expect(startPendingSetupInBasic('/')).toBe(false);
    expect(api.setView).not.toHaveBeenCalled();
  });

  it('keeps the current view on a page Basic cannot show', () => {
    setStore();
    expect(startPendingSetupInBasic('/settings/general')).toBe(false);
    expect(api.setView).not.toHaveBeenCalled();
  });

  it('treats unavailable session storage as no prior choice', () => {
    setStore();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try { expect(startPendingSetupInBasic('/')).toBe(true); } finally { spy.mockRestore(); }
  });

  it('the host applies it once setup has loaded', async () => {
    useOnboarding.setState({ loaded: false, open: false, profile: null, progress: undefined });
    render(<OnboardingHost />);
    await screen.findByRole('complementary', { name: 'Set up Zana' });
    await waitFor(() => expect(api.setView).toHaveBeenCalledWith('basic'));
  });
});
