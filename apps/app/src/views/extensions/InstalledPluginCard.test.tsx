// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { buildHubRows, type HubRow } from './installed-plugins.js';
const state = vi.hoisted(() => ({ desktop: true, toast: vi.fn(), toggle: vi.fn(), update: vi.fn(), list: vi.fn(), reconcile: vi.fn() }));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => state.desktop }));
vi.mock('@/lib/product-client', () => ({ product: { pluginApps: { setEnabled: state.toggle, applyUpdate: state.update, list: state.list }, extensions: { setEnabled: state.toggle } } }));
vi.mock('@/store', () => ({ useUi: { getState: () => ({ pushToast: state.toast }) } }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: state.reconcile }));
vi.mock('@/lib/resolveIcon', () => ({ resolveIcon: () => () => <svg data-testid="fallback-icon" /> }));
import { InstalledPluginCard } from './InstalledPluginCard.js';

function row(over: Partial<PluginAppEntry> = {}): HubRow {
  return buildHubRows([], [], [{ id: 'example', name: 'Example', description: 'A useful tool', icon: 'Box', enabled: true,
    provenance: 'builtin', status: 'running', appUrl: null, ...over }])[0]!;
}
beforeEach(() => {
  vi.clearAllMocks(); state.desktop = true;
  state.toggle.mockResolvedValue({ ok: true }); state.update.mockResolvedValue({ ok: true });
  state.list.mockResolvedValue([]); state.reconcile.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('opens details separately from updates and toggles, and falls back when a branding image fails', () => {
  const onOpen = vi.fn();
  const { container, rerender } = render(<InstalledPluginCard row={row({ icon: './icons/logo.svg', skillNames: ['example'] })} onOpen={onOpen} />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/plugins/example/assets/icons/logo.svg');
  fireEvent.error(container.querySelector('img')!);
  expect(screen.getByTestId('fallback-icon')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Example plugin details' }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Capabilities').textContent).toBe('Skills');
  fireEvent.click(screen.getByRole('button', { name: 'Open Example', exact: true }));
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Bundled')).toBeTruthy();
  rerender(<InstalledPluginCard row={row({ icon: './new.svg', provenance: 'direct' })} onOpen={onOpen} />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/plugins/example/assets/new.svg');
  expect(screen.getByText('Direct install')).toBeTruthy();
});

it('shows an optimistic pending switch and reconciles the renderer after success', async () => {
  let resolve!: (value: { ok: true }) => void;
  state.toggle.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const onOpen = vi.fn();
  render(<InstalledPluginCard row={row()} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('switch'));
  expect(state.toggle).toHaveBeenCalledWith('example', false);
  expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
  expect(onOpen).not.toHaveBeenCalled();
  resolve({ ok: true });
  await waitFor(() => expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(false));
  await waitFor(() => expect(state.reconcile).toHaveBeenCalledWith([]));
});

it.each([{ ok: false, message: 'Enable denied' }, new Error('Toggle failed'), 'unexpected'])('rolls back failed toggles and reports %j', async (failure) => {
  if (typeof failure === 'object' && !(failure instanceof Error)) state.toggle.mockResolvedValueOnce(failure);
  else state.toggle.mockRejectedValueOnce(failure);
  render(<InstalledPluginCard row={row()} onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(
    failure instanceof Error ? 'Toggle failed' : typeof failure === 'string' ? 'Failed to update plugin' : 'Enable denied', 'error'));
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
  expect(state.reconcile).not.toHaveBeenCalled();
});

it('keeps runtime warnings actionable and reports enabled plugins that are not running', () => {
  const onOpen = vi.fn();
  const { rerender } = render(<InstalledPluginCard row={row({ status: 'needs-configuration', statusDetail: 'Connect your account' })} onOpen={onOpen} />);
  expect(screen.getByText('A useful tool')).toBeTruthy();
  expect(screen.queryByText('Connect your account')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Example: Needs configuration/ }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.getByRole('switch').getAttribute('aria-label')).toContain('not running');
  rerender(<InstalledPluginCard row={row({ status: 'degraded' })} onOpen={onOpen} />);
  expect(screen.getByTestId('plugin-runtime-status-example').className).toContain('--warning');
  rerender(<InstalledPluginCard row={{ ...row(), module: { ...row().module, loadError: 'bad module' } }} onOpen={onOpen} />);
  expect(screen.getByTestId('plugin-runtime-status-example').className).toContain('--error');
  rerender(<InstalledPluginCard row={row({ status: 'disabled' })} onOpen={onOpen} />);
  expect(screen.getByTestId('plugin-not-running-example').textContent).toBe('not running');
});

it('keeps disk-only and non-toggleable entries visible on the appropriate surface', async () => {
  const disk: HubRow = { module: { id: 'legacy', title: 'Legacy', icon: 'Box' }, plugin: null,
    entry: { id: 'legacy', enabled: false, source: 'local' } as ExtensionEntry };
  state.desktop = false;
  const { rerender } = render(<InstalledPluginCard row={disk} onOpen={vi.fn()} />);
  expect(screen.getByText('Owner desktop')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  state.desktop = true;
  rerender(<InstalledPluginCard row={disk} onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(state.toggle).toHaveBeenCalledWith('legacy', true));
  rerender(<InstalledPluginCard row={{ ...disk, entry: null }} onOpen={vi.fn()} />);
  expect(screen.queryByRole('switch')).toBeNull();
});

it('applies an update once, disables it while pending, and reports the version', async () => {
  let resolve!: (value: { ok: true }) => void;
  state.update.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const onOpen = vi.fn();
  render(<InstalledPluginCard row={row({ availableVersion: '2.0' })} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Update Example to 2.0' }));
  expect(screen.getByText('Updating…')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Update Example to 2.0' }));
  expect(state.update).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  resolve({ ok: true });
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith('Updated Example to 2.0'));
});

it.each([{ ok: false, message: 'Update denied' }, { ok: false }, new Error('Update failed'), 'unexpected'])('reports failed updates %j and restores the action', async (failure) => {
  if (typeof failure === 'object' && !(failure instanceof Error)) state.update.mockResolvedValueOnce(failure);
  else state.update.mockRejectedValueOnce(failure);
  render(<InstalledPluginCard row={row({ availableVersion: '2.0' })} onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Update Example to 2.0' }));
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(
    failure instanceof Error ? 'Update failed' : typeof failure === 'string' || !failure.message ? 'Failed to update plugin' : 'Update denied', 'error'));
  expect((screen.getByRole('button', { name: 'Update Example to 2.0' }) as HTMLButtonElement).disabled).toBe(false);
});
