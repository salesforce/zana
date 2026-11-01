// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/product-client.js', () => ({ product: { config: { set: vi.fn(async () => ({})) } } }));
import { useUi } from '../store.js';
import { useRouteSync } from './useRouteSync.js';

function Probe() { useRouteSync(); return null; }
const mount = (url: string) => render(<MemoryRouter initialEntries={[url]}><Probe /></MemoryRouter>);

beforeEach(() => { useUi.setState({ nav: 'agents', settingsTab: 'global', settingsAnchor: null, focusedProjectId: null }); });
afterEach(cleanup);

it('keeps a pending store anchor on a Settings route whose URL carries no hash', () => {
  useUi.setState({ settingsAnchor: 'terminal-fonts' });
  mount('/settings/terminal');
  expect(useUi.getState().nav).toBe('settings');
  expect(useUi.getState().settingsTab).toBe('terminal');
  expect(useUi.getState().settingsAnchor).toBe('terminal-fonts');
});

it('lets the URL hash win over a pending store anchor', () => {
  useUi.setState({ settingsAnchor: 'stale' });
  mount('/settings/terminal#fresh');
  expect(useUi.getState().settingsAnchor).toBe('fresh');
});

it('resets a pending anchor when the route is not Settings', () => {
  useUi.setState({ settingsAnchor: 'stale' });
  mount('/inbox');
  expect(useUi.getState().nav).toBe('inbox');
  expect(useUi.getState().settingsAnchor).toBeNull();
});

// #532: with navigations committed at once, Settings consumes the anchor and
// clears the hash in the same effect flush. The mirror must not then restore the
// anchor from the location it just left, or opening the result again does nothing.
it('lets a page consume a hash anchor once, so opening the same result again reveals it again', () => {
  const consumed: string[] = [];
  let navigate: NavigateFunction = () => undefined;
  function SettingsPage() {
    const anchor = useUi((s) => s.settingsAnchor);
    const location = useLocation();
    navigate = useNavigate();
    useEffect(() => {
      if (!anchor) return;
      consumed.push(anchor);
      useUi.getState().setSettingsAnchor(null);
      if (location.hash) void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchor]);
    return null;
  }
  function Shell() { useRouteSync(); return <SettingsPage />; }
  render(<MemoryRouter initialEntries={['/settings/terminal']} useTransitions={false}><Shell /></MemoryRouter>);
  const open = () => act(() => {
    useUi.getState().setSettingsAnchor('terminal.tmux-persistence');
    void navigate('/settings/terminal#terminal.tmux-persistence');
  });
  open();
  expect(consumed).toEqual(['terminal.tmux-persistence']);
  expect(useUi.getState().settingsAnchor).toBeNull();
  open();
  expect(consumed).toEqual(['terminal.tmux-persistence', 'terminal.tmux-persistence']);
  expect(useUi.getState().settingsAnchor).toBeNull();
});
