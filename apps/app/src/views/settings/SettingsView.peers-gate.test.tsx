// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>
}));

vi.mock('@/lib/settings-search/reveal', async (orig) => ({
  ...(await orig<object>()),
  useSettingsTargetReveal: () => ({ target: null, reveal: null })
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: vi.fn(async () => h.config), set: vi.fn(), onChanged: () => () => {} },
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
  useUi.setState({ settingsTab: 'peers', settingsAnchor: null });
});
afterEach(cleanup);

it('renders the Peers page without an experimental opt-in', async () => {
  mount('/settings/peers');
  expect(await screen.findByText('peers-page')).toBeTruthy();
  expect(screen.getByTestId('path').textContent).toBe('/settings/peers');
});
