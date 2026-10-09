// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const reveal = vi.hoisted(() => ({ clearHash: undefined as undefined | (() => void), args: [] as any[] }));
vi.mock('@/lib/settings-search/reveal', async (orig) => ({
  ...(await orig<object>()),
  useSettingsTargetReveal: (args: any) => {
    reveal.clearHash = args.clearHash;
    reveal.args.push(args);
    return { target: null, reveal: null };
  }
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: vi.fn(async () => ({ theme: 'dark' })), set: vi.fn(), onChanged: () => () => {} },
  app: { homedir: vi.fn(async () => '/home/u') },
  openers: { openIn: vi.fn(async () => undefined) }
} }));
vi.mock('@/views/settings/AboutView', () => ({ AboutTab: () => <p>about</p> }));
import { useUi } from '@/store';
import { SettingsView } from './SettingsView';

let seen: { pathname: string; search: string; hash: string; state: unknown; key: string } | null = null;
function Probe() { seen = useLocation() as any; return null; }
const mount = (entry: string | { pathname: string; search?: string; hash?: string; state?: unknown }) =>
  render(<MemoryRouter initialEntries={[entry as any]}><SettingsView /><Probe /></MemoryRouter>);

beforeEach(() => {
  reveal.clearHash = undefined; reveal.args = []; seen = null;
  useUi.setState({ settingsTab: 'about', settingsAnchor: null });
});
afterEach(cleanup);

it('drops the handled #target from the router location, keeping path, search and state', async () => {
  mount({ pathname: '/settings/about', search: '?x=1', hash: '#about-developer', state: { from: 'search' } });
  await screen.findByRole('heading', { level: 1 });
  expect(seen!.hash).toBe('#about-developer');
  const before = seen!.key;
  await act(async () => { reveal.clearHash!(); });
  expect(seen!.hash).toBe('');
  expect(seen!.pathname).toBe('/settings/about');
  expect(seen!.search).toBe('?x=1');
  expect(seen!.state).toEqual({ from: 'search' });
  expect(seen!.key).not.toBe(before);
});

it('does not navigate when the location has no hash', async () => {
  mount('/settings/about');
  await screen.findByRole('heading', { level: 1 });
  const before = seen!.key;
  await act(async () => { reveal.clearHash!(); });
  expect(seen!.key).toBe(before);
});

it('passes no anchor to the reveal until the config has loaded', async () => {
  useUi.setState({ settingsAnchor: 'about-developer' });
  mount('/settings/about');
  expect(reveal.args[0].anchor).toBeNull();
  await screen.findByRole('heading', { level: 1 });
  expect(reveal.args.at(-1).anchor).toBe('about-developer');
});
