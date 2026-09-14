// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const desktop = vi.hoisted(() => ({
  api: null as object | null
}));
const emptyActions = vi.hoisted(() => [] as never[]);

vi.mock('../../lib/desktop-browser.js', () => ({
  getDesktopBrowserApi: () => desktop.api
}));
vi.mock('../../lib/product-client.js', () => ({
  product: { fs: { walkFiles: async () => [] } }
}));
vi.mock('../../store.js', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] })
}));
vi.mock('../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: () => () => undefined,
  listThreadPanelActions: () => emptyActions,
  listNewThreadPanelActions: () => emptyActions
}));
vi.mock('../../lib/app-surface.js', () => ({
  hasDesktopBridge: () => desktop.api !== null
}));

import { pluginPanelBrowserOwnerId, PluginPanelHostLayout } from './PluginPanelHostLayout.js';

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pluginPanelBrowserOwnerId', () => {
  it('namespaces the secondary-panel owner by plugin and path', () => {
    expect(pluginPanelBrowserOwnerId('docs', 'panel')).toBe('plugin-panel:docs:panel');
  });
});

describe('PluginPanelHostLayout', () => {
  it('renders children without a host panel when the desktop browser is unavailable', () => {
    desktop.api = null;
    const view = render(
      <PluginPanelHostLayout pluginId="docs" panelPath="panel">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    expect(view.getByText('slot:docs')).toBeTruthy();
    expect(view.queryByTestId('plugin-panel-host-layout')).toBeNull();
    view.unmount();
  });

  it('opens a Browser tab from the host launcher when the desktop browser exists', () => {
    desktop.api = {
      attach: vi.fn(),
      detach: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      onState: () => () => undefined,
      onOpenTab: () => () => undefined
    };
    const view = render(
      <PluginPanelHostLayout pluginId="docs" panelPath="panel">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    fireEvent.click(screen.getByTestId('plugin-panel-secondary-show'));
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    fireEvent.click(screen.getByTestId('thread-new-tab-browser'));
    expect(screen.getByTestId('thread-browser-tab')).toBeTruthy();
    view.unmount();
    desktop.api = null;
  });
});
