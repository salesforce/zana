/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ nav: 'example', path: 'second' as string | undefined }));
vi.mock('../hooks/useRouteState.js', () => ({ useRouteState: () => ({ nav: h.nav, pluginPanelPath: h.path, pluginSubPath: 'details' }) }));
vi.mock('./plugin-slots.js', () => {
  const panels = ['first', 'second'].map(id => ({ pluginId: 'example', id, generation: 1, component: ({ subPath }: { subPath: string }) => <p>{id}:{subPath}</p> }));
  return { listNavPanels: () => panels, subscribePluginSlots: () => () => {} };
});
vi.mock('./PluginSlotBoundary.js', () => ({ PluginSlotBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('../views/thread-detail/PluginPanelHostLayout.js', () => ({
  PluginPanelHostLayout: ({ pluginId, panelPath, children }: { pluginId: string; panelPath: string; children: ReactNode }) =>
    <section data-testid="shared-host" data-owner={`${pluginId}/${panelPath}`}>{children}</section>
}));
import { PluginNavPanelHost, useHasPluginNavPanel } from './PluginNavPanelHost.js';
afterEach(() => { cleanup(); h.nav = 'example'; h.path = 'second'; });

it('mounts the requested nav page with its route inside the shared host', () => {
  render(<PluginNavPanelHost />);
  expect(screen.getByTestId('shared-host').dataset.owner).toBe('example/second');
  expect(screen.getByText('second:details')).toBeTruthy();
});
it.each(['missing', undefined])('falls back to the first registered panel for %s', path => {
  h.path = path;
  render(<PluginNavPanelHost />);
  expect(screen.getByTestId('shared-host').dataset.owner).toBe('example/first');
});
it('does not create a host for a destination without plugin pages', () => {
  h.nav = 'other';
  expect(render(<PluginNavPanelHost />).container.childElementCount).toBe(0);
});
it('reports whether a plugin has a registered nav page', () => {
  function Probe() { return <p>{String(useHasPluginNavPanel('example'))}:{String(useHasPluginNavPanel('missing'))}</p>; }
  render(<Probe />);
  expect(screen.getByText('true:false')).toBeTruthy();
});
