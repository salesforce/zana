/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import type { PluginViewTitle } from '@/plugins/plugin-view-title';

const h = vi.hoisted(() => ({
  state: { configLoaded: true, projects: [{ id: 'p-1', name: 'Acme' }] as Array<{ id: string; name: string }>, init: vi.fn(async () => {}) },
  tabs: [] as PluginProjectTabRegistration[],
  title: null as PluginViewTitle | null,
  appsDone: null as null | (() => void),
  changed: null as null | ((entries: unknown[]) => void),
  offChanged: vi.fn(),
  reconcile: vi.fn(async () => {}),
  close: vi.fn(async () => true),
  show: vi.fn(async () => true)
}));
vi.mock('@/lib/monaco-loader', () => ({}));
vi.mock('@/store', () => ({ useData: (select: (state: typeof h.state) => unknown) => select(h.state) }));
vi.mock('@/components/HostDialogs', () => ({ HostDialogs: () => null }));
vi.mock('@/components/Toaster', () => ({ Toaster: () => null }));
vi.mock('@/plugins/PluginThemesHost', () => ({ PluginThemesHost: () => null }));
vi.mock('@/views/thread-detail/PluginPanelHostLayout', () => ({
  PluginPanelHostLayout: ({ pluginId, panelPath, scopeId, resourceId, separateWindow, children }: { pluginId: string; panelPath: string; scopeId?: string; resourceId?: string; separateWindow?: boolean; children: ReactNode }) => (
    <div data-testid="plugin-view-side-panel" data-page={`${pluginId}/${panelPath}`} data-scope={scopeId} data-resource={resourceId} data-window={String(separateWindow)}>{children}</div>
  )
}));
vi.mock('@/plugins/PluginSlotBoundary', () => ({ PluginSlotBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/plugins/plugin-app-loader', () => ({
  initPluginApps: () => new Promise<void>((resolve) => { h.appsDone = resolve; }),
  reconcilePluginApps: h.reconcile
}));
vi.mock('@/plugins/plugin-slots', () => ({ listProjectTabs: () => h.tabs, subscribePluginSlots: () => () => {} }));
vi.mock('@/plugins/plugin-nav-href', () => ({
  hrefForPluginProjectTab: (pluginId: string, projectId: string, tabId: string, resourceId?: string) => `/tabs/${pluginId}/${projectId}/${tabId}${resourceId === undefined ? "" : `?pluginResourceId=${encodeURIComponent(resourceId)}`}`
}));
vi.mock('@/plugins/plugin-view-windows', () => ({ closePluginViewWindow: h.close, showInMainWindow: h.show }));
vi.mock('@/plugins/plugin-view-title', () => ({ usePluginViewTitle: () => h.title }));
vi.mock('@/hooks/useShellChromeState', () => ({ useShellChromeState: () => ({ platform: 'macos', reserveMacosTrafficLights: true }) }));
vi.mock('@/lib/product-client', () => ({
  product: {
    pluginApps: {
      onChanged: (callback: (entries: unknown[]) => void) => {
        h.changed = callback;
        return h.offChanged;
      }
    }
  }
}));

import { PluginViewApp } from './PluginViewApp.js';

const target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p-1' };
const tab = (extra: Partial<PluginProjectTabRegistration> = {}) =>
  ({
    id: 'studio',
    pluginId: 'salesforce',
    generation: 1,
    label: 'Studio',
    detachable: true,
    component: ({ projectId }: { projectId: string }) => <p>studio for {projectId}</p>,
    ...extra
  }) as PluginProjectTabRegistration;

async function mount() {
  const view = render(<PluginViewApp target={target} />);
  await act(async () => { h.appsDone?.(); });
  return view;
}

beforeEach(() => {
  h.state.configLoaded = true;
  h.state.projects = [{ id: 'p-1', name: 'Acme' }];
  h.tabs = [tab()];
  h.title = null;
  h.appsDone = null;
  h.changed = null;
  for (const fn of [h.state.init, h.offChanged, h.reconcile, h.close, h.show]) fn.mockClear();
});
afterEach(cleanup);

it('waits for plugin apps before showing the tab', () => {
  h.tabs = [];
  render(<PluginViewApp target={target} />);
  expect(screen.getByTestId('plugin-view-loading')).toBeTruthy();
  expect(h.state.init).toHaveBeenCalled();
});

it('shows the detached tab under its own title strip and reconciles plugin app changes', async () => {
  h.title = { title: 'MyBot', detail: 'dev org', badge: 'Production', tone: 'danger' };
  const view = await mount();
  expect(screen.getByText('studio for p-1')).toBeTruthy();
  // The detached tab uses the same shared side panel as a project tab.
  expect(screen.getByTestId('plugin-view-side-panel').dataset).toMatchObject({ page: 'salesforce/studio', scope: 'p-1', window: 'true' });
  expect(screen.getByTestId('plugin-view-title').textContent).toBe('MyBot — Acme · dev org');
  const badge = screen.getByTestId('plugin-view-title-badge');
  expect(badge.textContent).toBe('Production');
  expect(badge.className).toContain('is-danger');
  expect(document.title).toContain('MyBot');
  expect(screen.getByTestId('plugin-view-window').dataset.platform).toBe('macos');

  h.changed!([{ id: 'salesforce' }]);
  expect(h.reconcile).toHaveBeenCalledWith([{ id: 'salesforce' }]);
  view.unmount();
  expect(h.offChanged).toHaveBeenCalled();
  h.changed!([]);
  expect(h.reconcile).toHaveBeenCalledTimes(1);
});

it('falls back to the tab label when the plugin sets no title', async () => {
  await mount();
  expect(screen.getByTestId('plugin-view-title').textContent).toBe('Studio — Acme');
  expect(screen.queryByTestId('plugin-view-title-badge')).toBeNull();
});

it('brings the tab back to the main window, then closes this one', async () => {
  await mount();
  await act(async () => { fireEvent.click(screen.getByTestId('plugin-view-bring-back')); });
  expect(h.show).toHaveBeenCalledWith('/tabs/salesforce/p-1/studio');
  expect(h.close).toHaveBeenCalledWith(target);
});

it('closes on the platform close shortcut only', async () => {
  await mount();
  fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
  expect(h.close).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'w', metaKey: true });
  expect(h.close).toHaveBeenCalledWith(target);
});

it('offers to close the window when the project or the tab is gone', async () => {
  h.state.projects = [];
  const view = await mount();
  expect(screen.getByText('Project not found')).toBeTruthy();
  expect(screen.getByTestId('plugin-view-title').textContent).toBe('Plugin');
  fireEvent.click(screen.getByText('Close window'));
  expect(h.close).toHaveBeenCalledTimes(1);
  view.unmount();

  h.state.projects = [{ id: 'p-1', name: 'Acme' }];
  h.tabs = [];
  await mount();
  expect(screen.getByText('Plugin tab unavailable')).toBeTruthy();
  fireEvent.click(screen.getByText('Close window'));
  expect(h.close).toHaveBeenCalledTimes(2);
});

it('sends a tab that does not detach back to the main window', async () => {
  h.tabs = [tab({ detachable: false })];
  h.title = { title: 'Ignored', tone: 'neutral' };
  await mount();
  expect(screen.getByText('Studio stays in the main window')).toBeTruthy();
  expect(screen.getByTestId('plugin-view-title').textContent).toBe('Studio — Acme');
  expect(screen.queryByTestId('plugin-view-bring-back')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByText('Show in main window')); });
  expect(h.show).toHaveBeenCalledWith('/tabs/salesforce/p-1/studio');
});

it('ignores plugin apps that finish loading after the window closed', async () => {
  const view = render(<PluginViewApp target={target} />);
  view.unmount();
  await act(async () => { h.appsDone?.(); });
  expect(h.offChanged).toHaveBeenCalled();
});

it('keeps the project scope while passing resource identity to the host panel', async () => {
  await act(async () => { render(<PluginViewApp target={{ ...target, resourceId: 'Help.agent' }} />); });
  expect(screen.getByTestId('plugin-view-side-panel').dataset).toMatchObject({ scope: 'p-1', resource: 'Help.agent' });
});

it('returns a specific resource to main and leaves its window open if main cannot navigate', async () => {
  render(<PluginViewApp target={{ ...target, resourceId: 'Help.agent' }} />);
  await act(async () => { h.appsDone?.(); });
  h.show.mockResolvedValueOnce(false);
  await act(async () => { fireEvent.click(screen.getByTestId('plugin-view-bring-back')); });
  expect(h.show).toHaveBeenCalledWith('/tabs/salesforce/p-1/studio?pluginResourceId=Help.agent');
  expect(h.close).not.toHaveBeenCalled();
  h.show.mockResolvedValueOnce(true);
  await act(async () => { fireEvent.click(screen.getByTestId('plugin-view-bring-back')); });
  expect(h.close).toHaveBeenCalledWith({ ...target, resourceId: 'Help.agent' });
});
