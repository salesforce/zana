// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
