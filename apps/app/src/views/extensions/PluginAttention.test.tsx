// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
const api = vi.hoisted(() => ({ reload: vi.fn(), list: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { pluginApps: api } }));
import { PluginAttention } from './PluginAttention.js';
import { buildHubRows } from './installed-plugins.js';

const plugin = (id: string, over: Partial<PluginAppEntry> = {}): PluginAppEntry => ({
  id, name: id, description: '', icon: 'Box', enabled: true, status: 'degraded', provenance: 'direct', appUrl: null, ...over
});
const setup = (plugins: PluginAppEntry[]) => render(<PluginAttention rows={buildHubRows([], [], plugins)} issuesOnly={false} onReview={vi.fn()} />);
const clickReload = () => fireEvent.click(screen.getByRole('button', { name: /Reload degraded plugins/ }));
beforeEach(() => { vi.resetAllMocks(); api.reload.mockResolvedValue({ ok: true }); api.list.mockResolvedValue([]); });
afterEach(cleanup);

it('offers bulk reload only for enabled degraded plugins and preserves review', () => {
  const onReview = vi.fn();
  const { rerender } = render(<PluginAttention rows={buildHubRows([], [], [plugin('setup', { status: 'needs-configuration' }), plugin('disabled', { enabled: false }), plugin('healthy', { status: 'running' })])} issuesOnly={false} onReview={onReview} />);
  expect(screen.queryByRole('button', { name: /Reload degraded/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Review/ })); expect(onReview).toHaveBeenCalledOnce();
  rerender(<PluginAttention rows={buildHubRows([], [], [plugin('broken')])} issuesOnly onReview={onReview} />);
  expect(screen.getByText('1 plugin needs attention')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show all' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Reload degraded plugins (1)' })).toBeTruthy();
  rerender(<PluginAttention rows={[]} issuesOnly={false} onReview={onReview} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('reloads all degraded plugins regardless of list filters, in sequence, with progress and no duplicate batch', async () => {
  let finish!: (value: unknown) => void;
  api.reload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const input = [plugin('one'), plugin('two'), plugin('healthy', { status: 'running' }), plugin('disabled', { enabled: false }), plugin('setup', { status: 'needs-configuration' })];
  api.list.mockResolvedValue(input.map(item => ({ ...item, status: 'running' })));
  const view = setup(input); clickReload();
  const busy = screen.getByRole('button', { name: 'Reloading 1 of 2…' }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true); fireEvent.click(busy);
  expect(api.reload.mock.calls).toEqual([['one']]);
  // Lifecycle events can remove recovered rows while the batch is still running.
  view.rerender(<PluginAttention rows={[]} issuesOnly={false} onReview={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Reloading 1 of 2…' })).toBeTruthy();
  finish({ ok: true });
  await screen.findByText('2 plugins reloaded.');
  expect(api.reload.mock.calls).toEqual([['one'], ['two']]);
  expect(screen.queryByRole('button', { name: /Reload/ })).toBeNull();
});

it('continues after failed calls and reports runtimes that remain degraded or need setup', async () => {
  const input = ['denied', 'throwing', 'unknown', 'broken', 'setup', 'missing', 'healthy'].map(id => plugin(id));
  api.reload.mockImplementation(async id => {
    if (id === 'denied') return { ok: false };
    if (id === 'throwing') throw new Error('Host offline');
    if (id === 'unknown') throw 'Connection lost';
    return { ok: true };
  });
  api.list.mockResolvedValue([plugin('broken', { statusDetail: 'Still broken' }), plugin('setup', { status: 'needs-configuration' }), plugin('healthy', { status: 'running' })]);
  setup(input); clickReload();
  await screen.findByText('1 plugin reloaded; 6 need attention.');
  for (const message of ['denied: Reload failed', 'throwing: Host offline', 'unknown: Connection lost', 'broken: Still broken', 'setup: Needs setup', 'missing: Plugin is not running']) expect(screen.getByText(message)).toBeTruthy();
  expect(api.reload).toHaveBeenCalledTimes(7);
});

it.each([new Error('Status unavailable'), 'Disconnected'])('reports verification failures and permits retry', async error => {
  api.list.mockRejectedValueOnce(error);
  setup([plugin('one')]); clickReload();
  await screen.findByText(`Reload attempts finished. Could not verify plugin status: ${error instanceof Error ? error.message : error}`);
  api.list.mockResolvedValue([plugin('one', { status: 'running' })]); clickReload();
  await screen.findByText('1 plugin reloaded.');
  expect(api.reload).toHaveBeenCalledTimes(2);
});

it('keeps a specific host refusal visible', async () => {
  api.reload.mockResolvedValue({ ok: false, message: 'Reload denied' });
  setup([plugin('one')]); clickReload();
  await waitFor(() => expect(screen.getByText('one: Reload denied')).toBeTruthy());
});


it('keeps source-recovery issues reviewable without retrying their obsolete paths', () => {
  setup([plugin('moved', { sourceRecovery: { canLocate: true, canSwitchOfficial: false } })]);
  expect(screen.queryByRole('button', { name: /Reload degraded/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Review/ })).toBeTruthy();
});
