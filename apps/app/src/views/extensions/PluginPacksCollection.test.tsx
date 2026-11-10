// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginPackCatalogEntry, PluginPackInstallation, PluginPackPlan } from '@zana-ai/zcc-domain';
const api = vi.hoisted(() => ({ list: vi.fn(), listInstalled: vi.fn(), plan: vi.fn(), install: vi.fn(), forget: vi.fn(), plugins: vi.fn(), off: vi.fn(), changed: vi.fn(), appsChanged: vi.fn(), appsOff: vi.fn(), navigate: vi.fn(), desktop: true }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  pluginPacks: { list: api.list, listInstalled: api.listInstalled, plan: api.plan, install: api.install, forget: api.forget },
  extensions: { marketplaceList: api.plugins, onChanged: api.changed },
  pluginApps: { onChanged: api.appsChanged }
} }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => api.desktop }));
vi.mock('../../lib/app-navigate.js', () => ({ appNavigate: api.navigate }));
import { PluginPacksCollection } from './PluginPacksCollection.js';
const identity = { marketplaceSource: 'git:trusted/catalog', packId: 'essentials' };
const catalog: PluginPackCatalogEntry = { identity, marketplaceName: 'internal', marketplaceDisplayName: 'Internal', pack: { id: 'essentials', displayName: 'Team essentials', description: 'Tools for your team.', members: [{ pluginId: 'existing', required: true }, { pluginId: 'new', required: false }] } };
const plan: PluginPackPlan = { identity, planId: 'first-plan', displayName: catalog.pack.displayName, description: catalog.pack.description, members: [
  { pluginId: 'existing', displayName: 'Existing tool', description: 'Keep its account.', required: true, status: 'installed', installedVersion: '0.9', installedSource: 'path:local', sourceLabel: 'git:trusted/existing@v1', targetVersion: 'v1.0', reason: 'Its settings and enabled state will be kept.' },
  { pluginId: 'new', displayName: 'New tool', description: 'Add a tool.', required: false, status: 'available', sourceLabel: 'git:trusted/new@v1', targetVersion: 'v1.0' }
] };
const saved = (failed = false): PluginPackInstallation => ({ identity, displayName: catalog.pack.displayName, description: catalog.pack.description, createdAt: 1, updatedAt: 2, members: [
  { pluginId: 'existing', displayName: 'Existing tool', selected: true, status: 'installed' },
  { pluginId: 'new', displayName: 'New tool', selected: true, status: failed ? 'failed' : 'installed', ...(failed ? { error: 'Source interrupted' } : {}) }
] });
beforeEach(() => {
  vi.clearAllMocks(); api.desktop = true; api.changed.mockReturnValue(api.off);
  api.appsChanged.mockReturnValue(api.appsOff);
  api.list.mockResolvedValue([catalog]); api.listInstalled.mockResolvedValue([]); api.plan.mockResolvedValue(plan); api.install.mockResolvedValue(saved()); api.forget.mockResolvedValue({ ok: true });
  api.plugins.mockResolvedValue({ ok: true, value: [{ id: 'existing', installed: true }] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const open = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Review pack' })); return screen.findByRole('dialog', { name: 'Review Team essentials' }); };
it('filters onboarding by source and reports success only after the user finishes review', async () => {
  const onInstalled = vi.fn(), onReviewChange = vi.fn();
  const view = render(<PluginPacksCollection mode="browse" marketplaceSource="git:other/catalog" onInstalled={onInstalled} onReviewChange={onReviewChange} />);
  await screen.findByText(/No bundles are currently available/);
  view.rerender(<PluginPacksCollection mode="browse" marketplaceSource={identity.marketplaceSource} onInstalled={onInstalled} onReviewChange={onReviewChange} />);
  await open(); expect(onReviewChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onInstalled).not.toHaveBeenCalled();
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await screen.findByRole('button', { name: 'Done' }); expect(onInstalled).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onReviewChange).toHaveBeenLastCalledWith(false); expect(onInstalled).toHaveBeenCalledWith(saved());
});
it('delegates settings navigation with the completed installation to an embedding setup flow', async () => {
  const onOpenPlugin = vi.fn();
  render(<PluginPacksCollection mode="browse" onOpenPlugin={onOpenPlugin} />);
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(onOpenPlugin).toHaveBeenLastCalledWith('existing', null);
  expect(api.navigate).not.toHaveBeenCalled();
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await screen.findByRole('button', { name: 'Done' });
  fireEvent.click(within(screen.getByTestId('plugin-pack-member-new')).getByRole('button', { name: 'Open settings' }));
  expect(onOpenPlugin).toHaveBeenLastCalledWith('new', saved());
});
it('discovers packs after catalogue mutations and background seed completion, and releases subscriptions', async () => {
  api.list.mockResolvedValueOnce([]);
  const view = render(<PluginPacksCollection mode="browse" catalogRevision={0} />);
  await waitFor(() => expect(api.list).toHaveBeenCalledOnce());
  expect(screen.queryByRole('region')).toBeNull();
  view.rerender(<PluginPacksCollection mode="browse" catalogRevision={1} />);
  await screen.findByRole('button', { name: 'Review pack' });
  api.list.mockResolvedValue([]);
  const changed = api.appsChanged.mock.calls.at(-1)![0] as () => void;
  changed();
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  view.unmount();
  expect(api.appsOff).toHaveBeenCalledTimes(2);
});
it('loads packs, reviews server-owned sources and saves selected IDs including existing members', async () => {
  render(<PluginPacksCollection mode="browse" />); await open();
  expect(api.plan).toHaveBeenCalledWith(identity);
  expect(screen.getByText('v0.9 · path:local')).toBeTruthy();
  expect(screen.getByText('Its settings and enabled state will be kept.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await screen.findByRole('button', { name: 'Done' });
  expect(api.install).toHaveBeenCalledWith({ identity, planId: 'first-plan', pluginIds: ['existing', 'new'] });
  fireEvent.click(within(screen.getByTestId('plugin-pack-member-new')).getByRole('button', { name: 'Open settings' }));
  expect(api.navigate).toHaveBeenCalledWith(expect.stringContaining('/new?view=installed'));
});
it('filters pack cards and hides pack mutation UI outside the owner desktop', async () => {
  const view = render(<PluginPacksCollection mode="browse" query="absent" />);
  await waitFor(() => expect(api.list).toHaveBeenCalledOnce());
  expect(screen.queryByRole('region')).toBeNull();
  view.rerender(<PluginPacksCollection mode="browse" query="team" />);
  await screen.findByRole('button', { name: 'Review pack' });
  api.desktop = false; view.rerender(<PluginPacksCollection mode="browse" />);
  expect(screen.queryByRole('region')).toBeNull();
});
it('shows catalogue errors and ignores responses after unmount', async () => {
  api.list.mockRejectedValueOnce(new Error('Catalogue offline'));
  const view = render(<PluginPacksCollection mode="browse" />);
  expect((await screen.findByRole('alert')).textContent).toContain('Catalogue offline');
  view.unmount(); expect(api.off).toHaveBeenCalledOnce();
  let resolve!: (rows: PluginPackCatalogEntry[]) => void;
  api.list.mockReturnValue(new Promise((done) => { resolve = done; }));
  const later = render(<PluginPacksCollection mode="browse" />); later.unmount(); resolve([catalog]);
  await Promise.resolve(); expect(screen.queryByRole('region')).toBeNull();
});
it('shows plan failures inline without an empty trust dialog', async () => {
  api.plan.mockRejectedValueOnce(new Error('Pack not found'));
  render(<PluginPacksCollection mode="browse" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review pack' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Pack not found');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('gets a fresh plan for partial failure and retries only failed plugins', async () => {
  api.install.mockResolvedValueOnce(saved(true)).mockResolvedValueOnce(saved());
  api.plan.mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...plan, planId: 'retry-plan', members: plan.members.map((member) => member.pluginId === 'existing' ? { ...member, status: 'installed' } : member) });
  render(<PluginPacksCollection mode="browse" />); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Retry failed plugins' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole('alert').textContent).toBe('Source interrupted');
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed plugins' }));
  await screen.findByRole('button', { name: 'Done' });
  expect(api.install).toHaveBeenLastCalledWith({ identity, planId: 'retry-plan', pluginIds: ['new'] });
});
it('requires review and explicit selection of new required members after a changed pack', async () => {
  api.install.mockResolvedValueOnce(saved(true));
  api.plan.mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...plan, planId: 'changed-plan', members: [...plan.members, { pluginId: 'added', displayName: 'Added tool', description: '', required: true, status: 'available', sourceLabel: 'git:trusted/added' }] });
  render(<PluginPacksCollection mode="browse" />); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await screen.findByText('This pack changed. Review its members and sources before installing again.');
  const added = screen.getByLabelText('Include Added tool') as HTMLInputElement;
  expect(added.checked).toBe(false); expect(added.disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Install selected plugins' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(added);
  expect((screen.getByRole('button', { name: 'Install selected plugins' }) as HTMLButtonElement).disabled).toBe(false);
});
it('blocks consumed-plan retries after a fresh review cannot be obtained', async () => {
  api.install.mockResolvedValueOnce(saved(true)); api.plan.mockResolvedValueOnce(plan).mockRejectedValueOnce(new Error('Offline'));
  render(<PluginPacksCollection mode="browse" />); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await screen.findByText('Offline Close this review and open the pack again to retry.');
  expect((screen.getByRole('button', { name: 'Retry failed plugins' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).toBeNull();
});
it('forgets pack membership independently and preserves actionable storage errors', async () => {
  api.listInstalled.mockResolvedValue([saved()]); api.forget.mockRejectedValueOnce(new Error('Store unavailable')).mockResolvedValueOnce({ ok: true });
  render(<PluginPacksCollection mode="installed" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Forget pack' }));
  const dialog = screen.getByRole('dialog', { name: 'Forget Team essentials?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Forget pack' }));
  await screen.findByText('Store unavailable');
  api.listInstalled.mockResolvedValue([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Forget pack' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Installed plugin packs' })).toBeNull());
  expect(api.forget).toHaveBeenCalledWith(identity);
});
it('retains saved packs when their marketplace is removed and keeps forget reachable', async () => {
  api.list.mockResolvedValue([]); api.listInstalled.mockResolvedValue([saved()]); api.plugins.mockResolvedValue({ ok: false, message: 'Offline' });
  render(<PluginPacksCollection mode="installed" />);
  await screen.findByRole('button', { name: 'Manage pack' });
  expect(screen.getByText('Marketplace · Plugin pack')).toBeTruthy();
  expect(screen.getByText('2 plugins')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Forget pack' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('surfaces non-Error install failures and requires a fresh review rather than reusing a consumed token', async () => {
  api.install.mockRejectedValueOnce('Catalogue changed');
  render(<PluginPacksCollection mode="browse" />); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await screen.findByText('Catalogue changed Close this review and open the pack again to retry.');
  expect((screen.getByRole('button', { name: 'Install selected plugins' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await open();
  expect((screen.getByRole('button', { name: 'Install selected plugins' }) as HTMLButtonElement).disabled).toBe(false);
});
it('ignores an older catalogue response after a newer plugin change refresh', async () => {
  let resolveFirst!: (rows: PluginPackCatalogEntry[]) => void;
  api.list.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce([]);
  render(<PluginPacksCollection mode="browse" />);
  await waitFor(() => expect(api.changed).toHaveBeenCalledOnce());
  const changed = api.changed.mock.calls[0]![0] as () => void;
  changed();
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  resolveFirst([catalog]);
  await Promise.resolve();
  expect(screen.queryByRole('button', { name: 'Review pack' })).toBeNull();
});
it('renders unavailable members and their host reason without inventing an install source', async () => {
  api.plan.mockResolvedValueOnce({ ...plan, members: [{ pluginId: 'missing', displayName: 'Missing tool', description: '', required: false, status: 'unavailable', reason: 'Not in the catalogue' }] });
  render(<PluginPacksCollection mode="browse" />); await open();
  expect(screen.getByText('Source unavailable')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Not in the catalogue');
  expect((screen.getByLabelText('Include Missing tool') as HTMLInputElement).disabled).toBe(true);
});
it('offers newly added optional members unchecked when managing a saved pack', async () => {
  api.listInstalled.mockResolvedValue([saved(true)]);
  api.plan.mockResolvedValue({ ...plan, members: [...plan.members, { pluginId: 'later', displayName: 'Later addition', description: 'Offered after installation.', required: false, status: 'available', sourceLabel: 'git:trusted/later' }] });
  render(<PluginPacksCollection mode="installed" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage pack' }));
  await screen.findByRole('dialog');
  expect((screen.getByLabelText('Include New tool') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Include Later addition') as HTMLInputElement).checked).toBe(false);
});
it('uses marketplace display names and only reports installation counts when every member is known', async () => {
  api.plugins.mockResolvedValue({ ok: true, value: [{ id: 'existing', title: 'Existing tool', installed: true }, { id: 'new', title: 'New tool', installed: false }] });
  render(<PluginPacksCollection mode="browse" query="New tool" />);
  expect(await screen.findByText('1 of 2 plugins installed')).toBeTruthy();
  expect(screen.getByText('Existing tool')).toBeTruthy();
  expect(screen.getByText('New tool')).toBeTruthy();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('shows per-member progress while installation remains active and preserves final failure and retry', async () => {
  const later = { pluginId: 'later', displayName: 'Later tool', description: '', required: false, status: 'available' as const, sourceLabel: 'git:trusted/later@v1' };
  api.plan.mockResolvedValue({ ...plan, members: [...plan.members, later] });
  const operation = deferred<PluginPackInstallation>();
  api.install.mockReturnValueOnce(operation.promise);
  render(<PluginPacksCollection mode="browse" />); await open();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  expect(within(screen.getByTestId('plugin-pack-member-new')).getByText('Installing…')).toBeTruthy();
  const progress: PluginPackInstallation = { ...saved(), members: [...saved().members, { pluginId: 'later', displayName: 'Later tool', selected: true, status: 'pending' }] };
  api.listInstalled.mockResolvedValue([progress]);
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(within(screen.getByTestId('plugin-pack-member-new')).getByText('Installed')).toBeTruthy();
  expect(within(screen.getByTestId('plugin-pack-member-later')).getByText('Installing…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  const final: PluginPackInstallation = { ...progress, updatedAt: 3, members: progress.members.map((member) => member.pluginId === 'later' ? { ...member, status: 'failed', error: 'Later source unavailable' } : member) };
  await act(async () => { operation.resolve(final); });
  expect(screen.getByText('Later source unavailable')).toBeTruthy();
  expect(within(screen.getByTestId('plugin-pack-member-later')).getByText('Failed')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Retry failed plugins' }) as HTMLButtonElement).disabled).toBe(false);
});

it('bounds progress polling without overlap, ignores other pack identities, and recovers after read errors', async () => {
  const operation = deferred<PluginPackInstallation>(), poll = deferred<PluginPackInstallation[]>();
  api.install.mockReturnValueOnce(operation.promise);
  render(<PluginPacksCollection mode="browse" />); await open();
  const baseline = api.listInstalled.mock.calls.length;
  api.listInstalled.mockReturnValueOnce(poll.promise);
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(api.listInstalled).toHaveBeenCalledTimes(baseline + 1);
  api.listInstalled.mockResolvedValue([{ ...saved(), identity: { ...identity, marketplaceSource: 'git:other/catalog' } }]);
  await act(async () => { poll.reject(new Error('Temporary progress read error')); });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(api.listInstalled).toHaveBeenCalledTimes(baseline + 2);
  expect(within(screen.getByTestId('plugin-pack-member-new')).getByText('Installing…')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => { operation.resolve(saved()); });
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  const finalCalls = api.listInstalled.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(api.listInstalled).toHaveBeenCalledTimes(finalCalls);
});

it('ignores late progress after the final failure so an older poll cannot clear its error', async () => {
  const operation = deferred<PluginPackInstallation>(), poll = deferred<PluginPackInstallation[]>();
  api.install.mockReturnValueOnce(operation.promise);
  render(<PluginPacksCollection mode="browse" />); await open();
  api.listInstalled.mockReturnValueOnce(poll.promise);
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  await act(async () => { operation.resolve(saved(true)); });
  expect(screen.getByText('Source interrupted')).toBeTruthy();
  await act(async () => { poll.resolve([saved()]); });
  expect(screen.getByText('Source interrupted')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry failed plugins' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
});

it('stops progress reads on unmount and ignores late poll and installation responses', async () => {
  const operation = deferred<PluginPackInstallation>(), poll = deferred<PluginPackInstallation[]>();
  api.install.mockReturnValueOnce(operation.promise);
  const view = render(<PluginPacksCollection mode="browse" />); await open();
  api.listInstalled.mockReturnValueOnce(poll.promise);
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  view.unmount();
  const calls = api.listInstalled.mock.calls.length;
  await act(async () => { poll.resolve([saved()]); operation.resolve(saved()); await vi.advanceTimersByTimeAsync(3000); });
  expect(api.listInstalled).toHaveBeenCalledTimes(calls);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not replace pending progress with the unchanged saved failure from a previous attempt', async () => {
  const operation = deferred<PluginPackInstallation>();
  api.listInstalled.mockResolvedValue([saved(true)]);
  api.install.mockReturnValueOnce(operation.promise);
  render(<PluginPacksCollection mode="browse" />); await open();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(within(screen.getByTestId('plugin-pack-member-new')).getByText('Installing…')).toBeTruthy();
  expect(screen.queryByText('Source interrupted')).toBeNull();
  await act(async () => { operation.resolve(saved()); });
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
});

it('does not show a successful saved pack when an all-installed review is rejected as stale', async () => {
  api.plan.mockResolvedValueOnce({ ...plan, members: [plan.members[0]!] });
  api.install.mockRejectedValueOnce(new Error('A previously installed plugin was removed since review.'));
  render(<PluginPacksCollection mode="browse" />); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Save pack' }));
  await screen.findByText('A previously installed plugin was removed since review. Close this review and open the pack again to retry.');
  expect(api.install).toHaveBeenCalledWith({ identity, planId: 'first-plan', pluginIds: ['existing'] });
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(screen.queryByText('Pack saved. Manage each plugin below.')).toBeNull();
  expect((screen.getByRole('button', { name: 'Save pack' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
});

it('opens the sole onboarding bundle inline and advances immediately after installation', async () => {
  const onInstalled = vi.fn(), onReviewChange = vi.fn(), onBusyChange = vi.fn();
  const view = render(<PluginPacksCollection mode="browse" presentation="onboarding" marketplaceSource={identity.marketplaceSource} onInstalled={onInstalled} onReviewChange={onReviewChange} onBusyChange={onBusyChange} />);
  expect(screen.queryByText(/No bundles/)).toBeNull();
  await screen.findByRole('button', { name: 'Install and continue' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review pack' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
  expect(onReviewChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Install and continue' }));
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(saved()));
  expect(api.install).toHaveBeenCalledWith({ identity, planId: plan.planId, pluginIds: ['existing', 'new'] });
  expect(onBusyChange).toHaveBeenCalledWith(true);
  view.unmount(); expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
it('continues an already installed onboarding bundle without offering installation', async () => {
  api.plan.mockResolvedValue({ ...plan, members: plan.members.map(member => ({ ...member, status: 'installed' })) });
  const onInstalled = vi.fn();
  render(<PluginPacksCollection mode="browse" presentation="onboarding" onInstalled={onInstalled} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue setup' }));
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(saved()));
  expect(api.install).toHaveBeenCalledWith({ identity, planId: plan.planId, pluginIds: ['existing', 'new'] });
  expect(screen.queryByRole('button', { name: 'Save pack' })).toBeNull();
});
it('retries saving onboarding progress without replaying a consumed installation plan', async () => {
  const onInstalled = vi.fn().mockRejectedValueOnce(new Error('Could not save setup')).mockResolvedValue(undefined);
  render(<PluginPacksCollection mode="browse" presentation="onboarding" onInstalled={onInstalled} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install and continue' }));
  await screen.findByText('Could not save setup');
  fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));
  await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(2));
  expect(api.install).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('lets onboarding choose between bundles without nested reviews or automatic installation', async () => {
  const second = { ...catalog, identity: { ...identity, packId: 'other' }, pack: { ...catalog.pack, id: 'other', displayName: 'Other bundle' } };
  api.list.mockResolvedValue([catalog, second]);
  render(<PluginPacksCollection mode="browse" presentation="onboarding" />);
  const choices = await screen.findAllByRole('button', { name: 'Choose bundle' });
  expect(api.plan).not.toHaveBeenCalled();
  fireEvent.click(choices[0]!);
  await screen.findByRole('button', { name: 'Install and continue' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose another bundle' }));
  expect(screen.getAllByRole('button', { name: 'Choose bundle' })).toHaveLength(2);
  expect(api.install).not.toHaveBeenCalled();
});
it('recovers inline planning and installation failures by requesting a fresh plan', async () => {
  api.plan.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(plan);
  api.install.mockRejectedValueOnce(new Error('Plan expired')).mockResolvedValue(saved());
  const onInstalled = vi.fn();
  render(<PluginPacksCollection mode="browse" presentation="onboarding" onInstalled={onInstalled} />);
  await screen.findByText('Plugin packs: Offline');
  expect(api.plan).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Reload bundle' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Install and continue' }));
  await screen.findByText('Plan expired Reload the bundle to retry.');
  expect((screen.getByRole('button', { name: 'Install and continue' }) as HTMLButtonElement).disabled).toBe(true);
  api.plan.mockResolvedValue({ ...plan, planId: 'fresh-plan' });
  fireEvent.click(screen.getByRole('button', { name: 'Reload bundle' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Install and continue' }));
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(saved()));
  expect(api.install).toHaveBeenLastCalledWith({ identity, planId: 'fresh-plan', pluginIds: ['existing', 'new'] });
});
it('keeps inline partial failures retryable and advances only after every selected plugin succeeds', async () => {
  api.install.mockResolvedValueOnce(saved(true)).mockResolvedValue(saved());
  const onInstalled = vi.fn();
  render(<PluginPacksCollection mode="browse" presentation="onboarding" onInstalled={onInstalled} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install and continue' }));
  const retry = await screen.findByRole('button', { name: 'Retry failed plugins' });
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
  expect(onInstalled).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(saved()));
  expect(api.install).toHaveBeenLastCalledWith({ identity, planId: plan.planId, pluginIds: ['new'] });
});
it('preserves the installed selection while retrying a failed onboarding save', async () => {
  const installation = saved();
  installation.members[1] = { ...installation.members[1]!, selected: false, status: 'skipped' };
  api.install.mockResolvedValue(installation);
  const onInstalled = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
  render(<PluginPacksCollection mode="browse" presentation="onboarding" onInstalled={onInstalled} />);
  await screen.findByRole('button', { name: 'Install and continue' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include New tool' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));
  await screen.findByText('Disk full');
  expect((screen.getByRole('checkbox', { name: 'Include New tool' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));
  await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(2));
  expect(onInstalled).toHaveBeenLastCalledWith(installation);
  expect(api.install).toHaveBeenCalledOnce();
});
