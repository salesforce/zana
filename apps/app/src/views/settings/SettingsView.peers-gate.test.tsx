// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  plugins: [] as unknown[]
}));

vi.mock('@/lib/settings-search/reveal', async (orig) => ({
  ...(await orig<object>()),
  useSettingsTargetReveal: () => ({ target: null, reveal: null })
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: vi.fn(async () => h.config), set: vi.fn(), onChanged: () => () => {} },
  pluginApps: { list: vi.fn(async () => h.plugins), onChanged: () => () => {} },
  app: { homedir: vi.fn(async () => '/home/u') },
  openers: { openIn: vi.fn(async () => undefined) }
}, peerLinks: { list: vi.fn(async () => ({ links: [] })) } }));
vi.mock('@/views/settings/AboutView', () => ({ AboutTab: () => <p>about</p> }));
vi.mock('@/views/settings/GlobalView', () => ({ GlobalTab: () => <p>global-page</p> }));
vi.mock('@/views/settings/PeersSettingsView', () => ({ PeersSettingsView: () => <p>peers-page</p> }));
import { useUi } from '@/store';
import { SettingsView } from './SettingsView';

function Path() { return <div data-testid="path">{useLocation().pathname}</div>; }
const mount = (entry: string) =>
  render(<MemoryRouter initialEntries={[entry]}><SettingsView /><Path /></MemoryRouter>);

beforeEach(() => {
  h.config = { theme: 'dark' };
  h.plugins = [];
  useUi.setState({ settingsTab: 'peers', settingsAnchor: null });
});
afterEach(cleanup);

it('redirects a deep link to Peers to Preferences when the toggle is off', async () => {
  h.plugins = [{ id: 'x', enabled: true, peers: true }];
  mount('/settings/peers');
  await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/settings/global'));
  expect(screen.queryByText('peers-page')).toBeNull();
});

it('redirects when the toggle is on but no enabled plugin supports peers', async () => {
  h.config = { theme: 'dark', peersSettingsEnabled: true };
  h.plugins = [{ id: 'x', enabled: false, peers: true }, { id: 'y', enabled: true }];
  mount('/settings/peers');
  await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/settings/global'));
  expect(screen.queryByText('peers-page')).toBeNull();
});

it('renders the Peers page when the toggle is on and a plugin supports peers', async () => {
  h.config = { theme: 'dark', peersSettingsEnabled: true };
  h.plugins = [{ id: 'x', enabled: true, peers: true }];
  mount('/settings/peers');
  expect(await screen.findByText('peers-page')).toBeTruthy();
  expect(screen.getByTestId('path').textContent).toBe('/settings/peers');
});
