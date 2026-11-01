/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import type { PluginSdkApp, ZccContext, ZccNavigate, ZccWindowTitle } from '@zana-ai/zcc-plugin-sdk/app';

const h = vi.hoisted(() => ({
  view: null as { pluginId: string; tabId: string; projectId: string; resourceId?: string } | null,
  scoped: false,
  closeOff: vi.fn(),
  registerClose: vi.fn(),
  open: [] as Array<{ pluginId: string; tabId: string; projectId: string; resourceId?: string }>,
  openWindow: vi.fn(async () => true),
  showInMain: vi.fn(async () => true)
}));
vi.mock('./plugin-window-close.js', () => ({ registerPluginWindowCloseHandler: h.registerClose }));
vi.mock('../lib/pluginViewSurface.js', () => ({ getPluginViewTarget: () => h.view }));
vi.mock('../lib/windowScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/windowScope.js')>()),
  isScopedWindow: () => h.scoped
}));
vi.mock('./plugin-view-windows.js', async (importOriginal) => ({
  isPluginViewOpen: (await importOriginal<typeof import('./plugin-view-windows.js')>()).isPluginViewOpen,
  listOpenPluginViews: () => h.open,
  openPluginViewWindow: h.openWindow,
  showInMainWindow: h.showInMain
}));

import { installPluginRuntime } from './plugin-runtime.js';
import { PluginRuntimeContext } from './PluginSlotBoundary.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';
import { getPluginViewTitle } from './plugin-view-title.js';
import { onPluginPanelScopeRequest, PluginPagePanelProvider } from './plugin-page-panel.js';
import { hrefForPluginProjectTab } from './plugin-nav-href.js';

const studio = { pluginId: 'sales', tabId: 'studio', projectId: 'p-1' };

function registerTabs() {
  interpretPluginApp(
    'sales',
    definePluginApp((app) => {
      app.slots.projectTab({ id: 'records', label: 'Records', component: () => null });
      app.slots.projectTab({ id: 'studio', label: 'Studio', detachable: true, component: () => null });
      app.slots.projectTab({ id: 'flows', label: 'Flows', detachable: true, component: () => null });
    })
  );
}

function renderRuntime(path = '/', sidePanel = false, page = { pluginId: sidePanel ? 'sales' : 'other', page: 'studio' }, closeHandler: (() => void | Promise<void>) | null = null) {
  installPluginRuntime();
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
  const out = { navigate: null as ZccNavigate | null, context: null as ZccContext | null, path: '' };
  function Probe() {
    runtime.useWindowCloseHandler?.(closeHandler);
    out.navigate = runtime.useZccNavigate();
    out.context = runtime.useZccContext();
    const location = useLocation();
    out.path = `${location.pathname}${location.search}`;
    return null;
  }
  render(
    <MemoryRouter initialEntries={[path]}>
      <PluginPagePanelProvider page={page}>
        <PluginRuntimeContext.Provider value={{ pluginId: 'sales', generation: 0 }}>
          <Probe />
        </PluginRuntimeContext.Provider>
      </PluginPagePanelProvider>
    </MemoryRouter>
  );
  return out;
}

beforeEach(() => {
  h.view = null;
  h.scoped = false;
  h.open = [];
  h.openWindow.mockClear();
  h.showInMain.mockClear();
  h.closeOff.mockClear();
  h.registerClose.mockReset().mockReturnValue(h.closeOff);
  registerTabs();
});
afterEach(() => {
  cleanup();
  clearPluginSlots('sales');
});

describe('plugin context surface', () => {
  it('reports the main window and the routed project', () => {
    expect(renderRuntime('/projects/p-1').context).toMatchObject({ projectId: 'p-1', surface: 'main' });
  });

  it('reports a per-project window', () => {
    h.scoped = true;
    expect(renderRuntime('/projects/p-1').context?.surface).toBe('project-window');
  });

  it('reports a plugin view window and its project, with no thread', () => {
    h.view = studio;
    expect(renderRuntime('/threads/t-1').context).toEqual({ projectId: 'p-1', threadId: null, surface: 'plugin-view' });
  });

  it('reports the side panel beside a detached tab', () => {
    h.view = studio;
    expect(renderRuntime('/', true).context).toEqual({ projectId: 'p-1', threadId: null, surface: 'plugin-view', sidePanel: true });
  });
});

describe('navigate.openInWindow', () => {
  it('forwards resource identity and exposes it in detached context', async () => {
    h.view = { ...studio, resourceId: 'Help.agent' };
    const out = renderRuntime();
    expect(out.context?.resourceId).toBe('Help.agent');
    await out.navigate!.openInWindow!('p-1', { tabId: 'studio', resourceId: 'Quote.agent' });
    expect(h.openWindow).toHaveBeenCalledWith({ ...studio, resourceId: 'Quote.agent' });
  });
  it('opens the named detachable tab', async () => {
    await expect(renderRuntime().navigate!.openInWindow!('p-1', { tabId: 'flows' })).resolves.toBe(true);
    expect(h.openWindow).toHaveBeenCalledWith({ pluginId: 'sales', tabId: 'flows', projectId: 'p-1' });
  });

  it("opens the plugin's first detachable tab when none is named", async () => {
    await renderRuntime().navigate!.openInWindow!('p-1');
    expect(h.openWindow).toHaveBeenCalledWith(studio);
  });

  it('refuses a tab that did not opt in or does not exist', async () => {
    const navigate = renderRuntime().navigate!;
    await expect(navigate.openInWindow!('p-1', { tabId: 'records' })).resolves.toBe(false);
    await expect(navigate.openInWindow!('p-1', { tabId: 'missing' })).resolves.toBe(false);
    expect(h.openWindow).not.toHaveBeenCalled();
  });
});

describe('navigate in the main window', () => {
  it('keeps project navigation in the main window while resources are detached', () => {
    h.open = [{ ...studio, resourceId: 'Help.agent' }];
    const out = renderRuntime();
    act(() => out.navigate!.toProject('p-1', { tabId: 'studio' }));
    expect(h.openWindow).not.toHaveBeenCalled();
    expect(out.path).toContain('/projects/p-1');
  });
  it('routes in place', () => {
    const out = renderRuntime();
    act(() => out.navigate!.toThread('t-1'));
    expect(out.path).toBe('/threads/t-1');
    expect(h.showInMain).not.toHaveBeenCalled();
  });

  it('can explicitly use the main tab while its detached window remains open', () => {
    h.open = [studio];
    const out = renderRuntime();
    act(() => out.navigate!.toProject('p-1', { tabId: 'studio', inMainWindow: true }));
    expect(h.openWindow).not.toHaveBeenCalled();
    expect(out.path).toContain('/projects/p-1');
  });

  it('brings a detached tab window forward instead of routing to its placeholder', () => {
    h.open = [studio];
    const out = renderRuntime();
    act(() => out.navigate!.toProject('p-1', { tabId: 'studio' }));
    expect(h.openWindow).toHaveBeenCalledWith(studio);
    expect(out.path).toBe('/');
  });

  it('routes to a tab that is not detached', () => {
    const out = renderRuntime();
    act(() => out.navigate!.toProject('p-1', { tabId: 'studio' }));
    expect(h.openWindow).not.toHaveBeenCalled();
    expect(out.path).toContain('/projects/p-1');
  });
});

describe('navigate in a plugin view window', () => {
  beforeEach(() => {
    h.view = studio;
  });

  it('sends in-app navigation to the main window', () => {
    const out = renderRuntime();
    out.navigate!.toThread('t-1');
    out.navigate!.toProject('p-2');
    out.navigate!.toCompose({ initialPrompt: 'Fix it', focusPrompt: true });
    out.navigate!.toPluginPanel('home');
    expect(h.showInMain.mock.calls.map(([path]) => path)).toEqual([
      '/threads/t-1',
      '/projects/p-2',
      '/threads/new?prompt=Fix+it&focus=1',
      expect.stringContaining('home')
    ]);
    expect(out.path).toBe('/');
  });

  it('can request its own project tab in main without refocusing the detached window', () => {
    const out = renderRuntime();
    act(() => out.navigate!.toProject('p-1', { tabId: 'studio', inMainWindow: true }));
    expect(h.openWindow).not.toHaveBeenCalled();
    expect(h.showInMain).toHaveBeenCalledWith(expect.stringContaining('/projects/p-1'));
    expect(out.path).toBe('/');
  });

  it("focuses this window for its own tab instead of the main window's placeholder", () => {
    const out = renderRuntime();
    act(() => out.navigate!.toProject('p-1', { tabId: 'studio' }));
    expect(h.openWindow).toHaveBeenCalledWith(studio);
    expect(h.showInMain).not.toHaveBeenCalled();
    act(() => out.navigate!.toProject('p-1', { tabId: 'flows' }));
    expect(h.showInMain).toHaveBeenCalledWith(expect.stringContaining('/projects/p-1'));
  });

  it('has no conversation to open a thread panel beside', () => {
    expect(renderRuntime().navigate!.openThreadPanel({ actionId: 'a' })).toBe(false);
  });
});

describe('useWindowTitle', () => {
  function renderTitle(title: ZccWindowTitle | null, pluginId = 'sales') {
    installPluginRuntime();
    const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
    function Probe({ value }: { value: ZccWindowTitle | null }) {
      runtime.useWindowTitle(value);
      return null;
    }
    const tree = (value: ZccWindowTitle | null) => (
      <PluginRuntimeContext.Provider value={{ pluginId, generation: 0 }}>
        <Probe value={value} />
      </PluginRuntimeContext.Provider>
    );
    const out = render(tree(title));
    return { ...out, update: (value: ZccWindowTitle | null) => out.rerender(tree(value)) };
  }

  it("titles the plugin's own window while mounted, follows changes and releases on unmount", () => {
    h.view = studio;
    const out = renderTitle({ title: 'Agentforce · Help', detail: 'dev', badge: 'Production', tone: 'danger' });
    expect(getPluginViewTitle()).toEqual({ title: 'Agentforce · Help', detail: 'dev', badge: 'Production', tone: 'danger' });
    out.update({ title: 'Salesforce · Data' });
    expect(getPluginViewTitle()).toEqual({ title: 'Salesforce · Data', tone: 'neutral' });
    out.update(null);
    expect(getPluginViewTitle()).toBeNull();
    out.update({ title: 'Agentforce' });
    out.unmount();
    expect(getPluginViewTitle()).toBeNull();
  });

  it('keeps a nested title on top while the pane under it changes', () => {
    h.view = studio;
    installPluginRuntime();
    const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
    function Titled({ value }: { value: ZccWindowTitle | null }) {
      runtime.useWindowTitle(value);
      return null;
    }
    const tree = (pane: string, dialog: boolean) => (
      <PluginRuntimeContext.Provider value={{ pluginId: 'sales', generation: 0 }}>
        <Titled value={{ title: pane, badge: 'Production', tone: 'danger' }} />
        {dialog ? <Titled value={{ title: 'Review publish' }} /> : null}
      </PluginRuntimeContext.Provider>
    );
    const out = render(tree('Agentforce · Help', false));
    out.rerender(tree('Agentforce · Help', true));
    expect(getPluginViewTitle()?.title).toBe('Review publish');
    out.rerender(tree('Agentforce · Orders', true));
    expect(getPluginViewTitle()?.title).toBe('Review publish');
    out.rerender(tree('Agentforce · Orders', false));
    expect(getPluginViewTitle()).toEqual({ title: 'Agentforce · Orders', badge: 'Production', tone: 'danger' });
    out.unmount();
    expect(getPluginViewTitle()).toBeNull();
  });

  it("leaves the main window and another plugin's window alone", () => {
    renderTitle({ title: 'Agentforce' });
    expect(getPluginViewTitle()).toBeNull();
    cleanup();
    h.view = studio;
    renderTitle({ title: 'Agentforce' }, 'other');
    expect(getPluginViewTitle()).toBeNull();
  });
});

it('exposes a return-to-main resource selection only on the matching plugin route', () => {
  const path = hrefForPluginProjectTab('sales', 'p-1', 'studio', 'Help.agent');
  expect(renderRuntime(path).context).toMatchObject({ resourceId: 'Help.agent', resourceRequestId: 'default' });
  cleanup();
  expect(renderRuntime('/threads/t-1?pluginResourceId=Help.agent').context?.resourceId).toBeUndefined();
});

it('delegates panel scope selection to the enclosing page only', () => {
  const show = vi.fn();
  const page = { pluginId: 'sales', page: 'studio' };
  const off = onPluginPanelScopeRequest(page, show);
  try {
    const navigate = renderRuntime('/', true, page).navigate!;
    navigate.setPanelScope?.({ id: 'Help.agent', view: 'editor' });
    expect(show).toHaveBeenCalledWith({ id: 'Help.agent', view: 'editor' });
    navigate.setPanelScope?.(null);
    expect(show).toHaveBeenLastCalledWith(null);
  } finally { off(); }
});

it('registers a close handler only for its own detached plugin and disposes it', async () => {
  const callback = vi.fn(async () => undefined);
  renderRuntime('/', false, undefined, callback);
  expect(h.registerClose).not.toHaveBeenCalled();
  cleanup();
  h.view = { ...studio, pluginId: 'other' };
  renderRuntime('/', false, undefined, callback);
  expect(h.registerClose).not.toHaveBeenCalled();
  cleanup();
  h.view = studio;
  renderRuntime('/', false, undefined, callback);
  expect(h.registerClose).toHaveBeenCalledTimes(1);
  await h.registerClose.mock.calls[0]![0]();
  expect(callback).toHaveBeenCalledTimes(1);
  cleanup();
  expect(h.closeOff).toHaveBeenCalledTimes(1);
});
