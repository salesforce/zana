// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useData, useUi } from '@/store';
import { SettingsView } from './SettingsView.js';

const set = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: async () => ({}), set, onChanged: () => () => {} },
  app: { homedir: async () => '/home/u' },
  pluginApps: { list: async () => [], onChanged: () => () => {} },
  extensions: { list: async () => [], onChanged: () => () => {} }
} }));
vi.mock('@/lib/app-surface', async (load) => ({
  ...await load<typeof import('@/lib/app-surface')>(),
  getAppSurface: () => 'desktop'
}));
vi.mock('@/lib/shellChrome', async (load) => ({
  ...await load<typeof import('@/lib/shellChrome')>(),
  shellPlatform: () => 'macos'
}));

const initial = useData.getState().glassModeEnabled;
const { settingsAnchor, settingsTab } = useUi.getState();
beforeEach(() => {
  set.mockReset();
  useUi.setState({ settingsTab: 'experimental', settingsAnchor: null });
  useData.setState({ glassModeEnabled: false });
});
afterEach(() => {
  cleanup();
  useUi.setState({ settingsAnchor, settingsTab });
  useData.setState({ glassModeEnabled: initial });
});

it('updates the shell store with the saved Glass Mode preference', async () => {
  set.mockResolvedValueOnce({ glassModeEnabled: true }).mockResolvedValueOnce({ glassModeEnabled: false });
  render(<MemoryRouter initialEntries={['/settings/experimental']}><SettingsView /></MemoryRouter>);

  const toggle = await screen.findByRole('switch', { name: 'Glass Mode' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(useData.getState().glassModeEnabled).toBe(true));
  expect(set).toHaveBeenNthCalledWith(1, { glassModeEnabled: true });
  expect(toggle.getAttribute('aria-checked')).toBe('true');

  fireEvent.click(toggle);
  await waitFor(() => expect(useData.getState().glassModeEnabled).toBe(false));
  expect(set).toHaveBeenNthCalledWith(2, { glassModeEnabled: false });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});
