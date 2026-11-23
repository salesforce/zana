// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExperimentalPluginToggles } from './ExperimentalPluginToggles';

const mocks = vi.hoisted(() => ({
  plugins: [{ id: 'sample', name: 'Sample', description: 'An experiment', enabled: false, experimental: true },
    { id: 'other', name: 'Other', description: '', enabled: true, experimental: false }],
  setEnabled: vi.fn(), list: vi.fn(), reconcile: vi.fn(), toast: vi.fn()
}));
vi.mock('@/plugins/installed-plugin-store', () => ({ useInstalledPlugins: () => ({ plugins: mocks.plugins }) }));
vi.mock('@/lib/product-client', () => ({ product: { pluginApps: { setEnabled: mocks.setEnabled, list: mocks.list } } }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: mocks.reconcile }));
vi.mock('@/store', () => ({ useUi: { getState: () => ({ pushToast: mocks.toast }) } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.plugins[0].enabled = false;
  mocks.list.mockResolvedValue(mocks.plugins);
});
afterEach(cleanup);

it('only offers registered experiments and reflects changes from the plugin manager', async () => {
  const { rerender } = render(<ExperimentalPluginToggles />);
  const toggle = screen.getByRole('switch', { name: 'Sample' }) as HTMLButtonElement;
  expect(screen.queryByRole('switch', { name: 'Other' })).toBeNull();
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  let resolve!: (result: { ok: true }) => void;
  mocks.setEnabled.mockReturnValue(new Promise(r => { resolve = r; }));
  fireEvent.click(toggle);
  expect(mocks.setEnabled).toHaveBeenCalledWith('sample', true);
  expect(toggle.disabled).toBe(true);
  mocks.plugins[0].enabled = true;
  resolve({ ok: true });
  await waitFor(() => expect(toggle.disabled).toBe(false));
  expect(mocks.reconcile).toHaveBeenCalledWith(mocks.plugins);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  mocks.plugins[0].enabled = false;
  rerender(<ExperimentalPluginToggles />);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

it.each(['denied', 'offline', 'unknown'])('shows a %s failure and restores the switch', async (reason) => {
  mocks.plugins[0].enabled = true;
  if (reason === 'denied') mocks.setEnabled.mockResolvedValue({ ok: false, message: reason });
  else mocks.setEnabled.mockRejectedValue(reason === 'offline' ? new Error(reason) : null);
  render(<ExperimentalPluginToggles />);
  const toggle = screen.getByRole('switch', { name: 'Sample' });
  fireEvent.click(toggle);
  expect(mocks.setEnabled).toHaveBeenCalledWith('sample', false);
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(reason === 'unknown' ? 'Failed to update plugin' : reason, 'error'));
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
